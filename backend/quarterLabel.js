// MBIE's TimeFrame is a calendar-quarter date ("2026-01-01"), not a real
// day, so showing it raw implies precision the data doesn't have. Every
// user-facing mention of a TimeFrame goes through here instead.
//
// Assumes TimeFrame is the FIRST day of its quarter (2026-01-01 = Jan-Mar
// 2026). MBIE doesn't document this; it's inferred from their own file
// label ("January 2020 to April 2026" — first/last TimeFrames 2020-01-01
// and 2026-04-01) and their release lag (the latest complete quarter is
// what's published). If that turns out wrong, this is the one place to fix.
const QUARTER_MONTHS = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'];

function quarterIndex(timeframe) {
  const [year, month] = timeframe.split('-').map(Number);
  return { year, quarter: Math.floor((month - 1) / 3) };
}

function quarterLabel(timeframe) {
  const { year, quarter } = quarterIndex(timeframe);
  return `Q${quarter + 1} ${year}`;
}

function quarterMonths(timeframe) {
  return QUARTER_MONTHS[quarterIndex(timeframe).quarter];
}

// The quarter `count` quarters after `timeframe`, as a TimeFrame string —
// used to recover the reference quarter a row's quarters_stale is
// measured against, so the number and the quarter named beside it can't
// disagree.
function addQuarters(timeframe, count) {
  const { year, quarter } = quarterIndex(timeframe);
  const total = year * 4 + quarter + count;
  const month = String((total % 4) * 3 + 1).padStart(2, '0');
  return `${Math.floor(total / 4)}-${month}-01`;
}

module.exports = { quarterLabel, quarterMonths, addQuarters };
