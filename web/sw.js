// Service worker of the web app (template: web/vite.config.mts injects the precache list).
// 1. Serves media stored in IndexedDB at `<app>/wpa-media/<sha256>.<ext>`.
//    Keep DB_NAME / DB_VERSION / store names in sync with web/bridge/db.ts.
// 2. Offline use: a production build precaches every file of the app on install.
//    Pages are network-first (new deploys show up), hashed assets cache-first.
//    The dev server injects an empty list, so nothing is cached during development.
const DB_NAME = 'wpa-web';
const DB_VERSION = 1;
const SEGMENT = '/wpa-media/';
const PRECACHE = __PRECACHE__;
const CACHE_PREFIX = 'wpa-app-';
const CACHE = `${CACHE_PREFIX}${PRECACHE.version}`;
const KEEP_CACHES = 2; // the previous version stays so an open page can still load its lazy chunks
const scoped = path => new URL(path, self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    if (PRECACHE.files.length) {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE.files.map(scoped));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = (await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE);
    // caches.keys() lists in creation order: drop all but the newest previous versions.
    for (const name of names.slice(0, Math.max(0, names.length - (KEEP_CACHES - 1)))) await caches.delete(name);
    await self.clients.claim();
  })());
});

async function pageFromNetwork(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE)).put(scoped('./index.html'), response.clone());
    return response;
  } catch {
    // Offline: any page of the app (control or ?mode=projector) is the same index.html.
    return (await caches.match(scoped('./index.html'), MATCH)) ?? (await caches.match(scoped('./'), MATCH)) ?? Response.error();
  }
}

// Files are keyed by their (hashed) URL alone. Hosts may send `Vary: Origin`, and module
// scripts carry an Origin header the precache request did not, so Vary must be ignored.
const MATCH = { ignoreVary: true };

async function assetFromCache(request) {
  const cached = await caches.match(request, MATCH);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getRecord(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('media', 'readonly').objectStore('media').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function respond(request, key) {
  const record = await getRecord(key);
  if (!record) return new Response('Not found', { status: 404 });
  const { blob, type } = record;
  const headers = { 'Content-Type': type || blob.type || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') || '');
  if (!range) return new Response(blob, { status: 200, headers: { ...headers, 'Content-Length': String(blob.size) } });
  let start = range[1] === '' ? NaN : Number(range[1]);
  let end = range[2] === '' ? blob.size - 1 : Number(range[2]);
  if (Number.isNaN(start)) { start = Math.max(0, blob.size - end); end = blob.size - 1; }
  end = Math.min(end, blob.size - 1);
  if (start > end || start >= blob.size) {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${blob.size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${blob.size}` },
  });
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const index = url.pathname.indexOf(SEGMENT);
  if (index >= 0) {
    const key = decodeURIComponent(url.pathname.slice(index + SEGMENT.length));
    if (/^[a-f0-9]{64}\.[a-z0-9]{1,10}$/.test(key)) {
      event.respondWith(respond(event.request, key).catch(() => new Response('Media unavailable', { status: 500 })));
    }
    return;
  }
  if (!PRECACHE.files.length || !event.request.url.startsWith(self.registration.scope)) return;
  if (event.request.mode === 'navigate') event.respondWith(pageFromNetwork(event.request));
  else event.respondWith(assetFromCache(event.request));
});
