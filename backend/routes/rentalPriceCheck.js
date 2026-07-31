const express = require('express');
const db = require('../db');

const router = express.Router();

const VALID_DWELLING_TYPES = ['ALL', 'Apartment', 'Boarding House', 'Flat', 'House', 'Room'];

// Feature 2 (lookup/transparency) discloses any staleness at all, unlike
// Feature 1's ranking engine which only excludes a suburb at >= 4 quarters
// stale (see data-pipeline/README.md, "Consumption rules for downstream
// features").
const STALE_THRESHOLD_QUARTERS = 1;

const findSuburbStmt = db.prepare('SELECT sa2_code, sa2_name FROM suburbs WHERE sa2_code = ?');
const findRentStmt = db.prepare(
  'SELECT * FROM rent WHERE sa2_code = ? AND dwelling_type = ? AND number_of_beds = ?'
);
const findAllAllRentStmt = db.prepare(
  "SELECT * FROM rent WHERE sa2_code = ? AND dwelling_type = 'ALL' AND number_of_beds = 'ALL'"
);

function comparisonLabel(rent, lowerQuartile, upperQuartile) {
  if (lowerQuartile == null || upperQuartile == null) return null;
  if (rent < lowerQuartile) return 'Below market';
  if (rent > upperQuartile) return 'Above market';
  return 'Fair';
}

function stalenessWarning(row) {
  if (row.quarters_stale < STALE_THRESHOLD_QUARTERS) return null;
  const quarterWord = row.quarters_stale === 1 ? 'quarter' : 'quarters';
  return `This rent data is ${row.quarters_stale} ${quarterWord} old (last updated ${row.timeframe}).`;
}

router.get('/rental-price-check', (req, res) => {
  const {
    sa2_code: sa2CodeRaw,
    dwelling_type: dwellingType,
    number_of_beds: numberOfBeds,
    rent: rentRaw,
  } = req.query;

  if (!sa2CodeRaw || !dwellingType || !numberOfBeds) {
    return res.status(400).json({
      error: 'sa2_code, dwelling_type, and number_of_beds are required',
    });
  }

  const sa2Code = Number(sa2CodeRaw);
  if (!Number.isInteger(sa2Code)) {
    return res.status(400).json({ error: 'sa2_code must be an integer' });
  }

  if (!VALID_DWELLING_TYPES.includes(dwellingType)) {
    return res.status(400).json({
      error: `dwelling_type must be one of: ${VALID_DWELLING_TYPES.join(', ')}`,
    });
  }

  let rent = null;
  if (rentRaw !== undefined) {
    rent = Number(rentRaw);
    if (!Number.isFinite(rent) || rent < 0) {
      return res.status(400).json({ error: 'rent must be a non-negative number' });
    }
  }

  const suburb = findSuburbStmt.get(sa2Code);
  if (!suburb) {
    return res.status(404).json({ error: `Unknown sa2_code: ${sa2Code}` });
  }

  let row = findRentStmt.get(sa2Code, dwellingType, numberOfBeds);
  let fallback = false;

  if (!row) {
    row = findAllAllRentStmt.get(sa2Code);
    fallback = row != null;
  }

  if (!row) {
    return res.json({
      sa2_code: suburb.sa2_code,
      sa2_name: suburb.sa2_name,
      dwelling_type: dwellingType,
      number_of_beds: numberOfBeds,
      insufficient_data: true,
      message: `No rental data is available for ${suburb.sa2_name}, even as a broader estimate across all dwelling types and bed counts.`,
    });
  }

  const comparison = rent !== null
    ? comparisonLabel(rent, row.lower_quartile_rent, row.upper_quartile_rent)
    : null;

  res.json({
    sa2_code: suburb.sa2_code,
    sa2_name: suburb.sa2_name,
    requested_dwelling_type: dwellingType,
    requested_number_of_beds: numberOfBeds,
    dwelling_type: row.dwelling_type,
    number_of_beds: row.number_of_beds,
    median_rent: row.median_rent,
    lower_quartile_rent: row.lower_quartile_rent,
    upper_quartile_rent: row.upper_quartile_rent,
    fallback,
    ...(fallback && {
      fallback_note: 'No data for the exact dwelling type/bed count combination — showing a broader estimate across all dwelling types and bed counts for this suburb.',
    }),
    timeframe: row.timeframe,
    quarters_stale: row.quarters_stale,
    staleness_warning: stalenessWarning(row),
    ...(rent !== null ? { rent, comparison } : {}),
  });
});

module.exports = router;
