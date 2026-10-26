const DATABASE = 'folio-library';
const PLACES = 'folio-reading-places';
let connection;
let placesConnection;

export function preference(key, fallback) {
  try { return JSON.parse(localStorage.getItem(`folio:${key}`)) ?? fallback; }
  catch { return fallback; }
}

export function savePreference(key, value) {
  try { localStorage.setItem(`folio:${key}`, JSON.stringify(value)); return true; }
  catch { return false; }
}

function openDatabase(name, storeName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Folio tabs to use the shelf.'));
  });
}
function database() {
  // Keep the existing PDF database at version one. A separate, tiny database
  // avoids upgrades being blocked by another open reader and leaves PDFs intact.
  connection ||= openDatabase(DATABASE, 'books').catch(error => { connection = undefined; throw error; });
  return connection;
}
function placesDatabase() {
  placesConnection ||= openDatabase(PLACES, 'places').catch(error => { placesConnection = undefined; throw error; });
  return placesConnection;
}
async function transaction(getDatabase, storeName, mode, operation) {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = operation(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Local storage transaction was cancelled.'));
  });
}
const booksTransaction = (mode, operation) => transaction(database, 'books', mode, operation);
const placesTransaction = (mode, operation) => transaction(placesDatabase, 'places', mode, operation);

// Retired metadata is discarded at the storage boundary, never applied to the
// automatic tree. Existing source bytes and reading-place fields stay intact.
function currentRecord(record) {
  const { structureEdits: retiredEdits, ...value } = record;
  if (value.source === 'manual' || value.structure?.status === 'manual') {
    value.source = 'structure';
    value.structure = undefined;
    value.chapters = [{ title: 'Entire book', page: 1 }];
  }
  return value;
}

export async function getBook(id) {
  const [book, place] = await Promise.all([
    booksTransaction('readonly', store => store.get(id)),
    placesTransaction('readonly', store => store.get(id)),
  ]);
  return book ? currentRecord({ ...book, ...place }) : undefined;
}
export const putBook = book => booksTransaction('readwrite', store => store.put(currentRecord(book)));
export async function deleteBook(id) {
  await Promise.all([
    booksTransaction('readwrite', store => store.delete(id)),
    placesTransaction('readwrite', store => store.delete(id)),
  ]);
}

export async function listBooks() {
  const [db, places] = await Promise.all([database(), placesTransaction('readonly', store => store.getAll())]);
  const byId = new Map(places.map(place => [place.id, place]));
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readonly');
    const books = [];
    const request = tx.objectStore('books').openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const { bytes, ...metadata } = cursor.value;
      books.push(currentRecord({ ...metadata, ...byId.get(metadata.id) }));
      cursor.continue();
    };
    tx.oncomplete = () => resolve(books.sort((a, b) => b.addedAt - a.addedAt));
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateBook(id, changes) {
  const allowed = new Set([
    'page', 'bookmarks', 'chapters', 'source', 'scrollPosition', 'bookPosition', 'view', 'readingLayout',
    'structure', 'contentsExpanded', 'scannedPages',
  ]);
  const metadata = Object.fromEntries(Object.entries(changes).filter(([key]) => allowed.has(key)));
  const db = await placesDatabase();
  return new Promise((resolve, reject) => {
    // Scroll saves never fetch or rewrite the source PDF bytes.
    const tx = db.transaction('places', 'readwrite');
    const store = tx.objectStore('places');
    const request = store.get(id);
    request.onsuccess = () => {
      store.put(currentRecord({ ...request.result, ...metadata, id }));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
