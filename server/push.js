const webpush = require('web-push');
// Web Push (works when the browser/tab is closed). Needs VAPID keys: run `npm run vapid`.
module.exports = function createPush(db, cfg) {
  const enabled = !!(cfg.vapidPublic && cfg.vapidPrivate);
  if (enabled) webpush.setVapidDetails(cfg.vapidSubject, cfg.vapidPublic, cfg.vapidPrivate);
  async function send(uid, payload) {
    if (!enabled) return;
    for (const s of db.prepare('select * from push_subs where user_id=?').all(uid)) {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: payload.kind === 'call' ? 30 : 86400, urgency: 'high' }); }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) db.prepare('delete from push_subs where endpoint=?').run(s.endpoint); }
    }
  }
  return { enabled, key: cfg.vapidPublic, send };
};
