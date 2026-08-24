// Leading + trailing throttle, hand-rolled (small enough not to justify a
// dependency for this project's scale). The first call in a burst fires
// immediately (leading edge). Calls that arrive before `delayMs` has
// elapsed since the last real invocation are suppressed, but the LATEST
// set of arguments seen during that suppressed window is remembered and
// fired once, after the remaining delay (trailing edge) — a call is only
// ever delayed, never silently dropped.
//
// This matters for the live-re-ranking use case specifically: during a
// fast slider drag, the value the user actually settles on must always
// eventually reach the server, even if it landed inside a suppressed
// window — a naive "only fire if enough time has passed" throttle (no
// trailing edge) would drop it, leaving the UI on a stale result.
export function throttle(fn, delayMs) {
  let lastCallTime = 0;
  let trailingTimer = null;
  let trailingArgs = null;

  function invoke(args) {
    lastCallTime = Date.now();
    fn(...args);
  }

  function throttled(...args) {
    const remaining = delayMs - (Date.now() - lastCallTime);

    if (remaining <= 0) {
      // Window's open — fire now, and drop any trailing call queued from
      // an earlier burst (this call supersedes it).
      if (trailingTimer) {
        clearTimeout(trailingTimer);
        trailingTimer = null;
      }
      invoke(args);
      return;
    }

    // Too soon — remember the latest args; only schedule the trailing
    // timer once per suppressed window (a later call in the same window
    // just updates trailingArgs, it doesn't push the timer back further,
    // which would make this a debounce instead of a throttle).
    trailingArgs = args;
    if (!trailingTimer) {
      trailingTimer = setTimeout(() => {
        trailingTimer = null;
        invoke(trailingArgs);
      }, remaining);
    }
  }

  throttled.cancel = function cancel() {
    if (trailingTimer) {
      clearTimeout(trailingTimer);
      trailingTimer = null;
    }
  };

  return throttled;
}
