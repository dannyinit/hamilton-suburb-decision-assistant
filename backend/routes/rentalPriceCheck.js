const express = require('express');
const db = require('../db');
const { lowSampleWarning, LOW_SAMPLE_FOOTNOTE } = require('../lowSampleWarning');
const { quarterLabel, quarterMonths, addQuarters } = require('../quarterLabel');

const router = express.Router();

const VALID_DWELLING_TYPES = ['ALL', 'Apartment', 'Boarding House', 'Flat', 'House', 'Room'];

// The rent table also has a separate, not-yet-fully-documented NULL
// category for number_of_beds (distinct from 'ALL') — see
// data-pipeline/README.md, rent table notes. This endpoint doesn't
// expose it: an omitted number_of_beds means "any bed count" (a
// user-intent question), which maps to the standard MBIE ALL aggregate,
// not that undocumented data category (a data question). The two only
// look alike because both happen to be "empty".
const VALID_NUMBER_OF_BEDS = ['ALL', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '15', '5+'];

// Feature 2 (lookup/transparency) discloses any staleness at all, unlike
// Feature 1's ranking engine which only excludes a suburb at >= 4 quarters
// stale (see data-pipeline/README.md, "Consumption rules for downstream
// features").
const STALE_THRESHOLD_QUARTERS = 1;

const findSuburbStmt = db.prepare('SELECT sa2_code, sa2_name FROM suburbs WHERE sa2_code = ?');
const findRentStmt = db.prepare(
  'SELECT * FROM rent WHERE sa2_code = ? AND dwelling_type = ? AND number_of_beds = ?'
);
const findDwellingTypeAllRentStmt = db.prepare(
  "SELECT * FROM rent WHERE sa2_code = ? AND dwelling_type = ? AND number_of_beds = 'ALL'"
);
const findAllAllRentStmt = db.prepare(
  "SELECT * FROM rent WHERE sa2_code = ? AND dwelling_type = 'ALL' AND number_of_beds = 'ALL'"
);

// Keyed by fallback_level ('none' is never looked up here — no note applies).
const FALLBACK_NOTES = {
  dwelling_type: 'No data for the exact number of bedrooms — showing the median across all bed counts for this dwelling type in this suburb.',
  full: 'No data for the exact dwelling type/bed count combination — showing a broader estimate across all dwelling types and bed counts for this suburb.',
};

function comparisonLabel(rent, lowerQuartile, upperQuartile) {
  if (lowerQuartile == null || upperQuartile == null) return null;
  if (rent < lowerQuartile) return 'Below market';
  if (rent > upperQuartile) return 'Above market';
  return 'Fair';
}

function stalenessWarning(row) {
  if (row.quarters_stale < STALE_THRESHOLD_QUARTERS) return null;
  const quarterWord = row.quarters_stale === 1 ? 'quarter' : 'quarters';
  // The reference quarter comes from the row itself (its own quarter +
  // quarters_stale) rather than a separate lookup, so the count and the
  // quarter named beside it always agree.
  const latest = quarterLabel(addQuarters(row.timeframe, row.quarters_stale));
  return `This data is from ${quarterLabel(row.timeframe)}, ${row.quarters_stale} ${quarterWord} older than the most recent data available (${latest}).`;
}

// Shown once in the breakdown table's footer when any row is stale, rather
// than repeating the per-row staleness_warning sentence's explanation. The
// reference quarter is looked up per request (not cached or hardcoded) so
// it tracks the data itself: refresh the database and it moves with it.
// "Most recent data available", not "latest MBIE release" — the database
// is a snapshot and may itself lag MBIE's own newest publication.
const latestTimeframeStmt = db.prepare('SELECT MAX(timeframe) AS timeframe FROM rent');

function staleFootnote() {
  return `This data is older than the most recent data available (${quarterLabel(latestTimeframeStmt.get().timeframe)}).`;
}

// Dwelling-type breakdown table shown below the primary result — every
// specific (dwelling_type != 'ALL', number_of_beds='ALL') row the suburb
// genuinely has data for, INCLUDING whichever dwelling_type the primary
// result itself displays (post-fallback) — that row is flagged via
// is_current rather than filtered out, so the table is a genuinely
// complete picture, not "everything except what you already saw". Each
// row carries its own nested specific-bed breakdown. The NULL-beds
// category is skipped throughout, same as the primary lookup above never
// exposes it.
const findDwellingTypesStmt = db.prepare(`
  SELECT dwelling_type, median_rent, total_bonds, timeframe, quarters_stale
  FROM rent
  WHERE sa2_code = ? AND dwelling_type != 'ALL' AND number_of_beds = 'ALL' AND median_rent IS NOT NULL
`);

