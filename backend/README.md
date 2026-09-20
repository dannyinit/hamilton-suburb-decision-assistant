# Backend

Express API for the Hamilton Suburb Decision Assistant. Connects read-only to the
SQLite database built by `data-pipeline/` (see [the root README](../README.md) for
the schema and data sources) and implements the two features from the project
proposal: Rental Price Check and Suburb Finder.

## Tech stack

- **Node.js + Express**
- **better-sqlite3**, a synchronous SQLite driver — the connection ([db.js](db.js))
  is opened `readonly: true` (this API never writes), and runs
  `PRAGMA foreign_keys = ON` itself, since SQLite only enforces foreign keys when a
  connection turns it on explicitly — it's a per-connection setting, not a property
  of the database file.

## Project structure

```
backend/
├── server.js                    # entry point: starts Express, mounts routes
├── db.js                        # shared read-only db connection
├── lowSampleWarning.js          # shared "small sample" signal + wording (Rental Price Check and Suburb Finder)
├── quarterLabel.js              # MBIE TimeFrame date -> "Q1 2026" / "Jan–Mar" labels
├── routes/
│   ├── index.js                 # collects every feature's router
│   ├── rentalPriceCheck.js      # GET /api/rental-price-check
│   ├── suburbFinder.js          # GET /api/suburb-finder
│   └── suburbs.js               # GET /api/suburbs
├── tests/
│   └── test_suburb_finder.py    # regression script, run against a live server
└── test-examples.md             # ready-to-paste curl examples for manual testing
```

## Setup

1. `cd backend`
2. `npm install`
3. `npm start` (or `npm run dev` to auto-restart on file changes)
4. Server listens on `http://localhost:3001` by default (override with the `PORT`
   env var).

To run the whole app as one server, as it is deployed, build the frontend and start
from the repo root: `npm run build && npm start` (see the root `package.json`).
`DB_PATH` overrides where the database is read from.

