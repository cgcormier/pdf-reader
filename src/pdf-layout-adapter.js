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
      // TextContent exposes fallback families, which omit emphasis even for
      // embedded italic faces. The operator list loads the actual font records.
      if (page.getOperatorList && page.commonObjs?.get) {
        try {
          await page.getOperatorList();
          for (const [id, style] of Object.entries(content.styles ?? {})) {
            try {
              const font = page.commonObjs.get(id);
              content.styles[id] = { ...style, sourceFontName: font.name ?? style.sourceFontName,
                bold: font.black === true ? true : font.bold ?? style.bold, italic: font.italic ?? style.italic,
                fontWeight: font.cssFontInfo?.fontWeight ?? style.fontWeight, italicAngle: font.cssFontInfo?.italicAngle ?? style.italicAngle };
            } catch { /* A missing font record leaves text and source mapping intact. */ }
          }
        } catch { /* Unsupported operator lists retain the TextContent fallback. */ }
      }
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
