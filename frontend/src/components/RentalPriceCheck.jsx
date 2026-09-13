import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getSuburbs, getBedAvailability, getRentalPriceCheck } from '../api';
import RentalPriceCheckForm from './RentalPriceCheckForm';
import RentalPriceCheckResult from './RentalPriceCheckResult';

const INITIAL_VALUES = {
  sa2_code: '',
  dwelling_type: 'ALL',
  number_of_beds: '',
  rent: '',
};

// Stable reference for "this suburb/dwelling type combo has no exact bed
// data" — a fresh [] literal on every render would give the reset effect
// below a new dependency value each time, even when nothing meaningful
// changed.
const EMPTY_BEDS = [];

function RentalPriceCheck() {
  const [searchParams] = useSearchParams();
  // Arrived via Suburb Finder's "Check detailed rent" link, which passes
  // sa2_code (always) and dwelling_type (the suburb's lowest_rent type) as
  // query params — read once to seed the form. Not kept in sync afterwards:
  // this only seeds the initial values, it doesn't turn the whole form into
  // URL-driven state for every later change.
  const linkedSa2Code = searchParams.get('sa2_code');
  const linkedDwellingType = searchParams.get('dwelling_type');

  const [suburbs, setSuburbs] = useState(null);
  const [suburbsError, setSuburbsError] = useState(null);

  // { [sa2_code]: { [dwelling_type]: [number_of_beds, ...] } }, or null
  // until it's loaded. Missing errors are non-fatal — the Bedrooms dropdown
  // just falls back to showing every option, same as if "show all" were on.
  const [bedAvailability, setBedAvailability] = useState(null);
  const [showAllBeds, setShowAllBeds] = useState(false);

  const [values, setValues] = useState(() => ({
    ...INITIAL_VALUES,
    sa2_code: linkedSa2Code ?? INITIAL_VALUES.sa2_code,
    dwelling_type: linkedDwellingType ?? INITIAL_VALUES.dwelling_type,
  }));
  const [status, setStatus] = useState('idle'); // idle | loading | error | success
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    getSuburbs()
      .then(setSuburbs)
      .catch((err) => setSuburbsError(err.message));
  }, []);

  useEffect(() => {
    getBedAvailability()
      .then(setBedAvailability)
      .catch(() => {}); // non-fatal, see bedAvailability's comment above
  }, []);

  // availableBeds is null when there's not enough info to filter yet (no
  // suburb picked, or bedAvailability hasn't loaded) — the Form treats
  // null the same as "show everything", same as showAllBeds being on.
  const availableBeds = values.sa2_code && bedAvailability
    ? bedAvailability[values.sa2_code]?.[values.dwelling_type] ?? EMPTY_BEDS
    : null;

  // If the suburb, dwelling type, or the "show all" toggle changes such
  // that the currently-selected bed count is no longer one of the visible
  // options, reset to "Any" rather than leaving the form pointing at a
  // value that's about to disappear from its own dropdown. 'Any' ('') is
  // always valid, so it's exempt from this check.
  useEffect(() => {
    if (showAllBeds || availableBeds === null || values.number_of_beds === '') return;
    if (!availableBeds.includes(values.number_of_beds)) {
      setValues((v) => ({ ...v, number_of_beds: '' }));
    }
  }, [values.sa2_code, values.dwelling_type, values.number_of_beds, showAllBeds, availableBeds]);

  async function handleSubmit() {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const data = await getRentalPriceCheck(values);
      setResult(data);
      setStatus('success');
    } catch (err) {
      setErrorMessage(err.message);
      setStatus('error');
    }
  }

  // Submit immediately when arriving via the link, instead of making the
  // user press "Check" again for a suburb they already chose to look at in
  // Suburb Finder. Deliberately doesn't call handleSubmit (which closes
  // over `values`, changing identity every render) — building the request
  // from linkedSa2Code/linkedDwellingType directly means the effect's real
  // dependencies are two stable strings that only change if the URL itself
  // does, not "every render", so this only ever fires once for a given link.
  // A suburb picked later by hand still submits only on a real button press.
  useEffect(() => {
    if (!linkedSa2Code) return;
    let cancelled = false;
    setStatus('loading');
    setErrorMessage(null);
    getRentalPriceCheck({
      ...INITIAL_VALUES,
      sa2_code: linkedSa2Code,
      dwelling_type: linkedDwellingType ?? INITIAL_VALUES.dwelling_type,
    })
      .then((data) => {
        if (cancelled) return;
        setResult(data);
        setStatus('success');
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMessage(err.message);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [linkedSa2Code, linkedDwellingType]);

  return (
    <section className="rental-price-check">
      <h2>Rental Price Check</h2>
      <p className="lede">
        Look up the market rent for a suburb, dwelling type and bed count, and
        optionally compare it against a rent you've been quoted.
      </p>

      <div className="feature-layout">
        <RentalPriceCheckForm
          suburbs={suburbs}
          suburbsError={suburbsError}
          values={values}
          onChange={setValues}
          onSubmit={handleSubmit}
          submitting={status === 'loading'}
          availableBeds={availableBeds}
          showAllBeds={showAllBeds}
          onShowAllBedsChange={setShowAllBeds}
        />
        <RentalPriceCheckResult status={status} data={result} errorMessage={errorMessage} />
      </div>
    </section>
  );
}

export default RentalPriceCheck;