**Prerequisite:** `data-pipeline/output/hamilton.db` must exist. It is **committed to
the repo**, so a fresh clone (or a deploy) needs only Node; after changing or re-running
the pipeline, rebuild it by following the data-pipeline setup steps in
[the root README](../README.md#setup) and **recommit the new file**. `db.js` fails fast
on startup (`fileMustExist: true`) if it's missing, rather than silently creating an
empty database.

## Endpoints

### `GET /api`

Returns a JSON summary of available endpoints — useful as a sanity check that the
server is actually running. (This was `GET /` before the server also started
serving the built frontend; `/` now returns the app itself.) Any other unknown
`/api/...` path returns a JSON `404`.

### `GET /` and client-side routes

When the frontend has been built (`npm run build --prefix frontend`), the same
process serves it: `index.html` for `/` and for any extension-less path that isn't
under `/api` (so a reload or shared link to `/rental-price-check` works with
`BrowserRouter`), and the fingerprinted files under `/assets/` with a one-year
immutable cache. A missing file (e.g. a stale `/assets/x.js`) is a plain `404`. If
`frontend/dist` doesn't exist — plain backend development, where vite serves the
frontend and proxies `/api` here — `GET /` returns a JSON `404` saying so. Responses
are gzip-compressed.

### `GET /api/health`

Confirms the server can query the database and that `foreign_keys` is really on,
not just configured in code:

```json
{ "status": "ok", "suburbCount": 62, "foreignKeysOn": true }
```

### `GET /api/suburbs`

Static reference data — all 62 suburbs (`sa2_code` + `sa2_name`, alphabetical by name),
for populating frontend suburb pickers. No query parameters. Unfiltered by
`suburb_data_status` deliberately: that field is specific to Suburb Finder's hard
constraints (the ALL/ALL rent row), not a general "can this suburb be looked up at
all" flag — Rental Price Check already reports its own per-request
`insufficient_data`/`staleness_warning` independent of this table, and this list is
meant to include suburbs like Te Rapa North (`NO_DATA`) precisely so their fallback
behaviour is reachable from the UI.

```json
{
  "suburbs": [
    { "sa2_code": 180500, "sa2_name": "Bader" },
    { "sa2_code": 177600, "sa2_name": "Beerescourt" }
  ]
}
```

### `GET /api/rental-price-check`

Looks up the market rent for a suburb/dwelling type/bed count, with a two-tier
fallback, a staleness warning when the data is old, and a breakdown table of every
other dwelling type the suburb has data for.

**Query parameters**

| param | required | notes |
|---|---|---|
| `sa2_code` | yes | integer SA2 code (see `suburbs` table) |
| `dwelling_type` | yes | one of `ALL`, `Apartment`, `Boarding House`, `Flat`, `House`, `Room` |
| `number_of_beds` | no | one of `ALL`, `0`–`9`, `15`, `5+`. Omitted/empty means "any bed count" and resolves to `ALL` — this endpoint does not expose the rent table's separate, undocumented NULL-beds data category |
| `rent` | no | a weekly rent figure to compare against the market; if given, the response includes a comparison label |

**Fallback order:** exact match (`sa2_code` + `dwelling_type` + `number_of_beds`) →
same dwelling type with `number_of_beds='ALL'` (`fallback_level: "dwelling_type"`,
skipped if the requested beds were already `ALL`) → the suburb's overall
`dwelling_type='ALL', number_of_beds='ALL'` row (`fallback_level: "full"`) → if even
that's missing, `insufficient_data: true` with no numbers at all. When a fallback
happens the response also carries a generic `fallback_note`; the frontend builds its
own, more specific banner from `requested_*` vs. the returned `dwelling_type` /
`number_of_beds` instead of showing this one.

#### Quarter labels

MBIE's `TimeFrame` is a calendar quarter written as a date (`2026-01-01`), not a
real day, so showing it raw implies precision the data doesn't have. Every
user-facing mention of a quarter goes through [quarterLabel.js](quarterLabel.js):

| field | example | where |
|---|---|---|
| `timeframe` | `"2026-01-01"` | primary result and every breakdown row — the raw ISO value, unchanged, for machine use |
| `timeframe_label` | `"Q1 2026"` | primary result and every breakdown row |
| `timeframe_months` | `"Jan–Mar"` | **primary result only** — one clarification where the reader is orienting, so "Q3" isn't mistaken for a July–June NZ fiscal quarter |

**Assumption:** `TimeFrame` is treated as the *first* day of its quarter
(`2026-01-01` = Jan–Mar 2026). MBIE doesn't document this; it's inferred from their
own file label ("January 2020 to April 2026", whose first/last `TimeFrame` values
are `2020-01-01` and `2026-04-01`) and from their release lag (the latest published
quarter is a complete one). If it turns out to be wrong, `quarterLabel.js` is the
only place to fix.

#### Staleness

Any row — the primary result or a breakdown row — with `quarters_stale >= 1` gets a
`staleness_warning`, a much stricter threshold than Suburb Finder's 4 quarters (see
the root README's "Consumption rules" section for why). The sentence names both
what the data's quarter is and what it's older than:

> This data is from Q1 2022, 16 quarters older than the most recent data available (Q1 2026).

The reference quarter in that sentence is derived from the row itself (its own
quarter plus `quarters_stale`), so the count and the quarter beside it can never
disagree. "Most recent data available", not "latest MBIE release" — the database is
a snapshot and may itself lag MBIE's newest publication.

`stale_footnote` is a separate, shorter explanation (*"This data is older than the
most recent data available (Q1 2026)."*) attached to the response **only when at
least one breakdown row is stale**. Its quarter comes from `SELECT MAX(timeframe)
FROM rent`, run on every request rather than cached or hardcoded, so it follows the
data when the database is rebuilt (the server needs a restart to reopen the
replaced file). Because it reflects the *table's* rows and not just the primary
result, it can appear even when the primary result is current — see the example
below.

#### Low-sample warning

Shared with Suburb Finder via [lowSampleWarning.js](lowSampleWarning.js): a row is
flagged when `total_bonds <= 6`. MBIE suppresses selections with fewer than 5 bonds
and applies fixed random rounding to base 3, so 6 is the smallest count that is ever
published — the observed floor across the whole rent table (only 6, 9, 12, … occur),
which is why the code's `<=` never needs to be `<`. The primary result carries
`low_sample_warning` and a full-sentence `low_sample_note` (*"This figure is based on
a very small sample (6 bonds — the smallest sample MBIE publishes) — treat it as a
rough indication only."*). Breakdown rows carry only the boolean, and the shared
`low_sample_footnote` is attached **only when at least one breakdown row is flagged**,
so a compact marker per row can point at one explanation instead of repeating the
sentence.

#### Dwelling-type breakdown

`dwelling_type_breakdown` lists every specific dwelling type
(`dwelling_type != 'ALL'`) the suburb genuinely has an all-beds row with a
`median_rent` for — **including the one the primary result shows** (flagged
`is_current: true` rather than filtered out, so it's a complete picture). Rows are
ordered like the frontend's dropdown (Apartment, Boarding House, Flat, House, Room).

| field | notes |
|---|---|
| `dwelling_type` | |
| `is_current` | `true` for the dwelling type the primary result (after any fallback) displays |
| `median_rent`, `total_bonds` | that dwelling type's all-beds row |
| `low_sample_warning` | as above |
| `timeframe`, `timeframe_label`, `quarters_stale`, `staleness_warning` | that row's *own* age — rows in one table routinely differ (a suburb's 2-bed row can be years older than its 1-bed row, because MBIE omits rows for thin quarters and each combination keeps its latest available quarter) |
| `beds` | nested per-bed-count rows for this dwelling type: `number_of_beds`, `median_rent`, `total_bonds`, `low_sample_warning`, and the same four age fields. Ordered in MBIE's category order (not numeric — `15` precedes `5+`). May be empty |

Rows with no `median_rent` and the separate NULL-beds category are excluded, as they
are from the primary lookup. **Don't expect bed rows to sum to the all-beds row**:
they can come from different quarters, and MBIE's base-3 rounding is applied to each
row independently.

For a suburb with no such rows (currently only Te Rapa South, whose one rent row is
the overall ALL/ALL row), `dwelling_type_breakdown` is `[]` and neither footnote is
attached. (Te Rapa North has no rent rows at all, so it gets the `insufficient_data`
response instead, which has no breakdown field.)

**Example response** (Flagstaff North, House, rent supplied). The primary result is
current (`quarters_stale: 0`, `staleness_warning: null`), yet `stale_footnote` is
present because two of the House bed rows in the breakdown are 2 quarters old —
`stale_footnote` describes the table, not the primary result. The breakdown is
truncated to the House row's first three bed rows and the Room row is omitted:

```json
{
  "sa2_code": 175300,
  "sa2_name": "Flagstaff North",
  "requested_dwelling_type": "House",
  "requested_number_of_beds": "ALL",
  "dwelling_type": "House",
  "number_of_beds": "ALL",
  "median_rent": 755,
  "lower_quartile_rent": 699,
  "upper_quartile_rent": 793,
  "total_bonds": 36,
  "low_sample_warning": false,
  "low_sample_note": null,
  "fallback_level": "none",
  "timeframe": "2026-01-01",
  "timeframe_label": "Q1 2026",
  "timeframe_months": "Jan–Mar",
  "quarters_stale": 0,
  "staleness_warning": null,
  "rent": 600,
  "comparison": "Below market",
  "dwelling_type_breakdown": [
    {
      "dwelling_type": "House",
      "is_current": true,
      "median_rent": 755,
      "total_bonds": 36,
      "low_sample_warning": false,
      "timeframe": "2026-01-01",
      "timeframe_label": "Q1 2026",
      "quarters_stale": 0,
      "staleness_warning": null,
      "beds": [
        {
          "number_of_beds": "1",
          "median_rent": 750,
          "total_bonds": 27,
          "low_sample_warning": false,
          "timeframe": "2026-01-01",
          "timeframe_label": "Q1 2026",
          "quarters_stale": 0,
          "staleness_warning": null
        },
        {
          "number_of_beds": "2",
          "median_rent": 720,
          "total_bonds": 6,
          "low_sample_warning": true,
          "timeframe": "2025-07-01",
          "timeframe_label": "Q3 2025",
          "quarters_stale": 2,
          "staleness_warning": "This data is from Q3 2025, 2 quarters older than the most recent data available (Q1 2026)."
        },
        {
          "number_of_beds": "3",
          "median_rent": 680,
          "total_bonds": 6,
          "low_sample_warning": true,
          "timeframe": "2025-07-01",
          "timeframe_label": "Q3 2025",
          "quarters_stale": 2,
          "staleness_warning": "This data is from Q3 2025, 2 quarters older than the most recent data available (Q1 2026)."
        }
      ]
    }
  ],
  "low_sample_footnote": "Based on a small sample (6 bonds — the smallest sample MBIE publishes); treat as a rough indication.",
  "stale_footnote": "This data is older than the most recent data available (Q1 2026)."
}
```

`fallback_note` (present only when `fallback_level` is not `"none"`) and the
`insufficient_data` response shape are covered in the fallback description above.

See [test-examples.md](test-examples.md) for one ready-to-run example per case
(exact match, both fallback tiers, NO_DATA, STALE, empty breakdown, a stale
breakdown row with a current primary result, invalid input, rent comparison).

### `GET /api/rental-price-check-examples`

A fixed list of example requests for demos, each as `{ description, url, result }`,
where `result` is the live response computed in-process by the same function the
real endpoint uses (no HTTP round-trip). Mirrors [test-examples.md](test-examples.md).
No parameters.

### `GET /api/rental-price-check-bed-availability`

Reference data for the frontend's Bedrooms dropdown: which `number_of_beds` values
have an *exact* rent row for each suburb/dwelling type, so the UI can offer only
the bed counts that won't just fall back to a broader estimate. No query
parameters — one static object covering every suburb/dwelling type at once.

Deliberately **exact-match only**, not "reachable via fallback": fallback tiers
`dwelling_type`/`full` succeed the same way no matter which bed count was
requested (neither fallback query looks at it), so that's not a signal that
varies per bed count. Excludes the separate undocumented NULL-beds MBIE
category (same exclusion `/api/rental-price-check` itself applies) and `'ALL'`
(not a selectable bed count).

```json
{
  "175300": { "ALL": ["1", "2", "3", "4", "5+"], "House": ["1", "2", "3", "4", "5+"], "Room": ["1"] },
  "175400": { "ALL": ["4"], "House": ["4"] }
}
```

A suburb/dwelling type combo with zero exact rows (e.g. Flagstaff North +
Apartment) is simply absent from its suburb's object — the frontend treats a
missing key as "no bed-specific options, only the general estimate."

### `GET /api/suburb-finder`

Ranks suburbs by a weighted score across rent, transport access, and distance to a
chosen destination, after applying hard budget/data-quality constraints.

**Query parameters**

| param | required | notes |
|---|---|---|
| `budget` | yes | non-negative weekly rent budget |
| `destination` | no | must exactly match a name in the `destinations` table: `University of Waikato`, `Transport Centre`, `The Base`, `Waikato Hospital`. Omitting the key entirely excludes distance from scoring (see "Optional destination" below) — but a present, empty, or unrecognised value (`destination=`, a typo) still fails validation with `400`, same as before. Only a fully absent key counts as "not provided" |
| `rent_weight`, `transport_weight` | no | each defaults independently to `1` if omitted or empty (an untouched slider); a present `0` is respected as "don't care about this criterion" and is not defaulted away. Normalised together (with `distance_weight`, if applicable) to sum to 1 |
| `distance_weight` | no | same rules as the other weights, but only has any effect when `destination` is provided. If supplied without a `destination`, it's silently ignored (logged server-side via `console.warn`, not surfaced in the response) |

**Hard constraints**, applied in this order so no suburb ever carries both reasons:
1. `suburb_data_status.data_status != 'CURRENT'` → excluded, reason `insufficient_data`
2. `lowest_rent.value > budget` (see "Budget filtering" below) → excluded, reason `exceeds_budget`

If no suburb survives both constraints, the response is `results: []` with
`no_suburbs_in_budget: true` and a message naming the cheapest available suburb
(by `lowest_rent`, same as the hard constraint above). This is unaffected by
whether `destination` was provided — neither hard constraint reads distance.

**Budget filtering: `lowest_rent`, not the suburb's overall median.** Comparing
`budget` against the suburb-wide `dwelling_type='ALL', number_of_beds='ALL'`
median would wrongly exclude a suburb where a specific dwelling type (e.g. Room)
is genuinely affordable but House prices pull the suburb-wide median above
budget. Instead, the budget check uses `lowest_rent`: for each suburb, the
single specific (`dwelling_type != 'ALL'`) dwelling_type/beds row with the
lowest `median_rent` — no minimum sample size required, since hard-constraint
filtering should err towards inclusion rather than excluding a suburb because
its cheapest option happens to have a small sample. Every `CURRENT` suburb has
at least a `House` row, so there's no fallback case to handle.

Each suburb's `lowest_rent` object (present on every entry in `results`, and on
`excluded` entries with `reason: "exceeds_budget"`):

| field | notes |
|---|---|
| `value` | the rent figure compared against `budget` |
| `dwelling_type`, `number_of_beds` | which specific row `value` came from |
| `total_bonds` | that row's sample size |
| `low_sample_warning` | `true` when `total_bonds <= 6` — the smallest sample MBIE ever publishes (it suppresses counts below 5 and rounds to base 3), not an arbitrary cutoff; see "Low-sample warning" under Rental Price Check. A two-tier mild/strong design was tried first, but across all 60 `CURRENT` suburbs `lowest_rent`'s `total_bonds` is only ever 6, 9, 12, or 15 — any boundary above 15 flagged 100% of suburbs, and `<=6` is the only split the real data supports (currently ~50/60 suburbs warned) |
| `low_sample_note` | human-readable explanation, `null` when `low_sample_warning` is `false` |

**This is deliberately a different figure from the `rent` criterion used for
scoring** (`score_breakdown.rent`, always the suburb-wide `median_rent`) — the
budget check needs the most optimistic realistic figure to avoid excluding a
suburb that might work, while ranking needs a stable, suburb-wide figure so one
thin sample doesn't distort a suburb's score relative to others. See the
frontend's `suburb-ranking-legend` copy for how this distinction is explained
to users, who see both figures next to each other.

**Optional destination:** when `destination` is omitted, the distance
criterion is excluded from scoring entirely — not assigned a neutral score,
just left out — and `rent_weight`/`transport_weight` are re-normalised
proportionally to fill the full weight between just the two of them (the same
sum-then-divide mechanism as always, just with fewer terms in the sum). The
response reflects this explicitly rather than silently: `destination: null`,
a top-level `distance_excluded: true` with a `distance_excluded_note`
explaining why, `weights_used` with only `rent`/`transport` keys, and each
suburb's `score_breakdown` with only `rent`/`transport` keys (not a `distance`
key with a null value). If both `rent_weight` and `transport_weight` are `0`
with no destination, the `400` error message names only those two params, not
`distance_weight`.

**Transport: walk-based route reach, not a stop count.** Each suburb's transport
figure is computed in the data pipeline by sampling its Stats NZ polygon on a 50m
grid and, at every point, counting the distinct bus routes with a stop within a 400m
walk (straight-line; stops are counted city-wide, whichever suburb they sit in).
`score_breakdown.transport` then carries:

| field | notes |
|---|---|
| `value` | the plain mean number of distinct routes within a 400m walk, across the suburb's points — **uncapped, shown to users** (the busiest suburbs are ~9.5). Points with no stop in range count as 0, so unserved land lowers it. The score is derived from this alone: `normalised_score` can be reproduced as the min-max normalisation of √`value`, rounded to 0.02 |
| `walk_coverage` | share of the suburb (0–1) within 400m of any bus stop. Returned for API consumers, not shown in the UI or scored separately — it's already reflected in `value` (uncovered points count 0), and the UI deliberately shows only one transport signal. Always `≤ value`: a covered point has at least one route |
| `normalised_score` | as for the other criteria |

**The square root is a judgment call, not a finding.** No ridership data or planning
standard was found supporting any particular shape for how much extra routes are worth
(the 400m radius, by contrast, does match NZTA/Waka Kotahi's ~5-minute-walk guidance).
The score is `√value`, applied to the suburb's *average*, because it compresses the
scale so the CBD's ~9.5 routes doesn't flatten every other suburb into the bottom of it
(uncapped, the median suburb sits 20% of the way up the range; with √, 41%) while being
**strictly increasing: a suburb with a higher displayed average never scores lower**
(rounding to 0.02 can tie near-equal averages, never reverse them). It's also easy to
state ("four times the routes counts as double"). Two earlier variants were tried and
dropped:

- **A hard cap of 4 routes per point** scored a point with 9 routes the same as one
  with 4, and collapsed a real ~49% gap between Chartwell and Rototuna Central to a
  near-tie.
- **√ applied per point before averaging** had no ceiling, but it also rewarded evenly
  spread service over concentrated pockets, so Whitiora (4.25 routes on average, but
  routes concentrated in one part of it) scored the same as Rototuna Central (3.84,
  even 3–5 everywhere) — a higher displayed number tying a lower one, which users
  could see and couldn't explain.

**Consequence: dead zones count only through the average.** Rototuna North (no stop in
reach across ~36% of its area) and Pukete East (fully covered) both average ~2.0 routes
and therefore score the same on transport, even though the former has areas with no
service at all. That is the price of monotonicity, and it's deliberate: a higher
displayed average is what the score follows.

This replaced a count of stops within 500m of the suburb's centroid, which depended
heavily on where the centroid happened to land (Hamilton Lake's sits on the lake itself, 426m from its nearest stop, and scored 2 stops despite
21 stops inside the suburb). `transport.value` therefore changed meaning: it used to
be a stop count and is now an average route count. Hamilton Lake's polygon includes the
lake, which no bus can serve, so the lake is masked out of the sampling using an
OpenStreetMap outline (see the root README's dataset 5); other suburbs' water is
negligible. `value` measures route *variety*, not service frequency — there is no
timetable data.

**Scoring**, applied only across the suburbs that survive both hard constraints
(not all 62 — ranking should reflect relative comparison among viable options).
The rent criterion here is always the suburb-wide `median_rent`, never
`lowest_rent` — see "Budget filtering" above for why the two are kept separate:

- Each criterion is min-max normalised to `[0,1]`. Rent and distance are cost
  criteria (reversed: lower is better); transport (√ of the average routes within a
  400m walk, see "Transport" below) is a benefit criterion (higher is better).
- **Exact tie** (every surviving suburb has the identical value on a criterion):
  `0.5` for all — deliberately neutral, not "best" or "worst".
- **Otherwise**, normalisation divides by `max(actual range, threshold)` — a
  minimum-meaningful-range floor so a small real difference (e.g. two suburbs $5/week
  apart, if they're the entire pool) doesn't get stretched across the full `[0,1]`
  scale. Thresholds, precomputed from the 60 `CURRENT` suburbs' full population and
  never recomputed from a request's own filtered subset:

  | criterion | threshold |
  |---|---|
  | rent | $50 |
  | transport (√ of average routes within a 400m walk) | 0.3 |
  | distance — University of Waikato | 1000m |
  | distance — Transport Centre | 750m |
  | distance — The Base | 940m |
  | distance — Waikato Hospital | 950m |

  (Distance uses a different threshold per destination — 10% of that destination's
  own full-population distance range — rather than one flat metre value, since the
  four destinations sit at genuinely different distances from the city. Transport's
  0.3 is derived the same way: 10% of √`value`'s 0.259–3.088 range is 0.283, rounded
  up. Rent's $50 is **not** derived that way — it's a hand-chosen flat constant (10% of
  the $340–$760 range of suburb-wide median rents would be $42). All of these are
  hardcoded from the current data, so they need re-deriving if the database is rebuilt
  with materially different data.)

  Confirmed against real data across every $5-step budget: with a normally-sized
  survivor set, this floor never actually engages for rent, and for distance only
  at the 2-suburbs-left extreme for 2 of the 4 destinations — it's a
  rare-edge-case safety net, not a mechanism doing routine work. Transport's 0.3
  (~10% of √`value`'s 0.259–3.088 full-population range, so 0.283) was re-checked
  after each change to the measure: across all 205 $5-step budgets from $100 to
  $1,200 that leave at least 2 suburbs, the surviving suburbs' rounded transport
  scoring input never spans less than 1.8 (the tightest case is a $180 budget with 2
  survivors), so it doesn't engage either.

- **Rent, distance and transport are also rounded before scoring** — to the nearest
  $5 for rent, nearest 100m for distance, nearest 0.02 of √(average routes) for transport — so two suburbs closer together than the data's
  real precision score identically instead of being ranked apart on noise. This is
  a different fix from the threshold floor above: the floor protects against a
  *whole population* being too tightly clustered, while rounding protects against
  *individual pairs* being closer than the data can actually distinguish. Rent's
  $5 step matches the data itself — 55 of the 60 `CURRENT` suburbs' `median_rent`
  already land on an exact multiple of $5. Distance's 100m step has no equivalent
  data-derived answer (adjacent suburbs' `distance_m` can differ by fractions of a
  metre, an artifact of computing straight-line distance from an SA2 centroid, with
  no natural "reporting bucket" the way rent has one) — it's a judgment call, chosen
  as a city-block-scale unit well below the distance thresholds above. Transport's
  0.02 step is likewise a judgment call: the average is a mean over a 50m sampling
  grid, so it carries sampling noise (halving the grid step moved it by at most 0.063
  routes, 0.015 on the √ scale), and 0.02 is chosen so a tie never spans more than that
  noise — the largest gap between two tied suburbs' averages is 0.045 routes. It
  leaves 37 distinct values across the 60 `CURRENT` suburbs. A coarser 0.05 was tried
  first and dropped: it tied suburbs up to 0.136 routes apart (Queenwood 2.83 and
  Beerescourt 2.97 scored the same), about double the noise, and visible in the UI as
  "2.8 vs 3.0" tying. Only the scoring input is rounded —
  `score_breakdown.rent.value`/`distance.value`/`transport.value` still show the
  raw figure, and `lowest_rent` (the budget hard constraint) is
  never rounded, since it's a boundary check, not a normalised score.

- `overall_score` is the weights-normalised sum of the three per-criterion scores
  (Weighted Sum Model). Results are ranked by `overall_score` descending, ties
  broken by `sa2_code` for deterministic ordering.

**Example response** (truncated to one result; at this budget, 39 suburbs are
included and 23 excluded):

```json
{
  "budget": 500,
  "destination": "The Base",
  "weights_used": { "rent": 0.333, "transport": 0.333, "distance": 0.333 },
  "results": [
    {
      "rank": 1,
      "sa2_code": 179400,
      "sa2_name": "Hamilton Central",
      "overall_score": 0.7732,
      "score_breakdown": {
        "rent": { "value": 400, "normalised_score": 0.8537 },
        "transport": { "value": 9.4935, "walk_coverage": 0.9784, "normalised_score": 1 },
        "distance": { "value": 5982.44, "normalised_score": 0.4659 }
      },
      "lowest_rent": {
        "value": 125,
        "dwelling_type": "Boarding House",
        "number_of_beds": null,
        "total_bonds": 6,
        "low_sample_warning": true,
        "low_sample_note": "This figure is based on a very small sample (6 bonds — the smallest sample MBIE publishes) — treat it as a rough indication only."
      }
    }
  ],
  "excluded": [
    { "sa2_code": 175200, "sa2_name": "Te Rapa North", "reason": "insufficient_data", "data_status": "NO_DATA" },
    {
      "sa2_code": 175400,
      "sa2_name": "Rotokauri-Waiwhakareke",
      "reason": "exceeds_budget",
      "lowest_rent": {
        "value": 650,
        "dwelling_type": "House",
        "number_of_beds": "ALL",
        "total_bonds": 6,
        "low_sample_warning": true,
        "low_sample_note": "This figure is based on a very small sample (6 bonds — the smallest sample MBIE publishes) — treat it as a rough indication only."
      }
    }
  ]
}
```

Note `score_breakdown.rent.value` (400, the suburb-wide median, used for
ranking) and `lowest_rent.value` (125, a specific Boarding House row, used for
the budget check) are deliberately different figures — see "Budget filtering"
above.

**Example response, no destination** (same budget, `destination` omitted — note
the re-normalised `weights_used`, the two-key `score_breakdown`, and that
`lowest_rent` is unaffected by destination since it's a hard-constraint concern,
not a scoring one; `overall_score` (and the order further down the list) differs from
the example above because distance no longer factors in. `excluded` is the same 23 entries as the
example above — hard constraints don't depend on destination — just truncated
here the same way):

```json
{
  "budget": 500,
  "destination": null,
  "distance_excluded": true,
  "distance_excluded_note": "No destination was provided, so distance could not be scored. rent_weight and transport_weight were re-normalised to fill the remaining weight.",
  "weights_used": { "rent": 0.5, "transport": 0.5 },
  "results": [
    {
      "rank": 1,
      "sa2_code": 179400,
      "sa2_name": "Hamilton Central",
      "overall_score": 0.9269,
      "score_breakdown": {
        "rent": { "value": 400, "normalised_score": 0.8537 },
        "transport": { "value": 9.4935, "walk_coverage": 0.9784, "normalised_score": 1 }
      },
      "lowest_rent": {
        "value": 125,
        "dwelling_type": "Boarding House",
        "number_of_beds": null,
        "total_bonds": 6,
        "low_sample_warning": true,
        "low_sample_note": "This figure is based on a very small sample (6 bonds — the smallest sample MBIE publishes) — treat it as a rough indication only."
      }
    }
  ],
  "excluded": [
    { "sa2_code": 175200, "sa2_name": "Te Rapa North", "reason": "insufficient_data", "data_status": "NO_DATA" },
    {
      "sa2_code": 175400,
      "sa2_name": "Rotokauri-Waiwhakareke",
      "reason": "exceeds_budget",
      "lowest_rent": {
        "value": 650,
        "dwelling_type": "House",
        "number_of_beds": "ALL",
        "total_bonds": 6,
        "low_sample_warning": true,
        "low_sample_note": "This figure is based on a very small sample (6 bonds — the smallest sample MBIE publishes) — treat it as a rough indication only."
      }
    }
  ]
}
```

### `GET /api/suburb-finder-examples`

A fixed list of example Suburb Finder requests, each as `{ description, url }`.
Unlike `/api/rental-price-check-examples` it deliberately carries no live `result`
— one Suburb Finder response can hold up to 10 fully score-broken-down suburbs,
which is too long to skim in a demo. No parameters.

## Testing

- **`/api/suburbs`:** manual — see [test-examples.md](test-examples.md). No
  parameters and no branching logic to cover (a single cached query result), so a
  regression script would just be re-asserting the row count; not worth automating.
- **`/api/rental-price-check-bed-availability`:** manual — see
  [test-examples.md](test-examples.md). Same reasoning as `/api/suburbs`: no
  parameters, one cached lookup, nothing to regress.
- **Rental Price Check:** manual — see [test-examples.md](test-examples.md) for
  curl examples covering every case (exact match, both fallback tiers, NO_DATA,
  STALE, empty breakdown, stale breakdown rows under a current primary result,
  low-sample footnote, invalid input, rent comparison).
- **Suburb Finder:** automated regression script,
  [tests/test_suburb_finder.py](tests/test_suburb_finder.py) — 79 checks run
  against a live server (validation, optional destination, empty result set,
  exact-tie, normal ranking, full population, all 4 destinations,
  low-coverage suburbs, transport route reach (including monotonicity and the Hamilton Lake lake mask), determinism, zero-weight criteria, `lowest_rent`
  — structure, the `low_sample_warning`/`total_bonds <= 6` invariant, the
  documented 50/60 warned split, and a "smoking gun" check that a suburb is
  actually included by its `lowest_rent` and not its `median_rent` — and the
  rent/distance/transport rounding-based tie behavior, with real suburbs confirmed to
  tie within a rounding bucket and not tie across one). Start the server
  first, then:

  ```
  python3 backend/tests/test_suburb_finder.py
  ```

  Set `BASE_URL` (default `http://localhost:3001`) to run the same checks against a
  deployed server, e.g. `BASE_URL=https://<app>.onrender.com python3 backend/tests/test_suburb_finder.py`.

  Exits non-zero if any check fails, so it can be wired into CI later.
