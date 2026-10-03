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
import os
import sys
import urllib.request
import urllib.parse

# Override to run the same checks against a deployed server, e.g.
#   BASE_URL=https://<your-app>.onrender.com python3 backend/tests/test_suburb_finder.py
BASE = os.environ.get("BASE_URL", "http://localhost:3001").rstrip("/") + "/api/suburb-finder"
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
# $195 is inside the N=1 window under lowest_rent-based filtering with only
# recent rows counted (Pukete East's lowest_rent is $192, the next cheapest
# suburb's is Kahikatea's $200).
code, body = call({"budget": 195})
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
# $100 is below the cheapest recent lowest_rent in the dataset ($192, Pukete
# East's 2-bed Apartment).
code, body = call({"budget": 100, "destination": "The Base"})
check("empty result set -> 200, results=[], no_suburbs_in_budget", code == 200 and body["results"] == [] and body["no_suburbs_in_budget"] is True, body)
check("empty result set cheapest hint mentions $192", "$192" in body.get("message", ""), body.get("message"))

# --- 4. N=1 exact tie (with destination) ---
code, body = call({"budget": 195, "destination": "The Base"})
r = body["results"]
check("N=1 -> exactly 1 result, rank 1, overall_score 0.5", code == 200 and len(r) == 1 and r[0]["rank"] == 1 and r[0]["overall_score"] == 0.5, r)

# --- 5. Normal case, cross-checked ---
# 23 results (not the pre-lowest_rent 10) -- lowest_rent-based filtering
# admits suburbs whose specific cheapest option fits the budget even though
# their suburb-wide median_rent doesn't. (39 before only recent rows counted.)
code, body = call({"budget": 500, "destination": "The Base"})
r = body["results"]
check("budget=500 -> 23 results", len(r) == 23, len(r))
check("budget=500 -> ranked descending by overall_score", all(r[i]["overall_score"] >= r[i+1]["overall_score"] for i in range(len(r)-1)), [x["overall_score"] for x in r])
check("budget=500 -> Hamilton Central ranks #1 (equal weights)", r[0]["sa2_name"] == "Hamilton Central", r[0])
hc = next(x for x in r if x["sa2_name"] == "Hamilton Central")
# rent normalised_score is 0.6133: its $495 median against the survivors'
# $350-$725 range, (725 - 495) / 375.
# distance normalised_score is 0.4337: distance_m (5982.44) rounds to 6000m
# for scoring (see the 100m rounding step), against the survivors'
# 1300m-9600m range, (9600 - 6000) / 8300.
# transport normalised_score is 1: Hamilton Central's 9.49 routes are the
# most of any survivor.
manual = round((0.6133 + 1 + 0.4337) / 3, 4)
check("Hamilton Central overall_score matches manual calc", abs(hc["overall_score"] - manual) < 0.001, (hc["overall_score"], manual))

# --- 6. Full population (very high budget) ---
code, body = call({"budget": 10000, "destination": "The Base"})
r = body["results"]
ex = body["excluded"]
# Since the Q2 2026 data pull every suburb is CURRENT (MBIE's revised file
# added Q1 2026 rows for Te Rapa North and South, the two suburbs the Q1 2026
# pull excluded), so a budget this high includes all 62.
check("budget=10000 -> 62 results (all CURRENT suburbs)", len(r) == 62, len(r))
check("budget=10000 -> nothing excluded", len(ex) == 0, ex)
check("budget=10000 -> included + excluded = 62", len(r) + len(ex) == 62, (len(r), len(ex)))
ranks = [x["rank"] for x in r]
check("budget=10000 -> ranks are 1..62 with no gaps/dupes", ranks == list(range(1, 63)), ranks[:5])

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

