import { useId, useState } from 'react';
import { Link } from 'react-router-dom';

// number_of_beds is 'ALL', a specific count ('1', '5+'), or null (MBIE's
// "NA" category: bonds with the number of bedrooms not recorded, a distinct
// category, not a duplicate of 'ALL' — see backend/README.md). 'ALL' shows
// the dwelling type alone; null says so explicitly, since the type alone
// would read as the all-bedrooms figure.
// dwelling_type 'ALL' only reaches here when a suburb has no recent specific
// dwelling-type row (see backend/README.md's "Budget filtering" section), and is
// spelled out so it can't be read as one particular type.
function formatDwellingType(dwellingType, numberOfBeds) {
  const type = dwellingType === 'ALL' ? 'all dwelling types combined' : dwellingType;
  if (numberOfBeds === 'ALL') return type;
  if (!numberOfBeds) return `${type}, bedrooms not recorded`;
  return `${type}, ${numberOfBeds} bedroom${numberOfBeds === '1' ? '' : 's'}`;
}

// insufficient_data with data_status 'CURRENT' means the suburb's rent data
// is recent but has no figure the budget can be checked against (see
// backend/README.md) — naming the status there would read as a contradiction.
const EXCLUSION_LABEL = {
  insufficient_data: (item) => (item.data_status === 'CURRENT'
    ? 'insufficient data (no recent rent figure to check against your budget)'
    : `insufficient data (${item.data_status})`),
  exceeds_budget: (item) => `exceeds budget (cheapest found: $${item.lowest_rent.value}/week, ${formatDwellingType(item.lowest_rent.dwelling_type, item.lowest_rent.number_of_beds)})`,
};

