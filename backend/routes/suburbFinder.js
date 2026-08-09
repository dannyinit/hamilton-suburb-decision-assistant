const express = require('express');
const db = require('../db');

const router = express.Router();

// destinations is a small, fixed reference table (4 rows) — cached once at
// startup rather than queried per request.
const destinationsById = db.prepare('SELECT destination_id, name FROM destinations').all();
const destinationByName = new Map(destinationsById.map((d) => [d.name, d]));

// Minimum-meaningful-range floors for normalisation, precomputed from the
// 60 sa2_data_status='CURRENT' suburbs (the stable population everything
// normalises against — never recomputed from a request's budget-filtered
// subset, or the floor wouldn't protect against anything). Rent and
// transport are flat constants; distance is 10% of each destination's own
// full-population range, since the four destinations sit at genuinely
// different distances from the city (confirmed against real geography
// before being hardcoded here).
const RENT_THRESHOLD = 50;
const TRANSPORT_THRESHOLD = 3;
const DISTANCE_THRESHOLDS = {
  'University of Waikato': 1000,
  'Transport Centre': 750,
  'The Base': 940,
  'Waikato Hospital': 950,
};

// Normalises one criterion across `included` to a [0,1] score per suburb.
// - True tie (every suburb has the identical value): 0.5 for all — zero
//   information, deliberately neutral. This can't be reached by the floor
//   below, since (value - min) is 0 for everyone regardless of denominator.
// - Otherwise: min-max scaled against max(actual range, threshold), so a
//   real-but-small spread gets compressed rather than stretched to fill
//   [0,1] (the best suburb in a tightly-clustered set won't hit a full 1).
// - `reverse: true` is for cost criteria (rent, distance) where lower is
//   better; `reverse: false` for benefit criteria (transport) where higher
//   is better.
function normaliseCriterion(included, { getValue, threshold, reverse }) {
  const values = included.map(getValue);
  const actualMin = Math.min(...values);
  const actualMax = Math.max(...values);

  if (actualMax === actualMin) {
    return values.map(() => 0.5);
  }

  const range = Math.max(actualMax - actualMin, threshold);
  return values.map((value) => {
    const numerator = reverse ? actualMax - value : value - actualMin;
    return Math.round((numerator / range) * 10000) / 10000;
  });
}

// One row per suburb for the chosen destination: data status (for the
// insufficient_data hard constraint), the ALL/ALL median rent (for the
// budget hard constraint and rent criterion), bus stop count (transport
// criterion), and distance to the chosen destination (distance criterion).
// suburb_bus_access and suburb_destination_distance have complete coverage
// (62 rows / 62x4 rows respectively) so plain JOINs are safe; rent is
// LEFT JOINed since NO_DATA suburbs genuinely have no ALL/ALL row.
const findCandidatesStmt = db.prepare(`
  SELECT
    s.sa2_code,
    s.sa2_name,
    sds.data_status,
    r.median_rent,
    sba.bus_stop_count_500m AS bus_stop_count,
    sdd.distance_m
  FROM suburbs s
  JOIN suburb_data_status sds ON sds.sa2_code = s.sa2_code
  LEFT JOIN rent r ON r.sa2_code = s.sa2_code AND r.dwelling_type = 'ALL' AND r.number_of_beds = 'ALL'
  JOIN suburb_bus_access sba ON sba.sa2_code = s.sa2_code
  JOIN suburb_destination_distance sdd ON sdd.sa2_code = s.sa2_code AND sdd.destination_id = ?
  ORDER BY s.sa2_code
`);

