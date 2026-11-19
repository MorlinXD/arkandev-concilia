// Desactivador: elimina cualquier service worker que otro proyecto haya dejado en este dominio
// (p. ej. localhost:3000) y que sirva archivos viejos desde su caché.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
  })());
});
