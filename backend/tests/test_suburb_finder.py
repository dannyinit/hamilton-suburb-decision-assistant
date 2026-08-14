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

code, body = call({"budget": 500, "destination": "Mars Base"})
check("invalid destination -> 400", code == 400, body)

code, body = call({"budget": 500, "destination": ""})
check("empty destination -> 400 (distinct from omitted)", code == 400, body)

code, body = call({"budget": -10, "destination": "The Base"})
check("negative budget -> 400", code == 400, body)

code, body = call({"budget": "abc", "destination": "The Base"})
check("non-numeric budget -> 400", code == 400, body)

code, body = call({"budget": 500, "destination": "The Base", "rent_weight": -1})
check("negative weight -> 400", code == 400, body)

code, body = call({"budget": 500, "destination": "The Base", "rent_weight": "xyz"})
check("non-numeric weight -> 400", code == 400, body)

code, body = call({"budget": 500, "destination": "The Base", "rent_weight": 0, "transport_weight": 0, "distance_weight": 0})
check("all weights zero (with destination) -> 400", code == 400, body)

# --- 2. Optional destination ---
code, body = call({"budget": 500})
check("no destination -> 200, not a validation error", code == 200, body)
check("no destination -> destination: null", body.get("destination") is None, body.get("destination"))
check("no destination -> distance_excluded: true with a note", body.get("distance_excluded") is True and isinstance(body.get("distance_excluded_note"), str) and len(body["distance_excluded_note"]) > 0, body.get("distance_excluded_note"))
check("no destination -> weights_used has exactly rent+transport", set(body["weights_used"].keys()) == {"rent", "transport"}, body["weights_used"])
no_dest_results = body["results"]
check("no destination -> score_breakdown has exactly rent+transport per suburb", all(set(x["score_breakdown"].keys()) == {"rent", "transport"} for x in no_dest_results), [set(x["score_breakdown"].keys()) for x in no_dest_results[:3]])

# Hard constraints don't depend on destination, so the same budget should
# produce the identical included/excluded suburb sets either way — only the
# scoring/ranking differs.
code, with_dest_body = call({"budget": 500, "destination": "The Base"})
no_dest_codes = {x["sa2_code"] for x in no_dest_results}
with_dest_codes = {x["sa2_code"] for x in with_dest_body["results"]}
check("no destination -> same included suburbs as with destination (hard constraints unaffected)", no_dest_codes == with_dest_codes, (len(no_dest_codes), len(with_dest_codes)))
no_dest_excluded = {(x["sa2_code"], x["reason"]) for x in body["excluded"]}
with_dest_excluded = {(x["sa2_code"], x["reason"]) for x in with_dest_body["excluded"]}
check("no destination -> identical excluded set as with destination", no_dest_excluded == with_dest_excluded)

# N=1 exact tie, no destination: both remaining criteria hit the tie branch,
# and since the two weights always sum to 1, overall_score is still 0.5.
code, body = call({"budget": 345})
r = body["results"]
check("no destination, N=1 -> exactly 1 result, overall_score 0.5", code == 200 and len(r) == 1 and r[0]["overall_score"] == 0.5, r)
check("no destination, N=1 -> score_breakdown has no distance key", "distance" not in r[0]["score_breakdown"], r[0]["score_breakdown"])

# Without distance to fall back on, zeroing both remaining weights must 400 —
# and the message must not reference distance_weight, since it's not even
# applicable in this mode.
code, body = call({"budget": 500, "rent_weight": 0, "transport_weight": 0})
check("no destination, both weights zero -> 400", code == 400, body)
check("no destination, both weights zero -> error names only rent_weight/transport_weight", "rent_weight" in body.get("error", "") and "transport_weight" in body.get("error", "") and "distance_weight" not in body.get("error", ""), body.get("error"))

# distance_weight supplied without a destination is silently ignored, not an
# error and not reflected anywhere in the response.
code, body = call({"budget": 500, "distance_weight": 5})
check("no destination, distance_weight supplied anyway -> silently ignored, still 200", code == 200 and set(body["weights_used"].keys()) == {"rent", "transport"}, body["weights_used"])

