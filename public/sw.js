// VibeCheck Service Worker — Cache-first strategy
const CACHE_VERSION = "vibecheck-v2";
const CACHE_NAME = `vibecheck-cache-${CACHE_VERSION}`;

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

// Install: pre-cache the app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch(() => {
        // Non-critical: some assets may not be cacheable yet
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: cache-first for app shell, network-first for API
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Bypass service worker for API calls — always go network
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")) {
    return;
  }

  // Cache-first for navigation + static assets
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Return cached, but update cache in background
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, response.clone());
            });
          }
          return response;
        }).catch(() => {});
        return cached;
      }

      // Not in cache — fetch from network and cache
      return fetch(event.request).then((response) => {
        if (!response.ok) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clone);
        });
        return response;
      }).catch(() => {
        // Offline fallback: return a simple page
        if (event.request.mode === "navigate") {
          return caches.match("/index.html");
        }
        return new Response("Offline", { status: 503 });
      });
    })
  );
});
