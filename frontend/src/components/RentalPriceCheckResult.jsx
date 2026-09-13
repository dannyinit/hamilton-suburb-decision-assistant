import { getDwellingTypeLabel, getDwellingTypePluralLabel, getNumberOfBedsLabel } from '../rentalCheckOptions';

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
  const dwellingTypePlural = getDwellingTypePluralLabel(data.requested_dwelling_type);

  return `No data for ${bedsLabel} ${dwellingTypePlural} in ${data.sa2_name} — showing the ${dwellingTypeLabel} median rent across all bed counts instead.`;
}

// fallback_level 'full' means: neither the exact bed count nor the exact
// dwelling type had data, so the suburb's overall ALL/ALL row is shown.
// No bed count is mentioned here (unlike dwellingTypeFallbackNote) since
// this tier has already fallen back past both dwelling type and bed
// count — there's nothing specific left to say about beds.
function fullFallbackNote(data) {
  const dwellingTypePlural = getDwellingTypePluralLabel(data.requested_dwelling_type);
  return `No data for ${dwellingTypePlural} in ${data.sa2_name} — showing the median rent across all dwelling types and bed counts instead.`;
}

// Other dwelling types this suburb genuinely has data for, excluding
// whichever dwelling_type the primary result actually displays (already
// filtered out by the backend) — collapsed by default, since it's
// supplementary detail, not the primary answer. Each type is itself an
// expandable row revealing its specific bed counts, so the default view
// stays a short list (avg ~2 types/suburb) and only grows when a user
// drills into one. No prop needed for "the excluded type": the backend
// has already removed it from `types`.
function OtherDwellingTypes({ types }) {
  if (types.length === 0) return null;

  return (
    <details className="other-dwelling-types">
      <summary>Other dwelling types with data ({types.length})</summary>
      <ul>
        {types.map((dt) => (
          <li key={dt.dwelling_type}>
            <details>
              <summary>
                {getDwellingTypeLabel(dt.dwelling_type)}: ${dt.median_rent}/week (based on {dt.total_bonds} bond{dt.total_bonds === 1 ? '' : 's'})
              </summary>
              {dt.low_sample_warning && (
                <div className="banner banner-warning">{dt.low_sample_note}</div>
              )}
              {dt.beds.length > 0 ? (
                <ul className="dwelling-type-beds">
                  {dt.beds.map((bed) => (
                    <li key={bed.number_of_beds}>
                      {getNumberOfBedsLabel(bed.number_of_beds)}: ${bed.median_rent}/week (based on {bed.total_bonds} bond{bed.total_bonds === 1 ? '' : 's'})
                      {bed.low_sample_warning && (
                        <div className="banner banner-warning">{bed.low_sample_note}</div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="no-beds-detail">No bed-count breakdown available for this dwelling type.</p>
              )}
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
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
        <div className="banner banner-info">{fullFallbackNote(data)}</div>
      )}

      {data.staleness_warning && (
        <div className="banner banner-warning">{data.staleness_warning}</div>
      )}

      {data.low_sample_warning && (
        <div className="banner banner-warning">{data.low_sample_note}</div>
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

      <div className="result-meta">
        <p>
          {data.dwelling_type === 'ALL' ? 'All dwelling types' : data.dwelling_type}
          {', '}
          {data.number_of_beds === 'ALL' ? 'all bed counts' : `${data.number_of_beds} bed(s)`}
        </p>
        <p className="result-meta-date">as of {data.timeframe}</p>
      </div>

      {data.comparison && (
        <p className={`comparison-badge ${COMPARISON_CLASS[data.comparison] ?? ''}`}>
          Your rent of ${data.rent}/week is <strong>{data.comparison}</strong>
        </p>
      )}

      <OtherDwellingTypes types={data.other_dwelling_types} />
    </div>
  );
}

export default RentalPriceCheckResult;
