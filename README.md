# Nebula

Ephemeral space-themed chat. Username only — no passwords, no database. Messages, stories, and posts live in process memory and burn on a timer. Restart the server and the slate is clean.

## Features

- **Rooms** — create / join group orbits (text or voice lobby)
- **Realtime chat** — Socket.IO, typing indicators, reactions, mentions, image + GIF attach
- **Direct messages** — private signals between online users
- **Stories & feed** — short-lived Instagram-style posts
- **Voice / video** — WebRTC mesh with public STUN; optional TURN via env
- **Live telemetry** — online crew, room counts, in-flight payload
- **Privacy cues** — screenshot-key signals announced in-room; nothing written to disk for chat data

## Quick start

```bash
cp .env.example .env
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000), pick a callsign, create a room.

```bash
npm test
```

## Deploy on Render

1. Push this repo to GitHub.
2. New → Web Service → connect the repo (or use `render.yaml`).
3. Build: `npm install` · Start: `npm start`.
4. Set optional env from `.env.example` (`TENOR_API_KEY`, `TURN_*`).
5. Health check path: `/api/health`.

Free Render instances sleep when idle — that also wipes memory (by design for this app).

## TURN / STUN

Public STUN is always on (`stun.l.google.com`, Cloudflare). For reliable calls through hard NATs, add a TURN provider and set:

- `TURN_URL`
- `TURN_USERNAME`
- `TURN_CREDENTIAL`

## Architecture

```
Browser ──WSS──► Nebula node (RAM only)
                └── signals WebRTC ◄──► STUN/TURN (media P2P)
```

No message DB. Media in chat is base64 in memory with TTL. WebRTC media does not land on the chat server disk.
