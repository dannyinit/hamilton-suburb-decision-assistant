"""
One-shot ETL: build data-pipeline/output/hamilton.db from the raw CSVs in
data-pipeline/raw/.

Sources:
  - sa2_higher_geographies.csv : filters the 62 SA2s belonging to Hamilton City
  - sa2_centroids.csv          : NZTM/WGS84 coordinates per SA2
  - mbie_rental_bond.csv       : rent statistics per SA2 / dwelling type / bed count / quarter
  - bus_stops_hamilton.csv     : bus stop locations (NZTM), deduplicated by STOP_ID

Run once with: python build_hamilton_db.py
"""

import sqlite3
from pathlib import Path

import pandas as pd

RAW_DIR = Path(__file__).resolve().parent.parent / "raw"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"
DB_PATH = OUTPUT_DIR / "hamilton.db"

BUS_STOP_RADIUS_M = 500
STALE_THRESHOLD_QUARTERS = 4


def load_hamilton_sa2_codes(higher_geo_path: Path) -> pd.DataFrame:
    """Return the 62 SA2 codes/names belonging to Hamilton City (by TA, not by name)."""
    df = pd.read_csv(higher_geo_path)
    hamilton = df[df["TA2019_V1_00_NAME"] == "Hamilton City"]
    return hamilton[["SA22019_V1_00", "SA22019_V1_00_NAME"]].rename(
        columns={"SA22019_V1_00": "sa2_code", "SA22019_V1_00_NAME": "sa2_name"}
    )


def load_sa2_centroids(centroids_path: Path, hamilton_sa2: pd.DataFrame) -> pd.DataFrame:
    """Attach NZTM/WGS84 centroid coordinates to the Hamilton SA2 list."""
    df = pd.read_csv(centroids_path)
    coords = df[["SA22019_V1_00", "EASTING", "NORTHING", "LATITUDE", "LONGITUDE"]].rename(
        columns={
            "SA22019_V1_00": "sa2_code",
            "EASTING": "easting",
            "NORTHING": "northing",
            "LATITUDE": "latitude",
            "LONGITUDE": "longitude",
        }
    )
    suburbs = hamilton_sa2.merge(coords, on="sa2_code", how="left")
    missing = suburbs[suburbs["easting"].isna()]
    if not missing.empty:
        print(f"Warning: {len(missing)} Hamilton SA2(s) missing centroid data: "
              f"{missing['sa2_code'].tolist()}")
    return suburbs


def _quarter_index(dt: pd.Series) -> pd.Series:
    """Monotonic quarter counter (year*4 + quarter) so staleness is a simple subtraction."""
    return dt.dt.year * 4 + (dt.dt.month - 1) // 3


def load_rental_bond(rental_path: Path, hamilton_sa2: pd.DataFrame) -> pd.DataFrame:
    """
    Clean the MBIE rental bond data and, for each Hamilton suburb x dwelling type
    x number-of-beds combination, keep only the most recent quarter that has a row
    (rows are omitted entirely by MBIE when a quarter's sample is too small, so a
    single global "latest quarter" filter would leave many suburbs empty).
    """
    df = pd.read_csv(rental_path)

    # Location Id: drop missing/unknown (-99) locations, then cast to SA2 int code.
    df = df[df["Location Id"].notna() & (df["Location Id"] != -99)].copy()
    df["sa2_code"] = df["Location Id"].astype(int)
    df = df[df["sa2_code"].isin(hamilton_sa2["sa2_code"])]

    # Number Of Beds has some NaN rows that carry real, distinct bond/rent data
    # (not duplicates of the 'ALL' bucket) - keep them as NULL rather than dropping.
    df["Number Of Beds"] = df["Number Of Beds"].astype("object")
    df.loc[df["Number Of Beds"].isna(), "Number Of Beds"] = None

    # TimeFrame is "D/MM/YYYY" (day never padded, e.g. "1/01/2026" vs "1/10/2025").
    # Comparing/aggregating it as a plain string is lexicographic, not chronological,
    # and silently picks the wrong "latest" row across a year boundary. Parse it first.
    df["tf_dt"] = pd.to_datetime(df["TimeFrame"], format="%d/%m/%Y")

    group_cols = ["sa2_code", "Dwelling Type", "Number Of Beds"]
    latest_mask = df.groupby(group_cols, dropna=False)["tf_dt"].transform("max") == df["tf_dt"]
    latest = df[latest_mask].copy()

    global_latest_q = _quarter_index(pd.Series([df["tf_dt"].max()]))[0]
    latest["quarters_stale"] = global_latest_q - _quarter_index(latest["tf_dt"])
    latest["timeframe"] = latest["tf_dt"].dt.strftime("%Y-%m-%d")

    latest = latest.rename(
        columns={
            "Dwelling Type": "dwelling_type",
            "Number Of Beds": "number_of_beds",
            "Median Rent": "median_rent",
            "Geometric Mean Rent": "geometric_mean_rent",
            "Upper Quartile Rent": "upper_quartile_rent",
            "Lower Quartile Rent": "lower_quartile_rent",
            "Total Bonds": "total_bonds",
            "Active Bonds": "active_bonds",
        }
    )

    covered = latest["sa2_code"].nunique()
    print(f"Rent: {len(latest)} rows covering {covered}/{len(hamilton_sa2)} Hamilton suburbs "
          f"(latest quarter present: {df['tf_dt'].max().date()}).")

    return latest[
        [
            "sa2_code",
            "dwelling_type",
            "number_of_beds",
            "timeframe",
            "quarters_stale",
            "median_rent",
            "geometric_mean_rent",
            "upper_quartile_rent",
            "lower_quartile_rent",
            "total_bonds",
            "active_bonds",
        ]
    ]