# --- 8. Low-coverage suburbs included without crashing ---
# Rotokauri-Waiwhakareke, Ruakura and Peacockes are large, still-developing
# suburbs with little of their land within a 400m walk of a stop. (Formerly
# "zero-bus-stop suburbs" under the centroid-count measure, which scored all
# three exactly 0; walk-based route reach gives Ruakura and Rotokauri a small
# but non-zero score since parts of them are served: Rotokauri ~0.07,
# Ruakura ~0.21, Peacockes 0.)
code, body = call({"budget": 1000, "destination": "The Base"})
r = body["results"]
low_coverage_names = {"Rotokauri-Waiwhakareke", "Ruakura", "Peacockes"}
present = {x["sa2_name"]: x for x in r if x["sa2_name"] in low_coverage_names}
check("all 3 low-coverage suburbs present at budget=1000", set(present.keys()) == low_coverage_names, set(present.keys()))
check("low-coverage suburbs have walk_coverage < 0.5", all(v["score_breakdown"]["transport"]["walk_coverage"] < 0.5 for v in present.values()), {k: v["score_breakdown"]["transport"] for k, v in present.items()})
check("low-coverage suburbs have a low transport normalised_score (< 0.25)", all(v["score_breakdown"]["transport"]["normalised_score"] < 0.25 for v in present.values()), {k: v["score_breakdown"]["transport"]["normalised_score"] for k, v in present.items()})
check("Peacockes has the lowest transport score of all (normalised_score == 0)", present["Peacockes"]["score_breakdown"]["transport"]["normalised_score"] == min(x["score_breakdown"]["transport"]["normalised_score"] for x in r) == 0, present["Peacockes"]["score_breakdown"]["transport"])

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

# --- 12. lowest_rent: the smoking-gun test that the budget hard constraint
# actually uses lowest_rent, not median_rent ---
# Pukete East's suburb-wide median_rent is $618 (would fail a $195 budget
# under the old rule), but its lowest_rent (a 2-bed Apartment row) is $192
# (passes a $195 budget). If this suburb is included at budget=195, the hard
# constraint is genuinely reading lowest_rent, not median_rent.
code, body = call({"budget": 195, "destination": "The Base"})
r = body["results"]
check("lowest_rent smoking gun: Pukete East included at budget=195 despite median_rent > budget", len(r) == 1 and r[0]["sa2_name"] == "Pukete East", r)
if r:
    check("lowest_rent smoking gun: median_rent (618) > budget but lowest_rent.value (192) <= budget", r[0]["score_breakdown"]["rent"]["value"] == 618 and r[0]["lowest_rent"]["value"] == 192, r[0])

# --- 12b. lowest_rent only uses recent rows (quarters_stale < 4) ---
# Hamilton Central's cheapest specific row is a $125 Boarding House row from
# Q4 2024, 6 quarters old; its cheapest recent one is $280 (Boarding House,
# 1 bed). The old row must not be the budget figure. A fixture-based check
# of the exact < 4 boundary is in test_stale_budget_rent.py.
code, body = call({"budget": 10000, "destination": "The Base"})
hc = next((x for x in body["results"] if x["sa2_name"] == "Hamilton Central"), None)
check("recent rows only: Hamilton Central's lowest_rent is the recent $280 row, not the old $125 one", hc is not None and hc["lowest_rent"]["value"] == 280 and hc["lowest_rent"]["number_of_beds"] == "1", hc and hc["lowest_rent"])
code, body = call({"budget": 150, "destination": "The Base"})
hc_ex = next((e for e in body["excluded"] if e["sa2_name"] == "Hamilton Central"), None)
check("recent rows only: Hamilton Central excluded at budget=150 as exceeds_budget", hc_ex is not None and hc_ex["reason"] == "exceeds_budget" and hc_ex["lowest_rent"]["value"] == 280, hc_ex)

