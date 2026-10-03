/* Grid Call service worker.
   Pushes arrive with no payload, so we ask the server what to say. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let msg = { title: "Grid Call", body: "Something has changed.", tag: "general" };
    try {
      const res = await fetch("/api/push/pending", { credentials: "include" });
      if (res.ok) msg = await res.json();
    } catch (e) { /* offline: fall back to the generic text */ }
    await self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag,
      renotify: false,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: "/" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes(self.location.origin)) return c.focus();
    }
    return self.clients.openWindow("/");
  })());
});
