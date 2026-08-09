"""Regression test for GET /api/suburb-finder.

Not part of an automated test runner (no pytest/jest harness exists in this
project yet) — this is a standalone script exercising the real endpoint
against the real hamilton.db data, the same way it was verified manually
during development.

Prerequisites: the backend must already be running locally on port 3001
(`npm start` or `node server.js` from backend/).

Usage:
    python3 backend/tests/test_suburb_finder.py

Exits non-zero if any check fails, so it can still be wired into CI later.
"""

import json
import sys
import urllib.request
import urllib.parse

BASE = "http://localhost:3001/api/suburb-finder"
results_log = []

def call(params):
    url = BASE + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

def check(name, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    results_log.append((status, name, detail))
    print(f"[{status}] {name}" + (f" -- {detail}" if detail and status == 'FAIL' else ""))

# --- 1. Validation errors ---
code, body = call({"destination": "The Base"})
check("missing budget -> 400", code == 400, body)

code, body = call({"budget": 500})
check("missing destination -> 400", code == 400, body)

code, body = call({"budget": 500, "destination": "Mars Base"})
check("invalid destination -> 400", code == 400, body)

code, body = call({"budget": -10, "destination": "The Base"})
check("negative budget -> 400", code == 400, body)

code, body = call({"budget": "abc", "destination": "The Base"})
check("non-numeric budget -> 400", code == 400, body)

code, body = call({"budget": 500, "destination": "The Base", "rent_weight": -1})
check("negative weight -> 400", code == 400, body)

code, body = call({"budget": 500, "destination": "The Base", "rent_weight": "xyz"})
check("non-numeric weight -> 400", code == 400, body)

code, body = call({"budget": 500, "destination": "The Base", "rent_weight": 0, "transport_weight": 0, "distance_weight": 0})
check("all weights zero -> 400", code == 400, body)

# --- 2. Empty result set ---
code, body = call({"budget": 300, "destination": "The Base"})
check("empty result set -> 200, results=[], no_suburbs_in_budget", code == 200 and body["results"] == [] and body["no_suburbs_in_budget"] is True, body)
check("empty result set cheapest hint mentions $340", "$340" in body.get("message", ""), body.get("message"))

# --- 3. N=1 exact tie ---
code, body = call({"budget": 345, "destination": "The Base"})
r = body["results"]
check("N=1 -> exactly 1 result, rank 1, overall_score 0.5", code == 200 and len(r) == 1 and r[0]["rank"] == 1 and r[0]["overall_score"] == 0.5, r)

# --- 4. Normal case, cross-checked ---
code, body = call({"budget": 500, "destination": "The Base"})
r = body["results"]
check("budget=500 -> 10 results", len(r) == 10, len(r))
check("budget=500 -> ranked descending by overall_score", all(r[i]["overall_score"] >= r[i+1]["overall_score"] for i in range(len(r)-1)), [x["overall_score"] for x in r])
check("budget=500 -> Hamilton Central ranks #1 (equal weights)", r[0]["sa2_name"] == "Hamilton Central", r[0])
hc = next(x for x in r if x["sa2_name"] == "Hamilton Central")
manual = round((0.625 + 1 + 0.6789) / 3, 4)
check("Hamilton Central overall_score matches manual calc", abs(hc["overall_score"] - manual) < 0.001, (hc["overall_score"], manual))

# --- 5. Full population (very high budget) ---
code, body = call({"budget": 10000, "destination": "The Base"})
r = body["results"]
ex = body["excluded"]
check("budget=10000 -> 60 results (all CURRENT suburbs)", len(r) == 60, len(r))
check("budget=10000 -> only 2 excluded, both insufficient_data", len(ex) == 2 and all(e["reason"] == "insufficient_data" for e in ex), ex)
te_rapa_names = {e["sa2_name"] for e in ex}
check("budget=10000 -> Te Rapa North and South both excluded", te_rapa_names == {"Te Rapa North", "Te Rapa South"}, te_rapa_names)
check("budget=10000 -> included + excluded = 62", len(r) + len(ex) == 62, (len(r), len(ex)))
ranks = [x["rank"] for x in r]
check("budget=10000 -> ranks are 1..60 with no gaps/dupes", ranks == list(range(1, 61)), ranks[:5])

# --- 6. Each destination individually, moderate budget ---
nearest_by_dest = {}
for dest in ["University of Waikato", "Transport Centre", "The Base", "Waikato Hospital"]:
    code, body = call({"budget": 550, "destination": dest})
    r = body["results"]
    check(f"destination={dest} -> 200, non-empty results", code == 200 and len(r) > 0, len(r))
    # closest suburb by raw distance value among results
    nearest = min(r, key=lambda x: x["score_breakdown"]["distance"]["value"])
    nearest_by_dest[dest] = nearest["sa2_name"]
check("distance nearest-suburb differs meaningfully across destinations", len(set(nearest_by_dest.values())) >= 2, nearest_by_dest)

# --- 7. Zero-bus-stop suburbs included without crashing ---
code, body = call({"budget": 1000, "destination": "The Base"})
r = body["results"]
zero_stop_names = {"Rotokauri-Waiwhakareke", "Ruakura", "Peacockes"}
present = {x["sa2_name"]: x for x in r if x["sa2_name"] in zero_stop_names}
check("all 3 zero-bus-stop suburbs present at budget=1000", set(present.keys()) == zero_stop_names, set(present.keys()))
check("zero-bus-stop suburbs have transport normalised_score == 0", all(v["score_breakdown"]["transport"]["normalised_score"] == 0 for v in present.values()), {k: v["score_breakdown"]["transport"] for k, v in present.items()})

# --- 8. Determinism across repeated identical calls ---
code, b1 = call({"budget": 550, "destination": "The Base"})
code, b2 = call({"budget": 550, "destination": "The Base"})
check("identical repeated queries -> identical rank ordering", [x["sa2_code"] for x in b1["results"]] == [x["sa2_code"] for x in b2["results"]])

# --- 9. Explicit zero weight on one criterion (transport ignored) ---
code, body = call({"budget": 500, "destination": "The Base", "transport_weight": 0})
check("transport_weight=0 explicit -> weights_used.transport == 0", body["weights_used"]["transport"] == 0, body["weights_used"])
r = body["results"]
check("transport_weight=0 -> overall_score independent of transport score", all(
    abs(x["overall_score"] - round((0.5 * x["score_breakdown"]["rent"]["normalised_score"] + 0.5 * x["score_breakdown"]["distance"]["normalised_score"]), 4)) < 0.001
    for x in r
), [(x["sa2_name"], x["overall_score"]) for x in r][:3])

# --- 10. No suburb appears in both included and excluded ---
code, body = call({"budget": 550, "destination": "The Base"})
included_codes = {x["sa2_code"] for x in body["results"]}
excluded_codes = {x["sa2_code"] for x in body["excluded"]}
check("no suburb in both results and excluded", included_codes.isdisjoint(excluded_codes))
check("results + excluded covers all 62 suburbs", len(included_codes) + len(excluded_codes) == 62, len(included_codes) + len(excluded_codes))

# --- summary ---
passed = sum(1 for s, _, _ in results_log if s == "PASS")
failed = sum(1 for s, _, _ in results_log if s == "FAIL")
print(f"\n{passed} passed, {failed} failed out of {len(results_log)} checks")
sys.exit(1 if failed else 0)
