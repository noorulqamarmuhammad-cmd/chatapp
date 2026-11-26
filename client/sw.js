self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(d.title || 'Pulse', { body: d.body || '', tag: d.tag || 'pulse', renotify: true, icon: '/icon-192.png', data: d, requireInteraction: !!d.requireInteraction, vibrate: d.kind === 'call' ? [300, 150, 300, 150, 300] : [120] }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close(); const id = e.notification.data && e.notification.data.conv_id;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(w => {
    if (w.length) { w[0].postMessage({ open: id }); return w[0].focus(); }
    return clients.openWindow('/' + (id ? '?c=' + id : ''));
  }));
});
