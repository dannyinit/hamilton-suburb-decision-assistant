"""Regression test for the Suburb Finder's null guard on the budget figure.

A suburb with no rent row that has a median at all -- not even a
dwelling_type = 'ALL' one -- has no figure to check against the budget. It
must be excluded (reason insufficient_data, data_status still CURRENT), never
compared: `null > budget` is false in JS, which once let such a suburb
through at any budget.

The real data has no such suburb, so this builds a modified copy of
hamilton.db (every median_rent for Peacockes set to NULL, its CURRENT status
left untouched) and starts its own backend on it. Peacockes has the highest
sa2_code, so it is the last row the cheapest-suburb hint in the empty-result
message sees -- the position where a null would once have won that
comparison too.

Standalone like test_suburb_finder.py, but needs no server already running.

Usage:
    python3 backend/tests/test_null_budget_rent.py

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
NULLED_SUBURB = "Peacockes"
results_log = []


def check(name, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    results_log.append((status, name, detail))
    print(f"[{status}] {name}" + (f" -- {detail}" if detail and status == 'FAIL' else ""))


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def build_fixture_db(path):
    shutil.copy(REAL_DB, path)
    with sqlite3.connect(path) as conn:
        (sa2_code,) = conn.execute("SELECT sa2_code FROM suburbs WHERE sa2_name = ?", (NULLED_SUBURB,)).fetchone()
        conn.execute("UPDATE rent SET median_rent = NULL WHERE sa2_code = ?", (sa2_code,))
        (status,) = conn.execute("SELECT data_status FROM suburb_data_status WHERE sa2_code = ?", (sa2_code,)).fetchone()
    return status


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
        status = build_fixture_db(db_path)
        check(f"fixture: {NULLED_SUBURB} is still CURRENT with every median nulled", status == "CURRENT", status)

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

        # At a budget every real figure passes, the nulled suburb is still out.
        body = call({"budget": 10000, "destination": "The Base"})
        entry = next((e for e in body["excluded"] if e["sa2_name"] == NULLED_SUBURB), None)
        check(f"null budget figure: {NULLED_SUBURB} not in results at budget=10000",
              all(x["sa2_name"] != NULLED_SUBURB for x in body["results"]))
        check(f"null budget figure: {NULLED_SUBURB} excluded as insufficient_data with data_status CURRENT",
              entry is not None and entry["reason"] == "insufficient_data" and entry["data_status"] == "CURRENT", entry)
        check("null budget figure: every other suburb is still included",
              len(body["results"]) == 61 and len(body["excluded"]) == 1, (len(body["results"]), len(body["excluded"])))

        # And at a budget nothing fits, it can't win the cheapest-suburb hint.
        body = call({"budget": 100, "destination": "The Base"})
        check("null budget figure: budget=100 still returns no results", body["results"] == [] and body.get("no_suburbs_in_budget") is True, body.get("results"))
        check("null budget figure: cheapest-suburb hint still names $125, never null",
              "$125/week" in body.get("message", "") and "null" not in body.get("message", ""), body.get("message"))
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
