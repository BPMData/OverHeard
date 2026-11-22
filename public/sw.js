// OverHeard service worker: makes the app installable and lets it run offline.
//
// - The app shell (index.html, every built JS/CSS chunk, icons) is saved at install, so the
//   whole app opens offline after one online visit, not only the screens already opened.
//   `npm run build` fills in PRECACHE and SHELL_VERSION below; in development they stay empty.
// - Pages are network-first so deploys show up immediately, but give up after a few seconds
//   on a weak connection and open the saved copy instead.
// - The Piper voice runtimes (/ort/, /piper/, ~40 MB) and Google Fonts are saved the first
//   time they're used: on the first read-aloud, or when a teacher clicks "Save offline" on a
//   voice in Settings. Student room links never download them at install.
// - The on-device translation engine (/bergamot/, ~5 MB) is saved the same way, the first time a
//   translation model loads. The models themselves live in their own cache (BERGAMOT_CACHE),
//   written by the page, which every deploy keeps.
// - API calls are never cached.
const PRECACHE = [];
const SHELL_VERSION = 'dev';
const SHELL_CACHE = `overheard-shell-${SHELL_VERSION}`;
const RUNTIME_CACHE = 'overheard-runtime-v1';
const BERGAMOT_CACHE = 'overheard-bergamot-v1';
const NAVIGATION_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE && k !== BERGAMOT_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

const isFontRequest = (url) =>
  url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com';

const isRuntimeAsset = (url) =>
  url.pathname.startsWith('/ort/') ||
  url.pathname.startsWith('/piper/') ||
  url.pathname.startsWith('/bergamot/') ||
  url.pathname.startsWith('/icons/');

/** Network-first, but a school Wi-Fi that hangs shouldn't block opening the app. */
async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  const network = fetch(request, { cache: 'no-cache' }).then((res) => {
    // Every client route serves the same index.html, so keep one copy under '/'
    if (res.ok) void cache.put('/', res.clone());
    return res;
  });
  try {
    return await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAVIGATION_TIMEOUT_MS)),
    ]);
  } catch {
    const saved = (await cache.match('/')) || (await cache.match('/index.html'));
    if (saved) return saved;
    return network; // Nothing saved yet: keep waiting for the network
  }
}

async function cacheFirst(request, cacheName) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    const copy = res.clone();
    void caches.open(cacheName).then((c) => c.put(request, copy));
  }
  return res;
}

// Font CSS can change (new glyph subsets), so serve the saved copy and refresh it behind.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((res) => {
      if (res.ok) void cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (isFontRequest(url)) {
    event.respondWith(
      url.origin === 'https://fonts.googleapis.com'
        ? staleWhileRevalidate(request)
        : cacheFirst(request, RUNTIME_CACHE),
    );
    return;
  }

  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate' && !isRuntimeAsset(url)) {
    event.respondWith(handleNavigation(request));
    return;
  }

  // Hashed build assets come from the install-time copy; anything else same-origin
  // (voice runtimes, icons, assets from a newer deploy) is saved the first time it's used.
  event.respondWith(cacheFirst(request, isRuntimeAsset(url) ? RUNTIME_CACHE : SHELL_CACHE));
});

