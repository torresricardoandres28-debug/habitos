const CACHE = "habitos-v4";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./app.js", "./config.js", "./icon.svg", "./icon-192.png", "./icon-512.png", "./icon-180.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)).catch(() => {}); return r; })
      .catch(() => caches.match(e.request).then(m => m || caches.match("./index.html")))
  );
});
