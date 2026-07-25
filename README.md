# Data Pipeline

Scripts and raw data for the Hamilton Suburb Decision Assistant.
CSV files in `raw/` are not committed to git (see `.gitignore`); they must be re-downloaded from the sources below.

## Datasets

Raw CSV files are included directly in `raw/` for reproducibility (they were non-trivial to re-download from the original portals). Sources and notes below are for citation and documentation purposes.

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
| quarters_stale | INTEGER | this row's `timeframe` vs. the global latest quarter, in quarters (0 = current) |
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

### Consumption rules for downstream features (not yet implemented)

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
the PlantUML VS Code extension, Alt+D to preview). It covers all 5 tables above and notes how the
one potential many-to-many relationship in this schema — a bus stop can lie within 500m of more
than one suburb centroid, and a suburb has many stops nearby — is resolved: it's never materialised
as a bridge table, only as the precomputed 1:1 fact `SUBURB_BUS_ACCESS.bus_stop_count_500m`.

## Setup

1. Create a virtual environment: `python3 -m venv venv`
2. Activate it: `source venv/bin/activate`
3. Install dependencies: `pip install pandas`
4. Run the ingestion script to build `output/hamilton.db`