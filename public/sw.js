/* Allowance caches only its public app shell and static assets. API responses,
 * receipts, the operator console's data and anything under /api never enter
 * Cache Storage. Documents are network-first; hashed assets are cache-first. */
const CACHE = 'allowance-shell-v1';
const SHELL = ['/', '/site.webmanifest?v=3', '/allowance-icon-192.png?v=3', '/allowance-icon-512.png?v=3', '/allowance-icon-maskable-512.png?v=1'];
const STATIC_PATHS = ['/assets/', '/fonts/', '/media/', '/brand/'];
const STATIC_FILES = new Set(['/favicon.svg', '/favicon-red.svg', '/favicon-32.png', '/apple-touch-icon.png', '/allowance-a.svg', '/allowance-symbol.svg', '/allowance-wordmark.svg']);

const isStatic = (url) => url.origin === self.location.origin && (STATIC_FILES.has(url.pathname) || STATIC_PATHS.some((path) => url.pathname.startsWith(path)));
const isPrivate = (url) => /^\/(api|merchant|tools)(\/|$)/.test(url.pathname);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (path) => {
      try { const response = await fetch(path, { cache: 'reload', credentials: 'omit' }); if (response.ok) await cache.put(path, response); } catch { /* the shell is refreshed on the next online visit */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('allowance-shell-') && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivate(url)) return;
  if (request.mode === 'navigate') {
    // Every route renders the same single-page shell; keep the latest copy for offline launches.
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) { const cache = await caches.open(CACHE); cache.put('/', response.clone()).catch(() => {}); }
        return response;
      } catch {
        return (await caches.match('/', { cacheName: CACHE })) || new Response('Allowance is offline. Reconnect to continue.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }
  if (isStatic(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request, { cacheName: CACHE });
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') { const cache = await caches.open(CACHE); cache.put(request, response.clone()).catch(() => {}); }
      return response;
    })());
  }
});
