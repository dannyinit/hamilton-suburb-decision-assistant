// Mirrors backend/routes/rentalPriceCheck.js's VALID_DWELLING_TYPES exactly.
// There's no endpoint for this (it's a small fixed set), so it's kept here
// in sync by hand — if the backend list ever changes, update this too.
const DWELLING_TYPES = [
  { value: 'ALL', label: 'Any dwelling type' },
  { value: 'Apartment', label: 'Apartment' },
  { value: 'Boarding House', label: 'Boarding House' },
  { value: 'Flat', label: 'Flat' },
  { value: 'House', label: 'House' },
  { value: 'Room', label: 'Room' },
];

// Mirrors backend/routes/rentalPriceCheck.js's VALID_NUMBER_OF_BEDS, minus
// 'ALL' (the "Any" option below omits the param entirely instead, since the
// backend treats an omitted/empty number_of_beds as identical to 'ALL' —
// no need to offer both). Same order as the backend's own validation-error
// message, so if that ever surfaces to a user it matches what they saw here.
//
// '5' and '5+' are genuinely distinct, coexisting MBIE categories, not a
// duplicate/typo — confirmed against the actual data: some suburbs have
// *both* a '5' row and a '5+' row for the same dwelling type, with
// different median_rent and total_bonds (the '5+' row's sample size is
// consistently larger, consistent with it being a "5 or more" aggregate
// that overlaps with the exact-5 bucket rather than a disjoint "6+").
// Labelled explicitly below so a user doesn't read them as a strictly
// increasing, mutually-exclusive scale.
//
// 0, 6, 8, 9 and 15 currently have zero rows in the database for any
// suburb — left in deliberately (not a bug) so the fallback/
// insufficient_data behaviour stays reachable from the UI for testing.
const NUMBER_OF_BEDS_OPTIONS = [
  { value: '0', label: '0 bedrooms' },
  { value: '1', label: '1 bedroom' },
  { value: '2', label: '2 bedrooms' },
  { value: '3', label: '3 bedrooms' },
  { value: '4', label: '4 bedrooms' },
  { value: '5', label: 'Exactly 5 bedrooms' },
  { value: '6', label: '6 bedrooms' },
  { value: '7', label: '7 bedrooms' },
  { value: '8', label: '8 bedrooms' },
  { value: '9', label: '9 bedrooms' },
  { value: '15', label: '15 bedrooms' },
  {
    value: '5+',
    label: '5 or more bedrooms',
    title: "Separate MBIE category from 'Exactly 5 bedrooms' — a broader 5-or-more aggregate, not a duplicate.",
  },
];

function RentalPriceCheckForm({ suburbs, suburbsError, values, onChange, onSubmit, submitting }) {
  const suburbsLoading = !suburbs && !suburbsError;

  function handleFieldChange(field) {
    return (e) => onChange({ ...values, [field]: e.target.value });
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="rental-form">
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
          {NUMBER_OF_BEDS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value} title={option.title}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="rent">Your weekly rent (optional)</label>
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
