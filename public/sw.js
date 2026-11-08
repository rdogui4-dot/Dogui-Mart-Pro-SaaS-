// Service worker : shell applicatif en cache (réseau d'abord pour les pages, cache en secours). Appwrite n'est jamais mis en cache.
// Les adresses sont relatives à la portée du service worker : l'application peut vivre à la racine ou sous un sous-chemin (GitHub Pages).
const CACHE = "dmp-shell-v2";
const BASE = self.registration.scope; // ex. https://compte.github.io/depot/
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll([BASE, BASE + "manifest.webmanifest", BASE + "icon.svg"]))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match(BASE))));
});
