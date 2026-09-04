"use strict";

/* ---------------- defuse: there is no worker anymore ----------------

   The pages no longer register a service worker — see CLAUDE.md, "No service worker".
   The offline shell was removed because offline kept the furniture and not the data
   (every observation, count, tile and photograph on these pages is asked of iNaturalist
   live), and a stale worker was the one bug in this repo that cannot be fixed by
   editing a file: it kept serving the old shell through any number of launches, and a
   home screen has no tab to close to coax a new worker in. Updates travel the ordinary
   route again — the browser asks for each file and takes what it is given.

   A registered worker cannot be told to leave by deleting this file: the browser would
   simply keep the last worker it fetched. So the file stays at the same address, and the
   first time a browser that still has the old worker registered checks in, it installs
   *this* worker instead, which:

   1. takes over immediately — skipWaiting, because a worker that waits for a cold start
      on a home screen can wait through any number of launches — then
   2. deletes every cache and unregisters itself.

   From then on the browser goes straight to the network on every navigation, like a
   browser that never met a worker. The page the reader is looking at is still the old
   cached one for that one launch; the next is fresh, and every launch after that.

   Do not add a fetch handler to this file. It must never answer a request: its one job
   is to leave, and a handler that caches or serves would be a way back in. Do not
   delete this file while an install of the old shell may still be out there — once
   unregistered, a browser never asks for it again, so keeping it costs nothing. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(name => caches.delete(name)));
    await self.registration.unregister();
  })());
});
