"""Regression test for GET /api/rental-price-check.

Standalone like test_suburb_finder.py. The expected values are read straight
from hamilton.db with SQL here, not taken from earlier API output, so a check
fails if the endpoint picks the wrong row, labels a rent wrongly or falls back
to the wrong level.

Prerequisites: the backend must already be running locally on port 3001
(`npm start` or `node server.js` from backend/).

Usage:
    python3 backend/tests/test_rental_price_check.py

Exits non-zero if any check fails.
"""

import json
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Override to run the same checks against a deployed server, e.g.
#   BASE_URL=https://<your-app>.onrender.com python3 backend/tests/test_rental_price_check.py
BASE = os.environ.get("BASE_URL", "http://localhost:3001").rstrip("/") + "/api/rental-price-check"
DB_PATH = os.environ.get(
    "DB_PATH", Path(__file__).resolve().parents[2] / "data-pipeline" / "output" / "hamilton.db"
)
db = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
db.row_factory = sqlite3.Row
results_log = []


def call(params):
    url = BASE + "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def check(name, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    results_log.append((status, name, detail))
    print(f"[{status}] {name}" + (f" -- {detail}" if detail and status == 'FAIL' else ""))


def sa2(name):
    return db.execute("SELECT sa2_code FROM suburbs WHERE sa2_name = ?", (name,)).fetchone()[0]


def rent_row(code, dwelling_type, beds):
    return db.execute(
        "SELECT * FROM rent WHERE sa2_code = ? AND dwelling_type = ? AND number_of_beds = ?",
        (code, dwelling_type, beds),
    ).fetchone()


def same_figures(body, row):
    return (body["median_rent"], body["lower_quartile_rent"], body["upper_quartile_rent"],
            body["total_bonds"], body["timeframe"]) == (
        row["median_rent"], row["lower_quartile_rent"], row["upper_quartile_rent"],
        row["total_bonds"], row["timeframe"])


HAMILTON_EAST = sa2("Hamilton East")
FLAGSTAFF_NORTH = sa2("Flagstaff North")

# --- 1. Validation errors ---
code, body = call({"dwelling_type": "House"})
check("missing sa2_code -> 400", code == 400, body)

code, body = call({"sa2_code": HAMILTON_EAST})
check("missing dwelling_type -> 400", code == 400, body)

code, body = call({"sa2_code": "abc", "dwelling_type": "House"})
check("non-numeric sa2_code -> 400", code == 400, body)

code, body = call({"sa2_code": "175300.5", "dwelling_type": "House"})
check("non-integer sa2_code -> 400", code == 400, body)

code, body = call({"sa2_code": HAMILTON_EAST, "dwelling_type": "Castle"})
check("unknown dwelling_type -> 400", code == 400, body)

code, body = call({"sa2_code": HAMILTON_EAST, "dwelling_type": "House", "number_of_beds": "Al"})
check("unknown number_of_beds -> 400", code == 400, body)

code, body = call({"sa2_code": HAMILTON_EAST, "dwelling_type": "House", "rent": -1})
check("negative rent -> 400", code == 400, body)

code, body = call({"sa2_code": 999999, "dwelling_type": "House"})
check("unknown sa2_code -> 404", code == 404, body)

# Forms JavaScript's Number() would quietly accept. Found by a hostile-input
# probe; they must be rejected, not read as 0 or as a hex number.
code, body = call({"sa2_code": " ", "dwelling_type": "House"})
check("whitespace sa2_code -> 400", code == 400, body)

code, body = call({"sa2_code": hex(HAMILTON_EAST), "dwelling_type": "House"})
check("hex sa2_code -> 400 (not read as that suburb)", code == 400, body)

code, body = call({"sa2_code": HAMILTON_EAST, "dwelling_type": "House", "rent": "   "})
check("whitespace rent -> 400 (not read as 0)", code == 400, body)

code, body = call({"sa2_code": HAMILTON_EAST, "dwelling_type": "House", "rent": "0x1F"})
check("hex rent -> 400", code == 400, body)

# --- 2. Exact match: Hamilton East, House, 1 bedroom ---
row = rent_row(HAMILTON_EAST, "House", "1")
code, body = call({"sa2_code": HAMILTON_EAST, "dwelling_type": "House", "number_of_beds": "1"})
check("exact match -> 200, fallback_level none", code == 200 and body["fallback_level"] == "none", body.get("fallback_level"))
check("exact match -> median, quartiles, bonds and quarter equal the rent table row", same_figures(body, row),
      (body.get("median_rent"), dict(row)))
check("no rent given -> no comparison", "comparison" not in body and "rent" not in body)

code, body = call({"sa2_code": HAMILTON_EAST, "dwelling_type": "House", "number_of_beds": "1", "rent": ""})
check("empty rent -> treated as no rent (no $0 comparison)", code == 200 and "comparison" not in body, body.get("comparison"))

# --- 3. Comparison label boundaries, from the row's own quartiles ---
lq, uq = row["lower_quartile_rent"], row["upper_quartile_rent"]
for rent, expected in [(lq - 1, "Below market"), (lq, "Fair"), (uq, "Fair"), (uq + 1, "Above market")]:
    code, body = call({"sa2_code": HAMILTON_EAST, "dwelling_type": "House", "number_of_beds": "1", "rent": rent})
    check(f"rent {rent} (LQ {lq}, UQ {uq}) -> {expected}", body.get("comparison") == expected, body.get("comparison"))

