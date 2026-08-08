# Rental Price Check — quick-reference test URLs

Start the server first: `npm start` (from `backend/`), then either paste a URL into a
browser or run the `curl` command. All base URLs assume `http://localhost:3001`.

## Health check

Confirms the server is up, connected to `hamilton.db`, and `foreign_keys` is on.

```
curl "http://localhost:3001/api/health"
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
`staleness_warning`.

```
curl "http://localhost:3001/api/rental-price-check?sa2_code=176300&dwelling_type=ALL&number_of_beds=ALL"
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