// One query for every specific-bed row across all dwelling types in the
// suburb, grouped by dwelling_type in JS below — avoids one query per
// dwelling_type row (at most 5 per suburb, so not a real N+1 concern
// either way, but this stays consistent with how suburbFinder.js's
// lowest_rent avoids per-row queries).
const findDwellingTypeBedsStmt = db.prepare(`
  SELECT dwelling_type, number_of_beds, median_rent, total_bonds, timeframe, quarters_stale
  FROM rent
  WHERE sa2_code = ? AND dwelling_type != 'ALL' AND number_of_beds != 'ALL' AND number_of_beds IS NOT NULL
    AND median_rent IS NOT NULL
`);

// Display order for dwelling types matches VALID_DWELLING_TYPES (the same
// order the frontend's dropdown already uses) rather than e.g. cheapest
// first, so a suburb's breakdown reads in the order a user already expects
// from elsewhere on the same page. Same idea for bed counts: MBIE's own
// category order (from VALID_NUMBER_OF_BEDS), not a plain numeric sort,
// since '15' precedes '5+' there — a numeric sort would separate them from
// the neighbours they're documented to relate to.
const DWELLING_TYPE_ORDER = VALID_DWELLING_TYPES.filter((type) => type !== 'ALL');
const NUMBER_OF_BEDS_ORDER = VALID_NUMBER_OF_BEDS.filter((beds) => beds !== 'ALL');

// Returns { breakdown, anyLowSample, anyStale } — anyLowSample tells the caller
// whether to attach the single shared LOW_SAMPLE_FOOTNOTE at all (only
// when at least one row in the table actually needs it), rather than
// always including a footnote that might reference nothing on the page.
// anyStale does the same for STALE_FOOTNOTE.
function buildDwellingTypeBreakdown(sa2Code, currentDwellingType) {
  const bedsByType = {};
  for (const row of findDwellingTypeBedsStmt.all(sa2Code)) {
    (bedsByType[row.dwelling_type] ??= []).push(row);
  }

  let anyLowSample = false;
  const markIfLowSample = (totalBonds) => {
    const { isLowSample } = lowSampleWarning(totalBonds);
    if (isLowSample) anyLowSample = true;
    return isLowSample;
  };

  let anyStale = false;
  const stalenessFor = (row) => {
    const warning = stalenessWarning(row);
    if (warning) anyStale = true;
    return {
      timeframe: row.timeframe,
      timeframe_label: quarterLabel(row.timeframe),
      quarters_stale: row.quarters_stale,
      staleness_warning: warning,
    };
  };

  const breakdown = findDwellingTypesStmt.all(sa2Code)
    .sort((a, b) => DWELLING_TYPE_ORDER.indexOf(a.dwelling_type) - DWELLING_TYPE_ORDER.indexOf(b.dwelling_type))
    .map((typeRow) => ({
      dwelling_type: typeRow.dwelling_type,
      is_current: typeRow.dwelling_type === currentDwellingType,
      median_rent: typeRow.median_rent,
      total_bonds: typeRow.total_bonds,
      low_sample_warning: markIfLowSample(typeRow.total_bonds),
      ...stalenessFor(typeRow),
      beds: (bedsByType[typeRow.dwelling_type] ?? [])
        .sort((a, b) => NUMBER_OF_BEDS_ORDER.indexOf(a.number_of_beds) - NUMBER_OF_BEDS_ORDER.indexOf(b.number_of_beds))
        .map((bedRow) => ({
          number_of_beds: bedRow.number_of_beds,
          median_rent: bedRow.median_rent,
          total_bonds: bedRow.total_bonds,
          low_sample_warning: markIfLowSample(bedRow.total_bonds),
          ...stalenessFor(bedRow),
        })),
    }));

  return { breakdown, anyLowSample, anyStale };
}