// <1000m -> whole metres; >=1000m -> km to 1 decimal. Real suburb-destination
// distances span both (308m to 10.6km across the full dataset) so this
// isn't cosmetic — without the split, close suburbs would show an ugly
// "308 m" vs. far ones an unwieldy "10628 m".
function formatDistance(metres) {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

// transport.value is the plain average number of distinct bus routes within a
// 400m walk of a point in the suburb, uncapped — shown as-is, so a busy central
// suburb honestly reads ~9.5. The score is the square root of this same figure
// (a judgment call that compresses the scale so the CBD doesn't flatten
// everyone else, while staying strictly increasing: a higher number never
// scores lower; see backend/README.md), so what's shown and what's scored
// always agree on order. The 400m is a straight-line radius, not a walking
// route, so it's shown as "within 400 m" rather than as a walking time.
// walk_coverage (also in the response) is
// deliberately not shown: it's already folded into value (points with no
// stop in range count 0), and showing it would offer users a second, unscored
// signal for "is this suburb good on transport". The title adds the
// zero-for-unserved-areas detail the shorter legend leaves out, for hover.
const TRANSPORT_EXPLANATION = "Average number of bus routes with a stop within 400 m, measured at points spread across the suburb; points with no stop within 400 m count as zero. More routes always score higher, each a little less than the last.";

function formatTransport({ value }) {
  const rounded = value.toFixed(1);
  return (
    <span title={TRANSPORT_EXPLANATION}>
      About {rounded === '1.0' ? '1 bus route' : `${rounded} bus routes`} within 400 m
    </span>
  );
}

// Order + formatting for each score_breakdown criterion. 'distance' is
// simply absent from the response when no destination was chosen (see
// backend/README.md's optional-destination section), so filtering on
// `breakdown[key]` below handles that for free — no separate
// distance_excluded check needed.
//
// A function rather than a static array: the distance row's label names
// the actual selected destination (e.g. "Distance to The Base"), which can
// change — and live-updates the ranking — so a generic "Distance" label
// would go stale-looking the moment a user picks a different one.
// `destination` is only read for that one row; by the time it's rendered
// at all (see the .filter() in ScoreBreakdown below) it's guaranteed
// non-null, since the row itself doesn't exist without one.
function getCriteria(destination) {
  return [
    { key: 'rent', label: 'Median rent', formatValue: ({ value }) => `$${value}/week` },
    { key: 'transport', label: 'Transport', formatValue: formatTransport },
    { key: 'distance', label: `Distance to ${destination}`, formatValue: ({ value }) => formatDistance(value) },
  ];
}

// Fill = the app's existing accent teal, track = its existing light banner
// blue (same family, both already used elsewhere in App.css) — a single
// flat fill color throughout, not ramped by score value: a low score here
// just means "relatively weaker than the best surviving suburb", not a
// warning/danger state, so bar *length* carries the magnitude and color
// stays constant. The bar is aria-hidden — the visible score number next
// to it is the accessible value, so a screen reader isn't told the same
// thing twice.
function ScoreMeter({ score }) {
  return (
    <span className="score-meter">
      <span className="score-meter-track" aria-hidden="true">
        <span className="score-meter-fill" style={{ width: `${score * 100}%` }} />
      </span>
      <span className="score-meter-value">{score.toFixed(3)}</span>
    </span>
  );
}

function ScoreBreakdown({ breakdown, destination }) {
  const criteria = getCriteria(destination);
  return (
    <table className="score-breakdown">
      <tbody>
        {criteria.filter((criterion) => breakdown[criterion.key]).map((criterion) => {
          const entry = breakdown[criterion.key];
          return (
            <tr key={criterion.key}>
              <th scope="row">{criterion.label}</th>
              <td>{criterion.formatValue(entry)}</td>
              <td><ScoreMeter score={entry.normalised_score} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// The budget hard-constraint is checked against this figure (the cheapest
// recent specific dwelling_type/beds row for the suburb, or its cheapest
// recent all-dwelling-types row when it has no recent specific one; recent
// means under 4 quarters old), not the median_rent
// shown in ScoreBreakdown — see backend/README.md's "lowest_rent" section
// for why they're deliberately different numbers serving different jobs,
// which is why it gets its own "Budget check" section, subtitled to say so.
// The figure leads; its source row (dwelling type, quarter, bonds) follows
// as a muted line. The quarter is shown because a recent figure can still be
// up to 3 quarters older than the latest data.
//
// No minimum sample size excludes a suburb here, so the bond count is always
// shown. When low_sample_warning is true (at or below MBIE's own minimum
// publishable sample size), the count moves into a small amber "Small
// sample" tag on its own line instead (inline, a wrapped tag left a dangling
// separator at phone width). The warning fires for most suburbs (50/60 when this was
// tuned, 43/62 with the Q2 2026 data), so a full-width banner was the
// loudest thing in every suburb's details — alarm fatigue, not a useful
// signal. The tag is a button that shows low_sample_note on tap or click:
// a hover-only tooltip wouldn't work on phones.
function SmallSampleTag({ totalBonds, note }) {
  const [open, setOpen] = useState(false);
  const noteId = useId();
  return (
    <>
      <button
        type="button"
        className="sample-tag"
        aria-expanded={open}
        aria-controls={noteId}
        onClick={() => setOpen((value) => !value)}
      >
        Small sample ({totalBonds} bond{totalBonds === 1 ? '' : 's'})
        <span className="sample-tag-chevron" aria-hidden="true">▸</span>
      </button>
      <span id={noteId} className="sample-tag-note" hidden={!open}>{note}</span>
    </>
  );
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function BudgetCheck({ lowestRent }) {
  const { value, dwelling_type, number_of_beds, total_bonds, timeframe_label, low_sample_warning, low_sample_note } = lowestRent;

  return (
    <section className="suburb-details-section budget-check">
      <h3 className="suburb-details-heading">Budget check</h3>
      <p className="suburb-details-subtitle">Used only to check your budget, not to rank.</p>
      <p className="lowest-rent-figure">
        Cheapest option <strong>${value}/week</strong>
      </p>
      <p className="lowest-rent-meta">
        {capitalise(formatDwellingType(dwelling_type, number_of_beds))} · <span className="nowrap">{timeframe_label}</span>
        {!low_sample_warning && ` · based on ${total_bonds} bond${total_bonds === 1 ? '' : 's'}`}
      </p>
      {low_sample_warning && (
        <p className="lowest-rent-sample">
          <SmallSampleTag totalBonds={total_bonds} note={low_sample_note} />
        </p>
      )}
      {dwelling_type === 'ALL' && (
        <p className="lowest-rent-note">
          There is no recent rent data for specific dwelling types in this suburb, so this is the median across all dwelling types.
        </p>
      )}
    </section>
  );
}

// Shown once above the list, not per suburb: it's the same for every row.
// Plain caption text, not .banner-info: that style is for something notable
// about *this* search; this explains how to read the list. The Distance
// bullet is also how a missing destination is explained (the response's
// distance_excluded_note is deliberately not shown: it's written for API
// consumers and names query parameters).
function RankingLegend() {
  return (
    <div className="suburb-ranking-legend">
      <p>Suburbs are scored and ranked on the following criteria:</p>
      <ul>
        <li>
          <strong>Rent:</strong> the suburb's median weekly rent across all dwelling types. Lower rent scores higher.
        </li>
        <li>
          <strong>Transport:</strong> the average number of bus routes with a stop within 400 m, measured at points spread across the suburb. More routes score higher, though each extra route adds a little less.
        </li>
        <li>
          <strong>Distance:</strong> straight-line distance from the suburb's centre to your chosen destination. Shorter distances score higher. Only used once you pick a destination.
        </li>
      </ul>
      <p>
        Each criterion is scored from 0 to 1 compared with the other suburbs in this list, and the overall score combines them using your priorities.
      </p>
    </div>
  );
}

function ExcludedList({ excluded }) {
  if (excluded.length === 0) return null;

  return (
    <details className="excluded-list">
      <summary>{excluded.length} suburb{excluded.length === 1 ? '' : 's'} excluded</summary>
      <ul>
        {excluded.map((item) => (
          <li key={item.sa2_code}>
            <strong>{item.sa2_name}</strong>: {EXCLUSION_LABEL[item.reason]?.(item) ?? item.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

function SuburbFinderResults({ status, data, errorMessage, isRefreshing }) {
  if (status === 'idle') {
    return (
      <div className="status-card">
        Fill in the form and press "Find suburbs" to see ranked results.
      </div>
    );
  }

  if (status === 'loading') {
    return <div className="status-card">Ranking suburbs…</div>;
  }

  if (status === 'error') {
    return (
      <div className="status-card error">
        <strong>Couldn't rank suburbs.</strong>
        <p>{errorMessage}</p>
      </div>
    );
  }

  // status === 'success' from here on.

  if (data.no_suburbs_in_budget) {
    return (
      <div className={`status-card${isRefreshing ? ' is-refreshing' : ''}`}>
        <p>{data.message}</p>
        <ExcludedList excluded={data.excluded} />
      </div>
    );
  }

  return (
    <div className={`status-card ok result-card${isRefreshing ? ' is-refreshing' : ''}`}>
      {/* Count and budget come from the response, not the form: with Live
          ranking, the budget field can be edited without re-running the
          search, and this line must describe the results actually shown. */}
      <p className="suburb-ranking-count">
        {data.results.length} {data.results.length === 1 ? 'suburb is' : 'suburbs are'} within your budget of ${data.budget}/week.
      </p>
      <RankingLegend />

      <p className="suburb-ranking-hint">Select a suburb to see how it scored on each criterion.</p>
      {/* Column labels for the rows below. Reuses the rows' own column
          classes so the widths match; the hidden chevron keeps "Overall
          score" right-aligned with the score rather than the chevron. */}
      <div className="suburb-ranking-header">
        <span className="suburb-ranking-rank">Rank</span>
        <span className="suburb-ranking-name">Suburb</span>
        <span className="suburb-ranking-score">Overall score</span>
        <span className="suburb-ranking-chevron" aria-hidden="true">▸</span>
      </div>
      <ol className="suburb-ranking">
        {data.results.map((result) => (
          <li key={result.sa2_code}>
            <details className="suburb-ranking-item">
              <summary>
                <span className="suburb-ranking-rank">#{result.rank}</span>
                <span className="suburb-ranking-name">{result.sa2_name}</span>
                <span className="suburb-ranking-score">{result.overall_score.toFixed(3)}</span>
                <span className="suburb-ranking-chevron" aria-hidden="true">▸</span>
              </summary>
              <section className="suburb-details-section">
                <h3 className="suburb-details-heading">How it scored</h3>
                <ScoreBreakdown breakdown={result.score_breakdown} destination={data.destination} />
              </section>
              <BudgetCheck lowestRent={result.lowest_rent} />
              <div className="suburb-ranking-actions">
                <Link
                  to={`/rental-price-check?${new URLSearchParams({ sa2_code: result.sa2_code, dwelling_type: result.lowest_rent.dwelling_type }).toString()}`}
                  className="suburb-ranking-rpc-link"
                >
                  Check detailed rent in Rental Price Check →
                </Link>
              </div>
            </details>
          </li>
        ))}
      </ol>

      <ExcludedList excluded={data.excluded} />
    </div>
  );
}

export default SuburbFinderResults;
