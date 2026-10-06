import test from 'node:test';
import assert from 'node:assert/strict';
import { getBook, putBook, updateBook, listBooks, deleteBook } from '../src/storage.js';

// Exercise the IndexedDB contract, including transaction completion and cursors,
// without installing a browser or another runtime dependency.
const databases = new Map();
const operations = [];
function fakeDatabase(name) {
  const stores = new Map();
  return {
    stores, close() {},
    createObjectStore(store) { stores.set(store, new Map()); },
    transaction(storeName, mode) {
      const rows = stores.get(storeName);
      assert.ok(rows, `existing store ${storeName}`);
      const tx = { pending: 0, objectStore() {
        function request(type, action) {
          operations.push({ name, storeName, mode, type });
          const result = {};
          tx.pending++;
          queueMicrotask(() => {
            result.result = structuredClone(action());
            result.onsuccess?.();
            if (--tx.pending === 0) queueMicrotask(() => { if (!tx.pending) tx.oncomplete?.(); });
          });
          return result;
        }
        return {
          get: id => request('get', () => rows.get(id)),
          getAll: () => request('getAll', () => [...rows.values()]),
          put: value => request('put', () => { rows.set(value.id, structuredClone(value)); return value.id; }),
          delete: id => request('delete', () => rows.delete(id)),
          openCursor() {
            operations.push({ name, storeName, mode, type: 'cursor' });
            const result = {};
            const values = [...rows.values()];
            tx.pending++;
            function advance() {
              queueMicrotask(() => {
                result.result = values.length ? { value: structuredClone(values.shift()), continue: advance } : null;
                result.onsuccess?.();
                if (!result.result && --tx.pending === 0) queueMicrotask(() => tx.oncomplete?.());
              });
            }
            advance();
            return result;
          },
        };
      } };
      return tx;
    },
  };
}
globalThis.indexedDB = {
  open(name, version) {
    assert.equal(version, 1, 'reading progress must not upgrade the existing PDF database');
    const request = {};
    queueMicrotask(() => {
      const fresh = !databases.has(name);
      if (fresh) databases.set(name, fakeDatabase(name));
      request.result = databases.get(name);
      if (fresh) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  },
};
const original = { id: 'older-book', title: 'An existing book', bytes: new Uint8Array([1, 2, 3]).buffer, page: 3, bookmarks: [3], chapters: [{ title: 'A Quiet Morning', page: 1 }], source: 'manual', addedAt: 1 };

test('existing shelf records remain readable before a progress overlay exists', async () => {
  await putBook(original);
  assert.deepEqual(await getBook(original.id), original);
  assert.equal((await listBooks())[0].chapters[0].title, 'A Quiet Morning');
});

test('progress updates touch only small metadata and retain PDF bytes and older chapter edits', async () => {
  const start = operations.length;
  const scrollPosition = { page: 4, fraction: 0.35, view: 'book' };
  const bookPosition = { page: 4, offset: 845 };
  await updateBook(original.id, { page: 4, scrollPosition, bookPosition, bytes: new ArrayBuffer(100), title: 'Unexpected replacement' });
  const writes = operations.slice(start);
  assert.ok(writes.length > 0);
  assert.ok(writes.every(op => op.name === 'folio-reading-places'), 'no PDF-store access during progress save');
  const raw = databases.get('folio-library').stores.get('books').get(original.id);
  assert.deepEqual(raw, original, 'source record remains intact');
  const place = databases.get('folio-reading-places').stores.get('places').get(original.id);
  assert.equal('bytes' in place, false);
  assert.equal('title' in place, false);
  const loaded = await getBook(original.id);
  assert.equal(loaded.page, 4);
  assert.deepEqual(loaded.scrollPosition, scrollPosition);
  assert.deepEqual(loaded.bookPosition, bookPosition);
  assert.deepEqual(loaded.bytes, original.bytes);
  assert.deepEqual(loaded.chapters, original.chapters);
  const shelf = await listBooks();
  assert.equal(shelf[0].page, 4);
  assert.equal('bytes' in shelf[0], false);
});

test('later bookmark updates preserve the scroll place, and removal clears both stores', async () => {
  await updateBook(original.id, { bookmarks: [2, 4] });
  const loaded = await getBook(original.id);
  assert.deepEqual(loaded.bookmarks, [2, 4]);
  assert.equal(loaded.scrollPosition.fraction, 0.35);
  assert.deepEqual(loaded.bookPosition, { page: 4, offset: 845 });
  await deleteBook(original.id);
  assert.equal(await getBook(original.id), undefined);
  assert.deepEqual(await listBooks(), []);
  assert.equal(databases.get('folio-reading-places').stores.get('places').has(original.id), false);
});