// Pure computation, decoupled from Express req/res, so both the real route
// and the examples route below can share the exact same logic — the
// examples route calls this directly (in-process) rather than making an
// HTTP request back to the server.
function computeRentalPriceCheck(query) {
  const {
    sa2_code: sa2CodeRaw,
    dwelling_type: dwellingType,
    number_of_beds: numberOfBedsRaw,
    rent: rentRaw,
  } = query;

  if (!sa2CodeRaw || !dwellingType) {
    return { status: 400, body: { error: 'sa2_code and dwelling_type are required' } };
  }

  const sa2Code = Number(sa2CodeRaw);
  if (!Number.isInteger(sa2Code)) {
    return { status: 400, body: { error: 'sa2_code must be an integer' } };
  }

  if (!VALID_DWELLING_TYPES.includes(dwellingType)) {
    return {
      status: 400,
      body: { error: `dwelling_type must be one of: ${VALID_DWELLING_TYPES.join(', ')}` },
    };
  }

  // Omitted/empty means "any bed count" and maps to the standard ALL
  // aggregate, not an error. Any non-empty value still has to match the
  // documented set, so a typo (e.g. "Al" instead of "ALL") is rejected
  // here instead of silently falling through to the fallback/NO_DATA
  // path and looking like missing data.
  const numberOfBeds = numberOfBedsRaw === undefined || numberOfBedsRaw === '' ? 'ALL' : numberOfBedsRaw;
  if (!VALID_NUMBER_OF_BEDS.includes(numberOfBeds)) {
    return {
      status: 400,
      body: { error: `number_of_beds must be one of: ${VALID_NUMBER_OF_BEDS.join(', ')}` },
    };
  }

  let rent = null;
  if (rentRaw !== undefined) {
    rent = Number(rentRaw);
    if (!Number.isFinite(rent) || rent < 0) {
      return { status: 400, body: { error: 'rent must be a non-negative number' } };
    }
  }

  const suburb = findSuburbStmt.get(sa2Code);
  if (!suburb) {
    return { status: 404, body: { error: `Unknown sa2_code: ${sa2Code}` } };
  }

  let row = findRentStmt.get(sa2Code, dwellingType, numberOfBeds);
  let fallbackLevel = 'none';

  // Tier 2 only makes sense when the requested beds weren't already
  // 'ALL' — otherwise it's the same query as the exact match above.
  if (!row && numberOfBeds !== 'ALL') {
    row = findDwellingTypeAllRentStmt.get(sa2Code, dwellingType);
    if (row) fallbackLevel = 'dwelling_type';
  }

  if (!row) {
    row = findAllAllRentStmt.get(sa2Code);
    if (row) fallbackLevel = 'full';
  }

  if (!row) {
    return {
      status: 200,
      body: {
        sa2_code: suburb.sa2_code,
        sa2_name: suburb.sa2_name,
        dwelling_type: dwellingType,
        number_of_beds: numberOfBeds,
        insufficient_data: true,
        message: `No rental data is available for ${suburb.sa2_name}, even as a broader estimate across all dwelling types and bed counts.`,
      },
    };
  }

  const comparison = rent !== null
    ? comparisonLabel(rent, row.lower_quartile_rent, row.upper_quartile_rent)
    : null;

  // The primary result keeps its own full-sentence warning (unchanged, one
  // occurrence per response) — only the breakdown table below switches to
  // the compact marker + single shared footnote, since that's where a full
  // sentence per row would actually repeat.
  const { isLowSample: primaryIsLowSample, note: primaryLowSampleNote } = lowSampleWarning(row.total_bonds);
  const { breakdown: dwellingTypeBreakdown, anyLowSample, anyStale } = buildDwellingTypeBreakdown(sa2Code, row.dwelling_type);

  return {
    status: 200,
    body: {
      sa2_code: suburb.sa2_code,
      sa2_name: suburb.sa2_name,
      requested_dwelling_type: dwellingType,
      requested_number_of_beds: numberOfBeds,
      dwelling_type: row.dwelling_type,
      number_of_beds: row.number_of_beds,
      median_rent: row.median_rent,
      lower_quartile_rent: row.lower_quartile_rent,
      upper_quartile_rent: row.upper_quartile_rent,
      total_bonds: row.total_bonds,
      low_sample_warning: primaryIsLowSample,
      low_sample_note: primaryLowSampleNote,
      fallback_level: fallbackLevel,
      ...(fallbackLevel !== 'none' && {
        fallback_note: FALLBACK_NOTES[fallbackLevel],
      }),
      timeframe: row.timeframe,
      timeframe_label: quarterLabel(row.timeframe),
      timeframe_months: quarterMonths(row.timeframe),
      quarters_stale: row.quarters_stale,
      staleness_warning: stalenessWarning(row),
      ...(rent !== null ? { rent, comparison } : {}),
      dwelling_type_breakdown: dwellingTypeBreakdown,
      ...(anyLowSample && { low_sample_footnote: LOW_SAMPLE_FOOTNOTE }),
      ...(anyStale && { stale_footnote: staleFootnote() }),
    },
  };
}

