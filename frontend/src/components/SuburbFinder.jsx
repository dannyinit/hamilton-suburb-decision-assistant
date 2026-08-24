import { useEffect, useRef, useState } from 'react';
import { getSuburbFinder } from '../api';
import { throttle } from '../throttle';
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

// How often a slider drag is allowed to trigger a re-rank. Fast enough to
// read as live, slow enough to keep request volume sane even across a
// multi-second continuous drag.
const LIVE_REFRESH_THROTTLE_MS = 200;

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

  // Cancels a still-in-flight request when a newer one starts, so a slow
  // response to an old slider position can never resolve after — and
  // overwrite — a faster response to a newer one.
  const abortControllerRef = useRef(null);

  // Step 2 still reuses the existing status/loading state for every
  // search, including slider-triggered ones — dragging will visibly reset
  // the list for now. That's this step's known, called-out limitation:
  // isolating "is the fetch/throttle/cancel logic correct" from "does it
  // look good" (Step 3 removes the flash without touching this function).
  async function runSearch(requestValues) {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setStatus('loading');
    setErrorMessage(null);
    try {
      const data = await getSuburbFinder(buildRequestParams(requestValues), {
        signal: controller.signal,
      });
      setResult(data);
      setStatus('success');
    } catch (err) {
      if (err.name === 'AbortError') return; // superseded by a newer request
      setErrorMessage(err.message);
      setStatus('error');
    }
  }

  // Created once and reused across renders — a throttle recreated every
  // render would lose its internal "last called" timing on every render,
  // making it a no-op. Safe to capture this render's runSearch forever:
  // runSearch's behaviour never actually varies between renders (it takes
  // the values to search for as a parameter, and otherwise only touches
  // stable setState functions and the stable abortControllerRef).
  const throttledRefreshRef = useRef(null);
  if (!throttledRefreshRef.current) {
    throttledRefreshRef.current = throttle(runSearch, LIVE_REFRESH_THROTTLE_MS);
  }

  // Both read inside the weight-watching effect below without being listed
  // as its dependencies — deliberately, not an oversight. Refs are updated
  // every render (the accepted exception to "don't mutate during render"),
  // so a read always sees the latest value, and — because the linter can't
  // see through `.current` — neither read forces the effect to re-fire
  // just because status or values changed for an unrelated reason:
  //   - statusRef: if `status` were a real dependency, this effect would
  //     also re-fire the moment handleSubmit's own explicit, unthrottled
  //     search flips status from 'loading' to 'success' — nothing about
  //     the weights changed, only status did — racing a redundant
  //     throttled call against the explicit one already in flight.
  //   - valuesRef: the effect needs the *current* budget/destination
  //     alongside whichever weight just changed, but must not re-fire
  //     when budget/destination change on their own (only sliders should
  //     trigger a live refresh — see the earlier design proposal).
  const statusRef = useRef(status);
  statusRef.current = status;

  const valuesRef = useRef(values);
  valuesRef.current = values;

  useEffect(() => {
    if (statusRef.current === 'idle') return; // nothing to refresh yet
    throttledRefreshRef.current(valuesRef.current);
  }, [values.rent_weight, values.transport_weight, values.distance_weight]);

  useEffect(() => {
    return () => {
      throttledRefreshRef.current?.cancel();
      abortControllerRef.current?.abort();
    };
  }, []);

  function handleSubmit() {
    // Explicit button press — never throttled, the user wants this now.
    runSearch(values);
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
