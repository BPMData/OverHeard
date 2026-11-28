// OverHeard service worker: makes the app installable and lets it run offline.
//
// - The app shell (index.html, every built JS/CSS chunk, icons) is saved at install, so the
//   whole app opens offline after one online visit, not only the screens already opened.
//   `npm run build` fills in the file lists and hashes below; in development they stay empty.
// - Pages are network-first so deploys show up immediately, but give up after a few seconds
//   on a weak connection and open the saved copy instead.
// - The Piper voice runtimes (/ort/, /piper/, ~40 MB) and Google Fonts are saved the first
//   time they're used: on the first read-aloud, or when a teacher clicks "Save offline" on a
//   voice in Settings. Student room links never download them at install.
// - The on-device translation engine (/bergamot/, ~5 MB) is saved the same way, the first time a
//   translation model loads. The models themselves live in their own cache,
//   written by the page, which every deploy keeps.
// - API calls are never cached.
const BUILD = { version: 'dev', precache: [], runtimes: {} };
const SHELL_CACHE = `overheard-shell-${BUILD.version}`;
const RUNTIME_CACHE = 'overheard-runtime-v1';
const NAVIGATION_TIMEOUT_MS = 3000;

// Keep each engine file under its content hash. Different workers can finish requests
// concurrently without overwriting the bytes needed by the next release.
function runtimeRequest(pathname) {
  const integrity = BUILD.runtimes[pathname];
  const url = new URL(pathname, self.location.origin);
  url.searchParams.set('revision', integrity);
  return new Request(url, { integrity, cache: 'reload' });
}

async function install() {
  const shell = await caches.open(SHELL_CACHE);
  await shell.addAll(BUILD.precache.map((url) => new Request(url, { cache: 'reload' })));
  // Refresh only engines this device has used. This also migrates unversioned
  // entries from older installations and keeps downloaded engines usable offline.
  const runtime = await caches.open(RUNTIME_CACHE);
  const used = new Set((await runtime.keys()).map((key) => new URL(key.url).pathname));
  const updates = [];
  for (const pathname of Object.keys(BUILD.runtimes)) {
    const request = runtimeRequest(pathname);
    if (used.has(pathname) && !(await runtime.match(request))) updates.push(request);
  }
  await runtime.addAll(updates);
  await self.skipWaiting();
}

self.addEventListener('install', (event) => event.waitUntil(install()));

async function activate() {
  const runtime = await caches.open(RUNTIME_CACHE);
  for (const request of await runtime.keys()) {
    const url = new URL(request.url);
    if (
      url.origin === self.location.origin &&
      isEnginePath(url.pathname) &&
      (!BUILD.runtimes[url.pathname] || request.url !== runtimeRequest(url.pathname).url)
    ) {
      await runtime.delete(request);
    }
  }
  const obsolete = (await caches.keys()).filter((key) => key.startsWith('overheard-shell-') && key !== SHELL_CACHE);
  await Promise.all(obsolete.map((key) => caches.delete(key)));
  await self.clients.claim();
}

self.addEventListener('activate', (event) => event.waitUntil(activate()));

const isFontRequest = (url) =>
  url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com';

const isEnginePath = (path) => path.startsWith('/ort/') || path.startsWith('/piper/') || path.startsWith('/bergamot/');

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
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.status !== 206) await cache.put(request, res.clone()).catch(() => {});
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
      url.origin === 'https://fonts.googleapis.com' ? staleWhileRevalidate(request) : cacheFirst(request, RUNTIME_CACHE)
    );
    return;
  }

  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (isEnginePath(url.pathname)) {
    if (BUILD.runtimes[url.pathname]) event.respondWith(cacheFirst(runtimeRequest(url.pathname), RUNTIME_CACHE));
    return;
  }

  if (request.mode === 'navigate' && !url.pathname.startsWith('/icons/')) {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(cacheFirst(request, SHELL_CACHE));
});
