const express = require('express');
const db = require('../db');

const router = express.Router();

// Static reference data — all 62 suburbs, sa2_code + sa2_name — for
// frontend suburb pickers (Rental Price Check's form today, Suburb
// Finder's results/legend later). Cached once at startup, mirroring how
// suburbFinder.js caches the 4-row destinations table: this list never
// changes at runtime.
//
// Deliberately unfiltered by suburb_data_status: that field describes
// rent-data quality for Suburb Finder's hard constraints (ALL/ALL row
// only), not whether a suburb should be selectable at all. Rental Price
// Check already reports its own per-request insufficient_data/
// staleness_warning independent of this table (see rentalPriceCheck.js) —
// filtering here would hide suburbs like Te Rapa North, which is exactly
// the NO_DATA demo case in test-examples.md.
const suburbs = db.prepare('SELECT sa2_code, sa2_name FROM suburbs ORDER BY sa2_name').all();

router.get('/suburbs', (req, res) => {
  res.json({ suburbs });
});

module.exports = router;
