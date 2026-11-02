import { inspect } from 'node:util';

// Playwright 1.61.1's injected waitForFunction treats a Promise as truthy before its
// resolved value is known. Poll evaluate() so async false keeps waiting.
export async function waitForAsync(page, predicate, arg, { timeout = 30_000, interval = 50,
  label = 'asynchronous browser predicate' } = {}) {
  if (!Number.isFinite(timeout) || timeout <= 0 || !Number.isFinite(interval) || interval <= 0) {
    throw new RangeError('Browser wait timeout and interval must be finite positive milliseconds');
  }
  const deadline = performance.now() + timeout;
  let attempts = 0; let lastResult; let lastError; let expiration;
  const diagnostic = () => `${label}; attempts=${attempts}; last result=${inspect(lastResult)}; last error=${lastError?.message || 'none'}`;
  function timedOut() {
    const error = new Error(`Timed out after ${timeout}ms waiting for ${diagnostic()}`);
    Object.assign(error, { name: 'TimeoutError', attempts, lastResult, lastError });
    return error;
  }
  let deadlineTimer;
  const expired = new Promise((_, reject) => {
    deadlineTimer = setTimeout(() => { expiration = timedOut(); reject(expiration); }, timeout);
  });
  try {
    while (true) {
      if (performance.now() >= deadline) throw timedOut();
      attempts++;
      try {
        lastResult = await Promise.race([page.evaluate(predicate, arg), expired]);
      } catch (error) {
        if (error === expiration) throw error;
        lastError = error;
        const failure = new Error(`Browser wait failed: ${diagnostic()}`, { cause: error });
        Object.assign(failure, { attempts, lastResult, lastError });
        throw failure;
      }
      if (lastResult) return lastResult;
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw timedOut();
      if (interval >= remaining) await expired;
      let pollTimer;
      try {
        await Promise.race([new Promise(resolve => { pollTimer = setTimeout(resolve, Math.min(interval, remaining)); }), expired]);
      } finally { clearTimeout(pollTimer); }
    }
  } finally { clearTimeout(deadlineTimer); }
}