# --- 13. lowest_rent structure and low_sample_warning correctness ---
code, body = call({"budget": 10000, "destination": "The Base"})
r = body["results"]
ex = body["excluded"]
check("budget=10000 -> every result has a lowest_rent object with the expected keys", all(
    set(x["lowest_rent"].keys()) == {"value", "dwelling_type", "number_of_beds", "total_bonds", "low_sample_warning", "low_sample_note"}
    for x in r
), [set(x["lowest_rent"].keys()) for x in r[:1]])
# lowest_rent.value is NOT guaranteed to be <= the ALL/ALL median_rent used
# for scoring: the suburb-wide median also covers bonds that no published
# recent specific row does (MBIE suppresses thin cells), e.g. Queenwood's
# cheapest recent specific row (House, 1 bed, $645) sits above its $640
# ALL/ALL median. What
# must hold is that every included suburb had a real figure to check.
check("budget=10000 -> every included suburb has a numeric lowest_rent.value", all(
    isinstance(x["lowest_rent"]["value"], (int, float)) for x in r
), [(x["sa2_name"], x["lowest_rent"]) for x in r if not isinstance(x["lowest_rent"]["value"], (int, float))])
check("budget=10000 -> low_sample_warning true iff total_bonds <= 6, for every result", all(
    x["lowest_rent"]["low_sample_warning"] == (x["lowest_rent"]["total_bonds"] <= 6) for x in r
), [(x["sa2_name"], x["lowest_rent"]) for x in r if x["lowest_rent"]["low_sample_warning"] != (x["lowest_rent"]["total_bonds"] <= 6)])
check("budget=10000 -> low_sample_note is non-empty iff low_sample_warning is true, for every result", all(
    bool(x["lowest_rent"]["low_sample_note"]) == x["lowest_rent"]["low_sample_warning"] for x in r
), [(x["sa2_name"], x["lowest_rent"]) for x in r if bool(x["lowest_rent"]["low_sample_note"]) != x["lowest_rent"]["low_sample_warning"]])
warned = sum(1 for x in r if x["lowest_rent"]["low_sample_warning"])
check("budget=10000 -> 43/62 suburbs carry low_sample_warning (the only meaningful split the real data supports)", warned == 43, warned)

# budget=10000 has no exceeds_budget exclusions at all (see section 6) --
# need a tighter budget to check that reason's excluded entries also carry
# a lowest_rent object.
code, body = call({"budget": 500, "destination": "The Base"})
exceeds_budget = [e for e in body["excluded"] if e["reason"] == "exceeds_budget"]
check("budget=500 -> exceeds_budget-excluded entries also carry a lowest_rent object", len(exceeds_budget) > 0 and all("lowest_rent" in e and "value" in e["lowest_rent"] for e in exceeds_budget), exceeds_budget[:1])

# --- 14. Rounding-based tie behavior (rent to $5, distance to 100m) ---
# Confirmed against real data before this was written: at budget=600 with no
# destination, Pukete East ($618) and Saint Andrews East ($620) are 2 apart
# raw but both round to $620 -- they should score identically instead of
# being ranked apart on noise smaller than MBIE's own reporting granularity.
code, body = call({"budget": 600})
r = body["results"]
by_name = {x["sa2_name"]: x for x in r}
pe = by_name.get("Pukete East")
sae = by_name.get("Saint Andrews East")
check("rent rounding: Pukete East ($618) and Saint Andrews East ($620) present", pe is not None and sae is not None, list(by_name.keys())[:5])
if pe and sae:
    check("rent rounding: raw values are 2 apart, not equal", pe["score_breakdown"]["rent"]["value"] != sae["score_breakdown"]["rent"]["value"], (pe["score_breakdown"]["rent"]["value"], sae["score_breakdown"]["rent"]["value"]))
    check("rent rounding: both round to $620 and tie on rentScore", pe["score_breakdown"]["rent"]["normalised_score"] == sae["score_breakdown"]["rent"]["normalised_score"], (pe["score_breakdown"]["rent"], sae["score_breakdown"]["rent"]))

