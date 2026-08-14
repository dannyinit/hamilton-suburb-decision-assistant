import { getDwellingTypeLabel, getNumberOfBedsLabel } from '../rentalCheckOptions';

const COMPARISON_CLASS = {
  'Below market': 'comparison-below',
  'Fair': 'comparison-fair',
  'Above market': 'comparison-above',
};

// fallback_level 'dwelling_type' means: the exact beds count was
// unavailable, so the dwelling type's ALL-beds row is shown instead. The
// backend's own fallback_note is generic ("this dwelling type"/"this
// suburb"), forcing the reader to re-derive values already visible in the
// form — so this builds a version naming them directly, reusing the same
// labels the dropdown shows (see rentalCheckOptions.js) rather than a
// separate copy of the value->text mapping.
function dwellingTypeFallbackNote(data) {
  // Dropdown labels are plural standalone text ("3 bedrooms"); mid-sentence
  // as a compound adjective ("3 bedroom Houses") they need to be singular.
  // Every current label happens to end in "bedroom(s)" and nothing else,
  // so this simple substring swap covers them all — revisit if a future
  // label doesn't follow that pattern.
  const bedsLabel = getNumberOfBedsLabel(data.requested_number_of_beds).replace('bedrooms', 'bedroom');
  const dwellingTypeLabel = getDwellingTypeLabel(data.requested_dwelling_type);

  // Pluralising "House" -> "Houses" etc. is a plain +'s', correct for
  // every real dwelling type in the current fixed list. 'ALL' ("Any
  // dwelling type") is the one exception — this fallback tier can (rarely)
  // fire for it too, when it lands on the same ALL/ALL row the 'full' tier
  // would also reach — and "Any dwelling types" reads wrong, so it's left
  // unpluralised in that case.
  const dwellingTypePlural = data.requested_dwelling_type === 'ALL' ? dwellingTypeLabel : `${dwellingTypeLabel}s`;

  return `No data for ${bedsLabel} ${dwellingTypePlural} in ${data.sa2_name} — showing the ${dwellingTypeLabel} median rent across all bed counts instead.`;
}

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

      {data.fallback_level === 'dwelling_type' && (
        <div className="banner banner-info">{dwellingTypeFallbackNote(data)}</div>
      )}

      {data.fallback_level === 'full' && (
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
