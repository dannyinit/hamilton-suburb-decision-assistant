# Data Pipeline

Scripts and raw data for the Hamilton Suburb Decision Assistant.
The data files in `raw/` (CSVs and one GeoJSON) are committed to this repository; the sources below are for citation, licensing and re-downloading a fresh copy if needed.

## Datasets

Raw data files are included directly in `raw/` for reproducibility (they were non-trivial to re-download from the original portals). Sources and notes below are for citation and documentation purposes.

### 1. MBIE Rental Bond data
- File: `mbie_rental_bond.csv`
- Source: https://www.tenancy.govt.nz/about-tenancy-services/data-and-statistics/rental-bond-data/
- Licence: Creative Commons Attribution 3.0 New Zealand
- Notes: Location Id is a Statistics NZ SA2 2019 area code. Exclude Location Id = -99 and NaN before suburb-level analysis.

### 2. Waikato GTFS bus stop data (BUSIT)
- File: `bus_stops_hamilton.csv` (from the `BUS_STOP_HAMILTON` layer, NOT `BUS_ROUTE_HAMILTON`)
- Source: https://data.waikatoregion.govt.nz:8443/ords/piplx/f?p=140:12:0::NO::P12_METADATA_ID:402
- Notes: x, y coordinates in NZTM2000 (EPSG:2193), metres. 1557 rows, 1045 unique STOP_ID values; dedupe by STOP_ID before counting stops.

### 3. Stats NZ SA2 2019 centroids
- File: `sa2_centroids.csv`
- Source: https://datafinder.stats.govt.nz/layer/98771-statistical-area-2-2019-centroid-inside/
- Notes: includes both NZTM (EASTING/NORTHING) and WGS84 (LATITUDE/LONGITUDE) coordinates. NZTM used for distance calculations.

### 4. Stats NZ SA2 Higher Geographies 2019 (TA concordance)
- File: `sa2_higher_geographies.csv`
- Source: https://datafinder.stats.govt.nz/layer/98779-statistical-area-2-higher-geographies-2019-generalised/
- Notes: used to correctly filter to the 62 SA2 areas belonging to Hamilton City (`TA2019_V1_00_NAME = "Hamilton City"`). Do NOT filter by suburb name string or the "(Hamilton City)" suffix, since only 7/62 suburbs carry that suffix.