# Hamilton Lake ($623) rounds to $625 -- a different bucket from $620, only
# $5 away from Pukete East raw -- so it should NOT tie, confirming rounding
# creates ties only within a bucket, not indiscriminately.
hl_rent = by_name.get("Hamilton Lake")
check("rent rounding: Hamilton Lake ($623->$625) does not tie with Pukete East ($618->$620)", hl_rent is not None and pe is not None and hl_rent["score_breakdown"]["rent"]["normalised_score"] != pe["score_breakdown"]["rent"]["normalised_score"], (hl_rent, pe) if hl_rent and pe else None)

# Distance: at budget=700 with University of Waikato, Silverdale (1078m),
# Hillcrest West (1146m) and Hillcrest East (1111m) are all within 100m of
# each other but not of each other's raw value -- all three round to
# 1100m and should tie on distScore. $700 rather than $600 so Ruakura
# (budget figure $700) is included for the contrast check below.
code, body = call({"budget": 700, "destination": "University of Waikato"})
r = body["results"]
by_name = {x["sa2_name"]: x for x in r}
trio_names = ["Silverdale (Hamilton City)", "Hillcrest West (Hamilton City)", "Hillcrest East (Hamilton City)"]
trio = {name: by_name.get(name) for name in trio_names}
check("distance rounding: all three ~1.1km suburbs present", all(v is not None for v in trio.values()), list(by_name.keys())[:5])
if all(trio.values()):
    raw_values = {name: v["score_breakdown"]["distance"]["value"] for name, v in trio.items()}
    scores = {name: v["score_breakdown"]["distance"]["normalised_score"] for name, v in trio.items()}
    check("distance rounding: raw distance_m values are not all equal", len(set(raw_values.values())) == 3, raw_values)
    check("distance rounding: all three round to 1100m and tie on distScore", len(set(scores.values())) == 1, scores)

# Ruakura (1253m -> rounds to 1300m) is a different bucket from the trio
# above -- should not tie with them, same contrast principle as Fairfield.
ruakura = by_name.get("Ruakura")
check("distance rounding: Ruakura present for the contrast check", ruakura is not None, list(by_name.keys())[:5])
if ruakura and all(trio.values()):
    check("distance rounding: Ruakura (1253m->1300m) does not tie with the ~1100m trio", ruakura["score_breakdown"]["distance"]["normalised_score"] not in scores.values(), (ruakura["score_breakdown"]["distance"], scores))

# --- 15. Transport: walk-based route reach ---
# transport.value is the plain mean number of distinct bus routes within a 400m
# walk of a point in the suburb (uncapped). It is scored as sqrt(value) -- a
# judgment-call curve that compresses the scale so the CBD doesn't flatten
# everyone else, while staying strictly increasing -- then rounded to 0.02 and
# min-max normalised. walk_coverage is the share of the suburb within 400m of
# any stop (returned for API consumers; not scored separately).
code, body = call({"budget": 10000, "destination": "The Base"})
r = body["results"]
tr = {x["sa2_name"]: x["score_breakdown"]["transport"] for x in r}
check("transport breakdown has exactly value/walk_coverage/normalised_score", all(set(t.keys()) == {"value", "walk_coverage", "normalised_score"} for t in tr.values()), next(iter(tr.values())))
check("transport walk_coverage is within [0, 1]", all(0 <= t["walk_coverage"] <= 1 for t in tr.values()), {k: t["walk_coverage"] for k, t in tr.items() if not 0 <= t["walk_coverage"] <= 1})
# Holds by construction: a covered point has >= 1 route, so the average is at
# least the coverage.
check("walk_coverage <= value everywhere", all(t["walk_coverage"] - 1e-4 <= t["value"] for t in tr.values()), {k: t for k, t in tr.items() if t["walk_coverage"] - 1e-4 > t["value"]})
check("transport value is uncapped (the busiest suburbs exceed the old cap of 4)", max(t["value"] for t in tr.values()) > 9, max(t["value"] for t in tr.values()))
top = max(tr.values(), key=lambda t: t["value"])
check("the suburb with the highest value has transport normalised_score == 1", top["normalised_score"] == 1, top)

