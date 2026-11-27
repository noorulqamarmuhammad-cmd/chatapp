(() => {
const $ = s => document.querySelector(s), root = $('#root');
const h = (t, a = {}, ...c) => { const e = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'style') e.style.cssText = v; else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); } e.append(...c.flat(9).filter(x => x != null && x !== false)); return e; };
const S = { token: localStorage.getItem('token'), me: null, convs: [], cur: null, msgs: {}, typing: {}, online: new Set(), call: null, reply: null, edit: null, friends: { friends: [], incoming: [], outgoing: [] }, seen: {}, pending: {}, drafts: {}, below: 0 };
let rec = null;
const EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const conv = id => S.convs.find(c => c.id === id), cur = () => conv(S.cur);
const other = c => c.members.find(m => m.id !== S.me.id) || S.me;
const title = c => c.type === 'group' ? c.name : other(c).name;
const hm = { hour: '2-digit', minute: '2-digit' };
const fmt = t => { const d = new Date(t); return (d.toDateString() === new Date().toDateString() ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ') + d.toLocaleTimeString([], hm); };
const preview = m => !m ? 'No messages yet' : m.deleted ? 'Message deleted' : m.kind === 'call' ? m.body : m.file_url && !m.body ? ({ image: '📷 Photo', video: '🎥 Video', audio: '🎤 Voice message' }[m.kind] || '📎 ' + m.file_name) : m.body;
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
async function logout() {
  try { const sub = await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription(); if (sub) { await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); } } catch {}
  localStorage.removeItem('token'); S.sock?.close(); location.reload();
}

// ---------- main layout ----------
async function boot() {
  if (!S.token) return authScreen();
  try { S.me = await api('/me'); } catch { return authScreen(); }
  connect(); await Promise.all([loadConvs(), loadFriends()]);
  root.replaceChildren(h('div', { class: 'app', id: 'app' },
    h('aside', { class: 'side' }, h('header', {}, h('button', { class: 'ic', 'aria-label': 'Your profile', onclick: settings }, avatar(S.me, 36)), h('strong', {}, 'Pulse'), h('span', { class: 'sp' }),
      h('button', { class: 'ic', 'aria-label': 'Friends and requests', onclick: friendsDialog }, '🤝', h('span', { id: 'frbadge', class: 'badge', hidden: true })), h('button', { class: 'ic', 'aria-label': 'New group', onclick: groupDialog }, '👥'), h('button', { class: 'ic', 'aria-label': 'Settings', onclick: settings }, '⚙️')),
      h('input', { id: 'q', type: 'search', placeholder: 'Search people and messages', 'aria-label': 'Search people and messages', oninput: debounce(search, 250) }), h('div', { id: 'list' })),
    h('main', { id: 'main' })));
  renderList(); renderChat();
  paintBadge(); registerSW(); syncPush();
  const deep = new URLSearchParams(location.search).get('c'); if (deep) { history.replaceState(null, '', '/'); openConv(+deep); }
  if ('Notification' in window && Notification.permission === 'default') toast('Tap here to turn on notifications', settings);
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
    h('span', {}, c.last && h('small', {}, new Date(c.last.created).toLocaleTimeString([], hm)), h('div', { class: 'row end' }, c.pinned && '📌', c.muted && '🔇', c.unread > 0 && h('span', { class: 'badge', 'aria-label': c.unread + ' unread' }, c.unread))))) : [h('p', { class: 'empty' }, 'No chats yet. Search a username to send a friend request, then chat once they accept.')]));
}
async function search() {
  const q = $('#q').value.trim(); if (q.length < 2) return renderList();
  const [us, ms] = await Promise.all([api('/users?q=' + encodeURIComponent(q)), api('/search?q=' + encodeURIComponent(q))]);
  $('#list').replaceChildren(...us.map(u => h('div', { class: 'item' }, avatar(u, 44), h('span', { class: 't' }, h('b', {}, u.name), h('small', {}, '@' + u.username)), relBtn(u))),
    ...ms.map(m => h('button', { class: 'item', onclick: () => { $('#q').value = ''; openConv(m.conv_id); } }, h('span', { class: 't' }, h('b', {}, conv(m.conv_id) ? title(conv(m.conv_id)) : 'Chat'), h('small', {}, m.body)), h('small', {}, fmt(m.created)))),
    !us.length && !ms.length && h('p', { class: 'empty' }, 'No people or messages match “' + q + '”.'));
}
function relBtn(u) {
  const go = async (p, o) => { try { await api(p, o); await loadFriends(); search(); } catch (e) { toast(e.message); } };
  if (u.relation === 'friend') return h('button', { class: 'btn', onclick: () => chatWith(u.id) }, 'Message');
  if (u.relation === 'incoming') return h('button', { class: 'btn', onclick: () => go('/friends/' + u.id + '/accept', { method: 'POST' }) }, 'Accept');
  if (u.relation === 'outgoing') return h('button', { class: 'btn ghost', 'aria-label': 'Cancel request to ' + u.name, onclick: () => go('/friends/' + u.id, { method: 'DELETE' }) }, 'Requested ✕');
  return h('button', { class: 'btn', onclick: () => go('/friends/request', { method: 'POST', body: { userId: u.id } }) }, 'Add friend');
}
async function chatWith(id) { try { const c = await api('/conversations', { method: 'POST', body: { userId: id } }); addConv(c); const q = $('#q'); if (q) q.value = ''; document.querySelectorAll('dialog[open]').forEach(d => d.close()); renderList(); openConv(c.id); } catch (e) { toast(e.message); } }
async function openConv(id) {
  if (rec) endRec(false);
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
  const input = h('textarea', { rows: 1, placeholder: 'Write a message', 'aria-label': 'Message', maxlength: 4000, onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } if (e.key === 'Escape') { S.reply = S.edit = null; renderBar(); } }, oninput: () => { onType(); S.drafts[S.cur] = input.value; grow(input); } });
  input.value = S.drafts[S.cur] || ''; setTimeout(() => grow(input));
  const file = h('input', { type: 'file', hidden: true, accept: 'image/*,video/mp4,video/webm,application/pdf,text/plain', onchange: () => attach(file.files[0]) });
  main.replaceChildren(h('section', { class: 'chat' },
    h('header', {}, h('button', { class: 'ic back', 'aria-label': 'Back to chats', onclick: () => { S.cur = null; renderChat(); } }, '←'), avatar(c.type === 'group' ? { id: c.id, name: c.name } : other(c), 40),
      h('div', { class: 't' }, h('b', {}, title(c)), h('small', { id: 'sub', style: 'display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, chatSub(c))),
      c.type === 'dm' && h('button', { class: 'ic', 'aria-label': 'Voice call', onclick: () => startCall(false) }, '📞'), c.type === 'dm' && h('button', { class: 'ic', 'aria-label': 'Video call', onclick: () => startCall(true) }, '🎥'),
      h('button', { class: 'ic', 'aria-label': c.pinned ? 'Unpin chat' : 'Pin chat', 'aria-pressed': c.pinned, onclick: () => patchConv({ pinned: !c.pinned }) }, '📌'),
      h('button', { class: 'ic', 'aria-label': c.muted ? 'Unmute notifications' : 'Mute notifications', 'aria-pressed': c.muted, onclick: () => patchConv({ muted: !c.muted }) }, c.muted ? '🔇' : '🔔')),
    h('div', { class: 'stage' }, bubbles(), h('div', { id: 'msgs', role: 'log', 'aria-live': 'polite', onscroll: paintJump }), h('button', { id: 'jump', class: 'jump', hidden: true, 'aria-label': 'Jump to latest messages', onclick: () => { const b = $('#msgs'); b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); } })),
    h('div', { id: 'tp', class: 'tp', role: 'status', hidden: true }), h('div', { id: 'bar' }),
    h('div', { class: 'composer' }, h('button', { class: 'ic emo-btn', 'aria-label': 'Insert emoji', onclick: emojiPicker }, '😊'), h('button', { class: 'ic', 'aria-label': 'Attach a file', onclick: () => file.click() }, '📎'), file, h('button', { class: 'ic', 'aria-label': 'Record a voice message', onclick: toggleRec }, '🎤'), input, h('button', { class: 'btn', onclick: send }, 'Send'))));
  renderMsgs(true); renderBar(); paintTyping(); input.focus();
}
const patchConv = async p => { addConv(await api('/conversations/' + S.cur, { method: 'PATCH', body: p })); renderChat(); renderList(); };
function renderBar() {
  const b = $('#bar'); if (!b) return; if (rec) return paintRec(); const t = S.edit ? 'Editing message' : S.reply ? 'Replying: ' + (S.reply.body || S.reply.file_name) : null;
  b.className = t ? 'bar' : ''; b.replaceChildren(...(t ? [h('span', {}, t), h('button', { class: 'ic', 'aria-label': 'Cancel', onclick: () => { S.reply = S.edit = null; $('textarea').value = ''; renderBar(); } }, '✕')] : []));
}
let typingOn = false, typingT;
function onType() { if (!typingOn) { typingOn = true; S.sock.emit('typing', { conv_id: S.cur, on: true }); } clearTimeout(typingT); typingT = setTimeout(() => { typingOn = false; S.sock.emit('typing', { conv_id: S.cur, on: false }); }, 2000); }
function send() {
  const ta = $('textarea'), body = ta.value.trim(); if (!body) return;
  if (S.edit) S.sock.emit('message:edit', { id: S.edit.id, body }, r => r?.error && toast(r.error));
  else { const p = { conv: S.cur, body, reply_to: S.reply?.id, state: 'queued' }; (S.pending[S.cur] ??= []).push(p); if (S.sock.connected) deliver(p); blip(880); }
  ta.value = ''; S.drafts[S.cur] = ''; grow(ta); S.reply = S.edit = null; renderBar(); typingOn = false; S.sock.emit('typing', { conv_id: S.cur, on: false }); renderMsgs(true);
  const b = $('.composer .btn'); b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse');
}
// Offline-safe sending: messages wait in a visible outbox and are sent on reconnect; failures can be retried.
function deliver(p) {
  p.state = 'sending';
  S.sock.timeout(10000).emit('message:send', { conv_id: p.conv, body: p.body, reply_to: p.reply_to }, (err, r) => {
    if (err || r?.error) { p.state = 'failed'; p.err = r?.error || 'no confirmation from the server'; } else S.pending[p.conv] = S.pending[p.conv].filter(x => x !== p);
    renderMsgs();
  });
}
function pendingBubble(p) {
  const failed = p.state === 'failed', drop = () => { S.pending[p.conv] = S.pending[p.conv].filter(x => x !== p); renderMsgs(); };
  return h('article', { class: 'm me pending' + (failed ? ' failed' : '') }, p.reply_to && h('div', { class: 'quote' }, 'Reply'), h('p', {}, linkify(p.body)),
    h('div', { class: 'meta' }, failed ? 'Not sent: ' + p.err : p.state === 'queued' ? '🕓 Waiting for connection…' : '🕓 Sending…',
      failed && [h('button', { class: 'lnk', onclick: () => S.sock.connected ? deliver(p) : (p.state = 'queued', renderMsgs()) }, 'Retry'), h('button', { class: 'lnk', onclick: drop }, 'Delete')]));
}
async function attach(f) {
  if (!f) return; const fd = new FormData(); fd.append('file', f);
  try { const a = await api('/upload', { method: 'POST', body: fd }); S.sock.emit('message:send', { conv_id: S.cur, body: $('textarea').value.trim(), attachment: a, reply_to: S.reply?.id }, r => r?.error && toast(r.error)); $('textarea').value = ''; S.reply = null; renderBar(); } catch (e) { toast(e.message); }
}

// ---------- voice messages ----------
const mmss = ms => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
async function toggleRec() {
  if (rec) return endRec(true);
  if (!navigator.mediaDevices || !window.MediaRecorder) return toast('Voice recording is not supported in this browser.');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t));
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {}), chunks = [];
    mr.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec = { mr, stream, chunks, conv: S.cur, t0: Date.now(), send: false, mime: (mime || mr.mimeType || 'audio/webm').split(';')[0] };
    mr.onstop = async () => {
      const r = rec; clearInterval(r.timer); r.stream.getTracks().forEach(t => t.stop()); rec = null; renderBar();
      if (!r.send || !r.chunks.length) return;
      const ext = r.mime.includes('mp4') ? 'm4a' : r.mime.includes('ogg') ? 'ogg' : 'weba', fd = new FormData();
      fd.append('file', new File(r.chunks, 'voice.' + ext, { type: r.mime }));
      try { const a = await api('/upload', { method: 'POST', body: fd }); a.name = 'Voice message ' + mmss(Date.now() - r.t0); S.sock.emit('message:send', { conv_id: r.conv, attachment: a }, x => x?.error && toast(x.error)); } catch (e) { toast(e.message); }
    };
    mr.start(); rec.timer = setInterval(() => { paintRec(); if (rec && Date.now() - rec.t0 > 300000) endRec(true); }, 500); paintRec();
  } catch { toast('Allow microphone access to record a voice message.'); }
}
function endRec(send) { if (!rec) return; rec.send = send; if (rec.mr.state !== 'inactive') rec.mr.stop(); }
function paintRec() {
  const b = $('#bar'); if (!b || !rec) return; const t = $('#recT'), txt = '🔴 Recording ' + mmss(Date.now() - rec.t0);
  if (t) return void (t.textContent = txt);
  b.className = 'bar'; b.replaceChildren(h('span', { id: 'recT', role: 'timer' }, txt), h('button', { class: 'ic', 'aria-label': 'Discard recording', onclick: () => endRec(false) }, '🗑️'), h('button', { class: 'btn', onclick: () => endRec(true) }, 'Send'));
}

