(() => {
const $ = s => document.querySelector(s), root = $('#root');
const h = (t, a = {}, ...c) => { const e = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); } e.append(...c.flat(9).filter(x => x != null && x !== false)); return e; };
const S = { token: localStorage.getItem('token'), me: null, convs: [], cur: null, msgs: {}, typing: {}, online: new Set(), call: null, reply: null, edit: null };
const EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const conv = id => S.convs.find(c => c.id === id), cur = () => conv(S.cur);
const other = c => c.members.find(m => m.id !== S.me.id) || S.me;
const title = c => c.type === 'group' ? c.name : other(c).name;
const hm = { hour: '2-digit', minute: '2-digit' };
const fmt = t => { const d = new Date(t); return (d.toDateString() === new Date().toDateString() ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ') + d.toLocaleTimeString([], hm); };
const preview = m => !m ? 'No messages yet' : m.deleted ? 'Message deleted' : m.kind === 'call' ? m.body : m.file_url && !m.body ? ({ image: '📷 Photo', video: '🎥 Video' }[m.kind] || '📎 ' + m.file_name) : m.body;
const theme = () => { const t = localStorage.getItem('theme'); t ? document.documentElement.dataset.theme = t : delete document.documentElement.dataset.theme; };
theme();

function toast(text, onclick) { const t = h('button', { class: 'toast', onclick: () => { t.remove(); onclick?.(); } }, text); $('#toasts').append(t); setTimeout(() => t.remove(), 5000); }
function banner(text) { const b = $('#banner'); b.hidden = !text; b.textContent = text || ''; }
async function api(p, o = {}) {
  const fd = o.body instanceof FormData;
  const r = await fetch('/api' + p, { ...o, headers: { ...(o.body && !fd && { 'Content-Type': 'application/json' }), Authorization: 'Bearer ' + S.token }, body: o.body && !fd ? JSON.stringify(o.body) : o.body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && S.me) logout(); throw new Error(j.error || 'Request failed'); }
  return j;
}
function avatar(u, size = 40) {
  const e = h('span', { class: 'av', role: 'img', 'aria-label': u.name }); e.style.width = e.style.height = size + 'px'; e.style.fontSize = size * .42 + 'px';
  if (u.avatar) e.append(h('img', { src: u.avatar, alt: '' })); else { e.textContent = (u.name || '?').trim()[0].toUpperCase(); e.style.background = `hsl(${(u.id * 67) % 360} 45% 36%)`; }
  return e;
}
function dialog(t, content, okLabel, ok) {
  const d = h('dialog', { 'aria-label': t }, h('h2', {}, t), ...content, h('div', { class: 'row end' },
    h('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, okLabel ? 'Cancel' : 'Close'),
    okLabel && h('button', { class: 'btn', type: 'button', onclick: async () => { try { await ok(); d.close(); } catch (e) { toast(e.message); } } }, okLabel)));
  d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal(); return d;
}

// ---------- auth ----------
function authScreen(signup = false) {
  const f = (id, label, type = 'text', ac) => h('label', {}, label, h('input', { id, type, autocomplete: ac, required: true }));
  const err = h('p', { class: 'err', role: 'alert' });
  root.replaceChildren(h('form', { class: 'auth', onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    try {
      const r = await (await fetch('/api/auth/' + (signup ? 'signup' : 'login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('#u').value, name: signup ? $('#n').value : undefined, password: $('#p').value }) })).json();
      if (!r.token) throw new Error(r.error || 'Could not sign in');
      localStorage.setItem('token', r.token); S.token = r.token; boot();
    } catch (x) { err.textContent = x.message; }
  } }, h('h1', {}, 'Pulse'), h('p', { class: 'muted' }, signup ? 'Create your account' : 'Sign in to your chats'),
    f('u', 'Username', 'text', 'username'), signup && f('n', 'Display name', 'text', 'name'), f('p', signup ? 'Password (8+ characters)' : 'Password', 'password', signup ? 'new-password' : 'current-password'),
    err, h('button', { class: 'btn' }, signup ? 'Create account' : 'Sign in'),
    h('button', { class: 'btn ghost', type: 'button', onclick: () => authScreen(!signup) }, signup ? 'I already have an account' : 'Create an account')));
}
function logout() { localStorage.removeItem('token'); S.sock?.close(); location.reload(); }

// ---------- main layout ----------
async function boot() {
  if (!S.token) return authScreen();
  try { S.me = await api('/me'); } catch { return authScreen(); }
  connect(); await loadConvs();
  root.replaceChildren(h('div', { class: 'app', id: 'app' },
    h('aside', { class: 'side' }, h('header', {}, h('button', { class: 'ic', 'aria-label': 'Your profile', onclick: settings }, avatar(S.me, 36)), h('strong', {}, 'Pulse'), h('span', { class: 'sp' }),
      h('button', { class: 'ic', 'aria-label': 'New group', onclick: groupDialog }, '👥'), h('button', { class: 'ic', 'aria-label': 'Settings', onclick: settings }, '⚙️')),
      h('input', { id: 'q', type: 'search', placeholder: 'Search people and messages', 'aria-label': 'Search people and messages', oninput: debounce(search, 250) }), h('div', { id: 'list' })),
    h('main', { id: 'main' })));
  renderList(); renderChat();
  if ('Notification' in window && Notification.permission === 'default') toast('Turn on desktop notifications? Open Settings to enable.');
}
const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
async function loadConvs() { S.convs = await api('/conversations'); }
const addConv = c => { const i = S.convs.findIndex(x => x.id === c.id); i < 0 ? S.convs.push(c) : (S.convs[i] = c); };
const ts = c => c.last?.created || 0;

function renderList() {
  const l = $('#list'); if (!l) return;
  const cs = [...S.convs].sort((a, b) => b.pinned - a.pinned || ts(b) - ts(a));
  l.replaceChildren(...(cs.length ? cs.map(c => h('button', { class: 'item' + (c.id === S.cur ? ' on' : ''), role: 'listitem', onclick: () => openConv(c.id) },
    avatar(c.type === 'group' ? { id: c.id, name: c.name } : other(c), 44),
    h('span', { class: 't' }, h('b', {}, title(c)), h('small', {}, S.typing[c.id] && Object.keys(S.typing[c.id]).length ? 'typing…' : preview(c.last))),
    h('span', {}, c.last && h('small', {}, new Date(c.last.created).toLocaleTimeString([], hm)), h('div', { class: 'row end' }, c.pinned && '📌', c.muted && '🔇', c.unread > 0 && h('span', { class: 'badge', 'aria-label': c.unread + ' unread' }, c.unread))))) : [h('p', { class: 'empty' }, 'No chats yet. Search for a username above to start one.')]));
}
async function search() {
  const q = $('#q').value.trim(); if (q.length < 2) return renderList();
  const [us, ms] = await Promise.all([api('/users?q=' + encodeURIComponent(q)), api('/search?q=' + encodeURIComponent(q))]);
  $('#list').replaceChildren(...us.map(u => h('button', { class: 'item', onclick: async () => { const c = await api('/conversations', { method: 'POST', body: { userId: u.id } }); addConv(c); $('#q').value = ''; openConv(c.id); } }, avatar(u, 44), h('span', { class: 't' }, h('b', {}, u.name), h('small', {}, '@' + u.username + ' · ' + u.status)))),
    ...ms.map(m => h('button', { class: 'item', onclick: () => { $('#q').value = ''; openConv(m.conv_id); } }, h('span', { class: 't' }, h('b', {}, conv(m.conv_id) ? title(conv(m.conv_id)) : 'Chat'), h('small', {}, m.body)), h('small', {}, fmt(m.created)))),
    !us.length && !ms.length && h('p', { class: 'empty' }, 'No people or messages match “' + q + '”.'));
}
async function openConv(id) {
  S.cur = id; S.reply = S.edit = null;
  if (!conv(id)) await loadConvs();
  if (!S.msgs[id]) S.msgs[id] = await api(`/conversations/${id}/messages`);
  renderChat(); markRead();
}
function markRead() { const c = cur(); if (c && document.visibilityState === 'visible') { S.sock.emit('message:read', { conv_id: c.id }); if (c.unread) { c.unread = 0; renderList(); } } }

function chatSub(c) {
  if (S.typing[c.id] && Object.keys(S.typing[c.id]).length) return 'typing…';
  return c.type === 'group' ? c.members.map(m => m.name).join(', ') : S.online.has(other(c).id) ? 'online' : other(c).status;
}
function renderChat() {
  $('#app')?.classList.toggle('chat-open', !!S.cur);
  const main = $('#main'); if (!main) return; const c = cur();
  if (!c) return main.replaceChildren(h('div', { class: 'empty' }, h('div', {}, h('h2', {}, 'Pick a chat'), h('p', {}, 'Choose a conversation, or search for someone by username to say hello.'))));
  const input = h('textarea', { rows: 1, placeholder: 'Write a message', 'aria-label': 'Message', maxlength: 4000, onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } if (e.key === 'Escape') { S.reply = S.edit = null; renderBar(); } }, oninput: onType });
  const file = h('input', { type: 'file', hidden: true, accept: 'image/*,video/mp4,video/webm,application/pdf,text/plain', onchange: () => attach(file.files[0]) });
  main.replaceChildren(h('section', { class: 'chat' },
    h('header', {}, h('button', { class: 'ic back', 'aria-label': 'Back to chats', onclick: () => { S.cur = null; renderChat(); } }, '←'), avatar(c.type === 'group' ? { id: c.id, name: c.name } : other(c), 40),
      h('div', { class: 't' }, h('b', {}, title(c)), h('small', { id: 'sub', style: 'display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, chatSub(c))),
      c.type === 'dm' && h('button', { class: 'ic', 'aria-label': 'Voice call', onclick: () => startCall(false) }, '📞'), c.type === 'dm' && h('button', { class: 'ic', 'aria-label': 'Video call', onclick: () => startCall(true) }, '🎥'),
      h('button', { class: 'ic', 'aria-label': c.pinned ? 'Unpin chat' : 'Pin chat', 'aria-pressed': c.pinned, onclick: () => patchConv({ pinned: !c.pinned }) }, '📌'),
      h('button', { class: 'ic', 'aria-label': c.muted ? 'Unmute notifications' : 'Mute notifications', 'aria-pressed': c.muted, onclick: () => patchConv({ muted: !c.muted }) }, c.muted ? '🔇' : '🔔')),
    h('div', { id: 'msgs', role: 'log', 'aria-live': 'polite' }), h('div', { id: 'bar' }),
    h('div', { class: 'composer' }, h('button', { class: 'ic', 'aria-label': 'Attach a file', onclick: () => file.click() }, '📎'), file, input, h('button', { class: 'btn', onclick: send }, 'Send'))));
  renderMsgs(true); renderBar(); input.focus();
}
const patchConv = async p => { addConv(await api('/conversations/' + S.cur, { method: 'PATCH', body: p })); renderChat(); renderList(); };
function renderBar() {
  const b = $('#bar'); if (!b) return; const t = S.edit ? 'Editing message' : S.reply ? 'Replying: ' + (S.reply.body || S.reply.file_name) : null;
  b.className = t ? 'bar' : ''; b.replaceChildren(...(t ? [h('span', {}, t), h('button', { class: 'ic', 'aria-label': 'Cancel', onclick: () => { S.reply = S.edit = null; $('textarea').value = ''; renderBar(); } }, '✕')] : []));
}
let typingOn = false, typingT;
function onType() { if (!typingOn) { typingOn = true; S.sock.emit('typing', { conv_id: S.cur, on: true }); } clearTimeout(typingT); typingT = setTimeout(() => { typingOn = false; S.sock.emit('typing', { conv_id: S.cur, on: false }); }, 2000); }
function send() {
  const ta = $('textarea'), body = ta.value.trim(); if (!body) return;
  const done = r => r?.error && toast(r.error);
  if (S.edit) S.sock.emit('message:edit', { id: S.edit.id, body }, done); else S.sock.emit('message:send', { conv_id: S.cur, body, reply_to: S.reply?.id }, done);
  ta.value = ''; S.reply = S.edit = null; renderBar(); typingOn = false; S.sock.emit('typing', { conv_id: S.cur, on: false });
}
async function attach(f) {
  if (!f) return; const fd = new FormData(); fd.append('file', f);
  try { const a = await api('/upload', { method: 'POST', body: fd }); S.sock.emit('message:send', { conv_id: S.cur, body: $('textarea').value.trim(), attachment: a, reply_to: S.reply?.id }, r => r?.error && toast(r.error)); $('textarea').value = ''; S.reply = null; renderBar(); } catch (e) { toast(e.message); }
}

function bubble(m, c) {
  if (m.kind === 'call') return h('div', { class: 'sys' }, '📞 ' + m.body + ' · ' + new Date(m.created).toLocaleTimeString([], hm));
  const mine = m.sender_id === S.me.id, who = c.members.find(u => u.id === m.sender_id);
  const media = m.deleted ? null : m.kind === 'image' ? h('img', { src: m.file_url, alt: m.file_name || 'Image', loading: 'lazy' }) : m.kind === 'video' ? h('video', { src: m.file_url, controls: true, preload: 'metadata' }) : m.file_url ? h('a', { href: m.file_url, target: '_blank', rel: 'noopener', download: m.file_name }, '📎 ' + (m.file_name || 'File')) : null;
  const rx = Object.entries(m.reactions || {});
  const el = h('article', { class: 'm' + (mine ? ' me' : ''), 'data-id': m.id },
    !mine && c.type === 'group' && h('div', { class: 'who' }, who?.name || 'Someone'),
    m.reply && h('div', { class: 'quote' }, h('b', {}, (c.members.find(u => u.id === m.reply.sender_id)?.name || '') + ' '), m.reply.body.slice(0, 80)),
    media, (m.body || m.deleted) && h('p', { class: m.deleted ? 'muted' : '' }, m.deleted ? 'This message was deleted' : m.body),
    rx.length > 0 && h('div', { class: 'rx' }, rx.map(([e, us]) => h('button', { class: us.includes(S.me.id) ? 'mine' : '', 'aria-label': `${e} from ${us.length}`, onclick: () => S.sock.emit('reaction', { id: m.id, emoji: e }) }, e + ' ' + us.length))),
    h('div', { class: 'meta' }, m.edited && !m.deleted && 'edited', new Date(m.created).toLocaleTimeString([], hm), mine && !m.deleted && h('span', { class: 'tick ' + m.status, 'aria-label': m.status }, m.status === 'sent' ? '✓' : '✓✓')),
    !m.deleted && h('button', { class: 'ic more', 'aria-label': 'Message actions', 'aria-haspopup': 'menu', onclick: e => { e.stopPropagation(); menu(el, m, mine); } }, '⋯'));
  return el;
}
function menu(el, m, mine) {
  document.querySelectorAll('.menu').forEach(x => x.remove());
  const item = (t, f) => h('button', { role: 'menuitem', onclick: () => { mm.remove(); f(); } }, t);
  const mm = h('div', { class: 'menu', role: 'menu' }, h('div', { class: 'emo' }, EMOJI.map(e => h('button', { 'aria-label': 'React ' + e, onclick: () => { mm.remove(); S.sock.emit('reaction', { id: m.id, emoji: e }); } }, e))),
    item('Reply', () => { S.reply = m; S.edit = null; renderBar(); $('textarea').focus(); }),
    mine && m.kind === 'text' && item('Edit', () => { S.edit = m; S.reply = null; $('textarea').value = m.body; renderBar(); $('textarea').focus(); }),
    mine && item('Delete', () => confirm('Delete this message for everyone?') && S.sock.emit('message:delete', { id: m.id })));
  el.append(mm); mm.querySelector('button').focus();
}
document.addEventListener('click', () => document.querySelectorAll('.menu').forEach(x => x.remove()));
document.addEventListener('keydown', e => e.key === 'Escape' && document.querySelectorAll('.menu').forEach(x => x.remove()));
function renderMsgs(bottom) {
  const box = $('#msgs'), c = cur(); if (!box || !c) return;
  const near = bottom || box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  box.replaceChildren(...(S.msgs[c.id] || []).map(m => bubble(m, c)));
  if (!(S.msgs[c.id] || []).length) box.append(h('p', { class: 'empty' }, 'No messages yet. Say hello.'));
  if (near) box.scrollTop = box.scrollHeight;
}
function patchMsg(m) { const a = S.msgs[m.conv_id]; if (!a) return; const i = a.findIndex(x => x.id === m.id); i < 0 ? a.push(m) : (a[i] = m); }

// ---------- notifications ----------
function notify(c, m) {
  if (c.muted || m.sender_id === S.me.id) return;
  const who = c.members.find(u => u.id === m.sender_id)?.name || 'New message', text = m.kind === 'call' ? m.body : preview(m);
  const head = c.type === 'group' ? `${c.name} · ${who}` : who;
  if (S.cur !== c.id || document.hidden) toast(head + ': ' + text, () => openConv(c.id));
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') { const n = new Notification(head, { body: text, tag: 'c' + c.id }); n.onclick = () => { focus(); openConv(c.id); n.close(); }; }
}

// ---------- socket ----------
function connect() {
  const s = S.sock = io({ auth: { token: S.token } });
  s.on('connect', async () => { banner(); if (S.me && $('#app')) { await loadConvs(); if (S.cur) S.msgs[S.cur] = await api(`/conversations/${S.cur}/messages`); renderList(); renderMsgs(); markRead(); } });
  s.on('disconnect', () => banner('Connection lost. Reconnecting…'));
  s.on('connect_error', e => e.message === 'unauthorized' ? logout() : banner('Can’t reach the server. Retrying…'));
  s.on('presence:list', l => { S.online = new Set(l); $('#sub') && cur() && ($('#sub').textContent = chatSub(cur())); });
  s.on('presence', p => { p.online ? S.online.add(p.user_id) : S.online.delete(p.user_id); $('#sub') && cur() && ($('#sub').textContent = chatSub(cur())); });
  s.on('conv:new', c => { addConv(c); renderList(); });
  s.on('message:new', async m => {
    if (!conv(m.conv_id)) await loadConvs();
    const c = conv(m.conv_id); if (!c) return;
    patchMsg(m); c.last = m;
    const seen = S.cur === c.id && document.visibilityState === 'visible';
    if (m.sender_id !== S.me.id) { if (seen) markRead(); else c.unread++; notify(c, m); }
    renderList(); if (S.cur === c.id) renderMsgs();
  });
  s.on('message:update', m => { patchMsg(m); const c = conv(m.conv_id); if (c?.last?.id === m.id) c.last = m; renderList(); if (S.cur === m.conv_id) renderMsgs(); });
  s.on('status', ({ conv_id, items }) => { for (const i of items) { const m = S.msgs[conv_id]?.find(x => x.id === i.id); if (m) m.status = i.status; } if (S.cur === conv_id) renderMsgs(); });
  s.on('typing', ({ conv_id, user_id, on }) => {
    const t = S.typing[conv_id] ??= {}; clearTimeout(t[user_id]); delete t[user_id];
    if (on) t[user_id] = setTimeout(() => { delete t[user_id]; renderList(); $('#sub') && cur() && ($('#sub').textContent = chatSub(cur())); }, 4000);
    renderList(); $('#sub') && cur() && ($('#sub').textContent = chatSub(cur()));
  });
  callEvents(s);
}
const focus = () => window.focus();
window.addEventListener('focus', markRead); document.addEventListener('visibilitychange', markRead);

// ---------- dialogs ----------
function groupDialog() {
  const picked = new Map(), name = h('input', { placeholder: 'Group name', maxlength: 40, 'aria-label': 'Group name' }), res = h('div', { class: 'res' }), chips = h('div', { class: 'chips' });
  const paint = () => chips.replaceChildren(...[...picked.values()].map(u => h('button', { type: 'button', class: 'chip', 'aria-label': 'Remove ' + u.name, onclick: () => { picked.delete(u.id); paint(); } }, u.name + ' ✕')));
  const q = h('input', { type: 'search', placeholder: 'Add people by name or username', 'aria-label': 'Add people', oninput: debounce(async () => { const r = q.value.length < 2 ? [] : await api('/users?q=' + encodeURIComponent(q.value)); res.replaceChildren(...r.map(u => h('button', { type: 'button', onclick: () => { picked.set(u.id, u); paint(); } }, u.name + ' @' + u.username))); }, 250) });
  dialog('New group', [name, q, res, chips], 'Create group', async () => { const c = await api('/conversations', { method: 'POST', body: { name: name.value, userIds: [...picked.keys()] } }); addConv(c); openConv(c.id); });
}
function settings() {
  const name = h('input', { value: S.me.name, maxlength: 40 }), status = h('input', { value: S.me.status, maxlength: 120 });
  const rr = h('input', { type: 'checkbox', checked: S.me.read_receipts, style: 'width:auto' }), th = h('select', {}, ['', 'light', 'dark'].map(v => h('option', { value: v, selected: (localStorage.getItem('theme') || '') === v }, v ? v[0].toUpperCase() + v.slice(1) : 'Match my device')));
  const pic = h('input', { type: 'file', accept: 'image/*', onchange: async () => { const fd = new FormData(); fd.append('file', pic.files[0]); try { S.me = await api('/me/avatar', { method: 'POST', body: fd }); toast('Profile photo updated'); } catch (e) { toast(e.message); } } });
  dialog('Settings', [h('label', {}, 'Name', name), h('label', {}, 'Status', status), h('label', {}, 'Profile photo', pic), h('label', { class: 'row' }, rr, 'Send read receipts'), h('label', {}, 'Theme', th),
    h('button', { class: 'btn ghost', type: 'button', onclick: async () => toast(!('Notification' in window) ? 'This browser does not support notifications' : (await Notification.requestPermission()) === 'granted' ? 'Desktop notifications on' : 'Notifications are blocked in your browser settings') }, 'Enable desktop notifications'),
    h('button', { class: 'btn ghost', type: 'button', onclick: logout }, 'Sign out')], 'Save', async () => {
    S.me = await api('/me', { method: 'PATCH', body: { name: name.value, status: status.value, read_receipts: rr.checked } }); th.value ? localStorage.setItem('theme', th.value) : localStorage.removeItem('theme'); theme(); });
}

// ---------- calls (WebRTC; signaling over the socket) ----------
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const rv = h('video', { class: 'rv', autoplay: true, playsinline: true }), lv = h('video', { class: 'lv', autoplay: true, muted: true, playsinline: true });
const info = h('p', { role: 'status' }), ctl = h('div', { class: 'ctl' });
$('#call').append(rv, lv, info, ctl); lv.muted = true;
const media = video => navigator.mediaDevices.getUserMedia({ audio: true, video: video ? { facingMode: 'user' } : false });
function mkPc() {
  const c = S.call, pc = c.pc = new RTCPeerConnection(ICE);
  c.local.getTracks().forEach(t => pc.addTrack(t, c.local));
  pc.ontrack = e => { rv.srcObject = e.streams[0]; paintCall(); };
  pc.onicecandidate = e => e.candidate && S.sock.emit('call:signal', { callId: c.id, data: { ice: e.candidate } });
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'connected') { c.state = 'active'; paintCall(); } if (pc.connectionState === 'failed') hangup(); };
}
async function startCall(video) {
  const c = cur(), peer = other(c); let local;
  try { local = await media(video); } catch { return toast('Allow microphone' + (video ? ' and camera' : '') + ' access to place a call.'); }
  S.sock.emit('call:invite', { to: peer.id, video }, r => { if (r.error) { local.getTracks().forEach(t => t.stop()); return toast(r.error); } S.call = { id: r.callId, peer, video, state: 'ringing', out: true, local }; paintCall(); });
}
async function acceptCall() {
  const c = S.call; try { c.local = await media(c.video); } catch { toast('Allow microphone access to answer.'); return S.sock.emit('call:decline', { callId: c.id }); }
  c.state = 'connecting'; mkPc(); paintCall(); S.sock.emit('call:accept', { callId: c.id });
}
const hangup = () => S.call && S.sock.emit('call:end', { callId: S.call.id });
function cleanupCall() { const c = S.call; if (!c) return; c.local?.getTracks().forEach(t => t.stop()); c.pc?.close(); rv.srcObject = lv.srcObject = null; S.call = null; paintCall(); }
function paintCall() {
  const c = S.call, box = $('#call'); box.hidden = !c; if (!c) return;
  const btn = (cls, label, ic, f) => h('button', { class: cls, 'aria-label': label, onclick: f }, ic);
  const word = c.video ? 'Video' : 'Voice';
  info.textContent = c.state === 'incoming' ? `${c.peer.name} is calling (${word.toLowerCase()})…` : c.state === 'ringing' ? `Calling ${c.peer.name}…` : c.state === 'connecting' ? 'Connecting…' : `${word} call with ${c.peer.name}`;
  lv.srcObject = c.local || null; lv.hidden = !c.video || !c.local; rv.hidden = !c.video || c.state !== 'active';
  ctl.replaceChildren(...(c.state === 'incoming' ? [btn('grn', 'Accept call', '📞', acceptCall), btn('red', 'Decline call', '✕', () => S.sock.emit('call:decline', { callId: c.id }))] :
    [c.local && btn('', 'Mute microphone', '🎤', e => { const t = c.local.getAudioTracks()[0]; t.enabled = !t.enabled; e.currentTarget.style.opacity = t.enabled ? 1 : .5; }),
     c.video && c.local && btn('', 'Turn camera off', '📷', e => { const t = c.local.getVideoTracks()[0]; t.enabled = !t.enabled; e.currentTarget.style.opacity = t.enabled ? 1 : .5; }),
     btn('red', c.state === 'ringing' ? 'Cancel call' : 'End call', '✕', hangup)]));
  (c.state === 'incoming' ? ctl.firstChild : ctl.lastChild)?.focus();
}
function callEvents(s) {
  s.on('call:incoming', ({ callId, from, video }) => {
    if (S.call) return s.emit('call:decline', { callId });
    S.call = { id: callId, peer: from, video, state: 'incoming' }; paintCall();
    if (document.hidden && Notification.permission === 'granted') new Notification(from.name + ' is calling', { body: video ? 'Video call' : 'Voice call', tag: 'call' });
  });
  s.on('call:accepted', async () => { const c = S.call; if (!c) return; c.state = 'connecting'; mkPc(); const o = await c.pc.createOffer(); await c.pc.setLocalDescription(o); s.emit('call:signal', { callId: c.id, data: { sdp: c.pc.localDescription } }); paintCall(); });
  s.on('call:signal', async ({ callId, data }) => {
    const c = S.call; if (!c || c.id !== callId || !c.pc) return;
    try {
      if (data.sdp) { await c.pc.setRemoteDescription(data.sdp); if (data.sdp.type === 'offer') { const a = await c.pc.createAnswer(); await c.pc.setLocalDescription(a); s.emit('call:signal', { callId, data: { sdp: c.pc.localDescription } }); } }
      else if (data.ice) await c.pc.addIceCandidate(data.ice);
    } catch (e) { console.warn('signal', e); }
  });
  s.on('call:ended', ({ callId, reason }) => {
    const c = S.call; if (!c || c.id !== callId) return;
    const msg = { missed: c.out ? `${c.peer.name} didn’t answer` : 'Missed call', declined: c.out ? `${c.peer.name} declined the call` : null, cancelled: c.out ? null : 'Call cancelled' }[reason];
    cleanupCall(); msg && toast(msg);
  });
}
boot();
})();
