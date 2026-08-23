const EXCLUSION_LABEL = {
  insufficient_data: (item) => `insufficient data (${item.data_status})`,
  exceeds_budget: (item) => `exceeds budget ($${item.median_rent}/week)`,
};

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

function SuburbFinderResults({ status, data, errorMessage }) {
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
      <div className="status-card">
        <p>{data.message}</p>
        <ExcludedList excluded={data.excluded} />
      </div>
    );
  }

  return (
    <div className="status-card ok result-card">
      {data.distance_excluded && (
        <div className="banner banner-info">{data.distance_excluded_note}</div>
      )}

      <ol className="suburb-ranking">
        {data.results.map((result) => (
          <li key={result.sa2_code} className="suburb-ranking-item">
            <span className="suburb-ranking-rank">#{result.rank}</span>
            <span className="suburb-ranking-name">{result.sa2_name}</span>
            <span className="suburb-ranking-score">{result.overall_score.toFixed(3)}</span>
          </li>
        ))}
      </ol>

      <ExcludedList excluded={data.excluded} />
    </div>
  );
}

export default SuburbFinderResults;
