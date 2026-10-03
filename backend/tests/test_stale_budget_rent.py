"""Regression test for the Suburb Finder's recent-rows rule on the budget figure.

lowest_rent (the figure the budget is checked against) may only come from rent
rows with quarters_stale < 4 -- the same age rule that marks a suburb STALE in
the data pipeline. An older row must never be used, however cheap.

The real data can't pin the exact boundary, so this builds a modified copy of
hamilton.db and starts its own backend on it:

- Whitiora: its Flat/1-bed row is set to $50 and exactly 4 quarters old (just
  too old), and its Flat/2-bed row to $55 and 3 quarters old (just recent
  enough). The $55 row must be the budget figure, never the $50 one.
- Claudelands: every specific dwelling-type row is set to 4 quarters old, so
  it has no recent specific row. Its budget figure must fall back to its
  cheapest recent dwelling_type = 'ALL' row, and it must stay included.

Both suburbs' ALL/ALL rows are left untouched, so both stay CURRENT.

Standalone like test_suburb_finder.py, but needs no server already running.

Usage:
    python3 backend/tests/test_stale_budget_rent.py

Exits non-zero if any check fails.
"""

import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REAL_DB = os.path.join(ROOT, "data-pipeline", "output", "hamilton.db")
SERVER = os.path.join(ROOT, "backend", "server.js")
BOUNDARY_SUBURB = "Whitiora"
FALLBACK_SUBURB = "Claudelands"
results_log = []


def check(name, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    results_log.append((status, name, detail))
    print(f"[{status}] {name}" + (f" -- {detail}" if detail and status == 'FAIL' else ""))


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def set_row(conn, sa2_code, dwelling_type, number_of_beds, median_rent, quarters_stale):
    cur = conn.execute(
        "UPDATE rent SET median_rent = ?, quarters_stale = ? WHERE sa2_code = ? AND dwelling_type = ? AND number_of_beds = ?",
        (median_rent, quarters_stale, sa2_code, dwelling_type, number_of_beds),
    )
    if cur.rowcount != 1:
        raise RuntimeError(f"fixture: expected one {dwelling_type}/{number_of_beds} row for {sa2_code}, updated {cur.rowcount}")


def build_fixture_db(path):
    """Returns (statuses, expected fallback row) read back from the fixture."""
    shutil.copy(REAL_DB, path)
    with sqlite3.connect(path) as conn:
        code_of = lambda name: conn.execute("SELECT sa2_code FROM suburbs WHERE sa2_name = ?", (name,)).fetchone()[0]
        boundary, fallback = code_of(BOUNDARY_SUBURB), code_of(FALLBACK_SUBURB)

        set_row(conn, boundary, "Flat", "1", 50, 4)
        set_row(conn, boundary, "Flat", "2", 55, 3)

        conn.execute("UPDATE rent SET quarters_stale = 4 WHERE sa2_code = ? AND dwelling_type != 'ALL'", (fallback,))
        expected_fallback = conn.execute(
            """SELECT number_of_beds, median_rent FROM rent
               WHERE sa2_code = ? AND dwelling_type = 'ALL' AND median_rent IS NOT NULL AND quarters_stale < 4
               ORDER BY median_rent LIMIT 1""",
            (fallback,),
        ).fetchone()

        statuses = dict(conn.execute(
            "SELECT s.sa2_name, d.data_status FROM suburbs s JOIN suburb_data_status d USING (sa2_code) WHERE s.sa2_name IN (?, ?)",
            (BOUNDARY_SUBURB, FALLBACK_SUBURB),
        ).fetchall())
    return statuses, expected_fallback


def wait_for_server(base, proc):
    for _ in range(50):
        if proc.poll() is not None:
            raise RuntimeError("backend exited before it was ready")
        try:
            with urllib.request.urlopen(base + "/api/health"):
                return
        except (urllib.error.URLError, ConnectionError):
            time.sleep(0.2)
    raise RuntimeError("backend did not become ready")


def main():
    tmp = tempfile.mkdtemp()
    proc = None
    try:
        db_path = os.path.join(tmp, "hamilton.db")
        statuses, expected_fallback = build_fixture_db(db_path)
        check("fixture: both modified suburbs are still CURRENT",
              statuses == {BOUNDARY_SUBURB: "CURRENT", FALLBACK_SUBURB: "CURRENT"}, statuses)
        check(f"fixture: {FALLBACK_SUBURB} has a recent dwelling_type = 'ALL' row to fall back to",
              expected_fallback is not None, expected_fallback)

        port = free_port()
        base = f"http://127.0.0.1:{port}"
        proc = subprocess.Popen(
            ["node", SERVER],
            env={**os.environ, "PORT": str(port), "DB_PATH": db_path},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        wait_for_server(base, proc)

        def call(params):
            url = base + "/api/suburb-finder?" + urllib.parse.urlencode(params)
            with urllib.request.urlopen(url) as resp:
                return json.loads(resp.read())

        def find(entries, name):
            return next((e for e in entries if e["sa2_name"] == name), None)

        # Boundary: the 3-quarter-old $55 row is used, the 4-quarter-old $50 one isn't.
        body = call({"budget": 10000, "destination": "The Base"})
        lr = (find(body["results"], BOUNDARY_SUBURB) or {}).get("lowest_rent")
        check(f"boundary: {BOUNDARY_SUBURB}'s budget figure is the 3-quarter-old $55 Flat/2-bed row",
              lr is not None and lr["value"] == 55 and lr["dwelling_type"] == "Flat" and lr["number_of_beds"] == "2", lr)

        body = call({"budget": 52, "destination": "The Base"})
        entry = find(body["excluded"], BOUNDARY_SUBURB)
        check(f"boundary: {BOUNDARY_SUBURB} excluded at budget=52 (the $50 row is 4 quarters old, so it doesn't count)",
              entry is not None and entry["reason"] == "exceeds_budget" and entry["lowest_rent"]["value"] == 55, entry)
        check(f"boundary: {BOUNDARY_SUBURB} not in results at budget=52",
              find(body["results"], BOUNDARY_SUBURB) is None)

        body = call({"budget": 55, "destination": "The Base"})
        check(f"boundary: {BOUNDARY_SUBURB} included at budget=55 (its recent figure)",
              find(body["results"], BOUNDARY_SUBURB) is not None, [x["sa2_name"] for x in body["results"]])

        # Fallback: no recent specific row, so the cheapest recent ALL row is used.
        body = call({"budget": 10000, "destination": "The Base"})
        lr = (find(body["results"], FALLBACK_SUBURB) or {}).get("lowest_rent")
        if expected_fallback is not None:
            beds, rent = expected_fallback
            check(f"fallback: {FALLBACK_SUBURB} falls back to its cheapest recent ALL row (ALL/{beds}, ${rent:g})",
                  lr is not None and lr["dwelling_type"] == "ALL" and lr["number_of_beds"] == beds and lr["value"] == rent, lr)

            body = call({"budget": rent - 1, "destination": "The Base"})
            entry = find(body["excluded"], FALLBACK_SUBURB)
            check(f"fallback: {FALLBACK_SUBURB} excluded as exceeds_budget just below that figure, not insufficient_data",
                  entry is not None and entry["reason"] == "exceeds_budget", entry)
    finally:
        if proc is not None:
            proc.terminate()
            proc.wait()
        shutil.rmtree(tmp, ignore_errors=True)

    passed = sum(1 for s, _, _ in results_log if s == "PASS")
    failed = sum(1 for s, _, _ in results_log if s == "FAIL")
    print(f"\n{passed} passed, {failed} failed out of {len(results_log)} checks")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
