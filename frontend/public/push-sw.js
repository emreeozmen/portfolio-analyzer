// Plain JS, not compiled — injected into the Workbox-generated service worker via
// vite.config.ts's `workbox.importScripts`. Handles the two events a Web Push
// subscription needs: showing a notification when a push arrives, and focusing/
// opening the app when the user clicks it. See backend/services/push_service.py for
// what gets sent (title/body/url) and frontend/src/lib/push.ts for how the
// subscription itself gets created.

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  const title = payload.title || 'Portföy Analiz'
  const options = {
    body: payload.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { url: payload.url || '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    }),
  )
})
