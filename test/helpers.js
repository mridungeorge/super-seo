// Shared test helpers.

/** True when the test run may touch the network (SM_LIVE=1). */
export function liveEnabled() {
  return process.argv.includes('--live') || process.env.SM_LIVE === '1';
}