### 5. Hamilton Lake outline (OpenStreetMap)
- File: `hamilton_lake_osm.geojson` (WGS84 lon/lat, one Polygon, 191 vertices)
- Source: OpenStreetMap way [28496787](https://www.openstreetmap.org/way/28496787) ("Lake Rotoroa / Hamilton Lake"), retrieved via the Overpass API; OSM data timestamp 2026-09-20T08:20:06Z.
- Licence: Open Database Licence (ODbL) 1.0 — © OpenStreetMap contributors. Any use of this file, or of anything derived from it, needs this attribution.
- Notes: used only to exclude lake water when sampling the Hamilton Lake SA2 polygon for walk-coverage/route reach, since Stats NZ's polygon includes the lake (its `AREA_SQ_KM` 2.428 vs `LAND_AREA_SQ_KM` 1.864 km²) and lake points are systematically less served by buses than land. Cross-check: the outline's area is 0.539 km², against Stats NZ's implied water area of 0.564 km² (within 5%). Hamilton Lake is the only Hamilton SA2 where this matters materially — Forest Lake is ~2.5% of its suburb and other OSM water bodies are negligible — so no other water layer is used. It is not an official boundary; LINZ's lake layer was deliberately not pursued for a single suburb.

## Output schema (`output/hamilton.db`)

Built by `scripts/build_hamilton_db.py`. All quarter/staleness figures are computed
against the true latest `TimeFrame` found anywhere in the Hamilton-filtered rental
data (parsed as a real date, not string-compared) — currently **2026-Q1**. This is
recomputed on every run, so it moves forward automatically as MBIE publishes new
quarters; it is never hardcoded.

All tables below are created with explicit `CREATE TABLE` DDL (primary keys and
`FOREIGN KEY (sa2_code) REFERENCES suburbs (sa2_code)` constraints are real schema
constraints, verifiable with `sqlite3 hamilton.db .schema`, not just conventions
documented in the ER diagram). The build script itself runs with
`PRAGMA foreign_keys = ON`, so if the ETL ever produces a `sa2_code` that isn't in
`suburbs`, the build fails immediately with `FOREIGN KEY constraint failed` instead
of silently writing orphaned rows.

**SQLite does not enforce foreign keys by default — this is a per-connection
setting, not a property of the database file.** Anyone who later opens
`hamilton.db` with a new connection (including the Node.js/Express backend) must
run `PRAGMA foreign_keys = ON` on that connection themselves, or the constraints
declared in the schema will silently not be checked.

### `suburbs` (62 rows, dimension)
| column | type | notes |
|---|---|---|
| sa2_code | INTEGER PK | SA2 2019 code |
| sa2_name | TEXT | |
| easting, northing | REAL | NZTM2000 |
| latitude, longitude | REAL | WGS84 |

### `rent` (848 rows, grain = sa2_code + dwelling_type + number_of_beds)
| column | type | notes |
|---|---|---|
| sa2_code | INTEGER FK→suburbs | |
| dwelling_type | TEXT | ALL / Apartment / Boarding House / Flat / House / Room |
| number_of_beds | TEXT, nullable | 'ALL', '0'..'9', '15', '5+', or NULL (a distinct MBIE category with real bond/rent data, not a duplicate of 'ALL') |
| timeframe | TEXT | ISO date (`YYYY-MM-DD`) of the most recent quarter that has a row for this exact combination (MBIE omits rows outright when a quarter's sample is too small) |
| quarters_stale | INTEGER | this row's `timeframe` vs. the global latest quarter, in quarters (0 = current). Downstream code (the backend's stale footnote and staleness sentences) assumes that global latest quarter also appears as some row's `timeframe` in this table; that holds by construction, since each combination keeps its own latest quarter and the global latest is computed over the same Hamilton-filtered data |
| median_rent, geometric_mean_rent, upper_quartile_rent, lower_quartile_rent | REAL | |
| total_bonds, active_bonds | INTEGER | |
| PK | (sa2_code, dwelling_type, number_of_beds) | |

### `bus_stops` (1045 rows, dimension)
| column | type | notes |
|---|---|---|
| stop_id | INTEGER PK | deduplicated from 1557 raw rows (a stop appears once per route) |
| stop_name | TEXT | |
| easting, northing | REAL | NZTM2000 |

### `suburb_bus_access` (62 rows, fact)
| column | type | notes |
|---|---|---|
| sa2_code | INTEGER PK FK→suburbs | |
| bus_stop_count_500m | INTEGER | stops within 500m of the suburb's NZTM centroid |

### `suburb_data_status` (62 rows, fact)
One row per suburb, summarising the overall (`dwelling_type='ALL'`, `number_of_beds='ALL'`)
rent figure used for ranking/budget decisions.

| column | type | notes |
|---|---|---|
| sa2_code | INTEGER PK FK→suburbs | |
| has_rent_data | BOOLEAN | any row at all for this suburb, in any dwelling_type/number_of_beds |
| all_all_timeframe | TEXT, nullable | timeframe of the ALL/ALL row; NULL if it doesn't exist |
| all_all_quarters_stale | INTEGER, nullable | |
| data_status | TEXT | `CURRENT` / `STALE` (all_all_quarters_stale >= `STALE_THRESHOLD_QUARTERS`) / `NO_DATA` (no rent data at all, or no ALL/ALL row) |

`STALE_THRESHOLD_QUARTERS = 4` (one year), set as a constant in `build_hamilton_db.py`.

As of the current data pull: **Te Rapa North** = `NO_DATA` (zero rows in `mbie_rental_bond.csv`
for this SA2, in any dwelling type or bed count), **Te Rapa South** = `STALE` (7 quarters
behind), all other 60 suburbs = `CURRENT`.

### `destinations` (4 rows, fixed reference data)
The 4 destinations users can pick, per the project proposal's functional requirements. Not
derived from any CSV — hardcoded as the `DESTINATIONS` constant in `build_hamilton_db.py`.
Coordinates are NZTM2000 (EPSG:2193), converted from Google Maps lat/long via pyproj.

| column | type | notes |
|---|---|---|
| destination_id | INTEGER PK | |
| name | TEXT, unique | University of Waikato / Transport Centre / The Base / Waikato Hospital |
| easting, northing | REAL | NZTM2000 |

### `suburb_destination_distance` (248 rows = 62 suburbs × 4 destinations, junction)
Euclidean NZTM distance from each suburb's centroid to each destination. This is a genuine
many-to-many relationship resolved with a real bridge table (composite PK, two FKs) — unlike
`bus_stops`/`suburbs`, the per-pair `distance_m` is itself needed downstream (the scoring
algorithm looks up the distance for the one destination the user picked), so it can't be
collapsed into a precomputed aggregate.

| column | type | notes |
|---|---|---|
| sa2_code | INTEGER PK FK→suburbs | |
| destination_id | INTEGER PK FK→destinations | |
| distance_m | REAL | straight-line NZTM distance, metres |

### Consumption rules for downstream features

Both features below are now implemented in `backend/` — see
[`backend/README.md`](backend/README.md) for the current, authoritative API contract
(request/response shapes, fallback tiers, normalisation). The underlying data-layer
rules that motivated the design are still accurate and kept here for context:

- **Feature 1 — Suburb Finder (ranking):** exclude a suburb when `suburb_data_status.data_status != 'CURRENT'`,
  with reason `insufficient_data`, checked *before* the budget filter so a suburb never carries
  both an `insufficient_data` and an `exceeds_budget` reason at once.
- **Feature 2 — Rental Price Check (lookup):** never blocks a suburb from selection. If `rent` has
  zero rows for the suburb at all, return "no data available" (this falls out naturally from the
  data for Te Rapa North — no special-casing needed). Otherwise show the row for the requested
  dwelling_type/number_of_beds and, whenever that row's `quarters_stale >= 1`, surface a warning
  stating exactly how many quarters old it is.
- Rationale for the different thresholds (4 quarters vs. 1 quarter): Feature 1 is a ranking engine
  where small staleness is noise and should only block suburbs when it's severe enough to distort
  results; Feature 2 is a transparency/lookup tool where the user is inspecting one specific number,
  so any staleness at all should be disclosed.

## Entity-relationship diagram

See [`data-pipeline/docs/er-diagram.puml`](data-pipeline/docs/er-diagram.puml) (PlantUML; open with
the PlantUML VS Code extension, Alt+D to preview). It covers all 7 tables above and both
many-to-many relationships in this schema, resolved two different ways:
- `bus_stops` ↔ `suburbs` (a stop can lie within 500m of more than one suburb centroid, and a
  suburb has many stops nearby): never materialised as a bridge table — collapsed at ETL time
  into the precomputed 1:1 fact `suburb_bus_access.bus_stop_count_500m`.
- `suburbs` ↔ `destinations` (every suburb has a distance to every destination, and vice versa):
  resolved with a genuine junction table, `suburb_destination_distance`, since the per-pair
  distance value itself is needed downstream and can't be aggregated away.

## Setup

1. Create a virtual environment: `python3 -m venv venv`
2. Activate it: `source venv/bin/activate`
3. Install dependencies: `pip install pandas`
4. Run the ingestion script to build `output/hamilton.db`