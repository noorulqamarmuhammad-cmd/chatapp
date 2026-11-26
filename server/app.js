const express = require('express'), http = require('http'), path = require('path'), fs = require('fs'), crypto = require('crypto');
const helmet = require('helmet'), rateLimit = require('express-rate-limit'), multer = require('multer');
const bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), { Server } = require('socket.io');
const D = require('./db'), attach = require('./realtime'), createPush = require('./push'), baseCfg = require('./config');

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'application/pdf': 'pdf', 'text/plain': 'txt', 'audio/webm': 'weba', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3' };
const base = m => String(m).split(';')[0].trim().toLowerCase();
const fail = (c, m) => Object.assign(new Error(m), { status: c });

function createApp(over = {}) {
  const cfg = { ...baseCfg, ...over };
  const db = D.openDb(cfg.dbFile);
  fs.mkdirSync(cfg.uploadDir, { recursive: true });
  const app = express(), server = http.createServer(app), io = new Server(server);
  const push = createPush(db, cfg), rt = attach(io, db, cfg, push);

  app.use(helmet({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], mediaSrc: ["'self'", 'blob:'], connectSrc: ["'self'", 'ws:', 'wss:'], scriptSrc: ["'self'"], styleSrc: ["'self'"] } } }));
  app.use(express.json({ limit: '20kb' }));
  app.use(express.static(path.join(__dirname, '../client')));
  app.use('/uploads', express.static(path.resolve(cfg.uploadDir), { setHeaders: r => r.setHeader('X-Content-Type-Options', 'nosniff') }));

  const authLimit = rateLimit({ windowMs: 15 * 60e3, limit: cfg.authMax, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again later.' } });
  const api = express.Router();
  api.use(rateLimit({ windowMs: 60e3, limit: 300, legacyHeaders: false, message: { error: 'Too many requests.' } }));

  const meOf = id => { const u = db.prepare('select * from users where id=?').get(id); return { ...D.publicUser(u), read_receipts: !!u.read_receipts }; };
  const session = id => ({ token: jwt.sign({ id }, cfg.jwtSecret, { expiresIn: '7d' }), user: meOf(id) });
  const auth = (req, res, next) => {
    try { const p = jwt.verify((req.headers.authorization || '').slice(7), cfg.jwtSecret); req.user = db.prepare('select * from users where id=?').get(p.id); if (!req.user) throw 0; next(); }
    catch { res.status(401).json({ error: 'Please sign in' }); }
  };
  const upload = multer({
    storage: multer.diskStorage({ destination: cfg.uploadDir, filename: (r, f, cb) => cb(null, crypto.randomBytes(16).toString('hex') + '.' + TYPES[base(f.mimetype)]) }),
    limits: { fileSize: cfg.maxUploadMb * 1048576 },
    fileFilter: (r, f, cb) => TYPES[base(f.mimetype)] ? cb(null, true) : cb(fail(415, 'That file type is not allowed')),
  });
  const kindOf = mime => mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'file';

  api.post('/auth/signup', authLimit, (req, res) => {
    const { username, name, password } = req.body || {}, un = String(username || '').toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(un)) throw fail(400, 'Username must be 3–20 letters, numbers or underscores');
    if (String(password || '').length < 8) throw fail(400, 'Password must be at least 8 characters');
    if (db.prepare('select 1 from users where username=?').get(un)) throw fail(409, 'That username is taken');
    const id = db.prepare('insert into users(username,name,pass_hash,created) values(?,?,?,?)').run(un, D.clean(name, 40) || un, bcrypt.hashSync(String(password), cfg.bcryptRounds), Date.now()).lastInsertRowid;
    res.status(201).json(session(+id));
  });
  api.post('/auth/login', authLimit, (req, res) => {
    const { username, password } = req.body || {};
    const u = db.prepare('select * from users where username=?').get(String(username || '').toLowerCase());
    if (!u || !bcrypt.compareSync(String(password || ''), u.pass_hash)) throw fail(401, 'Wrong username or password');
    res.json(session(u.id));
  });
  api.get('/me', auth, (req, res) => res.json(meOf(req.user.id)));
  api.patch('/me', auth, (req, res) => {
    const b = req.body || {}, u = req.user;
    db.prepare('update users set name=?, status=?, read_receipts=? where id=?').run(D.clean(b.name, 40) || u.name, b.status === undefined ? u.status : D.clean(b.status, 120), b.read_receipts === undefined ? u.read_receipts : +!!b.read_receipts, u.id);
    res.json(meOf(u.id));
  });
  api.post('/me/avatar', auth, upload.single('file'), (req, res) => {
    if (!req.file || !req.file.mimetype.startsWith('image/')) throw fail(400, 'Choose an image');
    db.prepare('update users set avatar=? where id=?').run('/uploads/' + req.file.filename, req.user.id);
    res.json(meOf(req.user.id));
  });
  api.get('/users', auth, (req, res) => {
    const q = '%' + D.clean(req.query.q, 40).replace(/[\\%_]/g, '\\$&') + '%';
    res.json(db.prepare("select * from users where id!=? and (username like ? escape '\\' or name like ? escape '\\') limit 20").all(req.user.id, q, q).map(u => ({ ...D.publicUser(u), relation: D.friendState(db, req.user.id, u.id) })));
  });
  api.get('/conversations', auth, (req, res) => {
    const ids = db.prepare('select conv_id from members where user_id=?').all(req.user.id).map(r => r.conv_id);
    res.json(ids.map(id => D.convView(db, id, req.user.id)));
  });
  api.post('/conversations', auth, (req, res) => {
    const { userId, userIds, name } = req.body || {}, me = req.user.id;
    let cid;
    if (userId) {
      if (+userId === me || !db.prepare('select 1 from users where id=?').get(+userId)) throw fail(400, 'Unknown user');
      if (!D.areFriends(db, me, +userId)) throw fail(403, 'You can only chat with friends. Send a friend request first.');
      cid = D.dmFor(db, me, +userId, true).id;
    } else {
      const ids = [...new Set((userIds || []).map(Number))].filter(i => i !== me && D.areFriends(db, me, i));
      if (!D.clean(name, 40) || !ids.length) throw fail(400, 'Add a group name and at least one friend');
      cid = +db.prepare("insert into conversations(type,name,created_by,created) values('group',?,?,?)").run(D.clean(name, 40), me, Date.now()).lastInsertRowid;
      for (const u of [me, ...ids]) db.prepare('insert into members(conv_id,user_id) values(?,?)').run(cid, u);
    }
    for (const u of D.memberIds(db, cid)) io.to('u:' + u).emit('conv:new', D.convView(db, cid, u));
    res.status(201).json(D.convView(db, cid, me));
  });
  api.patch('/conversations/:id', auth, (req, res) => {
    const id = +req.params.id; if (!D.isMember(db, id, req.user.id)) throw fail(404, 'Not found');
    for (const k of ['muted', 'pinned']) if (req.body?.[k] !== undefined) db.prepare(`update members set ${k}=? where conv_id=? and user_id=?`).run(+!!req.body[k], id, req.user.id);
    res.json(D.convView(db, id, req.user.id));
  });
  api.get('/conversations/:id/messages', auth, (req, res) => {
    const id = +req.params.id; if (!D.isMember(db, id, req.user.id)) throw fail(404, 'Not found');
    const before = +req.query.before || 9e15;
    res.json(db.prepare('select * from messages where conv_id=? and id<? order by id desc limit 50').all(id, before).reverse().map(m => D.hydrate(db, m)));
  });
  api.get('/search', auth, (req, res) => {
    const q = '%' + D.clean(req.query.q, 60).replace(/[\\%_]/g, '\\$&') + '%';
    res.json(db.prepare(`select m.* from messages m join members mb on mb.conv_id=m.conv_id and mb.user_id=? where m.deleted=0 and m.kind='text' and m.body like ? escape '\\' order by m.id desc limit 30`).all(req.user.id, q).map(m => D.hydrate(db, m)));
  });
  api.post('/upload', auth, upload.single('file'), (req, res) => {
    if (!req.file) throw fail(400, 'No file received');
    res.json({ url: '/uploads/' + req.file.filename, kind: kindOf(req.file.mimetype), name: D.clean(req.file.originalname, 120) });
  });
  // ---- friends ----
  const fview = id => D.publicUser(db.prepare('select * from users where id=?').get(id));
  const ping = (u, type, from) => io.to('u:' + u).emit('friend:update', { type, from: fview(from) });
  api.get('/friends', auth, (req, res) => {
    const me = req.user.id, out = { friends: [], incoming: [], outgoing: [] };
    for (const r of db.prepare('select * from friendships where a=? or b=?').all(me, me)) (r.status === 'accepted' ? out.friends : r.requester === me ? out.outgoing : out.incoming).push(fview(r.a === me ? r.b : r.a));
    res.json(out);
  });
  api.post('/friends/request', auth, (req, res) => {
    const me = req.user.id, o = +req.body?.userId;
    if (!o || o === me || !db.prepare('select 1 from users where id=?').get(o)) throw fail(400, 'Unknown user');
    const st = D.friendState(db, me, o), [a, b] = D.pair(me, o);
    if (st === 'friend' || st === 'outgoing') return res.json({ state: st });
    if (st === 'incoming') { db.prepare("update friendships set status='accepted' where a=? and b=?").run(a, b); ping(o, 'accepted', me); ping(me, 'sync', o); return res.json({ state: 'friend' }); }
    db.prepare("insert into friendships(a,b,requester,status,created) values(?,?,?,'pending',?)").run(a, b, me, Date.now());
    ping(o, 'request', me); ping(me, 'sync', o);
    rt.notifyAway(o, { title: 'New friend request', body: `${req.user.name} wants to be your friend`, kind: 'friend', tag: 'friend' });
    res.status(201).json({ state: 'outgoing' });
  });
  api.post('/friends/:id/accept', auth, (req, res) => {
    const me = req.user.id, o = +req.params.id, [a, b] = D.pair(me, o);
    if (D.friendState(db, me, o) !== 'incoming') throw fail(404, 'No request from that user');
    db.prepare("update friendships set status='accepted' where a=? and b=?").run(a, b);
    ping(o, 'accepted', me); ping(me, 'sync', o);
    rt.notifyAway(o, { title: 'Friend request accepted', body: `${req.user.name} is now your friend`, kind: 'friend', tag: 'friend' });
    res.json({ state: 'friend' });
  });
  api.delete('/friends/:id', auth, (req, res) => { // decline, cancel or unfriend
    const me = req.user.id, o = +req.params.id, [a, b] = D.pair(me, o);
    db.prepare('delete from friendships where a=? and b=?').run(a, b); ping(o, 'sync', me); ping(me, 'sync', o);
    res.json({ state: 'none' });
  });
  // ---- push subscriptions ----
  api.get('/push/key', auth, (req, res) => res.json({ key: push.enabled ? push.key : null }));
  api.post('/push/subscribe', auth, (req, res) => {
    const { endpoint, keys } = req.body || {};
    if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || !keys?.p256dh || !keys?.auth) throw fail(400, 'Invalid subscription');
    db.prepare('insert into push_subs(endpoint,user_id,p256dh,auth) values(?,?,?,?) on conflict(endpoint) do update set user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth').run(endpoint, req.user.id, String(keys.p256dh), String(keys.auth));
    res.json({ ok: true });
  });
  api.post('/push/unsubscribe', auth, (req, res) => { db.prepare('delete from push_subs where endpoint=? and user_id=?').run(String(req.body?.endpoint || ''), req.user.id); res.json({ ok: true }); });
  app.use('/api', api);
  app.use((e, req, res, next) => {
    const code = e.code === 'LIMIT_FILE_SIZE' ? 413 : e.status || 500;
    if (code === 500) console.error(e);
    res.status(code).json({ error: code === 413 ? `File is larger than ${cfg.maxUploadMb} MB` : code === 500 ? 'Something went wrong' : e.message });
  });
  return { app, server, io, db, cfg };
}
module.exports = { createApp };
