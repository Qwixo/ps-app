// G Squad (the mobile web app at /todolist-mobile/): keeps the app itself on the phone so it opens offline.
// It never caches API traffic: your list is kept separately, encrypted, by the app (the same as the website).
// scripts/postbuild.mjs fills in the cache name (this build's fingerprint) and the files this build needs, so an
// update arrives as a new cache and the old one is deleted.
const CACHE = "__PSM_CACHE__";
const FILES = __PSM_FILES__;
const SHELL = "/todolist-mobile/";

self.addEventListener("install", (e) => {
  // Everything up front, so even a screen never opened online works offline later. One failed file does not stop it.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(FILES.map((f) => c.add(new Request(f, { cache: "reload" })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("psm-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;   // Supabase and anything else: straight through
  if (req.mode === "navigate") {
    if (!url.pathname.startsWith(SHELL)) return;
    // Network first so updates arrive; the saved page when offline (every path here is the same app).
    e.respondWith(fetch(req).then((r) => {
      if (r.ok && (r.headers.get("content-type") || "").startsWith("text/html")) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(SHELL, copy)); }
      return r;
    }).catch(() => caches.match(SHELL, { ignoreSearch: true })));
    return;
  }
  // The app's hashed files never change: from the cache first. Its icons and manifest too.
  if (url.pathname.startsWith("/client/assets/") || (url.pathname.startsWith(SHELL) && !url.pathname.endsWith("/sw.js"))) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok && url.pathname.startsWith("/client/assets/")) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return r;
    })));
  }
});