code, body = call({"sa2_code": HAMILTON_EAST, "dwelling_type": "House", "number_of_beds": "1", "rent": "400.5"})
check("decimal rent still accepted", code == 200 and body.get("rent") == 400.5, body.get("rent"))

# --- 4. Omitted bedrooms mean ALL ---
code_a, body_a = call({"sa2_code": HAMILTON_EAST, "dwelling_type": "House"})
code_b, body_b = call({"sa2_code": HAMILTON_EAST, "dwelling_type": "House", "number_of_beds": "ALL"})
check("omitted number_of_beds -> same row as ALL", same_figures(body_a, rent_row(HAMILTON_EAST, "House", "ALL"))
      and body_a["median_rent"] == body_b["median_rent"], (body_a.get("median_rent"), body_b.get("median_rent")))

# --- 5. Fallback, level 1: same dwelling type, all bedrooms ---
check("Flagstaff North has no House/6 row (precondition)", rent_row(FLAGSTAFF_NORTH, "House", "6") is None)
code, body = call({"sa2_code": FLAGSTAFF_NORTH, "dwelling_type": "House", "number_of_beds": "6"})
check("House/6 -> fallback_level dwelling_type with a note",
      body.get("fallback_level") == "dwelling_type" and bool(body.get("fallback_note")), body.get("fallback_level"))
check("House/6 -> figures of the House/ALL row", same_figures(body, rent_row(FLAGSTAFF_NORTH, "House", "ALL")),
      body.get("median_rent"))

# --- 6. Fallback, level 2: whole suburb ---
# A suburb with an ALL/ALL row but no row at all for some dwelling type.
full = db.execute("""
    SELECT s.sa2_code, d.dwelling_type FROM suburbs s
    CROSS JOIN (SELECT 'Apartment' AS dwelling_type UNION SELECT 'Boarding House' UNION SELECT 'Flat'
                UNION SELECT 'House' UNION SELECT 'Room') d
    WHERE EXISTS (SELECT 1 FROM rent r WHERE r.sa2_code = s.sa2_code
                  AND r.dwelling_type = 'ALL' AND r.number_of_beds = 'ALL')
      AND NOT EXISTS (SELECT 1 FROM rent r WHERE r.sa2_code = s.sa2_code AND r.dwelling_type = d.dwelling_type)
    ORDER BY s.sa2_code, d.dwelling_type LIMIT 1
""").fetchone()
check("a suburb/dwelling type with no rows exists (precondition)", full is not None)
if full:
    code, body = call({"sa2_code": full["sa2_code"], "dwelling_type": full["dwelling_type"], "number_of_beds": "2"})
    check("no rows for the dwelling type -> fallback_level full", body.get("fallback_level") == "full", body.get("fallback_level"))
    check("full fallback -> figures of the suburb's ALL/ALL row",
          same_figures(body, rent_row(full["sa2_code"], "ALL", "ALL")), body.get("median_rent"))

# --- 7. Warnings ---
latest = db.execute("SELECT MAX(timeframe) FROM rent").fetchone()[0]
old = db.execute("""
    SELECT * FROM rent WHERE timeframe < ? AND dwelling_type != 'ALL' AND number_of_beds != 'ALL'
      AND number_of_beds IS NOT NULL AND median_rent IS NOT NULL ORDER BY sa2_code LIMIT 1
""", (latest,)).fetchone()
code, body = call({"sa2_code": old["sa2_code"], "dwelling_type": old["dwelling_type"], "number_of_beds": old["number_of_beds"]})
check("a row older than the latest quarter -> staleness warning", bool(body.get("staleness_warning")), body.get("staleness_warning"))

code, body = call({"sa2_code": HAMILTON_EAST, "dwelling_type": "House", "number_of_beds": "1"})
check("a row from the latest quarter -> no staleness warning",
      row["timeframe"] == latest and body.get("staleness_warning") is None, body.get("staleness_warning"))

small = db.execute("""
    SELECT * FROM rent WHERE total_bonds <= 6 AND dwelling_type != 'ALL' AND number_of_beds != 'ALL'
      AND number_of_beds IS NOT NULL AND median_rent IS NOT NULL ORDER BY sa2_code LIMIT 1
""").fetchone()
code, body = call({"sa2_code": small["sa2_code"], "dwelling_type": small["dwelling_type"], "number_of_beds": small["number_of_beds"]})
check("6 bonds or fewer -> small-sample warning", body.get("low_sample_warning") is True, body.get("total_bonds"))

code, body = call({"sa2_code": HAMILTON_EAST, "dwelling_type": "House", "number_of_beds": "1"})
check("more than 6 bonds -> no small-sample warning", row["total_bonds"] > 6 and body.get("low_sample_warning") is False)

# --- 8. Rent breakdown ---
expected_types = {r[0] for r in db.execute("""
    SELECT DISTINCT dwelling_type FROM rent WHERE sa2_code = ? AND dwelling_type != 'ALL'
      AND number_of_beds = 'ALL' AND median_rent IS NOT NULL
""", (HAMILTON_EAST,))}
shown_types = {t["dwelling_type"] for t in body.get("dwelling_type_breakdown", [])}
check("breakdown lists every dwelling type with a figure", shown_types == expected_types, (shown_types, expected_types))

# --- summary ---
passed = sum(1 for s, _, _ in results_log if s == "PASS")
failed = sum(1 for s, _, _ in results_log if s == "FAIL")
print(f"\n{passed} passed, {failed} failed out of {len(results_log)} checks")
sys.exit(1 if failed else 0)
