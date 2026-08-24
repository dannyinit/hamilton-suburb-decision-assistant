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

// How often a slider drag (or a destination change) is allowed to trigger
// a re-rank. Fast enough to read as live, slow enough to keep request
// volume sane even across a multi-second continuous drag.
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

  // Set only by live re-ranks (sliders/destination), never by the explicit
  // submit — orthogonal to `status`, so a live refresh never blanks the
  // list the way `status` briefly did in Step 2. See runLiveRefresh below.
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Cancels a still-in-flight request when a newer one starts — shared by
  // both search paths below, so an explicit submit and a live refresh
  // correctly cancel each other too, not just requests of their own kind.
  // Guarantees a slow response to an old request can never resolve after —
  // and overwrite — a faster response to a newer one.
  const abortControllerRef = useRef(null);

  async function fetchResults(requestValues, signal) {
    return getSuburbFinder(buildRequestParams(requestValues), { signal });
  }

  // The explicit "Find suburbs" path — sets the full status lifecycle,
  // same as before Step 2. Never throttled: a button press should act on
  // immediately, not wait out a throttle window meant for rapid dragging.
  async function runSearch(requestValues) {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setStatus('loading');
    setErrorMessage(null);
    try {
      const data = await fetchResults(requestValues, controller.signal);
      setResult(data);
      setStatus('success');
    } catch (err) {
      if (err.name === 'AbortError') return; // superseded by a newer request
      setErrorMessage(err.message);
      setStatus('error');
    }
  }

  // The slider/destination-triggered path — the Step 3 change. Never
  // touches `status` or clears `result`: the list stays exactly as it was
  // until the new data actually arrives, so nothing flashes or blanks
  // mid-drag. A failure here is swallowed (logged, not surfaced) rather
  // than replacing valid results with an error card over a background
  // refresh the user didn't explicitly ask to see the outcome of.
  async function runLiveRefresh(requestValues) {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsRefreshing(true);
    try {
      const data = await fetchResults(requestValues, controller.signal);
      setResult(data);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Live re-rank failed, keeping previous results:', err);
      }
    } finally {
      // Only clear isRefreshing if this call is still the most recent one.
      // If a newer call superseded this one, abortControllerRef.current
      // now points at *its* controller, not this call's — clearing the
      // flag here would be premature, flickering it off while the newer
      // call (which will clear it correctly itself when it finishes) is
      // still genuinely in flight.
      if (abortControllerRef.current === controller) {
        setIsRefreshing(false);
      }
    }
  }

  // Created once and reused across renders — a throttle recreated every
  // render would lose its internal "last called" timing on every render,
  // making it a no-op. Safe to capture this render's runLiveRefresh
  // forever: its behaviour never actually varies between renders (it
  // takes the values to search for as a parameter, and otherwise only
  // touches stable setState functions and the stable abortControllerRef).
  const throttledRefreshRef = useRef(null);
  if (!throttledRefreshRef.current) {
    throttledRefreshRef.current = throttle(runLiveRefresh, LIVE_REFRESH_THROTTLE_MS);
  }

  // Read inside the trigger effect below without being listed as its
  // dependency — deliberately, not an oversight. Refs are updated every
  // render (the accepted exception to "don't mutate during render"), so a
  // read always sees the latest value, and — because the linter can't see
  // through `.current` — this read doesn't force the effect to re-fire
  // just because `status` changed for an unrelated reason: if `status`
  // were a real dependency, this effect would also re-fire the moment
  // handleSubmit's own explicit search changes it, racing a redundant
  // throttled call against the explicit one already in flight.
  //
  // Guards on `=== 'success'` specifically, not just "not idle": a live
  // refresh has no valid prior result to refresh while idle (nothing
  // submitted yet), loading (an explicit search is already in flight —
  // the shared AbortController already handles a slider change arriving
  // mid-search), or error (no successful result is currently shown, and
  // status staying 'error' would otherwise leave the error card up even
  // after a live refresh quietly succeeded in the background).
  const statusRef = useRef(status);
  statusRef.current = status;

  // Read the same way, for the same reason, but for a different field:
  // the effect needs the *current* budget alongside whichever field
  // actually changed, without re-firing when budget changes on its own —
  // budget can change *which* suburbs survive the hard constraints, not
  // just how the survivors are scored, so it stays a deliberate,
  // explicit-submit-only action, unlike destination and the weights.
  const valuesRef = useRef(values);
  valuesRef.current = values;

  useEffect(() => {
    if (statusRef.current !== 'success') return;
    throttledRefreshRef.current(valuesRef.current);
  }, [values.rent_weight, values.transport_weight, values.distance_weight, values.destination]);

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
        Enter your weekly budget and press "Find suburbs" to get started. Once
        you have results, adjusting the sliders or destination updates the
        ranking live — budget changes still need "Find suburbs" pressed again.
      </p>

      <div className="feature-layout">
        <SuburbFinderForm
          values={values}
          onChange={setValues}
          onSubmit={handleSubmit}
          submitting={status === 'loading'}
        />
        <SuburbFinderResults
          status={status}
          data={result}
          errorMessage={errorMessage}
          isRefreshing={isRefreshing}
        />
      </div>
    </section>
  );
}

export default SuburbFinder;