# Monotonicity -- the design requirement: a higher displayed average never
# scores lower. (Rounding to 0.02 on the sqrt scale can tie near-equal
# averages, but never reverse them.)
pairs = [(a, b) for a in tr.values() for b in tr.values() if a["value"] > b["value"]]
violations = [(a, b) for a, b in pairs if a["normalised_score"] < b["normalised_score"]]
check("monotonic: no suburb with a higher average routes scores lower on transport", len(violations) == 0, violations[:3])
# The case that motivated this: a per-point sqrt scored Whitiora (4.25 routes)
# the same as Rototuna Central (3.84) because Whitiora's routes are concentrated
# in one part of it. Sqrt of the average keeps the higher one higher.
check("monotonic: Whitiora (4.25 routes) scores above Rototuna Central (3.84)", tr["Whitiora"]["normalised_score"] > tr["Rototuna Central"]["normalised_score"], (tr["Whitiora"], tr["Rototuna Central"]))
# No ceiling: a hard cap of 4 per point once scored Chartwell (5.72) and
# Rototuna Central (3.84) as 3.75 vs 3.66, a near-tie despite a ~49% gap.
gap = tr["Chartwell"]["normalised_score"] - tr["Rototuna Central"]["normalised_score"]
check("no ceiling: Chartwell scores clearly above Rototuna Central on transport (gap >= 0.1)", gap >= 0.1, (tr["Chartwell"], tr["Rototuna Central"]))
# Documented trade-off: coverage is only reflected through the average, so a
# suburb with dead zones but a matching average scores the same. Rototuna North
# (walk_coverage 0.64) and Pukete East (1.0) both average ~2.0 routes.
check("dead zones only count via the average: Rototuna North and Pukete East (~equal average, very different coverage) tie", abs(tr["Rototuna North"]["value"] - tr["Pukete East"]["value"]) < 0.1 and tr["Rototuna North"]["walk_coverage"] < 0.7 and tr["Pukete East"]["walk_coverage"] == 1 and tr["Rototuna North"]["normalised_score"] == tr["Pukete East"]["normalised_score"], (tr["Rototuna North"], tr["Pukete East"]))

# Hamilton Lake: its Stats NZ polygon includes the lake (~23%), which no bus
# can serve, so the lake is masked out of the sampling (OSM outline). Counted
# as land it would score coverage 0.83 and value 2.11 -- both below these
# bounds (masked: 0.91 and 2.37).
hl = tr["Hamilton Lake"]
check("Hamilton Lake: lake masked out (walk_coverage ~0.91, not the ~0.83 unmasked figure)", 0.88 <= hl["walk_coverage"] <= 0.94, hl)
check("Hamilton Lake: lake masked out (value >= 2.25; unmasked ~2.11)", hl["value"] >= 2.25, hl)

# Transport rounding to 0.02 on sqrt(value): at budget=700 with no destination,
# Melville North (2.301), Enderley South (2.290) and Dinsdale South (2.308)
# differ raw but all round to 1.52 and should tie; Hamilton Lake (2.374 -> 1.54)
# is the adjacent bucket, only ~0.06 routes away, and should not. $700 rather
# than $600 so Rototuna South (budget figure $685) is included below.
code, body = call({"budget": 700})
by_name = {x["sa2_name"]: x["score_breakdown"]["transport"] for x in body["results"]}
trio_t = [by_name.get(n) for n in ("Melville North", "Enderley South", "Dinsdale South")]
check("transport rounding: Melville North, Enderley South and Dinsdale South present", all(t is not None for t in trio_t), list(by_name.keys())[:5])
if all(trio_t):
    check("transport rounding: raw values differ", len({t["value"] for t in trio_t}) == 3, [t["value"] for t in trio_t])
    check("transport rounding: all three round to 1.52 (sqrt scale) and tie on transportScore", len({t["normalised_score"] for t in trio_t}) == 1, trio_t)
    hl2 = by_name.get("Hamilton Lake")
    check("transport rounding: Hamilton Lake (sqrt 1.54) does not tie with the 1.52 trio", hl2 is not None and hl2["normalised_score"] != trio_t[0]["normalised_score"], (hl2, trio_t[0]))

