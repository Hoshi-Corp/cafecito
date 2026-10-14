// Shows a push message and opens the app when it is tapped.
// shortcut: no caching, so the app does not work offline; add a fetch handler only if that becomes a goal.
self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data?.json() ?? {};
  } catch {} // a body that is not JSON still shows a notification, with the default text
  const { title = "Cafecito", body = "" } = message;
  event.waitUntil(self.registration.showNotification(title, { body, icon: "/icon-192.png" }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((open) => (open[0] ? open[0].focus() : clients.openWindow("/"))),
  );
});
