const Database = require('better-sqlite3'), fs = require('fs'), path = require('path');
function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
  db.exec(`
  create table if not exists users(id integer primary key, username text unique not null, name text not null, pass_hash text not null, avatar text, status text default 'Hey there! I am using Pulse.', read_receipts integer default 1, created integer);
  create table if not exists conversations(id integer primary key, type text not null, name text, created_by integer, created integer);
  create table if not exists members(conv_id integer references conversations(id), user_id integer references users(id), muted integer default 0, pinned integer default 0, last_read_id integer default 0, primary key(conv_id,user_id));
  create table if not exists messages(id integer primary key, conv_id integer not null references conversations(id), sender_id integer not null references users(id), kind text default 'text', body text default '', file_url text, file_name text, reply_to integer, edited integer default 0, deleted integer default 0, created integer);
  create index if not exists msg_conv on messages(conv_id,id);
  create table if not exists receipts(msg_id integer, user_id integer, state integer, primary key(msg_id,user_id));
  create table if not exists reactions(msg_id integer, user_id integer, emoji text, primary key(msg_id,user_id,emoji));`);
  return db;
}
// Strip control characters, trim, cap length. Output is always rendered with textContent on the client.
const clean = (s, max = 4000) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const publicUser = u => ({ id: u.id, username: u.username, name: u.name, avatar: u.avatar, status: u.status });
const isMember = (db, c, u) => !!db.prepare('select 1 from members where conv_id=? and user_id=?').get(c, u);
const memberIds = (db, c) => db.prepare('select user_id from members where conv_id=?').all(c).map(r => r.user_id);

function hydrate(db, m) {
  const rc = db.prepare('select user_id,state from receipts where msg_id=?').all(m.id);
  const others = memberIds(db, m.conv_id).filter(u => u !== m.sender_id);
  const min = others.length ? Math.min(...others.map(u => rc.find(r => r.user_id === u)?.state || 0)) : 0;
  const reactions = {};
  for (const r of db.prepare('select user_id,emoji from reactions where msg_id=?').all(m.id)) (reactions[r.emoji] ??= []).push(r.user_id);
  const rp = m.reply_to && db.prepare('select id,body,sender_id,deleted,file_name from messages where id=?').get(m.reply_to);
  return { id: m.id, conv_id: m.conv_id, sender_id: m.sender_id, kind: m.kind, deleted: !!m.deleted, edited: !!m.edited, created: m.created,
    body: m.deleted ? '' : m.body, file_url: m.deleted ? null : m.file_url, file_name: m.file_name, reactions,
    status: min >= 2 ? 'read' : min === 1 ? 'delivered' : 'sent',
    reply: rp ? { id: rp.id, sender_id: rp.sender_id, body: rp.deleted ? 'Deleted message' : rp.body || rp.file_name || '' } : null };
}
function convView(db, cid, uid) {
  const c = db.prepare('select * from conversations where id=?').get(cid);
  const mem = db.prepare('select u.*, m.muted, m.pinned, m.last_read_id from members m join users u on u.id=m.user_id where m.conv_id=?').all(cid);
  const mine = mem.find(x => x.id === uid);
  const last = db.prepare('select * from messages where conv_id=? order by id desc limit 1').get(cid);
  const unread = db.prepare('select count(*) n from messages where conv_id=? and id>? and sender_id!=? and deleted=0').get(cid, mine.last_read_id, uid).n;
  return { id: c.id, type: c.type, name: c.name, members: mem.map(publicUser), muted: !!mine.muted, pinned: !!mine.pinned, unread, last: last ? hydrate(db, last) : null };
}
function dmFor(db, a, b, create) {
  const r = db.prepare(`select c.id from conversations c join members x on x.conv_id=c.id and x.user_id=? join members y on y.conv_id=c.id and y.user_id=? where c.type='dm'`).get(a, b);
  if (r || !create) return r && { id: r.id };
  const id = +db.prepare("insert into conversations(type,created_by,created) values('dm',?,?)").run(a, Date.now()).lastInsertRowid;
  for (const u of [a, b]) db.prepare('insert into members(conv_id,user_id) values(?,?)').run(id, u);
  return { id, created: true };
}
module.exports = { openDb, clean, publicUser, isMember, memberIds, hydrate, convView, dmFor };
