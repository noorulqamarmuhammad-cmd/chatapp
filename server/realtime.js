const jwt = require('jsonwebtoken'), D = require('./db');
const EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const KIND = { jpg: 'image', png: 'image', gif: 'image', webp: 'image', mp4: 'video', webm: 'video', weba: 'audio', m4a: 'audio', ogg: 'audio', mp3: 'audio' };

module.exports = function attach(io, db, cfg, push = { send: async () => {} }) {
  const online = new Map(), calls = new Map(), inCall = new Map(); // userId->sockets, callId->call, userId->callId
  const room = u => 'u:' + u;
  const tell = (cid, ev, p) => D.memberIds(db, cid).forEach(u => io.to(room(u)).emit(ev, p));
  const contacts = uid => db.prepare('select distinct b.user_id id from members a join members b on a.conv_id=b.conv_id where a.user_id=? and b.user_id!=?').all(uid, uid).map(r => r.id);

  // Push only if none of the user's open sockets reports a visible page (so we never double-notify).
  async function notifyAway(uid, payload, cid) {
    try {
      if (cid && db.prepare('select muted from members where conv_id=? and user_id=?').get(cid, uid)?.muted) return;
      if ((await io.in(room(uid)).fetchSockets()).some(x => x.data.visible === true)) return;
      await push.send(uid, payload);
    } catch (e) { console.error('push failed:', e.message); }
  }
  // Record receipts (1 delivered, 2 read) for a user's pending messages and tell the conversation.
  function receive(uid, state, cid = 0) {
    const rows = db.prepare(`select m.id, m.conv_id from messages m join members mb on mb.conv_id=m.conv_id and mb.user_id=@u
      left join receipts r on r.msg_id=m.id and r.user_id=@u where m.sender_id!=@u and m.deleted=0 and m.kind!='call' and coalesce(r.state,0)<@s and (@c=0 or m.conv_id=@c)`).all({ u: uid, s: state, c: cid });
    const by = {};
    for (const r of rows) {
      db.prepare('insert into receipts(msg_id,user_id,state) values(?,?,?) on conflict(msg_id,user_id) do update set state=excluded.state').run(r.id, uid, state);
      (by[r.conv_id] ??= []).push(r.id);
    }
    for (const [c, ids] of Object.entries(by))
      tell(+c, 'status', { conv_id: +c, items: ids.map(id => ({ id, status: D.hydrate(db, db.prepare('select * from messages where id=?').get(id)).status })) });
  }
  function logCall(call, text) {
    const dm = D.dmFor(db, call.from, call.to, true);
    const id = db.prepare("insert into messages(conv_id,sender_id,kind,body,created) values(?,?,'call',?,?)").run(dm.id, call.from, text, Date.now()).lastInsertRowid;
    tell(dm.id, 'message:new', D.hydrate(db, db.prepare('select * from messages where id=?').get(id)));
  }
  function endCall(id, reason) {
    const c = calls.get(id); if (!c) return;
    clearTimeout(c.timer); calls.delete(id); inCall.delete(c.from); inCall.delete(c.to);
    for (const u of [c.from, c.to]) io.to(room(u)).emit('call:ended', { callId: id, reason });
    const label = c.video ? 'video' : 'voice';
    if (reason === 'missed') logCall(c, `Missed ${label} call`);
    else if (c.answeredAt) { const s = Math.round((Date.now() - c.answeredAt) / 1000); logCall(c, `${label[0].toUpperCase() + label.slice(1)} call · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`); }
    else if (reason === 'declined') logCall(c, `Declined ${label} call`);
  }

  io.use((s, next) => {
    try { const p = jwt.verify(s.handshake.auth?.token || '', cfg.jwtSecret); s.user = db.prepare('select * from users where id=?').get(p.id); if (!s.user) throw 0; next(); }
    catch { next(new Error('unauthorized')); }
  });

  io.on('connection', s => {
    const uid = s.user.id; let hits = [];
    s.join(room(uid));
    online.set(uid, (online.get(uid) || 0) + 1);
    const friends = contacts(uid);
    friends.forEach(f => io.to(room(f)).emit('presence', { user_id: uid, online: true }));
    s.emit('presence:list', friends.filter(f => online.has(f)));
    receive(uid, 1); // everything sent while offline is now delivered
    for (const c of calls.values()) if (c.to === uid && !c.answeredAt) s.emit('call:incoming', { callId: c.id, video: c.video, from: D.publicUser(db.prepare('select * from users where id=?').get(c.from)) }); // ringing while the app was opening

    const allow = () => { const n = Date.now(); hits = hits.filter(t => n - t < 10000); if (hits.length >= cfg.msgBurst) return false; hits.push(n); return true; };
    const msgOf = id => db.prepare('select * from messages where id=?').get(id);
    const own = id => { const m = msgOf(+id); return m && m.sender_id === uid && !m.deleted && m.kind !== 'call' ? m : null; };

    s.on('vis', ({ visible } = {}) => { s.data.visible = !!visible; });
    s.on('message:send', (d, ack = () => {}) => {
      if (!allow()) return ack({ error: 'You are sending messages too fast' });
      const cid = +d?.conv_id; if (!D.isMember(db, cid, uid)) return ack({ error: 'You are not in this conversation' });
      const cv = db.prepare('select type,name from conversations where id=?').get(cid);
      if (cv.type === 'dm' && !D.areFriends(db, uid, D.memberIds(db, cid).find(u => u !== uid))) return ack({ error: 'You can only message friends' });
      const body = D.clean(d.body); let url = null, name = null, kind = 'text';
      if (d.attachment) {
        const a = d.attachment;
        if (typeof a.url !== 'string' || !/^\/uploads\/[a-f0-9]{32}\.[a-z0-9]{2,4}$/.test(a.url)) return ack({ error: 'Invalid attachment' });
        url = a.url; name = D.clean(a.name, 120); kind = KIND[url.split('.').pop()] || 'file';
      }
      if (!body && !url) return ack({ error: 'Message is empty' });
      let reply = null;
      if (d.reply_to) { reply = msgOf(+d.reply_to); if (!reply || reply.conv_id !== cid) return ack({ error: 'Reply target not found' }); }
      const id = db.prepare('insert into messages(conv_id,sender_id,kind,body,file_url,file_name,reply_to,created) values(?,?,?,?,?,?,?,?)').run(cid, uid, kind, body, url, name, reply?.id || null, Date.now()).lastInsertRowid;
      db.prepare('update members set last_read_id=? where conv_id=? and user_id=?').run(id, cid, uid);
      tell(cid, 'message:new', D.hydrate(db, msgOf(id)));
      D.memberIds(db, cid).filter(u => u !== uid && online.has(u)).forEach(u => receive(u, 1, cid));
      const label = body || ({ image: '📷 Photo', video: '🎥 Video', audio: '🎤 Voice message' }[kind] || '📎 ' + name);
      D.memberIds(db, cid).filter(u => u !== uid).forEach(u => notifyAway(u, { title: cv.type === 'group' ? `${cv.name} · ${s.user.name}` : s.user.name, body: label.slice(0, 140), conv_id: cid, kind: 'message', tag: 'c' + cid }, cid));
      ack({ ok: true, id: +id });
    });
    s.on('message:read', ({ conv_id } = {}) => {
      const cid = +conv_id; if (!D.isMember(db, cid, uid)) return;
      db.prepare('update members set last_read_id=(select coalesce(max(id),0) from messages where conv_id=?) where conv_id=? and user_id=?').run(cid, cid, uid);
      receive(uid, db.prepare('select read_receipts r from users where id=?').get(uid).r ? 2 : 1, cid);
    });
    s.on('typing', ({ conv_id, on } = {}) => {
      if (!D.isMember(db, +conv_id, uid)) return;
      D.memberIds(db, +conv_id).filter(u => u !== uid).forEach(u => io.to(room(u)).emit('typing', { conv_id: +conv_id, user_id: uid, on: !!on }));
    });
    s.on('message:edit', ({ id, body } = {}, ack = () => {}) => {
      const m = own(id), b = D.clean(body); if (!m || m.kind !== 'text' || !b) return ack({ error: 'You can only edit your own text messages' });
      db.prepare('update messages set body=?, edited=1 where id=?').run(b, m.id);
      tell(m.conv_id, 'message:update', D.hydrate(db, msgOf(m.id))); ack({ ok: true });
    });
    s.on('message:delete', ({ id } = {}, ack = () => {}) => {
      const m = own(id); if (!m) return ack({ error: 'You can only delete your own messages' });
      db.prepare('update messages set deleted=1 where id=?').run(m.id);
      tell(m.conv_id, 'message:update', D.hydrate(db, msgOf(m.id))); ack({ ok: true });
    });
    s.on('reaction', ({ id, emoji } = {}) => {
      const m = msgOf(+id); if (!m || !EMOJI.includes(emoji) || !D.isMember(db, m.conv_id, uid)) return;
      const had = db.prepare('select emoji from reactions where msg_id=? and user_id=?').get(m.id, uid);
      db.prepare('delete from reactions where msg_id=? and user_id=?').run(m.id, uid);
      if (had?.emoji !== emoji) db.prepare('insert into reactions values(?,?,?)').run(m.id, uid, emoji);
      tell(m.conv_id, 'message:update', D.hydrate(db, m));
    });

    // ---- call signaling: invite -> ring -> accept/decline -> SDP/ICE relay -> end ----
    s.on('call:invite', ({ to, video } = {}, ack = () => {}) => {
      to = +to; if (!to || to === uid || !db.prepare('select 1 from users where id=?').get(to)) return ack({ error: 'Unknown user' });
      if (!D.areFriends(db, uid, to)) return ack({ error: 'You can only call friends' });
      if (inCall.has(uid)) return ack({ error: 'You are already in a call' });
      if (!online.has(to)) { logCall({ from: uid, to, video }, `Missed ${video ? 'video' : 'voice'} call`); notifyAway(to, { title: 'Missed call', body: `${s.user.name} tried to ${video ? 'video ' : ''}call you`, kind: 'message', tag: 'call' }); return ack({ error: 'They are offline right now' }); }
      if (inCall.has(to)) return ack({ error: 'They are on another call' });
      const callId = require('crypto').randomUUID();
      const call = { id: callId, from: uid, to, video: !!video, timer: setTimeout(() => endCall(callId, 'missed'), cfg.ringMs) };
      calls.set(callId, call); inCall.set(uid, callId); inCall.set(to, callId);
      io.to(room(to)).emit('call:incoming', { callId, video: call.video, from: D.publicUser(s.user) });
      notifyAway(to, { title: `${s.user.name} is calling`, body: call.video ? 'Video call' : 'Voice call', kind: 'call', tag: 'call', requireInteraction: true });
      ack({ ok: true, callId });
    });
    const mine = id => { const c = calls.get(id); return c && (c.from === uid || c.to === uid) ? c : null; };
    s.on('call:accept', ({ callId } = {}) => {
      const c = mine(callId); if (!c || c.to !== uid || c.answeredAt) return;
      clearTimeout(c.timer); c.answeredAt = Date.now(); io.to(room(c.from)).emit('call:accepted', { callId });
    });
    s.on('call:decline', ({ callId } = {}) => { const c = mine(callId); if (c && c.to === uid && !c.answeredAt) endCall(callId, 'declined'); });
    s.on('call:signal', ({ callId, data } = {}) => { const c = mine(callId); if (c) io.to(room(c.from === uid ? c.to : c.from)).emit('call:signal', { callId, data }); });
    s.on('call:end', ({ callId } = {}) => { const c = mine(callId); if (c) endCall(callId, c.answeredAt ? 'ended' : c.from === uid ? 'cancelled' : 'declined'); });

    s.on('disconnect', () => {
      const n = (online.get(uid) || 1) - 1;
      if (n > 0) return online.set(uid, n);
      online.delete(uid);
      if (inCall.has(uid)) endCall(inCall.get(uid), 'ended');
      contacts(uid).forEach(f => io.to(room(f)).emit('presence', { user_id: uid, online: false }));
    });
  });
  return { notifyAway };
};
