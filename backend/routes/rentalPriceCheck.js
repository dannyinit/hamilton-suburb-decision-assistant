const express = require('express');
const db = require('../db');

const router = express.Router();

const VALID_DWELLING_TYPES = ['ALL', 'Apartment', 'Boarding House', 'Flat', 'House', 'Room'];

const findSuburbStmt = db.prepare('SELECT sa2_code, sa2_name FROM suburbs WHERE sa2_code = ?');
const findRentStmt = db.prepare(
  'SELECT * FROM rent WHERE sa2_code = ? AND dwelling_type = ? AND number_of_beds = ?'
);

function comparisonLabel(rent, lowerQuartile, upperQuartile) {
  if (lowerQuartile == null || upperQuartile == null) return null;
  if (rent < lowerQuartile) return 'Below market';
  if (rent > upperQuartile) return 'Above market';
  return 'Fair';
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

  const row = findRentStmt.get(sa2Code, dwellingType, numberOfBeds);

  if (!row) {
    // TODO (step 3): fall back to dwelling_type=ALL/number_of_beds=ALL, and
    // return a clear "insufficient data" response if even that is missing.
    return res.status(501).json({
      error: 'No exact match for that combination — fallback logic not implemented yet',
    });
  }

  const comparison = rent !== null
    ? comparisonLabel(rent, row.lower_quartile_rent, row.upper_quartile_rent)
    : null;

  res.json({
    sa2_code: suburb.sa2_code,
    sa2_name: suburb.sa2_name,
    dwelling_type: row.dwelling_type,
    number_of_beds: row.number_of_beds,
    median_rent: row.median_rent,
    lower_quartile_rent: row.lower_quartile_rent,
    upper_quartile_rent: row.upper_quartile_rent,
    fallback: false,
    // TODO (step 3): staleness warning derived from row.quarters_stale.
    quarters_stale: row.quarters_stale,
    timeframe: row.timeframe,
    ...(rent !== null ? { rent, comparison } : {}),
  });
});

module.exports = router;
