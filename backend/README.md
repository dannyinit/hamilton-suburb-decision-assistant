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
│   └── suburbFinder.js          # GET /api/suburb-finder
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
2. `median_rent > budget` (the suburb's `dwelling_type='ALL', number_of_beds='ALL'` row) → excluded, reason `exceeds_budget`

If no suburb survives both constraints, the response is `results: []` with
`no_suburbs_in_budget: true` and a message naming the cheapest available suburb.
This is unaffected by whether `destination` was provided — neither hard
constraint reads distance.

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
(not all 62 — ranking should reflect relative comparison among viable options):

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

**Example response** (truncated to one result):

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
      "overall_score": 0.768,
      "score_breakdown": {
        "rent": { "value": 400, "normalised_score": 0.625 },
        "transport": { "value": 28, "normalised_score": 1 },
        "distance": { "value": 5982.44, "normalised_score": 0.6789 }
      }
    }
  ],
  "excluded": [
    { "sa2_code": 175200, "sa2_name": "Te Rapa North", "reason": "insufficient_data", "data_status": "NO_DATA" },
    { "sa2_code": 175300, "sa2_name": "Flagstaff North", "reason": "exceeds_budget", "median_rent": 750 }
  ]
}
```

**Example response, no destination** (same budget, `destination` omitted — note
the re-normalised `weights_used`, the `distance_excluded` fields, and the
two-key `score_breakdown`; the ranking and `overall_score` differ from the
example above because distance no longer factors in. `excluded` is the same 52
entries as the example above — hard constraints don't depend on destination —
just truncated here the same way):

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
      "overall_score": 0.8125,
      "score_breakdown": {
        "rent": { "value": 400, "normalised_score": 0.625 },
        "transport": { "value": 28, "normalised_score": 1 }
      }
    }
  ],
  "excluded": [
    { "sa2_code": 175200, "sa2_name": "Te Rapa North", "reason": "insufficient_data", "data_status": "NO_DATA" },
    { "sa2_code": 175300, "sa2_name": "Flagstaff North", "reason": "exceeds_budget", "median_rent": 750 }
  ]
}
```

## Testing

- **Rental Price Check:** manual — see [test-examples.md](test-examples.md) for
  curl examples covering every case (exact match, both fallback tiers, NO_DATA,
  STALE, invalid input, rent comparison).
- **Suburb Finder:** automated regression script,
  [tests/test_suburb_finder.py](tests/test_suburb_finder.py) — 44 checks run
  against a live server (validation, optional destination, empty result set,
  exact-tie, normal ranking, full population, all 4 destinations,
  zero-bus-stop suburbs, determinism, zero-weight criteria). Start the server
  first, then:

  ```
  python3 backend/tests/test_suburb_finder.py
  ```

  Exits non-zero if any check fails, so it can be wired into CI later.
