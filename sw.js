const CACHE_VERSION = "controle-financeiro-v4.0.0";
const APP_ROOT = new URL("./", self.registration.scope);
const INDEX_URL = new URL("./index.html", APP_ROOT).href;
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./js/app.js",
  "./js/utils.js",
  "./js/calculations.js",
  "./js/funding.js",
  "./js/database.js",
  "./js/recurring.js",
  "./js/charts.js",
  "./js/export.js",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg"
].map((path) => new URL(path, APP_ROOT).href);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("controle-financeiro-") && key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

function isBackupRequest(url) {
  return /controle-financeiro-backup|\.json$/i.test(url.pathname) && !url.pathname.endsWith("/manifest.json");
}

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(INDEX_URL, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(INDEX_URL)) || Response.error();
  }
}

async function assetResponse(request) {
  const cached = await caches.match(request);
  const network = fetch(request).then(async (response) => {
    if (response.ok && response.type === "basic") {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isBackupRequest(url)) return;
  if (request.mode === "navigate") event.respondWith(navigationResponse(request));
  else event.respondWith(assetResponse(request));
});
