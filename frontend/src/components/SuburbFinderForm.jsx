import { DESTINATIONS } from '../suburbFinderOptions';

function SuburbFinderForm({ values, onChange, onSubmit, submitting, liveRanking, onLiveRankingChange }) {
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

      <div className="field">
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={liveRanking}
            onChange={(e) => onLiveRankingChange(e.target.checked)}
          />
          Live ranking
        </label>
        <div className="field-hint-stack">
          <p className={`field-hint${liveRanking ? '' : ' is-hidden'}`}>
            Sliders and destination update the ranking as you change them.
          </p>
          <p className={`field-hint${liveRanking ? ' is-hidden' : ''}`}>
            Only "Find suburbs" applies changes now.
          </p>
        </div>
      </div>

      <div className="field">
        <label htmlFor="rent_weight">
          Rent priority <span className="field-value">{values.rent_weight}</span>
        </label>
        <input
          id="rent_weight"
          type="range"
          min="0"
          max="10"
          step="1"
          value={values.rent_weight}
          onChange={handleFieldChange('rent_weight')}
        />
      </div>

      <div className="field">
        <label htmlFor="transport_weight">
          Transport priority <span className="field-value">{values.transport_weight}</span>
        </label>
        <input
          id="transport_weight"
          type="range"
          min="0"
          max="10"
          step="1"
          value={values.transport_weight}
          onChange={handleFieldChange('transport_weight')}
        />
      </div>

      <div className="field">
        <label htmlFor="distance_weight">
          Distance priority <span className="field-value">{values.distance_weight}</span>
        </label>
        <input
          id="distance_weight"
          type="range"
          min="0"
          max="10"
          step="1"
          value={values.distance_weight}
          onChange={handleFieldChange('distance_weight')}
          disabled={!values.destination}
        />
        {!values.destination && (
          <p className="field-hint">Select a destination to enable this.</p>
        )}
      </div>

      <button type="submit" disabled={submitting}>
        {submitting ? 'Ranking…' : 'Find suburbs'}
      </button>
    </form>
  );
}

export default SuburbFinderForm;
