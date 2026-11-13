// Cincee Vault service worker: keeps the app itself available offline.
// It never caches API traffic; your data is cached separately, encrypted, by the app.
// v2 (31 Oct 2026): v1 could keep a download (PS.dmg, the download page) as the shell; a new name clears it.
const CACHE = "cincee-vault-shell-v2";
const SHELL = ["/client/", "/client/manifest.webmanifest", "/client/icon.svg", "/client/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith("/client/")) return;
  // The app downloads and their pages (PS.dmg, install.sh, the APK) are not the vault: never cached.
  if (url.pathname.startsWith("/client/ps/") || url.pathname.startsWith("/client/gos/")) return;
  // The build prompt page is its own page: never cached, and never kept as the vault's shell.
  if (url.pathname.startsWith("/client/build/")) return;
  if (e.request.mode === "navigate") {
    // Network first so updates arrive; fall back to the cached shell when offline.
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok && (r.headers.get("content-type") || "").startsWith("text/html")) {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put("/client/", copy));
      }
      return r;
    }).catch(() => caches.match("/client/")));
    return;
  }
  if (url.pathname.startsWith("/client/assets/")) {
    // Hashed, immutable files: cache first.
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    })));
  }
});
