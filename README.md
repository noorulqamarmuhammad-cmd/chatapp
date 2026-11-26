# Pulse — real-time chat

WhatsApp-style messaging with 1:1 and group chats, media, WebRTC voice/video calls, reactions, replies, edit/delete, pinned chats, message search and notifications.

## Stack (one line each)
- **Node.js + Express** — small, ubiquitous HTTP layer for auth, REST and uploads.
- **Socket.IO** — WebSockets with automatic reconnection, rooms and acknowledgements; carries messages, receipts, typing, presence and call signaling.
- **SQLite (better-sqlite3)** — zero-setup, transactional, persistent storage; swap for Postgres when you need multiple servers.
- **bcryptjs + JWT** — salted password hashing and stateless auth shared by the REST API and the socket handshake.
- **multer, helmet, express-rate-limit** — validated uploads, secure headers/CSP, and brute-force/flood protection.
- **Vanilla JS + CSS variables (no build step)** — fewer moving parts; all user text is rendered with `textContent`, so it can't inject HTML.
- **WebRTC** — peer-to-peer audio/video; the socket server only relays SDP/ICE.
- **node:test + socket.io-client** — built-in runner, real server and real sockets in tests.

## Run locally
```bash
npm install
cp .env.example .env     # set JWT_SECRET
npm start                # http://localhost:3000
npm test
```
Open two browsers (or one normal + one private window), sign up two users, search for the other's username, and chat or call. Camera/mic need `localhost` or HTTPS.

## Environment variables
| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `JWT_SECRET` | dev value | **Required in production** (server refuses to start without it) |
| `DB_FILE` | ./data/pulse.db | SQLite file |
| `UPLOAD_DIR` | ./data/uploads | Uploaded media |
| `MAX_UPLOAD_MB` | 15 | Upload size limit |
| `AUTH_RATE_LIMIT` | 20 | Login/signup attempts per 15 min per IP |
| `MSG_BURST` | 20 | Messages per 10 s per socket |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | unset | Web Push keys. Run `npm run vapid` once and paste the three lines into your host's variables. Without them the app works but cannot notify a closed app. |

## Layout
```
server/  config.js · db.js (schema, views) · app.js (REST, uploads, security) · realtime.js (sockets, receipts, calls) · index.js
client/  index.html · app.css (design tokens, light/dark) · app.js
test/    app.test.js  (auth + rate limit, delivery/receipts/edit/delete/react/search, call signaling incl. missed calls)
```

## Known gaps
- **Push notifications** (messages, calls, friend requests) use a service worker and Web Push, so they arrive with the tab or browser closed. Android Chrome works after the user taps Enable notifications. On iPhone the site must first be added to the Home Screen (iOS 16.4+). A pushed call is a notification that opens the app, not a native ringing screen, and it expires after about 30 seconds.
- **Calls** use a public STUN server only; add a TURN server to `ICE` in `client/app.js` for users behind strict NATs. One-to-one only, no ringtone sound. The camera-switch button needs a device with a second camera.
- **Thumbnails** are not generated (images are scaled by CSS); uploads are checked by MIME type/size and stored under random names, not by magic-byte sniffing. Uploaded files are served by unguessable URL rather than per-request auth.
- Group chats can't be edited after creation (no add/remove members). Pagination of older history is server-side (`?before=`) but the UI loads only the latest 50 messages.
- Single-process only: presence and call state live in memory (use the Socket.IO Redis adapter to scale out).
- Message search uses SQL `LIKE`; swap for SQLite FTS5 for large histories.
