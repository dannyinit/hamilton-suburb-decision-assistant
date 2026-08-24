import { DWELLING_TYPES, NUMBER_OF_BEDS_OPTIONS } from '../rentalCheckOptions';

function RentalPriceCheckForm({
  suburbs,
  suburbsError,
  values,
  onChange,
  onSubmit,
  submitting,
  availableBeds,
  showAllBeds,
  onShowAllBedsChange,
}) {
  const suburbsLoading = !suburbs && !suburbsError;

  // availableBeds is null before there's enough info to filter (no suburb
  // picked yet, or the lookup hasn't loaded) — show everything in that
  // case, same as if "show all" were checked.
  const bedsToShow = showAllBeds || availableBeds === null
    ? NUMBER_OF_BEDS_OPTIONS
    : NUMBER_OF_BEDS_OPTIONS.filter((option) => availableBeds.includes(option.value));

  function handleFieldChange(field) {
    return (e) => onChange({ ...values, [field]: e.target.value });
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="form-card">
      <div className="field">
        <label htmlFor="sa2_code">Suburb</label>
        <select
          id="sa2_code"
          value={values.sa2_code}
          onChange={handleFieldChange('sa2_code')}
          required
          disabled={suburbsLoading || Boolean(suburbsError)}
        >
          <option value="" disabled hidden>
            {suburbsLoading ? 'Loading suburbs…' : 'Select a suburb…'}
          </option>
          {suburbs?.map((suburb) => (
            <option key={suburb.sa2_code} value={suburb.sa2_code}>
              {suburb.sa2_name}
            </option>
          ))}
        </select>
        {suburbsError && <p className="field-error">{suburbsError}</p>}
      </div>

      <div className="field">
        <label htmlFor="dwelling_type">Dwelling type</label>
        <select
          id="dwelling_type"
          value={values.dwelling_type}
          onChange={handleFieldChange('dwelling_type')}
          required
        >
          {DWELLING_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="number_of_beds">Bedrooms</label>
        <select
          id="number_of_beds"
          value={values.number_of_beds}
          onChange={handleFieldChange('number_of_beds')}
        >
          <option value="">Any (all bed counts)</option>
          {bedsToShow.map((option) => (
            <option key={option.value} value={option.value} title={option.title}>
              {option.label}
            </option>
          ))}
        </select>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={showAllBeds}
            onChange={(e) => onShowAllBedsChange(e.target.checked)}
          />
          Show all bedroom counts (including ones with no data)
        </label>
      </div>

      <div className="field">
        <label htmlFor="rent">Your weekly rent ($, optional)</label>
        <input
          id="rent"
          type="number"
          min="0"
          step="1"
          placeholder="e.g. 600"
          value={values.rent}
          onChange={handleFieldChange('rent')}
        />
      </div>

      <button type="submit" disabled={suburbsLoading || Boolean(suburbsError) || submitting}>
        {submitting ? 'Checking…' : 'Check rental price'}
      </button>
    </form>
  );
}

export default RentalPriceCheckForm;