def build_suburb_data_status(rent: pd.DataFrame, hamilton_sa2: pd.DataFrame) -> pd.DataFrame:
    """
    One row per Hamilton suburb summarising whether its overall (dwelling_type='ALL',
    number_of_beds='ALL') rent figure is fit to drive ranking/budget decisions:
      - NO_DATA: suburb has no rent rows at all, or specifically no ALL/ALL row
      - STALE:   ALL/ALL row exists but is >= STALE_THRESHOLD_QUARTERS quarters old
      - CURRENT: ALL/ALL row exists and is recent
    """
    has_any_data = hamilton_sa2[["sa2_code"]].copy()
    has_any_data["has_rent_data"] = has_any_data["sa2_code"].isin(rent["sa2_code"])

    all_all = rent[(rent["dwelling_type"] == "ALL") & (rent["number_of_beds"] == "ALL")][
        ["sa2_code", "timeframe", "quarters_stale"]
    ].rename(columns={"timeframe": "all_all_timeframe", "quarters_stale": "all_all_quarters_stale"})

    status = hamilton_sa2[["sa2_code"]].merge(has_any_data, on="sa2_code", how="left")
    status = status.merge(all_all, on="sa2_code", how="left")

    def classify(row):
        if not row["has_rent_data"] or pd.isna(row["all_all_quarters_stale"]):
            return "NO_DATA"
        if row["all_all_quarters_stale"] >= STALE_THRESHOLD_QUARTERS:
            return "STALE"
        return "CURRENT"

    status["data_status"] = status.apply(classify, axis=1)
    status["all_all_quarters_stale"] = status["all_all_quarters_stale"].astype("Int64")

    print("Suburb data status:", status["data_status"].value_counts().to_dict())

    return status[
        ["sa2_code", "has_rent_data", "all_all_timeframe", "all_all_quarters_stale", "data_status"]
    ]


def load_bus_stops(bus_stops_path: Path) -> pd.DataFrame:
    """Dedupe bus stops by STOP_ID (a stop served by multiple routes appears once per route)."""
    df = pd.read_csv(bus_stops_path)
    deduped = df.drop_duplicates(subset="STOP_ID", keep="first")
    return deduped[["STOP_ID", "STOP_NAME", "x", "y"]].rename(
        columns={"STOP_ID": "stop_id", "STOP_NAME": "stop_name", "x": "easting", "y": "northing"}
    )


def compute_bus_stops_within_radius(
    suburbs: pd.DataFrame, bus_stops: pd.DataFrame, radius_m: float = BUS_STOP_RADIUS_M
) -> pd.DataFrame:
    """Count bus stops within radius_m of each suburb's NZTM centroid."""
    counts = []
    for _, suburb in suburbs.iterrows():
        dx = bus_stops["easting"] - suburb["easting"]
        dy = bus_stops["northing"] - suburb["northing"]
        distance = (dx**2 + dy**2) ** 0.5
        counts.append((suburb["sa2_code"], int((distance <= radius_m).sum())))

    return pd.DataFrame(counts, columns=["sa2_code", "bus_stop_count_500m"])


def build_database(
    suburbs: pd.DataFrame,
    rent: pd.DataFrame,
    bus_stops: pd.DataFrame,
    bus_access: pd.DataFrame,
    data_status: pd.DataFrame,
    db_path: Path,
) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()

    with sqlite3.connect(db_path) as conn:
        suburbs.to_sql("suburbs", conn, index=False)
        rent.to_sql("rent", conn, index=False)
        bus_stops.to_sql("bus_stops", conn, index=False)
        bus_access.to_sql("suburb_bus_access", conn, index=False)
        data_status.to_sql("suburb_data_status", conn, index=False)

        conn.execute("CREATE UNIQUE INDEX idx_suburbs_pk ON suburbs (sa2_code)")
        conn.execute(
            "CREATE UNIQUE INDEX idx_rent_pk ON rent (sa2_code, dwelling_type, number_of_beds)"
        )
        conn.execute("CREATE UNIQUE INDEX idx_bus_stops_pk ON bus_stops (stop_id)")
        conn.execute(
            "CREATE UNIQUE INDEX idx_bus_access_pk ON suburb_bus_access (sa2_code)"
        )
        conn.execute(
            "CREATE UNIQUE INDEX idx_data_status_pk ON suburb_data_status (sa2_code)"
        )
        conn.commit()


def main() -> None:
    hamilton_sa2 = load_hamilton_sa2_codes(RAW_DIR / "sa2_higher_geographies.csv")
    assert len(hamilton_sa2) == 62, f"Expected 62 Hamilton SA2s, got {len(hamilton_sa2)}"

    suburbs = load_sa2_centroids(RAW_DIR / "sa2_centroids.csv", hamilton_sa2)
    rent = load_rental_bond(RAW_DIR / "mbie_rental_bond.csv", hamilton_sa2)
    bus_stops = load_bus_stops(RAW_DIR / "bus_stops_hamilton.csv")
    bus_access = compute_bus_stops_within_radius(suburbs, bus_stops)
    data_status = build_suburb_data_status(rent, hamilton_sa2)

    build_database(suburbs, rent, bus_stops, bus_access, data_status, DB_PATH)

    print(f"Done. Wrote {DB_PATH}")
    print(f"  suburbs: {len(suburbs)} rows")
    print(f"  rent: {len(rent)} rows")
    print(f"  bus_stops: {len(bus_stops)} rows")
    print(f"  suburb_bus_access: {len(bus_access)} rows")
    print(f"  suburb_data_status: {len(data_status)} rows")


if __name__ == "__main__":
    main()
