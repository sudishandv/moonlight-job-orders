self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil((async () => {
    // Safari requires every push to show a notification, so always show one.
    await self.registration.showNotification(data.title || "Moonlight Concept", {
      body: data.body || "", tag: data.tag || "activity", renotify: true,
      icon: "/icon-192.png", badge: "/icon-192.png", data: { url: data.url || "/" },
    });
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    wins.forEach((c) => c.postMessage({ type: "push", body: data.body || "" }));
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.length) return wins[0].focus();
    return self.clients.openWindow((event.notification.data && event.notification.data.url) || "/");
  })());
});
