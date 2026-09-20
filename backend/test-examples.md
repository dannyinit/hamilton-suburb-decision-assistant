# Rental Price Check — quick-reference test URLs

Start the server first: `npm start` (from `backend/`), then either paste a URL into a
browser or run the `curl` command. All base URLs assume `http://localhost:3001`.

## Health check

Confirms the server is up, connected to `hamilton.db`, and `foreign_keys` is on.

```
curl "http://localhost:3001/api/health"
```

## Suburb list (for populating a picker)

All 62 suburbs, `sa2_code` + `sa2_name`, alphabetical. No parameters.

```
curl "http://localhost:3001/api/suburbs"
```

## Bed availability lookup (for filtering the Bedrooms dropdown)

Which number_of_beds values have an exact row for each suburb/dwelling type. No
parameters.

```
curl "http://localhost:3001/api/rental-price-check-bed-availability"
```

## Normal exact-match lookup

Flagstaff North, House, 2 beds — has good coverage, so this hits the exact row
directly. `fallback_level` should be `'none'`.

```
curl "http://localhost:3001/api/rental-price-check?sa2_code=175300&dwelling_type=House&number_of_beds=2"
```

## Intermediate fallback case (dwelling type kept, beds widened)

Flagstaff North has no `House`/6-beds row, but does have a `House`/ALL row, so this
falls back one tier — to the same dwelling type with `number_of_beds=ALL` — rather
than jumping straight to the fully generic estimate. `fallback_level` should be
`'dwelling_type'`, with a `fallback_note`.

```
curl "http://localhost:3001/api/rental-price-check?sa2_code=175300&dwelling_type=House&number_of_beds=6"
```

## Full fallback case (dwelling type and beds both widened)

Rotokauri-Waiwhakareke has no `Room` data at all (not even `Room`/ALL), so this
falls back all the way to the suburb's overall `dwelling_type=ALL,
number_of_beds=ALL` row. `fallback_level` should be `'full'`, with a
`fallback_note`.

```
curl "http://localhost:3001/api/rental-price-check?sa2_code=175400&dwelling_type=Room&number_of_beds=ALL"
```

## NO_DATA case

Te Rapa North has zero rent rows at all, even the ALL/ALL fallback. Response
should have `insufficient_data: true` and no numbers.

```
curl "http://localhost:3001/api/rental-price-check?sa2_code=175200&dwelling_type=House&number_of_beds=ALL"
```

## STALE case

Te Rapa South's only data is ~7 quarters old. Numbers are still returned, plus a
`staleness_warning` that names the quarter ("This data is from Q2 2024, 7 quarters
older than the most recent data available (Q1 2026).").

This suburb has no other dwelling-type rows, so `dwelling_type_breakdown` is `[]`
and neither footnote is attached (the frontend shows a "no breakdown available"
message instead of a table).

```
curl "http://localhost:3001/api/rental-price-check?sa2_code=176300&dwelling_type=ALL&number_of_beds=ALL"
```

## Breakdown with a current primary result but stale rows

Flagstaff North, House: the primary result is current (`quarters_stale: 0`,
`staleness_warning: null`), but the House 2-bed and 3-bed rows in
`dwelling_type_breakdown[].beds` are 2 quarters old and the 5+ row is 6, each with its
own `staleness_warning`. Because at least one breakdown row is stale, the response also
carries `stale_footnote` — describing the table, not the primary result. Also shows
`timeframe_label` (`"Q1 2026"`) and, on the primary result only, `timeframe_months`
(`"Jan–Mar"`).

```
curl "http://localhost:3001/api/rental-price-check?sa2_code=175300&dwelling_type=House"
```

## Breakdown with mixed row ages (Pukete East)

Pukete East, House (SA2 176000): the all-beds and 1-/3-bed rows are current, while the
2-bed row is from Q1 2022 (16 quarters old) and the 4-bed row from Q4 2023 (9 quarters
old). The bed rows' `total_bonds` can't be summed to the all-beds figure — they come
from different quarters, and MBIE rounds each row independently. Also has
`low_sample_warning: true` bed rows, so `low_sample_footnote` is present.

```
curl "http://localhost:3001/api/rental-price-check?sa2_code=176000&dwelling_type=House"
```

## Example lists

`/api/rental-price-check-examples` returns these cases as a list, each with its live
result; `/api/suburb-finder-examples` returns Suburb Finder's equivalent (description +
URL only).

```
curl "http://localhost:3001/api/rental-price-check-examples"
curl "http://localhost:3001/api/suburb-finder-examples"
```

## Omitted number_of_beds (defaults to ALL)

Leaving `number_of_beds` out entirely means "any bed count" and resolves to the
standard `number_of_beds=ALL` aggregate — this should return an identical response
to the normal exact-match example above with `number_of_beds=ALL` added explicitly.

```
curl "http://localhost:3001/api/rental-price-check?sa2_code=175300&dwelling_type=House"
```

## Invalid input (expected 400)

`number_of_beds=99` isn't in the documented value set, so this is rejected as a bad
request instead of silently falling through to NO_DATA.

```
curl "http://localhost:3001/api/rental-price-check?sa2_code=175300&dwelling_type=House&number_of_beds=99"
```

## Rent provided — comparison label

Same Flagstaff North House/ALL row as above, but with a `rent` supplied so the
response includes a `comparison` label (`Below market` here, since 600 is under the
lower quartile).

```
curl "http://localhost:3001/api/rental-price-check?sa2_code=175300&dwelling_type=House&number_of_beds=ALL&rent=600"
```
