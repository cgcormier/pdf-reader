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
const original = { id: 'older-book', title: 'An existing book', bytes: new Uint8Array([1, 2, 3]).buffer, page: 3, bookmarks: [3], chapters: [{ title: 'A Quiet Morning', page: 1 }], source: 'structure', addedAt: 1 };

test('existing shelf records remain readable before a progress overlay exists', async () => {
  await putBook(original);
  assert.deepEqual(await getBook(original.id), original);
  assert.equal((await listBooks())[0].chapters[0].title, 'A Quiet Morning');
});

test('progress updates touch only small metadata and retain PDF bytes and saved automatic chapters', async () => {
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

test('structure metadata round trips and survives later progress saves without changing PDF bytes', async () => {
  const structure = {
    version: 1,
    nodes: [
      { id: 'part-1', kind: 'part', title: 'Part I', page: 2, parentId: null },
      { id: 'chapter-1', kind: 'chapter', title: 'Opening', page: 2, parentId: 'part-1' },
    ],
  };
  const contentsExpanded = { 'part-1': true, 'chapter-1': false };
  await updateBook(original.id, {
    structure,
    contentsExpanded,
    scannedPages: 120,
    source: 'headings',
  });

  let loaded = await getBook(original.id);
  assert.deepEqual(loaded.structure, structure);
  assert.deepEqual(loaded.contentsExpanded, contentsExpanded);
  assert.equal(loaded.scannedPages, 120);
  assert.equal(loaded.source, 'headings');
  assert.deepEqual(loaded.bytes, original.bytes);

  await updateBook(original.id, { page: 5 });
  loaded = await getBook(original.id);
  assert.deepEqual(loaded.structure, structure);
  assert.deepEqual(loaded.contentsExpanded, contentsExpanded);
  assert.equal(loaded.scannedPages, 120);
  assert.equal(loaded.page, 5);
  assert.deepEqual(loaded.bytes, original.bytes);
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

test('versioned source anchors and rollback metadata round trip without touching PDF bytes', async () => {
  const id = 'mapped-layout-book'; await putBook({ ...original, id });
  const bookPosition = { page: 3, offset: 21, layoutVersion: 1, source: { item: 7, offset: 4 }, legacyOffset: 35, contentsId: 'scene-2' };
  const start = operations.length;
  await updateBook(id, { bookPosition, scrollPosition: { page: 3, fraction: .4, view: 'book' } });
  assert.ok(operations.slice(start).every(op => op.name === 'folio-reading-places'));
  const saved = await getBook(id); assert.deepEqual(saved.bookPosition, bookPosition); assert.deepEqual(saved.bytes, original.bytes);
  await deleteBook(id);
});

 test('retired edits are ignored and older custom-only books rescan without changing bytes or positions', async () => {
  const id='retired-contents-book';
  const raw={...original,id,source:'manual',structure:{status:'manual',nodes:[{id:'old',title:'Custom',page:1}]},structureEdits:{old:{title:'Override'}}};
  databases.get('folio-library').stores.get('books').set(id,structuredClone(raw));
  const loaded=await getBook(id);
  assert.equal('structureEdits' in loaded,false); assert.equal(loaded.structure,undefined);
  assert.deepEqual(loaded.chapters,[{title:'Entire book',page:1}]);
  assert.deepEqual(loaded.bytes,original.bytes); assert.equal(loaded.page,original.page);
  await updateBook(id,{page:4,structureEdits:{old:{title:'Still ignored'}}});
  assert.equal('structureEdits' in databases.get('folio-reading-places').stores.get('places').get(id),false);
  assert.deepEqual((await getBook(id)).bytes,original.bytes);
  assert.equal('structureEdits' in (await listBooks()).find(b=>b.id===id),false);
  await deleteBook(id);
});