function bubble(m, c, pop) {
  if (m.kind === 'call') return h('div', { class: 'sys' }, '📞 ' + m.body + ' · ' + new Date(m.created).toLocaleTimeString([], hm));
  const mine = m.sender_id === S.me.id, who = c.members.find(u => u.id === m.sender_id);
  const media = m.deleted ? null : m.kind === 'image' ? h('img', { class: 'zoom', src: m.file_url, alt: m.file_name || 'Image', loading: 'lazy', onclick: () => dialog('Photo', [h('img', { class: 'big', src: m.file_url, alt: m.file_name || 'Image' })]) }) : m.kind === 'video' ? h('video', { src: m.file_url, controls: true, preload: 'metadata' }) : m.kind === 'audio' ? h('audio', { src: m.file_url, controls: true, preload: 'metadata', 'aria-label': 'Voice message' }) : m.file_url ? h('a', { href: m.file_url, target: '_blank', rel: 'noopener', download: m.file_name }, '📎 ' + (m.file_name || 'File')) : null;
  const rx = Object.entries(m.reactions || {});
  const el = h('article', { class: 'm' + (mine ? ' me' : '') + (pop ? ' pop' : ''), 'data-id': m.id, ondblclick: ev => { if (!m.deleted) { S.sock.emit('reaction', { id: m.id, emoji: '❤️' }); burst(ev.clientX, ev.clientY, '❤️'); } } },
    !mine && c.type === 'group' && h('div', { class: 'who' }, who?.name || 'Someone'),
    m.reply && h('div', { class: 'quote' }, h('b', {}, (c.members.find(u => u.id === m.reply.sender_id)?.name || '') + ' '), m.reply.body.slice(0, 80)),
    media, (m.body || m.deleted) && h('p', { class: m.deleted ? 'muted' : '' }, m.deleted ? 'This message was deleted' : linkify(m.body)),
    rx.length > 0 && h('div', { class: 'rx' }, rx.map(([e, us]) => h('button', { class: us.includes(S.me.id) ? 'mine' : '', 'aria-label': `${e} from ${us.length}`, onclick: ev => { S.sock.emit('reaction', { id: m.id, emoji: e }); burst(ev.clientX, ev.clientY, e); } }, e + ' ' + us.length))),
    h('div', { class: 'meta' }, m.edited && !m.deleted && 'edited', new Date(m.created).toLocaleTimeString([], hm), mine && !m.deleted && h('span', { class: 'tick ' + m.status, 'aria-label': m.status }, m.status === 'sent' ? '✓' : '✓✓')),
    !m.deleted && h('button', { class: 'ic more', 'aria-label': 'Message actions', 'aria-haspopup': 'menu', onclick: e => { e.stopPropagation(); menu(el, m, mine); } }, '⋯'));
  return el;
}
function menu(el, m, mine) {
  document.querySelectorAll('.menu').forEach(x => x.remove());
  const item = (t, f) => h('button', { role: 'menuitem', onclick: () => { mm.remove(); f(); } }, t);
  const mm = h('div', { class: 'menu', role: 'menu' }, h('div', { class: 'emo' }, EMOJI.map(e => h('button', { 'aria-label': 'React ' + e, onclick: ev => { mm.remove(); S.sock.emit('reaction', { id: m.id, emoji: e }); burst(ev.clientX, ev.clientY, e); } }, e))),
    item('Reply', () => { S.reply = m; S.edit = null; renderBar(); $('textarea').focus(); }),
    m.kind === 'text' && item('Copy', () => navigator.clipboard?.writeText(m.body).then(() => toast('Copied')).catch(() => toast('Couldn’t copy'))),
    mine && m.kind === 'text' && item('Edit', () => { S.edit = m; S.reply = null; $('textarea').value = m.body; renderBar(); $('textarea').focus(); }),
    mine && item('Delete', () => confirm('Delete this message for everyone?') && S.sock.emit('message:delete', { id: m.id })));
  el.append(mm); mm.querySelector('button').focus();
}
document.addEventListener('click', () => document.querySelectorAll('.menu,.emojis').forEach(x => x.remove()));
document.addEventListener('keydown', e => e.key === 'Escape' && document.querySelectorAll('.menu,.emojis').forEach(x => x.remove()));
function renderMsgs(bottom) {
  const box = $('#msgs'), c = cur(); if (!box || !c) return;
  const near = bottom || box.scrollHeight - box.scrollTop - box.clientHeight < 120, seen = S.seen[c.id], list = S.msgs[c.id] || [], nodes = []; let day = '';
  for (const m of list) { const d = dayLabel(m.created); if (d !== day) { day = d; nodes.push(h('div', { class: 'day' }, d)); } nodes.push(bubble(m, c, seen !== undefined && m.id > seen)); }
  (S.pending[c.id] || []).forEach(p => nodes.push(pendingBubble(p)));
  if (!nodes.length) nodes.push(h('p', { class: 'empty' }, 'No messages yet. Say hello.'));
  box.replaceChildren(...nodes); S.seen[c.id] = list.reduce((a, m) => Math.max(a, m.id), 0);
  if (near) box.scrollTop = box.scrollHeight; paintJump();
}
const dayLabel = t => { const d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString() ? 'Today' : d.toDateString() === new Date(n - 864e5).toDateString() ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }); };
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
  s.on('connect', async () => { banner(); s.emit('vis', { visible: document.visibilityState === 'visible' }); Object.values(S.pending).flat().filter(p => p.state === 'queued').forEach(deliver); if (S.me && $('#app')) { await loadConvs(); if (S.cur) S.msgs[S.cur] = await api(`/conversations/${S.cur}/messages`); renderList(); renderMsgs(); markRead(); } });
  s.on('disconnect', () => banner('Connection lost. Reconnecting…'));
  s.on('connect_error', e => e.message === 'unauthorized' ? logout() : banner('Can’t reach the server. Retrying…'));
  s.on('presence:list', l => { S.online = new Set(l); $('#sub') && cur() && ($('#sub').textContent = chatSub(cur())); });
  s.on('presence', p => { p.online ? S.online.add(p.user_id) : S.online.delete(p.user_id); $('#sub') && cur() && ($('#sub').textContent = chatSub(cur())); });
  s.on('conv:new', c => { addConv(c); renderList(); });
  s.on('friend:update', async ({ type, from }) => { await loadFriends(); if (type === 'request') toast(from.name + ' sent you a friend request', friendsDialog); if (type === 'accepted') toast(from.name + ' accepted your friend request'); });
  s.on('message:new', async m => {
    if (!conv(m.conv_id)) await loadConvs();
    const c = conv(m.conv_id); if (!c) return;
    const bx = $('#msgs'), away = S.cur === c.id && bx && bx.scrollHeight - bx.scrollTop - bx.clientHeight >= 120;
    patchMsg(m); c.last = m; delete S.typing[c.id]?.[m.sender_id]; paintTyping();
    const seen = S.cur === c.id && document.visibilityState === 'visible';
    if (m.sender_id !== S.me.id) { if (seen) { markRead(); blip(660); } else c.unread++; notify(c, m); }
    renderList(); if (S.cur === c.id) { renderMsgs(); if (away && m.sender_id !== S.me.id) S.below++; paintJump(); }
  });
  s.on('message:update', m => { patchMsg(m); const c = conv(m.conv_id); if (c?.last?.id === m.id) c.last = m; renderList(); if (S.cur === m.conv_id) renderMsgs(); });
  s.on('status', ({ conv_id, items }) => { for (const i of items) { const m = S.msgs[conv_id]?.find(x => x.id === i.id); if (m) m.status = i.status; } if (S.cur === conv_id) renderMsgs(); });
  s.on('typing', ({ conv_id, user_id, on }) => { setTimeout(paintTyping, 0);
    const t = S.typing[conv_id] ??= {}; clearTimeout(t[user_id]); delete t[user_id];
    if (on) t[user_id] = setTimeout(() => { delete t[user_id]; renderList(); paintTyping(); $('#sub') && cur() && ($('#sub').textContent = chatSub(cur())); }, 4000);
    renderList(); $('#sub') && cur() && ($('#sub').textContent = chatSub(cur()));
  });
  callEvents(s);
}
const focus = () => window.focus();
window.addEventListener('focus', markRead); document.addEventListener('visibilitychange', () => { S.sock?.emit('vis', { visible: document.visibilityState === 'visible' }); markRead(); });

