// Shows a push message and opens the app when it is tapped. No caching: the app is not offline-capable.
self.addEventListener("push", (event) => {
  const { title = "Cafecito", body = "" } = event.data?.json() ?? {};
  event.waitUntil(self.registration.showNotification(title, { body, icon: "/favicon.ico" }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((open) => (open[0] ? open[0].focus() : clients.openWindow("/"))),
  );
});
