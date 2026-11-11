/** Coordinate cooperative fitting with the short page-turn animation.
 * Holds are independent so an older turn cannot release a newer turn's gate.
 */
export function createFitGate() {
  const holds = new Set();
  const waiters = new Set();
  return {
    get paused() { return holds.size > 0; },
    pause() {
      const hold = {};
      holds.add(hold);
      return () => {
        if (!holds.delete(hold) || holds.size) return;
        for (const resolve of waiters) resolve();
        waiters.clear();
      };
    },
    wait(signal) {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (!holds.size) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const finish = () => {
          signal?.removeEventListener('abort', abort);
          waiters.delete(finish);
          resolve();
        };
        const abort = () => {
          waiters.delete(finish);
          signal.removeEventListener('abort', abort);
          reject(signal.reason);
        };
        waiters.add(finish);
        signal?.addEventListener('abort', abort, { once: true });
      });
    },
  };
}
