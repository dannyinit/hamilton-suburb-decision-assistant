# Hamilton Suburb Decision Assistant

A web app that helps someone renting in Hamilton, New Zealand decide where to look: a
**Suburb Finder** that ranks suburbs by rent, transport and distance to a chosen
destination, and a **Rental Price Check** that looks up market rent for a suburb, dwelling
type and bedroom count. There are no user accounts and nothing is ever written at
runtime: the app reads a prebuilt, read-only SQLite database.

It runs as **one Node process**: an Express server that serves both the API and the
built React frontend.

| Folder | What it is | Docs |
|---|---|---|
| `frontend/` | React + Vite single-page app | — |
| `backend/` | Express API and the static-file server | [backend/README.md](backend/README.md) |
| `data-pipeline/` | Python ETL that builds the SQLite database from the raw datasets | the rest of this file, from "Data Pipeline" below |

## Running the app

Needs Node 22.12 or newer (Node 24 works locally; the deployed version is pinned, see
Deployment).

- **As deployed (one server):** from the repo root, `npm run build && npm start`, then
  open http://localhost:3001 (override the port with `PORT`). `npm run build` installs and
  builds the frontend, then installs the backend.
- **Development (hot reload):** in one terminal, `cd backend && npm install && npm start`;
  in another, `cd frontend && npm install && npm run dev`. Vite proxies `/api` to the
  backend on port 3001.
- **Regression tests** (Suburb Finder, 79 checks; start the server first):
  `python3 backend/tests/test_suburb_finder.py`.

The database, `data-pipeline/output/hamilton.db`, is **committed to the repo**, so none of
the above needs Python or the raw data.

## Deployment (Render)

