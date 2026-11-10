const CACHE = 'folio-v1';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch('/asset-list.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Offline asset list unavailable.');
    const assets = await response.json();
    const cache = await caches.open(CACHE);
    await cache.addAll([...assets, '/asset-list.json']);
    // A reader refresh installs the current asset set as one complete unit.
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('folio-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (new URL(event.request.url).pathname === '/health') return;
  event.respondWith((async () => {
    if (event.request.mode === 'navigate') {
      try { return await fetch(event.request); }
      catch { return (await caches.match('/')) || Response.error(); }
    }
    // Prefer current files when the local server is running; fall back offline.
    let response;
    try { response = await fetch(event.request); if (response.ok) return response; }
    catch { /* Offline: use the bundled asset cache. */ }
    return (await caches.match(event.request)) || response || Response.error();
  })());
});
