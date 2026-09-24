/*
 * TrackMyRMC legacy service-worker retirement shim.
 *
 * Older web builds may have registered a worker at /service-worker.js, /sw.js,
 * or /expo-service-worker.js. The current Expo web app does not rely on an
 * offline worker, so this script replaces those legacy workers, clears their
 * Cache Storage entries, unregisters itself, and reloads controlled windows
 * once so the current Cloud Run shell is used immediately.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch (_) {
        // Cache cleanup is best-effort; unregister must still proceed.
      }

      try {
        await self.registration.unregister();
      } catch (_) {
        // A failed unregister should not prevent clients from refreshing.
      }

      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      await Promise.all(
        windows.map((client) => {
          if ("navigate" in client && client.url) {
            return client.navigate(client.url).catch(() => undefined);
          }
          return undefined;
        })
      );
    })()
  );
});