The app is set up for [Render](https://render.com)'s free web service via the Blueprint in
[render.yaml](render.yaml): one service that runs `npm run build` and then `npm start`,
health-checked at `/api/health`, in the Singapore region (the closest to New Zealand).

**Deploying**

1. Push `master` to GitHub.
2. In Render, sign in with GitHub, then **New → Blueprint**, pick this repository and
   branch `master`; Render reads `render.yaml`. (If it asks for a payment method even for
   the free plan, create a **New → Web Service** by hand with the same build command,
   start command and health-check path instead.)
3. Open the build log and check which Node version was used, then open
   `https://<your-app>.onrender.com/api/health`.
4. Smoke-test the live app with the regression suite:
   `BASE_URL=https://<your-app>.onrender.com python3 backend/tests/test_suburb_finder.py`.

With `autoDeployTrigger: commit`, every push to `master` redeploys.

**Before a demo, warm the service up.** Render's free instances spin down after 15
minutes without traffic and take about a minute to start again, so open the app (or
`/api/health`) a minute or two beforehand. Free instances also have 512 MB of memory and
0.1 CPU, and a monthly allowance of 750 instance hours; Render's filesystem is
ephemeral, which doesn't matter here because the database ships with the repo. Current
terms: https://render.com/docs/free.

**After any pipeline rebuild, recommit `data-pipeline/output/hamilton.db`.** The
database is normally gitignored (`data-pipeline/output/*.db*`) with an exception for this
one file, because a deploy has to ship it. Re-running `scripts/build_hamilton_db.py`
rewrites the file locally, but nothing changes on the deployed site until the new file is
committed and pushed. Also re-derive the Suburb Finder's hardcoded normalisation
thresholds if the data changes materially (see [backend/README.md](backend/README.md)).

**Node version.** `render.yaml` pins `NODE_VERSION` to an exact release (currently
22.23.2), tested with a from-scratch build and the full regression suite. Vite 8 needs
Node 22.12 or newer, and an unbounded range would drift to newer major versions over
time, so `engines` in the root `package.json` is bounded too (`>=22.12.0 <23`). Bump the
pin deliberately and re-run the checks.

**Data attribution.** Every dataset's licence requires credit, so the app shows a "Data
sources" footer on every page ([DataSources.jsx](frontend/src/components/DataSources.jsx)).
Keep it in sync with the Datasets list below whenever a source is added or its licence
changes. Licences were confirmed against each publisher's own pages on 2026-09-21.

---

# Data Pipeline

Scripts and raw data for the Hamilton Suburb Decision Assistant.
The data files in `raw/` (CSVs and one GeoJSON) are committed to this repository; the sources below are for citation, licensing and re-downloading a fresh copy if needed.

## Datasets

Raw data files are included directly in `raw/` for reproducibility (they were non-trivial to re-download from the original portals). Sources and notes below are for citation and documentation purposes.

### 1. MBIE Rental Bond data
- File: `mbie_rental_bond.csv`
- Source: https://www.tenancy.govt.nz/about-tenancy-services/data-and-statistics/rental-bond-data/
- Licence: Creative Commons Attribution 3.0 New Zealand. The publisher asks that you credit "The Ministry of Business, Innovation and Employment" as the source.
- Notes: Location Id is a Statistics NZ SA2 2019 area code. Exclude Location Id = -99 and NaN before suburb-level analysis.

### 2. Waikato GTFS bus stop data (BUSIT)
- File: `bus_stops_hamilton.csv` (from the `BUS_STOP_HAMILTON` layer, NOT `BUS_ROUTE_HAMILTON`)
- Source: https://data.waikatoregion.govt.nz:8443/ords/piplx/f?p=140:12:0::NO::P12_METADATA_ID:402
- Licence: Creative Commons Attribution 4.0 International. Publisher's own wording: "© Waikato Regional Council 2022 Licensed under CC BY 4.0." The dataset page also carries a no-liability disclaimer.
- Notes: x, y coordinates in NZTM2000 (EPSG:2193), metres. 1557 rows (one per stop-route pair), 1045 unique STOP_ID values, 21 routes. The `bus_stops` table is deduplicated by STOP_ID, but transport access is computed from the stop-route pairs, since it counts distinct routes.

### 3. Stats NZ SA2 2019 centroids
- File: `sa2_centroids.csv`
- Source: https://datafinder.stats.govt.nz/layer/98771-statistical-area-2-2019-centroid-inside/
- Licence: Creative Commons Attribution 4.0 International (per its data.govt.nz catalogue entry); attribute Stats NZ.
- Notes: includes both NZTM (EASTING/NORTHING) and WGS84 (LATITUDE/LONGITUDE) coordinates. NZTM used for distance calculations.

### 4. Stats NZ SA2 Higher Geographies 2019 (TA concordance)
- File: `sa2_higher_geographies.csv`
- Source: https://datafinder.stats.govt.nz/layer/98779-statistical-area-2-higher-geographies-2019-generalised/
- Licence: Creative Commons Attribution 4.0 International (per its data.govt.nz catalogue entry); attribute Stats NZ.
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
| stop_id | INTEGER PK | deduplicated from 1557 raw rows (a stop appears once per route). Not used by the transport calculation, which reads the stop-route pairs from the raw file |
| stop_name | TEXT | |
| easting, northing | REAL | NZTM2000 |

### `suburb_bus_access` (62 rows, fact)
| column | type | notes |
|---|---|---|
| sa2_code | INTEGER PK FK→suburbs | |
| walk_coverage_400m | REAL | share (0–1) of the suburb's land within 400m of any bus stop (straight-line; stops counted city-wide). Returned by the API for consumers; not shown in the UI or scored (it's already reflected in `avg_routes_400m`) |
| avg_routes_400m | REAL | plain mean number of distinct bus routes with a stop within 400m, over a 50m grid of points across the suburb's land (uncapped). Points with no stop in range count 0, so this already reflects coverage. Shown in the UI, and the basis of the transport score: the backend scores √`avg_routes_400m`, a judgment call, not a finding (no evidence supports its shape); it compresses the scale so the CBD's ~9.5 routes doesn't flatten the rest, while being strictly increasing, so a higher average never scores lower. Always `≥ walk_coverage_400m` |

Both columns come from sampling each suburb's Stats NZ polygon (not its centroid, which can
land somewhere unrepresentative — Hamilton Lake's sits on the lake). Lake water is excluded
from the sampling using the OSM outline (dataset 5). See `compute_transport_access` in
`scripts/build_hamilton_db.py`; the build asserts every suburb's sampled area is within 5% of
its Stats NZ land area.

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
- `bus_stops` ↔ `suburbs` (a stop can be within walking distance of more than one suburb, and a
  suburb has many stops nearby): never materialised as a bridge table — collapsed at ETL time
  into the precomputed 1:1 fact `suburb_bus_access` (`walk_coverage_400m`, `avg_routes_400m`).
- `suburbs` ↔ `destinations` (every suburb has a distance to every destination, and vice versa):
  resolved with a genuine junction table, `suburb_destination_distance`, since the per-pair
  distance value itself is needed downstream and can't be aggregated away.

## Setup

1. Create a virtual environment: `python3 -m venv venv`
2. Activate it: `source venv/bin/activate`
3. Install dependencies: `pip install -r requirements.txt` (pandas, numpy, shapely, pyproj)
4. Run the ingestion script to build `output/hamilton.db`