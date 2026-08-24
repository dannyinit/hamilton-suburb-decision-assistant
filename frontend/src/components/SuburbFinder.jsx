import { useState } from 'react';
import { getSuburbFinder } from '../api';
import SuburbFinderForm from './SuburbFinderForm';
import SuburbFinderResults from './SuburbFinderResults';

const INITIAL_VALUES = {
  budget: '',
  destination: '',
  // Sliders default to the shared mid-point of their 0-10 range, not the
  // backend's own default of 1 — normalisation only cares about ratios, so
  // three sliders all at 5 produce an identical result to all at 1, and a
  // thumb sitting mid-track reads as "neutral priority" at a glance in a
  // way "1 out of 10" wouldn't.
  rent_weight: '5',
  transport_weight: '5',
  distance_weight: '5',
};

// distance_weight is only meaningful with a destination — the backend
// itself ignores it otherwise (see backend/README.md). The slider still
// holds a value even while disabled (so it resumes where it was left if a
// destination is picked again), so the omission has to happen here, at
// request-build time, not by clearing the slider's own state.
function buildRequestParams(values) {
  const { distance_weight, ...rest } = values;
  return {
    ...rest,
    ...(values.destination ? { distance_weight } : {}),
  };
}

function SuburbFinder() {
  const [values, setValues] = useState(INITIAL_VALUES);
  const [status, setStatus] = useState('idle'); // idle | loading | error | success
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  async function handleSubmit() {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const data = await getSuburbFinder(buildRequestParams(values));
      setResult(data);
      setStatus('success');
    } catch (err) {
      setErrorMessage(err.message);
      setStatus('error');
    }
  }

  return (
    <section className="suburb-finder">
      <h1>Suburb Finder</h1>
      <p className="lede">
        Enter your weekly budget and, optionally, a destination you'd like to be
        close to. Use the sliders to set how much rent, transport access, and
        distance matter to you, then press "Find suburbs" to rank them.
      </p>

      <div className="feature-layout">
        <SuburbFinderForm
          values={values}
          onChange={setValues}
          onSubmit={handleSubmit}
          submitting={status === 'loading'}
        />
        <SuburbFinderResults status={status} data={result} errorMessage={errorMessage} />
      </div>
    </section>
  );
}

export default SuburbFinder;