router.get('/rental-price-check', (req, res) => {
  const { status, body } = computeRentalPriceCheck(req.query);
  res.status(status).json(body);
});

// Reference data for the frontend's Bedrooms dropdown: which number_of_beds
// values have an *exact* rent row for each (sa2_code, dwelling_type) pair,
// so the UI can offer only the bed counts that won't just fall back to a
// broader estimate. Deliberately exact-match only, not "reachable via
// fallback" — fallback_level 'dwelling_type'/'full' succeed the same way
// regardless of which beds value was requested (neither fallback query
// even looks at it), so that signal doesn't vary per bed count and
// wouldn't filter anything meaningful out. Excludes number_of_beds IS NULL
// (the separate undocumented MBIE category computeRentalPriceCheck also
// never exposes) and 'ALL' (not a selectable bed count in the dropdown).
//
// Cached once at startup, like suburbs.js and suburbFinder.js's
// destinations — this is static reference data derived from a read-only
// DB, not something that changes per-request.
const bedAvailabilityRows = db.prepare(
  `SELECT sa2_code, dwelling_type, number_of_beds
   FROM rent
   WHERE number_of_beds IS NOT NULL AND number_of_beds != 'ALL'
   ORDER BY sa2_code, dwelling_type, number_of_beds`
).all();

const bedAvailability = {};
for (const row of bedAvailabilityRows) {
  const bySuburb = (bedAvailability[row.sa2_code] ??= {});
  const beds = (bySuburb[row.dwelling_type] ??= []);
  beds.push(row.number_of_beds);
}

router.get('/rental-price-check-bed-availability', (req, res) => {
  res.json(bedAvailability);
});

// Static reference data for demos — no DB lookups, just a fixed list of
// example URLs so each case can be opened directly in a browser without
// having to remember the exact query params. Mirrors test-examples.md.
const RENTAL_PRICE_CHECK_EXAMPLES = [
  {
    description: 'Normal exact match: Flagstaff North, House, 2 beds has good coverage, so this hits the exact row directly (fallback_level "none").',
    url: '/api/rental-price-check?sa2_code=175300&dwelling_type=House&number_of_beds=2',
  },
  {
    description: 'Intermediate fallback tier: Flagstaff North has no House/6-beds row, but does have a House/ALL row, so this falls back to the same dwelling type with all bed counts (fallback_level "dwelling_type").',
    url: '/api/rental-price-check?sa2_code=175300&dwelling_type=House&number_of_beds=6',
  },
  {
    description: 'Full fallback tier: Rotokauri-Waiwhakareke has no Room data at all, so this falls back all the way to the suburb overall ALL/ALL row (fallback_level "full").',
    url: '/api/rental-price-check?sa2_code=175400&dwelling_type=Room&number_of_beds=ALL',
  },
  {
    description: 'NO_DATA: Te Rapa North has zero rent rows at all, even the ALL/ALL fallback, so the response has insufficient_data true and no numbers.',
    url: '/api/rental-price-check?sa2_code=175200&dwelling_type=House&number_of_beds=ALL',
  },
  {
    description: 'STALE: Te Rapa South only data is about 7 quarters old. Numbers are still returned, plus a staleness_warning stating exactly how old.',
    url: '/api/rental-price-check?sa2_code=176300&dwelling_type=ALL&number_of_beds=ALL',
  },
  {
    description: 'Invalid input: number_of_beds=99 is not in the documented value set, so this is rejected with a 400 instead of silently falling through to NO_DATA.',
    url: '/api/rental-price-check?sa2_code=175300&dwelling_type=House&number_of_beds=99',
  },
  {
    description: 'Rent comparison: same Flagstaff North House/ALL row, with a rent supplied so the response includes a comparison label (Below market, since 600 is under the lower quartile).',
    url: '/api/rental-price-check?sa2_code=175300&dwelling_type=House&number_of_beds=ALL&rent=600',
  },
];

router.get('/rental-price-check-examples', (req, res) => {
  const withResults = RENTAL_PRICE_CHECK_EXAMPLES.map((example) => {
    const { searchParams } = new URL(example.url, 'http://localhost');
    const { body } = computeRentalPriceCheck(Object.fromEntries(searchParams));
    return { ...example, result: body };
  });
  res.json(withResults);
});

module.exports = router;
