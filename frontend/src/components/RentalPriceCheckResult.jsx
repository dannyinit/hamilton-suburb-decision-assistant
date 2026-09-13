import { Fragment, useState } from 'react';
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

// Compact per-row indicator for low_sample_warning, replacing a repeated
// full-sentence banner — the explanation itself appears once, in the
// table's shared footnote (see DwellingTypeBreakdownTable's `footnote`).
function LowSampleMarker({ warning }) {
  if (!warning) return null;
  return <sup className="low-sample-marker" aria-hidden="true">†</sup>;
}

// Section B: a dwelling type's specific bed counts, revealed by expanding
// its row in Section A below. `beds` is empty for dwelling types that have
// an overall ALL-beds figure but no specific-bed rows underneath it (a
// real, if uncommon, MBIE data shape) — shown as a note rather than an
// empty table.
function BedsSubtable({ beds }) {
  if (beds.length === 0) {
    return <p className="no-beds-detail">No bed-count breakdown available for this dwelling type.</p>;
  }

  return (
    <table className="beds-subtable">
      <thead>
        <tr>
          <th scope="col">Beds</th>
          <th scope="col">Median rent</th>
          <th scope="col">Sample size</th>
        </tr>
      </thead>
      <tbody>
        {beds.map((bed) => (
          <tr key={bed.number_of_beds}>
            <th scope="row">{getNumberOfBedsLabel(bed.number_of_beds)}</th>
            <td>${bed.median_rent}/week</td>
            <td>{bed.total_bonds}<LowSampleMarker warning={bed.low_sample_warning} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Section A: every dwelling type this suburb genuinely has data for,
// including whichever one the primary result above already shows (flagged
// via is_current rather than filtered out, so this is a complete picture,
// not "everything except what you already saw"). Each row expands to
// Section B (its specific bed counts). Expand state is plain React state,
// not the native <details> this app uses everywhere else — the revealed
// content needs to span the full table width via colSpan, which a
// <details> confined to one cell can't do.
function DwellingTypeBreakdownTable({ breakdown, footnote }) {
  const [expandedTypes, setExpandedTypes] = useState(() => new Set());

  function toggle(dwellingType) {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(dwellingType)) {
        next.delete(dwellingType);
      } else {
        next.add(dwellingType);
      }
      return next;
    });
  }

  return (
    <table className="dwelling-type-table">
      <caption>Rent by dwelling type</caption>
      <thead>
        <tr>
          <th scope="col">Dwelling type</th>
          <th scope="col">Median rent</th>
          <th scope="col">Sample size</th>
        </tr>
      </thead>
      <tbody>
        {breakdown.map((dt) => {
          const isExpanded = expandedTypes.has(dt.dwelling_type);
          return (
            <Fragment key={dt.dwelling_type}>
              <tr className={dt.is_current ? 'dwelling-type-row is-current' : 'dwelling-type-row'}>
                <th scope="row">
                  <button
                    type="button"
                    className="dwelling-type-toggle"
                    aria-expanded={isExpanded}
                    onClick={() => toggle(dt.dwelling_type)}
                  >
                    <span className="dwelling-type-chevron" aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
                    {getDwellingTypeLabel(dt.dwelling_type)}
                  </button>
                  {dt.is_current && <span className="current-tag">(shown above)</span>}
                </th>
                <td>${dt.median_rent}/week</td>
                <td>{dt.total_bonds}<LowSampleMarker warning={dt.low_sample_warning} /></td>
              </tr>
              {isExpanded && (
                <tr className="dwelling-type-beds-row">
                  <td colSpan={3}>
                    <BedsSubtable beds={dt.beds} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
      {footnote && (
        <tfoot>
          <tr>
            <td colSpan={3}>† {footnote}</td>
          </tr>
        </tfoot>
      )}
    </table>
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

      <DwellingTypeBreakdownTable breakdown={data.dwelling_type_breakdown} footnote={data.low_sample_footnote} />
    </div>
  );
}

export default RentalPriceCheckResult;