function parseWeight(raw, paramName) {
  // Omitted or empty means "not specified" -> default to 1 (an untouched
  // slider). A present '0' is a deliberate "I don't care about this
  // criterion at all" and must stay 0, not be defaulted away — Number('')
  // alone would evaluate to 0 and silently conflate the two.
  if (raw === undefined || raw === '') return 1;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${paramName} must be a non-negative number`);
  }
  return value;
}

// Pure computation, decoupled from Express req/res, so both the real route
// and the examples route below can share the exact same logic — the
// examples route calls this directly (in-process) rather than making an
// HTTP request back to the server.
function computeSuburbFinder(query) {
  const {
    budget: budgetRaw,
    destination: destinationName,
    rent_weight: rentWeightRaw,
    transport_weight: transportWeightRaw,
    distance_weight: distanceWeightRaw,
  } = query;

  if (!budgetRaw || !destinationName) {
    return { status: 400, body: { error: 'budget and destination are required' } };
  }

  const budget = Number(budgetRaw);
  if (!Number.isFinite(budget) || budget < 0) {
    return { status: 400, body: { error: 'budget must be a non-negative number' } };
  }

  const destination = destinationByName.get(destinationName);
  if (!destination) {
    return {
      status: 400,
      body: { error: `destination must be one of: ${destinationsById.map((d) => d.name).join(', ')}` },
    };
  }

  // Each weight defaults independently to 1 (an unset slider), then all
  // three are normalised together below — so rent_weight=2 with the other
  // two omitted means "rent matters twice as much as each of the others",
  // not an error.
  let rentWeight;
  let transportWeight;
  let distanceWeight;
  try {
    rentWeight = parseWeight(rentWeightRaw, 'rent_weight');
    transportWeight = parseWeight(transportWeightRaw, 'transport_weight');
    distanceWeight = parseWeight(distanceWeightRaw, 'distance_weight');
  } catch (err) {
    return { status: 400, body: { error: err.message } };
  }

  const weightSum = rentWeight + transportWeight + distanceWeight;
  if (weightSum === 0) {
    return {
      status: 400,
      body: { error: 'rent_weight, transport_weight, and distance_weight cannot all be zero' },
    };
  }

  const weightsUsed = {
    rent: rentWeight / weightSum,
    transport: transportWeight / weightSum,
    distance: distanceWeight / weightSum,
  };

  const candidates = findCandidatesStmt.all(destination.destination_id);

  // Hard constraints, in order: data quality first, then budget — so a
  // suburb never carries both an insufficient_data and an exceeds_budget
  // reason at once (per data-pipeline/README.md's documented ordering).
  const excluded = [];
  const included = [];

  for (const row of candidates) {
    if (row.data_status !== 'CURRENT') {
      excluded.push({
        sa2_code: row.sa2_code,
        sa2_name: row.sa2_name,
        reason: 'insufficient_data',
        data_status: row.data_status,
      });
      continue;
    }

    if (row.median_rent > budget) {
      excluded.push({
        sa2_code: row.sa2_code,
        sa2_name: row.sa2_name,
        reason: 'exceeds_budget',
        median_rent: row.median_rent,
      });
      continue;
    }

    included.push({
      sa2_code: row.sa2_code,
      sa2_name: row.sa2_name,
      median_rent: row.median_rent,
      bus_stop_count: row.bus_stop_count,
      distance_m: row.distance_m,
    });
  }

  // Nothing to normalise against with zero survivors — short-circuit
  // before any of the per-criterion min/max logic below.
  if (included.length === 0) {
    const cheapestCurrent = candidates
      .filter((row) => row.data_status === 'CURRENT')
      .reduce((min, row) => (min === null || row.median_rent < min ? row.median_rent : min), null);

    return {
      status: 200,
      body: {
        budget,
        destination: destination.name,
        weights_used: weightsUsed,
        results: [],
        excluded,
        no_suburbs_in_budget: true,
        message: cheapestCurrent === null
          ? 'No suburbs have current rent data to compare against.'
          : `No suburbs with current rent data fall within a $${budget}/week budget. The cheapest available suburb (with current data) is $${cheapestCurrent}/week.`,
      },
    };
  }

  // Per-criterion normalisation, applied only across `included` (post
  // budget-filter), per the design decision that ranking should reflect
  // relative comparison among viable options, not all 62 suburbs.
  const rentScores = normaliseCriterion(included, {
    getValue: (s) => s.median_rent,
    threshold: RENT_THRESHOLD,
    reverse: true, // cost: lower rent is better
  });
  const transportScores = normaliseCriterion(included, {
    getValue: (s) => s.bus_stop_count,
    threshold: TRANSPORT_THRESHOLD,
    reverse: false, // benefit: more bus stops is better
  });
  const distanceScores = normaliseCriterion(included, {
    getValue: (s) => s.distance_m,
    threshold: DISTANCE_THRESHOLDS[destination.name],
    reverse: true, // cost: shorter distance is better
  });

  // Weighted Sum Model: overall_score is the weights-normalised dot product
  // of the three per-criterion scores. score_breakdown carries each
  // criterion's raw value alongside its normalised score, so the frontend
  // can show "why" a suburb scored the way it did, not just the final number.
  const scored = included.map((suburb, i) => {
    const rentScore = rentScores[i];
    const transportScore = transportScores[i];
    const distanceScore = distanceScores[i];
    const overallScore = Math.round(
      (weightsUsed.rent * rentScore
        + weightsUsed.transport * transportScore
        + weightsUsed.distance * distanceScore) * 10000
    ) / 10000;

    return {
      sa2_code: suburb.sa2_code,
      sa2_name: suburb.sa2_name,
      overall_score: overallScore,
      score_breakdown: {
        rent: { value: suburb.median_rent, normalised_score: rentScore },
        transport: { value: suburb.bus_stop_count, normalised_score: transportScore },
        distance: { value: suburb.distance_m, normalised_score: distanceScore },
      },
    };
  });

  // Highest overall_score first; ties broken by sa2_code so ordering is
  // deterministic across requests rather than relying on sort stability.
  scored.sort((a, b) => b.overall_score - a.overall_score || a.sa2_code - b.sa2_code);
  const results = scored.map((suburb, i) => ({ rank: i + 1, ...suburb }));

  return {
    status: 200,
    body: {
      budget,
      destination: destination.name,
      weights_used: weightsUsed,
      results,
      excluded,
    },
  };
}

router.get('/suburb-finder', (req, res) => {
  const { status, body } = computeSuburbFinder(req.query);
  res.status(status).json(body);
});

// Static reference data for demos — no DB lookups, just a fixed list of
// example URLs so each case can be opened directly in a browser without
// having to remember the exact query params.
const SUBURB_FINDER_EXAMPLES = [
  {
    description: 'Normal case with multiple results: a $500/week budget near The Base returns 10 suburbs ranked by weighted score with equal-priority weights.',
    url: '/api/suburb-finder?budget=500&destination=The%20Base',
  },
  {
    description: 'Empty result set: a $300/week budget is below the cheapest available suburb ($340), so no suburbs qualify. The response includes a hint naming the cheapest suburb that does have current data.',
    url: '/api/suburb-finder?budget=300&destination=The%20Base',
  },
  {
    description: 'N=1 exact-tie case: a $345/week budget leaves exactly one suburb (Greensboro), so every criterion normalises to the neutral tie value 0.5 and overall_score is 0.5.',
    url: '/api/suburb-finder?budget=345&destination=The%20Base',
  },
  {
    description: 'Different weight priorities: same $500 budget and destination as the normal case, but weighted entirely toward rent (rent_weight=1, transport_weight=0, distance_weight=0), so the ranking collapses to cheapest-first.',
    url: '/api/suburb-finder?budget=500&destination=The%20Base&rent_weight=1&transport_weight=0&distance_weight=0',
  },
];

// Unlike rental-price-check-examples, this intentionally stays
// description + url only (no live result field) — a suburb-finder result
// can carry up to 10 full score-broken-down suburbs, which is too long to
// skim during a demo.
router.get('/suburb-finder-examples', (req, res) => {
  res.json(SUBURB_FINDER_EXAMPLES);
});

module.exports = router;
