// Injectable clock. All actors read time from here, so "an expired token" is made by advancing the clock, never by sleeping.
export function createClock(base = () => Date.now()) {
  let offsetMs = 0;
  return {
    now: () => base() + offsetMs,
    nowSec: () => Math.floor((base() + offsetMs) / 1000),
    advance(ms) { offsetMs += ms; },
    reset() { offsetMs = 0; },
  };
}