# --- 3. Empty result set ---
code, body = call({"budget": 300, "destination": "The Base"})
check("empty result set -> 200, results=[], no_suburbs_in_budget", code == 200 and body["results"] == [] and body["no_suburbs_in_budget"] is True, body)
check("empty result set cheapest hint mentions $340", "$340" in body.get("message", ""), body.get("message"))

# --- 4. N=1 exact tie (with destination) ---
code, body = call({"budget": 345, "destination": "The Base"})
r = body["results"]
check("N=1 -> exactly 1 result, rank 1, overall_score 0.5", code == 200 and len(r) == 1 and r[0]["rank"] == 1 and r[0]["overall_score"] == 0.5, r)

# --- 5. Normal case, cross-checked ---
code, body = call({"budget": 500, "destination": "The Base"})
r = body["results"]
check("budget=500 -> 10 results", len(r) == 10, len(r))
check("budget=500 -> ranked descending by overall_score", all(r[i]["overall_score"] >= r[i+1]["overall_score"] for i in range(len(r)-1)), [x["overall_score"] for x in r])
check("budget=500 -> Hamilton Central ranks #1 (equal weights)", r[0]["sa2_name"] == "Hamilton Central", r[0])
hc = next(x for x in r if x["sa2_name"] == "Hamilton Central")
manual = round((0.625 + 1 + 0.6789) / 3, 4)
check("Hamilton Central overall_score matches manual calc", abs(hc["overall_score"] - manual) < 0.001, (hc["overall_score"], manual))

# --- 6. Full population (very high budget) ---
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

# --- 7. Each destination individually, moderate budget ---
nearest_by_dest = {}
for dest in ["University of Waikato", "Transport Centre", "The Base", "Waikato Hospital"]:
    code, body = call({"budget": 550, "destination": dest})
    r = body["results"]
    check(f"destination={dest} -> 200, non-empty results", code == 200 and len(r) > 0, len(r))
    # closest suburb by raw distance value among results
    nearest = min(r, key=lambda x: x["score_breakdown"]["distance"]["value"])
    nearest_by_dest[dest] = nearest["sa2_name"]
check("distance nearest-suburb differs meaningfully across destinations", len(set(nearest_by_dest.values())) >= 2, nearest_by_dest)

# --- 8. Zero-bus-stop suburbs included without crashing ---
code, body = call({"budget": 1000, "destination": "The Base"})
r = body["results"]
zero_stop_names = {"Rotokauri-Waiwhakareke", "Ruakura", "Peacockes"}
present = {x["sa2_name"]: x for x in r if x["sa2_name"] in zero_stop_names}
check("all 3 zero-bus-stop suburbs present at budget=1000", set(present.keys()) == zero_stop_names, set(present.keys()))
check("zero-bus-stop suburbs have transport normalised_score == 0", all(v["score_breakdown"]["transport"]["normalised_score"] == 0 for v in present.values()), {k: v["score_breakdown"]["transport"] for k, v in present.items()})

# --- 9. Determinism across repeated identical calls ---
code, b1 = call({"budget": 550, "destination": "The Base"})
code, b2 = call({"budget": 550, "destination": "The Base"})
check("identical repeated queries -> identical rank ordering", [x["sa2_code"] for x in b1["results"]] == [x["sa2_code"] for x in b2["results"]])

# --- 10. Explicit zero weight on one criterion (transport ignored) ---
code, body = call({"budget": 500, "destination": "The Base", "transport_weight": 0})
check("transport_weight=0 explicit -> weights_used.transport == 0", body["weights_used"]["transport"] == 0, body["weights_used"])
r = body["results"]
check("transport_weight=0 -> overall_score independent of transport score", all(
    abs(x["overall_score"] - round((0.5 * x["score_breakdown"]["rent"]["normalised_score"] + 0.5 * x["score_breakdown"]["distance"]["normalised_score"]), 4)) < 0.001
    for x in r
), [(x["sa2_name"], x["overall_score"]) for x in r][:3])

# --- 11. No suburb appears in both included and excluded ---
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
