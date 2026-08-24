const EXCLUSION_LABEL = {
  insufficient_data: (item) => `insufficient data (${item.data_status})`,
  exceeds_budget: (item) => `exceeds budget ($${item.median_rent}/week)`,
};

// <1000m -> whole metres; >=1000m -> km to 1 decimal. Real suburb-destination
// distances span both (308m to 10.6km across the full dataset) so this
// isn't cosmetic — without the split, close suburbs would show an ugly
// "308 m" vs. far ones an unwieldy "10628 m".
function formatDistance(metres) {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

function formatBusStops(count) {
  return `${count} bus stop${count === 1 ? '' : 's'} within 500m`;
}

// Order + formatting for each score_breakdown criterion. 'distance' is
// simply absent from the response when no destination was chosen (see
// backend/README.md's optional-destination section), so filtering on
// `breakdown[key]` below handles that for free — no separate
// distance_excluded check needed here, unlike the banner above the list.
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
    { key: 'rent', label: 'Rent', formatValue: (v) => `$${v}/week` },
    { key: 'transport', label: 'Transport', formatValue: formatBusStops },
    { key: 'distance', label: `Distance to ${destination}`, formatValue: formatDistance },
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
          const { value, normalised_score } = breakdown[criterion.key];
          return (
            <tr key={criterion.key}>
              <th scope="row">{criterion.label}</th>
              <td>{criterion.formatValue(value)}</td>
              <td><ScoreMeter score={normalised_score} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
            <strong>{item.sa2_name}</strong> — {EXCLUSION_LABEL[item.reason]?.(item) ?? item.reason}
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
      {data.distance_excluded && (
        <div className="banner banner-info">{data.distance_excluded_note}</div>
      )}

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
              <ScoreBreakdown breakdown={result.score_breakdown} destination={data.destination} />
            </details>
          </li>
        ))}
      </ol>

      <ExcludedList excluded={data.excluded} />
    </div>
  );
}

export default SuburbFinderResults;
