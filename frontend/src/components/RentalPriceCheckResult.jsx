const COMPARISON_CLASS = {
  'Below market': 'comparison-below',
  'Fair': 'comparison-fair',
  'Above market': 'comparison-above',
};

function RentalPriceCheckResult({ status, data, errorMessage }) {
  if (status === 'idle') {
    return (
      <div className="status-card">
        Fill in the form and press "Check rental price" to see results.
      </div>
    );
  }

  if (status === 'loading') {
    return <div className="status-card">Checking…</div>;
  }

  if (status === 'error') {
    return (
      <div className="status-card error">
        <strong>Couldn't complete the check.</strong>
        <p>{errorMessage}</p>
      </div>
    );
  }

  // status === 'success' from here on.

  if (data.insufficient_data) {
    return (
      <div className="status-card">
        <strong>{data.sa2_name}</strong>
        <p>{data.message}</p>
      </div>
    );
  }

  return (
    <div className="status-card ok result-card">
      <h2>{data.sa2_name}</h2>

      {data.fallback_level !== 'none' && (
        <div className="banner banner-info">{data.fallback_note}</div>
      )}

      {data.staleness_warning && (
        <div className="banner banner-warning">{data.staleness_warning}</div>
      )}

      <dl className="rent-stats">
        <div>
          <dt>Lower quartile</dt>
          <dd>${data.lower_quartile_rent}</dd>
        </div>
        <div>
          <dt>Median</dt>
          <dd>${data.median_rent}</dd>
        </div>
        <div>
          <dt>Upper quartile</dt>
          <dd>${data.upper_quartile_rent}</dd>
        </div>
      </dl>

      <p className="result-meta">
        {data.dwelling_type === 'ALL' ? 'All dwelling types' : data.dwelling_type}
        {', '}
        {data.number_of_beds === 'ALL' ? 'all bed counts' : `${data.number_of_beds} bed(s)`}
        {' — as of '}
        {data.timeframe}
      </p>

      {data.comparison && (
        <p className={`comparison-badge ${COMPARISON_CLASS[data.comparison] ?? ''}`}>
          Your rent of ${data.rent}/week is <strong>{data.comparison}</strong>
        </p>
      )}
    </div>
  );
}

export default RentalPriceCheckResult;
