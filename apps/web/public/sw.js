// Web Push for thread notifications. No fetch handler: this worker never intercepts requests.
// The server builds the payload in apps/server/src/webPush/WebPushNotifier.ts.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === "string" ? payload.title : "K-code";
  // WebKit revokes push permission when a push shows no notification, even while the app is focused.
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof payload.body === "string" ? payload.body : "",
      tag: typeof payload.tag === "string" ? payload.tag : undefined,
      icon: "/apple-touch-icon.png",
      data: {
        url: typeof payload.url === "string" ? payload.url : "/",
        environmentId: payload.environmentId,
        threadId: payload.threadId,
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data ?? {};
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = windows[0];
      if (client) {
        await client.focus();
        const message = {
          type: "t3code:open-thread",
          environmentId: data.environmentId,
          threadId: data.threadId,
        };
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Client.postMessage has no targetOrigin.
        client.postMessage(message);
        return;
      }
      await self.clients.openWindow(typeof data.url === "string" ? data.url : "/");
    })(),
  );
});