# The bucket is deliberately no wider than the sampling noise (~0.06 routes).
# A coarser 0.05 step once tied Beerescourt (2.97) with Swarbrick (2.84) -- 0.13
# routes apart, visible in the UI as "3.0 vs 2.8" scoring the same. They must
# now score differently, while Swarbrick and Rototuna South (2.842 / 2.835)
# still tie.
bee, swa, rs = by_name.get("Beerescourt"), by_name.get("Swarbrick"), by_name.get("Rototuna South")
check("transport rounding: Beerescourt (2.97) no longer ties with Swarbrick (2.84)", bee is not None and swa is not None and bee["normalised_score"] > swa["normalised_score"], (bee, swa))
check("transport rounding: Swarbrick (2.842) and Rototuna South (2.835) still tie", swa is not None and rs is not None and swa["normalised_score"] == rs["normalised_score"], (swa, rs))

# --- 16. lowest_rent fallback to an all-dwelling-types row ---
# Te Rapa South has no specific dwelling-type row at all, only ALL/ALL ($515)
# and ALL/2-beds ($515). Its budget figure falls back to the cheapest ALL row
# instead of coming back null -- which a bare `null > budget` check once let
# through at every budget, even $150.
code, body = call({"budget": 10000, "destination": "The Base"})
trs = next((x for x in body["results"] if x["sa2_name"] == "Te Rapa South"), None)
check("Te Rapa South: lowest_rent falls back to an ALL dwelling_type row ($515)", trs is not None and trs["lowest_rent"]["dwelling_type"] == "ALL" and trs["lowest_rent"]["value"] == 515, trs and trs["lowest_rent"])
check("every other suburb's lowest_rent is still a specific dwelling type", all(
    x["lowest_rent"]["dwelling_type"] != "ALL" for x in body["results"] if x["sa2_name"] != "Te Rapa South"
), [x["sa2_name"] for x in body["results"] if x["lowest_rent"]["dwelling_type"] == "ALL" and x["sa2_name"] != "Te Rapa South"])

code, body = call({"budget": 510, "destination": "The Base"})
trs_ex = next((e for e in body["excluded"] if e["sa2_name"] == "Te Rapa South"), None)
check("Te Rapa South: excluded at budget=510 as exceeds_budget, not passed through", trs_ex is not None and trs_ex["reason"] == "exceeds_budget" and trs_ex["lowest_rent"]["value"] == 515, trs_ex)
check("Te Rapa South: not in results at budget=510", all(x["sa2_name"] != "Te Rapa South" for x in body["results"]))

code, body = call({"budget": 515, "destination": "The Base"})
check("Te Rapa South: included at budget=515 (its fallback figure)", any(x["sa2_name"] == "Te Rapa South" for x in body["results"]))

# The bug's exact symptom was Te Rapa South appearing at budgets far below
# its $515 figure. $200 leaves only Pukete East ($192) and Kahikatea ($200)
# -- never Te Rapa South.
code, body = call({"budget": 200, "destination": "The Base"})
names = {x["sa2_name"] for x in body["results"]}
check("budget=200 -> only Pukete East and Kahikatea", names == {"Pukete East", "Kahikatea"}, names)

# The null guard itself (a suburb with no rent figure at all is excluded, never
# compared against the budget) can't be reached with the real data, so it is
# tested against a modified copy of the database in test_null_budget_rent.py.

# --- summary ---
passed = sum(1 for s, _, _ in results_log if s == "PASS")
failed = sum(1 for s, _, _ in results_log if s == "FAIL")
print(f"\n{passed} passed, {failed} failed out of {len(results_log)} checks")
sys.exit(1 if failed else 0)
