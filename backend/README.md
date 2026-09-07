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

**Prerequisite:** `data-pipeline/output/hamilton.db` must already exist — build it
first by following the data-pipeline setup steps in [the root README](../README.md#setup).
`db.js` fails fast on startup (`fileMustExist: true`) if it's missing, rather than
silently creating an empty database.

## Endpoints

### `GET /`

Returns a JSON summary of available endpoints — useful as a sanity check that the
server is actually running.

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
fallback and a staleness warning when the data is old.

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
that's missing, `insufficient_data: true` with no numbers at all.

**Staleness:** any row with `quarters_stale >= 1` gets a `staleness_warning`
stating exactly how many quarters old it is — a much stricter threshold than Suburb
Finder's 4 quarters (see the root README's "Consumption rules" section for why).

**Example response** (exact match, rent supplied):

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
  "fallback_level": "none",
  "timeframe": "2026-01-01",
  "quarters_stale": 0,
  "staleness_warning": null,
  "rent": 600,
  "comparison": "Below market"
}
```

See [test-examples.md](test-examples.md) for one ready-to-run example per case
(exact match, both fallback tiers, NO_DATA, STALE, invalid input, rent comparison).

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
| `low_sample_warning` | `true` when `total_bonds <= 6` — MBIE's own minimum publishable sample size, not an arbitrary cutoff. A two-tier mild/strong design was tried first, but across all 60 `CURRENT` suburbs `lowest_rent`'s `total_bonds` is only ever 6, 9, 12, or 15 — any boundary above 15 flagged 100% of suburbs, and `<=6` is the only split the real data supports (currently ~50/60 suburbs warned) |
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

**Scoring**, applied only across the suburbs that survive both hard constraints
(not all 62 — ranking should reflect relative comparison among viable options).
The rent criterion here is always the suburb-wide `median_rent`, never
`lowest_rent` — see "Budget filtering" above for why the two are kept separate:

- Each criterion is min-max normalised to `[0,1]`. Rent and distance are cost
  criteria (reversed: lower is better); transport (bus stop count) is a benefit
  criterion (higher is better).
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
  | transport (bus stops within 500m) | 3 stops |
  | distance — University of Waikato | 1000m |
  | distance — Transport Centre | 750m |
  | distance — The Base | 940m |
  | distance — Waikato Hospital | 950m |

  (Distance uses a different threshold per destination — 10% of that destination's
  own full-population distance range — rather than one flat metre value, since the
  four destinations sit at genuinely different distances from the city.)

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
      "overall_score": 0.7739,
      "score_breakdown": {
        "rent": { "value": 400, "normalised_score": 0.8537 },
        "transport": { "value": 28, "normalised_score": 1 },
        "distance": { "value": 5982.44, "normalised_score": 0.468 }
      },
      "lowest_rent": {
        "value": 125,
        "dwelling_type": "Boarding House",
        "number_of_beds": null,
        "total_bonds": 6,
        "low_sample_warning": true,
        "low_sample_note": "This figure is based on a very small sample (6 bonds — MBIE's own minimum reportable size) — treat it as a rough indication only."
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
        "low_sample_note": "This figure is based on a very small sample (6 bonds — MBIE's own minimum reportable size) — treat it as a rough indication only."
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
not a scoring one; the ranking and `overall_score` differ from the example above
because distance no longer factors in. `excluded` is the same 23 entries as the
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
        "transport": { "value": 28, "normalised_score": 1 }
      },
      "lowest_rent": {
        "value": 125,
        "dwelling_type": "Boarding House",
        "number_of_beds": null,
        "total_bonds": 6,
        "low_sample_warning": true,
        "low_sample_note": "This figure is based on a very small sample (6 bonds — MBIE's own minimum reportable size) — treat it as a rough indication only."
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
        "low_sample_note": "This figure is based on a very small sample (6 bonds — MBIE's own minimum reportable size) — treat it as a rough indication only."
      }
    }
  ]
}
```

## Testing

- **`/api/suburbs`:** manual — see [test-examples.md](test-examples.md). No
  parameters and no branching logic to cover (a single cached query result), so a
  regression script would just be re-asserting the row count; not worth automating.
- **`/api/rental-price-check-bed-availability`:** manual — see
  [test-examples.md](test-examples.md). Same reasoning as `/api/suburbs`: no
  parameters, one cached lookup, nothing to regress.
- **Rental Price Check:** manual — see [test-examples.md](test-examples.md) for
  curl examples covering every case (exact match, both fallback tiers, NO_DATA,
  STALE, invalid input, rent comparison).
- **Suburb Finder:** automated regression script,
  [tests/test_suburb_finder.py](tests/test_suburb_finder.py) — 52 checks run
  against a live server (validation, optional destination, empty result set,
  exact-tie, normal ranking, full population, all 4 destinations,
  zero-bus-stop suburbs, determinism, zero-weight criteria, and `lowest_rent`
  — structure, the `low_sample_warning`/`total_bonds <= 6` invariant, the
  documented 50/60 warned split, and a "smoking gun" check that a suburb is
  actually included by its `lowest_rent` and not its `median_rent`). Start
  the server first, then:

  ```
  python3 backend/tests/test_suburb_finder.py
  ```

  Exits non-zero if any check fails, so it can be wired into CI later.
