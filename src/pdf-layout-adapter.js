import { interpretPage } from './pdf-layout.js';

const documents = new WeakMap();
const abort = signal => { if (signal?.aborted) throw new DOMException('Layout cancelled.', 'AbortError'); };
function wait(promise, signal) {
  abort(signal);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Layout cancelled.', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', onAbort); resolve(value); }, error => { signal.removeEventListener('abort', onAbort); reject(error); });
  });
}

/** Shared pending reads; aborting one consumer does not cancel another's page. */
export async function readPageLayout(pdf, number, { signal } = {}) {
  abort(signal);
  if (!Number.isInteger(number) || number < 1 || number > pdf.numPages) throw new RangeError(`Page number must be between 1 and ${pdf.numPages}.`);
  let cache = documents.get(pdf);
  if (!cache) { cache = new Map(); documents.set(pdf, cache); }
  if (!cache.has(number)) {
    const pending = (async () => {
      const page = await pdf.getPage(number);
      const [content, structTree] = await Promise.all([
        page.getTextContent({ includeMarkedContent: true }),
        page.getStructTree?.().catch(() => null) ?? null,
      ]);
      return interpretPage(content, { pageNumber: number, view: page.view,
        viewport: page.getViewport?.({ scale: 1 }), structTree, documentId: pdf.fingerprints?.[0] ?? null, rotation: page.rotate ?? 0 });
    })();
    cache.set(number, pending);
    pending.catch(() => { if (cache.get(number) === pending) cache.delete(number); });
    while (cache.size > 8) cache.delete(cache.keys().next().value);
  }
  const pending = cache.get(number);
  cache.delete(number); cache.set(number, pending);
  const result = await wait(pending, signal);
  abort(signal);
  return result;
}

export function clearPageLayouts(pdf) { documents.delete(pdf); }
