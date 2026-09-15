const CACHE = 'incassaprima-v2';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './privacy.html',
  './manifest.webmanifest',
  './app/',
  './app/index.html',
  './app/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== 'GET' ||
    url.protocol !== 'http:' && url.protocol !== 'https:' ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((response) => {
          if (!response || !response.ok) {
            return response;
          }

          const responseCopy = response.clone();

          caches.open(CACHE).then((cache) => {
            cache.put(request, responseCopy);
          });

          return response;
        })
        .catch(() => caches.match('./app/index.html'));
    })
  );
});