// ---------- dialogs ----------
function groupDialog() {
  const picked = new Map(), name = h('input', { placeholder: 'Group name', maxlength: 40, 'aria-label': 'Group name' }), res = h('div', { class: 'res' }), chips = h('div', { class: 'chips' });
  const paint = () => chips.replaceChildren(...[...picked.values()].map(u => h('button', { type: 'button', class: 'chip', 'aria-label': 'Remove ' + u.name, onclick: () => { picked.delete(u.id); paint(); } }, u.name + ' ✕')));
  const show = () => { const t = q.value.toLowerCase(); res.replaceChildren(...(S.friends.friends.length ? S.friends.friends.filter(u => !t || u.name.toLowerCase().includes(t) || u.username.includes(t)).map(u => h('button', { type: 'button', onclick: () => { picked.set(u.id, u); paint(); } }, u.name + ' @' + u.username)) : [h('small', {}, 'Add friends first, then you can put them in a group.')])); };
  const q = h('input', { type: 'search', placeholder: 'Choose from your friends', 'aria-label': 'Add friends', oninput: show }); show();
  dialog('New group', [name, q, res, chips], 'Create group', async () => { const c = await api('/conversations', { method: 'POST', body: { name: name.value, userIds: [...picked.keys()] } }); addConv(c); openConv(c.id); });
}
function settings() {
  const name = h('input', { value: S.me.name, maxlength: 40 }), status = h('input', { value: S.me.status, maxlength: 120 });
  const snd = h('input', { type: 'checkbox', checked: localStorage.getItem('sound') !== 'off', style: 'width:auto' }), rr = h('input', { type: 'checkbox', checked: S.me.read_receipts, style: 'width:auto' }), th = h('select', {}, ['', 'light', 'dark'].map(v => h('option', { value: v, selected: (localStorage.getItem('theme') || '') === v }, v ? v[0].toUpperCase() + v.slice(1) : 'Match my device')));
  const pic = h('input', { type: 'file', accept: 'image/*', onchange: async () => { const fd = new FormData(); fd.append('file', pic.files[0]); try { S.me = await api('/me/avatar', { method: 'POST', body: fd }); toast('Profile photo updated'); } catch (e) { toast(e.message); } } });
  dialog('Settings', [h('label', {}, 'Name', name), h('label', {}, 'Status', status), h('label', {}, 'Profile photo', pic), h('label', { class: 'row' }, rr, 'Send read receipts'), h('label', { class: 'row' }, snd, 'Message sounds'), h('label', {}, 'Theme', th),
    h('button', { class: 'btn ghost', type: 'button', onclick: enableNotifications }, 'Enable notifications'),
    h('button', { class: 'btn ghost', type: 'button', onclick: logout }, 'Sign out')], 'Save', async () => {
    S.me = await api('/me', { method: 'PATCH', body: { name: name.value, status: status.value, read_receipts: rr.checked } }); th.value ? localStorage.setItem('theme', th.value) : localStorage.removeItem('theme'); localStorage.setItem('sound', snd.checked ? 'on' : 'off'); theme(); });
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
     c.video && c.local && btn('', 'Switch between front and back camera', '🔄', flipCam),
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
// ---------- feel: fixed layout, ripples, bubbles, typing, jump, emoji, sounds ----------
const fit = () => { document.documentElement.style.setProperty('--app-h', (window.visualViewport?.height || innerHeight) + 'px'); window.scrollTo(0, 0); };
window.visualViewport?.addEventListener('resize', fit); window.visualViewport?.addEventListener('scroll', fit); addEventListener('resize', fit); fit();
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('button,.item'); if (!el || reduced()) return;
  const r = el.getBoundingClientRect(), z = Math.max(r.width, r.height) * 2, s = h('span', { class: 'ripple', 'aria-hidden': 'true' });
  s.style.cssText = `width:${z}px;height:${z}px;left:${e.clientX - r.left - z / 2}px;top:${e.clientY - r.top - z / 2}px`; el.append(s); s.addEventListener('animationend', () => s.remove());
});
function burst(x, y, emoji) {
  if (reduced()) return; if (!x && !y) { x = innerWidth / 2; y = innerHeight / 2; }
  for (let i = 0; i < 7; i++) { const s = h('span', { class: 'fly', 'aria-hidden': 'true' }, emoji); s.style.cssText = `left:${x}px;top:${y}px;--dx:${Math.random() * 120 - 60}px;--dy:${-(80 + Math.random() * 100)}px;animation-delay:${i * 50}ms`; s.addEventListener('animationend', () => s.remove()); document.body.append(s); }
}
function bubbles() { const w = h('div', { class: 'bubbles', 'aria-hidden': 'true' }); for (let i = 0; i < 10; i++) { const s = h('span'), z = 18 + Math.random() * 46; s.style.cssText = `left:${Math.random() * 100}%;width:${z}px;height:${z}px;animation-duration:${14 + Math.random() * 16}s;animation-delay:-${Math.random() * 20}s`; w.append(s); } return w; }
function paintTyping() {
  const t = $('#tp'), c = cur(); if (!t || !c) return; const ids = Object.keys(S.typing[c.id] || {}).map(Number); t.hidden = !ids.length; if (!ids.length) return;
  t.replaceChildren(h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('small', {}, ids.map(i => c.members.find(u => u.id === i)?.name || 'Someone').join(', ') + ' typing…'));
}
function paintJump() {
  const b = $('#msgs'), j = $('#jump'); if (!b || !j) return; const away = b.scrollHeight - b.scrollTop - b.clientHeight > 200; if (!away) S.below = 0;
  j.hidden = !away; j.replaceChildren('↓', S.below > 0 && h('span', { class: 'badge' }, S.below));
}
const linkify = t => t.split(/(https?:\/\/[^\s]+)/g).map((p, i) => i % 2 ? h('a', { href: p, target: '_blank', rel: 'noopener noreferrer nofollow' }, p) : p);
const grow = el => { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'; };
const EMOJIS = '😀 😂 🥹 😍 😘 😎 🤔 😅 😭 😡 🥳 🤝 👍 👎 👏 🙏 💪 🙌 🔥 ❤️ 💔 ✨ 🎉 💯 ✅ ❌ 👀 🤗 😴 🤯 😇 🙈'.split(' ');
function emojiPicker(e) {
  e.stopPropagation(); const old = $('.emojis'); if (old) return old.remove(); const ta = $('textarea');
  $('.composer').append(h('div', { class: 'emojis', role: 'dialog', 'aria-label': 'Emoji' }, EMOJIS.map(x => h('button', { type: 'button', 'aria-label': x, onclick: ev => { ev.stopPropagation(); const s = ta.selectionStart ?? ta.value.length; ta.setRangeText(x, s, ta.selectionEnd ?? s, 'end'); ta.dispatchEvent(new Event('input')); ta.focus(); } }, x))));
}
let ac; addEventListener('pointerdown', () => { ac ??= new (window.AudioContext || window.webkitAudioContext)(); }, { once: true });
function blip(f, d = .09) {
  if (!ac || localStorage.getItem('sound') === 'off') return; const o = ac.createOscillator(), g = ac.createGain();
  o.frequency.value = f; g.gain.setValueAtTime(.06, ac.currentTime); g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + d); o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + d);
}

