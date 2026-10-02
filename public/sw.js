const CACHE = "tmm-offline-shell-v1";
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add("/offline-capture")));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("tmm-offline-shell-") && key !== CACHE).map(key => caches.delete(key))))]));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  // API, login, and personalised operations responses must never enter the offline cache.
  if (url.pathname === "/offline-capture" && event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put("/offline-capture", copy))); }
      return response;
    }).catch(() => caches.match("/offline-capture")));
  } else if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/assets/") || ["/sindane-logo.png", "/manifest.webmanifest"].includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
      return response;
    })));
  }
});
