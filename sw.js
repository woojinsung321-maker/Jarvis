// JARVIS service worker.
// - Makes the app installable and lets the app shell open offline.
// - Network-first for the app's own files, so updates always arrive when online.
// - Never touches /api/ requests: login, chat data and cookies are never cached.
// If you add or rename files in SHELL, change the CACHE version number.

const CACHE = "jarvis-shell-v4";
const SHELL = [
  "/",
  "/theme.css",
  "/styles.css",
  "/login.css",
  "/app.js",
  "/auth.js",
  "/config.js",
  "/backend.js",
  "/chat-ui.js",
  "/dialogs.js",
  "/history-ui.js",
  "/memory-ui.js",
  "/panels.css",
  "/voice.js",
  "/voice-ui.js",
  "/voice.css",
  "/pwa.js",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("/") : undefined))
      )
  );
});
