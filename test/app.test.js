const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const { io: ioc } = require('socket.io-client');
const { createApp } = require('../server/app');

async function boot(over = {}) {
  const a = createApp({ dbFile: ':memory:', uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-')), bcryptRounds: 4, authMax: 1000, ringMs: 150, ...over });
  await new Promise(r => a.server.listen(0, r));
  a.url = 'http://localhost:' + a.server.address().port;
  a.req = async (method, p, body, token) => {
    const r = await fetch(a.url + '/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  a.signup = async name => { const r = await a.req('POST', '/auth/signup', { username: name, name, password: 'password123' }); return { ...r.body.user, token: r.body.token }; };
  a.befriend = async (x, y) => { await a.req('POST', '/friends/request', { userId: y.id }, x.token); await a.req('POST', '/friends/' + x.id + '/accept', null, y.token); };
  a.sock = token => new Promise((res, rej) => { const s = ioc(a.url, { auth: { token }, forceNew: true }); s.on('connect', () => res(s)); s.on('connect_error', rej); });
  return a;
}
const once = (s, ev) => new Promise(r => s.once(ev, r));
const emit = (s, ev, d) => new Promise(r => s.emit(ev, d, r));

test('authentication', async () => {
  const a = await boot();
  try {
    const up = await a.req('POST', '/auth/signup', { username: 'alice', password: 'password123' });
    assert.equal(up.status, 201); assert.ok(up.body.token);
    assert.equal((await a.req('POST', '/auth/signup', { username: 'alice', password: 'password123' })).status, 409);
    assert.equal((await a.req('POST', '/auth/signup', { username: 'bob', password: 'short' })).status, 400);
    assert.equal((await a.req('POST', '/auth/login', { username: 'alice', password: 'wrong-pass' })).status, 401);
    assert.equal((await a.req('POST', '/auth/login', { username: 'alice', password: 'password123' })).status, 200);
    assert.notEqual(a.db.prepare('select pass_hash h from users').get().h, 'password123');
    assert.equal((await a.req('GET', '/me')).status, 401);
    assert.equal((await a.req('GET', '/me', null, up.body.token)).status, 200);
    await assert.rejects(a.sock(''), /unauthorized/);
  } finally { a.io.close(); }
});

test('rate limiting on auth endpoint', async () => {
  const a = await boot({ authMax: 3 });
  try {
    const codes = []; for (let i = 0; i < 5; i++) codes.push((await a.req('POST', '/auth/login', { username: 'x', password: 'y' })).status);
    assert.equal(codes[4], 429);
  } finally { a.io.close(); }
});

test('message delivery, receipts, edit, delete, reactions', async () => {
  const a = await boot();
  try {
    const al = await a.signup('alice'), bo = await a.signup('bob'), ev = await a.signup('eve');
    await a.befriend(al, bo);
    const conv = (await a.req('POST', '/conversations', { userId: bo.id }, al.token)).body;
    const sa = await a.sock(al.token), sb = await a.sock(bo.token), se = await a.sock(ev.token);
    const got = once(sb, 'message:new'), st = once(sa, 'status');
    assert.ok((await emit(sa, 'message:send', { conv_id: conv.id, body: 'hello <b>bob</b>' })).ok);
    assert.equal((await got).body, 'hello <b>bob</b>');
    assert.equal((await st).items[0].status, 'delivered'); // bob was online
    const st2 = once(sa, 'status'); sb.emit('message:read', { conv_id: conv.id });
    assert.equal((await st2).items[0].status, 'read');
    // outsiders cannot post or read
    assert.ok((await emit(se, 'message:send', { conv_id: conv.id, body: 'hi' })).error);
    assert.equal((await a.req('GET', `/conversations/${conv.id}/messages`, null, ev.token)).status, 404);
    // edit / delete permissions
    const id = (await a.req('GET', `/conversations/${conv.id}/messages`, null, al.token)).body[0].id;
    assert.ok((await emit(sb, 'message:edit', { id, body: 'hacked' })).error);
    const upd = once(sb, 'message:update'); assert.ok((await emit(sa, 'message:edit', { id, body: 'fixed' })).ok);
    assert.deepEqual([(await upd).body, (await a.req('GET', `/conversations/${conv.id}/messages`, null, bo.token)).body[0].edited], ['fixed', true]);
    const rx = once(sa, 'message:update'); sb.emit('reaction', { id, emoji: '👍' });
    assert.deepEqual((await rx).reactions['👍'], [bo.id]);
    // read receipts off => sender only ever sees "delivered"
    await a.req('PATCH', '/me', { read_receipts: false }, bo.token);
    await emit(sa, 'message:send', { conv_id: conv.id, body: 'second' }); await new Promise(r => setTimeout(r, 50));
    sb.emit('message:read', { conv_id: conv.id }); await new Promise(r => setTimeout(r, 80));
    const last = (await a.req('GET', `/conversations/${conv.id}/messages`, null, al.token)).body.pop();
    assert.equal(last.status, 'delivered');
    const del = once(sb, 'message:update'); await emit(sa, 'message:delete', { id: last.id });
    assert.equal((await del).deleted, true);
    assert.equal((await a.req('GET', '/search?q=fixed', null, al.token)).body.length, 1);
    [sa, sb, se].forEach(s => s.close());
  } finally { a.io.close(); }
});

test('call signaling: ring, accept, relay, end, missed', async () => {
  const a = await boot();
  try {
    const al = await a.signup('alice'), bo = await a.signup('bob'); await a.befriend(al, bo);
    const sa = await a.sock(al.token), sb = await a.sock(bo.token);
    const inc = once(sb, 'call:incoming');
    const { callId } = await emit(sa, 'call:invite', { to: bo.id, video: true });
    const i = await inc; assert.equal(i.callId, callId); assert.equal(i.from.id, al.id); assert.equal(i.video, true);
    assert.ok((await emit(sa, 'call:invite', { to: bo.id })).error); // caller is busy
    const acc = once(sa, 'call:accepted'); sb.emit('call:accept', { callId }); await acc;
    const sig = once(sb, 'call:signal'); sa.emit('call:signal', { callId, data: { sdp: { type: 'offer', sdp: 'x' } } });
    assert.equal((await sig).data.sdp.type, 'offer');
    const end = once(sa, 'call:ended'); sb.emit('call:end', { callId });
    assert.equal((await end).reason, 'ended');
    // unanswered => missed, logged in the chat
    const { callId: c2 } = await emit(sa, 'call:invite', { to: bo.id });
    const missed = await once(sa, 'call:ended'); assert.deepEqual([missed.callId, missed.reason], [c2, 'missed']);
    const conv = (await a.req('GET', '/conversations', null, bo.token)).body[0];
    const msgs = (await a.req('GET', `/conversations/${conv.id}/messages`, null, bo.token)).body;
    assert.ok(msgs.some(m => m.kind === 'call' && /Missed/.test(m.body)));
    [sa, sb].forEach(s => s.close());
  } finally { a.io.close(); }
});

test('friend requests gate chatting and calling; voice upload; unfriend blocks sending', async () => {
  const a = await boot();
  try {
    const al = await a.signup('alice'), bo = await a.signup('bob');
    assert.equal((await a.req('POST', '/conversations', { userId: bo.id }, al.token)).status, 403);
    const s1 = await a.sock(al.token), s2 = await a.sock(bo.token);
    assert.ok((await emit(s1, 'call:invite', { to: bo.id })).error);
    const ping = once(s2, 'friend:update');
    assert.equal((await a.req('POST', '/friends/request', { userId: bo.id }, al.token)).body.state, 'outgoing');
    assert.equal((await ping).type, 'request');
    assert.equal((await a.req('GET', '/users?q=bob', null, al.token)).body[0].relation, 'outgoing');
    assert.equal((await a.req('POST', '/friends/' + bo.id + '/accept', null, al.token)).status, 404); // requester can't self-accept
    assert.equal((await a.req('POST', '/friends/' + al.id + '/accept', null, bo.token)).body.state, 'friend');
    const conv = (await a.req('POST', '/conversations', { userId: bo.id }, al.token)).body; assert.ok(conv.id);
    const fd = new FormData(); fd.append('file', new Blob(['x'], { type: 'audio/webm;codecs=opus' }), 'voice.weba');
    const up = await (await fetch(a.url + '/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + al.token }, body: fd })).json();
    assert.equal(up.kind, 'audio');
    const got = once(s2, 'message:new'); assert.ok((await emit(s1, 'message:send', { conv_id: conv.id, attachment: up })).ok);
    assert.equal((await got).kind, 'audio');
    await a.req('DELETE', '/friends/' + bo.id, null, al.token);
    assert.ok((await emit(s1, 'message:send', { conv_id: conv.id, body: 'hi' })).error);
    [s1, s2].forEach(s => s.close());
  } finally { a.io.close(); }
});
