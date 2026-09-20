// Shared by suburbFinder.js (lowest_rent) and rentalPriceCheck.js (the
// primary result and its dwelling-type/beds breakdown) — both need the
// identical "trust this figure less" signal for the same underlying
// reason (a rent figure built on a thin MBIE sample), so it lives in one
// place rather than two independently-maintained copies that could drift.
//
// Threshold is MBIE's own minimum publishable sample size (6 — anything
// smaller and they suppress the row entirely), not an arbitrary cutoff.
// Confirmed against real data (see suburbFinder.js's git history): a
// two-tier mild/strong design was tried first, but across all 60 CURRENT
// suburbs a lowest_rent row's total_bonds is only ever 6, 9, 12, or 15 --
// any boundary above 15 flagged 100% of suburbs, and <=6 is the only split
// point the real data actually supports.
const LOW_SAMPLE_THRESHOLD = 6;

function lowSampleWarning(totalBonds) {
  const isLowSample = totalBonds <= LOW_SAMPLE_THRESHOLD;
  return {
    isLowSample,
    note: isLowSample
      ? `This figure is based on a very small sample (${totalBonds} bonds — the smallest sample MBIE publishes) — treat it as a rough indication only.`
      : null,
  };
}

// A single shared explanation for callers that show a compact per-row
// marker (e.g. a † symbol) instead of repeating the full sentence above on
// every qualifying row — rentalPriceCheck.js's dwelling-type breakdown
// table shows this once, in a footer, rather than once per row. Plain
// text; the marker symbol itself is a presentation detail left to the
// frontend, not baked in here.
const LOW_SAMPLE_FOOTNOTE = `Based on a small sample (${LOW_SAMPLE_THRESHOLD} bonds — the smallest sample MBIE publishes); treat as a rough indication.`;

module.exports = { LOW_SAMPLE_THRESHOLD, LOW_SAMPLE_FOOTNOTE, lowSampleWarning };
