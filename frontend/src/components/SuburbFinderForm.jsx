import { DESTINATIONS } from '../suburbFinderOptions';

function SuburbFinderForm({ values, onChange, onSubmit, submitting }) {
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
        <label htmlFor="budget">Weekly budget ($)</label>
        <input
          id="budget"
          type="number"
          min="0"
          step="1"
          placeholder="e.g. 500"
          value={values.budget}
          onChange={handleFieldChange('budget')}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="destination">Destination (optional)</label>
        <select
          id="destination"
          value={values.destination}
          onChange={handleFieldChange('destination')}
        >
          <option value="">No preference</option>
          {DESTINATIONS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <button type="submit" disabled={submitting}>
        {submitting ? 'Ranking…' : 'Find suburbs'}
      </button>
    </form>
  );
}

export default SuburbFinderForm;