// ---------- camera flip ----------
async function flipCam() {
  const c = S.call; if (!c?.local) return;
  const prev = c.facing || 'user', next = prev === 'user' ? 'environment' : 'user', old = c.local.getVideoTracks()[0]; old?.stop();
  const get = f => navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: f } } });
  let ns; try { ns = await get(next); c.facing = next; } catch { try { ns = await get(prev); } catch { return toast('Couldn’t access the camera.'); } toast('No other camera found on this device.'); }
  const nt = ns.getVideoTracks()[0], sender = c.pc?.getSenders().find(x => x.track?.kind === 'video');
  old && c.local.removeTrack(old); c.local.addTrack(nt); await sender?.replaceTrack(nt);
  lv.srcObject = c.local; lv.style.transform = (c.facing || 'user') === 'user' ? 'scaleX(-1)' : 'none'; paintCall();
}

// ---------- friends ----------
let friendsBox = null;
const loadFriends = async () => { S.friends = await api('/friends'); paintBadge(); paintFriends(); };
function paintBadge() { const b = $('#frbadge'); if (b) { b.hidden = !S.friends.incoming.length; b.textContent = S.friends.incoming.length; } }
function paintFriends() {
  if (!friendsBox || !friendsBox.isConnected) return; const F = S.friends;
  const act = (p, o) => async () => { try { await api(p, o); await loadFriends(); } catch (e) { toast(e.message); } };
  const row = (u, ...btns) => h('div', { class: 'row' }, avatar(u, 36), h('span', { class: 'sp' }, h('b', {}, u.name), h('small', { style: 'display:block' }, '@' + u.username)), ...btns);
  friendsBox.replaceChildren(
    h('h3', {}, 'Requests (' + F.incoming.length + ')'),
    ...(F.incoming.length ? F.incoming.map(u => row(u, h('button', { class: 'btn', onclick: act('/friends/' + u.id + '/accept', { method: 'POST' }) }, 'Accept'), h('button', { class: 'btn ghost', 'aria-label': 'Decline ' + u.name, onclick: act('/friends/' + u.id, { method: 'DELETE' }) }, 'Decline'))) : [h('small', {}, 'No pending requests')]),
    h('h3', {}, 'Friends (' + F.friends.length + ')'),
    ...(F.friends.length ? F.friends.map(u => row(u, h('button', { class: 'btn', onclick: () => chatWith(u.id) }, 'Message'), h('button', { class: 'btn ghost', 'aria-label': 'Remove ' + u.name, onclick: () => confirm('Remove ' + u.name + ' from your friends?') && act('/friends/' + u.id, { method: 'DELETE' })() }, 'Remove'))) : [h('small', {}, 'Search a username to send your first request')]),
    F.outgoing.length > 0 && h('h3', {}, 'Sent requests'),
    ...F.outgoing.map(u => row(u, h('button', { class: 'btn ghost', onclick: act('/friends/' + u.id, { method: 'DELETE' }) }, 'Cancel'))));
}
function friendsDialog() { friendsBox = h('div', { style: 'display:flex;flex-direction:column;gap:10px;max-height:60vh;overflow:auto' }); dialog('Friends', [friendsBox]); paintFriends(); }

// ---------- push notifications (work with the app closed) ----------
const b64 = s => Uint8Array.from(atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register('/sw.js'); navigator.serviceWorker.addEventListener('message', e => e.data?.open && openConv(+e.data.open)); } catch (e) { console.warn('sw', e); }
}
async function syncPush() {
  if (!('serviceWorker' in navigator && 'PushManager' in window) || !('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const { key } = await api('/push/key'); if (!key) return false;
    const reg = await navigator.serviceWorker.ready; let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
    await api('/push/subscribe', { method: 'POST', body: sub.toJSON() }); return true;
  } catch (e) { console.warn('push', e); return false; }
}
async function enableNotifications() {
  if (!('Notification' in window)) return toast('This browser does not support notifications');
  if ((await Notification.requestPermission()) !== 'granted') return toast('Notifications are blocked. Allow them in your browser or site settings.');
  toast((await syncPush()) ? 'Notifications on, even when the app is closed' : 'Notifications on while the app is open. Push is not set up on the server yet.');
}
boot();
})();
