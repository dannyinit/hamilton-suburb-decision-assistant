// The 4 destinations users can pick for Suburb Finder. Hardcoded rather
// than fetched: unlike /api/suburbs (62 DB-derived rows, meaningfully
// sized, could change if the pipeline is rerun), this is a small, fixed
// domain list — the backend itself hardcodes the same 4 names as a
// DESTINATIONS constant in data-pipeline/scripts/build_hamilton_db.py, and
// the project proposal describes it as "a fixed list". Not worth a new
// endpoint for.
//
// Must match backend/routes/suburbFinder.js's destinations table exactly
// (checked against backend/README.md) — kept here in sync by hand.
export const DESTINATIONS = [
  'University of Waikato',
  'Transport Centre',
  'The Base',
  'Waikato Hospital',
];
