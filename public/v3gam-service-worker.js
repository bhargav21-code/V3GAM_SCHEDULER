/* V3GAM PWA worker: only caches the static offline notice, never app data or API responses. */
'use strict';

const V3GAM_CACHE = 'v3gam-pwa-shell-v1';
const V3GAM_OFFLINE_URL = '/v3gam-offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(V3GAM_CACHE)
      .then((cache) => cache.add(V3GAM_OFFLINE_URL))
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'V3GAM_SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('v3gam-pwa-') && key !== V3GAM_CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__hatchable/')) return;

  event.respondWith(
    fetch(request).catch(async () => {
      const fallback = await caches.match(V3GAM_OFFLINE_URL);
      return fallback || new Response(
        '<!doctype html><meta charset="utf-8"><title>V3GAM offline</title><p>Connect to the internet to use V3GAM.</p>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    })
  );
});