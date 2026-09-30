/* Public shell only. API/merchant/tool requests, transfers, downloads and video
 * streams always bypass this worker. A first install includes the shell's real
 * JS/CSS/font dependencies; mutable artwork is refreshed whenever online. */
const CACHE = 'allowance-shell-v2';
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const ICONS = [
  '/site.webmanifest?v=3',
  '/allowance-icon-192.png?v=3',
  '/allowance-icon-512.png?v=3',
  '/allowance-icon-maskable-512.png?v=1',
  '/allowance-a.svg?v=3',
  '/favicon-red.svg?v=3',
  '/favicon-32.png?v=3',
  '/apple-touch-icon.png?v=3',
];
const STATIC_PATHS = ['/assets/', '/fonts/', '/media/', '/brand/'];
const STATIC_FILES = new Set([
  ...ICONS.map((path) => new URL(path, self.location.origin).pathname),
  '/favicon.svg',
  '/favicon-red.svg',
  '/favicon-32.png',
  '/apple-touch-icon.png',
  '/allowance-a.svg',
  '/allowance-symbol.svg',
  '/allowance-wordmark.svg',
]);
const isPrivate = (url) => /^\/(api|merchant|tools)(\/|$)/.test(url.pathname);
const isLarge = (url) => /\.(?:mp4|webm|mov|zip|pdf)$/i.test(url.pathname);
const isImmutable = (url) =>
  /^\/assets\/[^/]+-[\w-]{8,}\.(?:js|css|woff2?|ttf|otf)$/.test(url.pathname);
const isStatic = (url) =>
  STATIC_FILES.has(url.pathname) || STATIC_PATHS.some((path) => url.pathname.startsWith(path));
const isHtml = (response) => (response.headers.get('content-type') || '').includes('text/html');
const canStore = (response) =>
  response.status === 200 &&
  response.type === 'basic' &&
  !/no-store/i.test(response.headers.get('cache-control') || '');

// Browser module/font requests carry Origin while worker precache fetches do
// not. Some static servers emit Vary: Origin for CORS headers despite serving
// the same public file. Only that variation is safe to relax, and only for
// this app's own origin. Never ignore language, authorization or other variants.
async function matchPublicAsset(cache, request) {
  const exact = await cache.match(request);
  if (exact) return exact;
  const origin = request.headers.get('origin');
  if (origin && origin !== self.location.origin) return undefined;
  const candidate = await cache.match(request, { ignoreVary: true });
  const vary = candidate?.headers
    .get('vary')
    ?.split(',')
    .map((name) => name.trim().toLowerCase());
  return vary?.length && vary.every((name) => name === 'origin') ? candidate : undefined;
}

async function storeAsset(cache, request, response, shellDependency = false) {
  if (!canStore(response)) {
    if (shellDependency) throw new Error('Shell dependency cannot be cached');
    return;
  }
  const length = response.headers.get('content-length');
  // Do not buffer arbitrary large artwork. The app's hashed bundles and explicit
  // shell dependencies are trusted local build outputs and may be compressed.
  if (Number(length) > MAX_ASSET_BYTES) {
    if (shellDependency) throw new Error('Shell dependency exceeds offline cache budget');
    return;
  }
  if (!length && !shellDependency) return;
  await cache.put(request, response.clone());
}

async function cacheShell(cache, response) {
  if (!canStore(response) || !isHtml(response)) return;
  const html = await response.clone().text();
  const previous = await cache.match('/');
  if (previous && (await previous.text()) === html) return;
  const dependencies = new Set();
  for (const match of html.matchAll(
    /<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["'][^>]*>/gi
  )) {
    const url = new URL(match[1], self.location.origin);
    if (url.origin === self.location.origin && isImmutable(url)) dependencies.add(url.href);
  }
  // Commit HTML only after its dependencies: an update must not replace a
  // working offline document with one whose new bundle has never been fetched.
  await Promise.all(
    [...dependencies].map(async (url) => {
      const asset =
        (await cache.match(url)) || (await fetch(url, { cache: 'reload', credentials: 'omit' }));
      if (!asset.ok) throw new Error('Shell dependency unavailable');
      await storeAsset(cache, url, asset, true);
      if (new URL(url).pathname.endsWith('.css')) {
        const css = await asset.text();
        const fonts = new Set();
        for (const match of css.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi)) {
          const font = new URL(match[1], url);
          if (
            font.origin === self.location.origin &&
            /^\/fonts\/.+\.(?:woff2?|ttf|otf)$/.test(font.pathname)
          )
            fonts.add(font.href);
        }
        await Promise.all(
          [...fonts].map(async (font) => {
            const response = await fetch(font, { cache: 'reload', credentials: 'omit' });
            if (!response.ok) throw new Error('Shell font unavailable');
            await storeAsset(cache, font, response, true);
          })
        );
      }
    })
  );
  await cache.put('/', response);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const response = await fetch('/', { cache: 'reload', credentials: 'omit' });
      if (!canStore(response) || !isHtml(response)) throw new Error('App shell unavailable');
      await cacheShell(cache, response);
      await Promise.allSettled(
        ICONS.map(async (path) => {
          const response = await fetch(path, { cache: 'reload', credentials: 'omit' });
          await storeAsset(cache, path, response, true);
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('allowance-shell-') && key !== CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivate(url) || isLarge(url)) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (canStore(response) && isHtml(response)) {
            // Clone before handing the network body to the browser. Cache open
            // is asynchronous and the browser may consume the original meanwhile.
            const shell = response.clone();
            event.waitUntil(
              caches
                .open(CACHE)
                .then((cache) => cacheShell(cache, shell))
                .catch(() => {})
            );
          }
          return response;
        } catch {
          return (
            (await caches.match('/', { cacheName: CACHE })) ||
            new Response('Allowance is offline. Reconnect to continue.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          );
        }
      })()
    );
    return;
  }
  if (!isStatic(url)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (isImmutable(url)) {
        const cached = await matchPublicAsset(cache, request);
        if (cached) return cached;
      }
      try {
        const response = await fetch(request, { cache: 'no-cache' });
        event.waitUntil(storeAsset(cache, request, response, isImmutable(url)).catch(() => {}));
        return response;
      } catch (error) {
        const cached = await matchPublicAsset(cache, request);
        if (cached) return cached;
        throw error;
      }
    })()
  );
});
