'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const store = require('./store');
const { iceServers } = require('./ice');

const PORT = Number(process.env.PORT || 3000);
const TENOR_KEY = process.env.TENOR_API_KEY || 'LIVDSRZULELA'; // Tenor's public demo key
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 4e6,
});

app.use(cors());
app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, privacy: 'ephemeral-memory-only', ts: Date.now() });
});

app.get('/api/ice', (_req, res) => {
  res.json({ iceServers: iceServers() });
});

app.get('/api/telemetry', (_req, res) => {
  res.json(store.telemetry());
});

app.get('/api/rooms', (_req, res) => {
  res.json(store.listRooms());
});

app.get('/api/gifs', async (req, res) => {
  try {
    const q = encodeURIComponent(String(req.query.q || 'space').slice(0, 64));
    const url = `https://tenor.googleapis.com/v2/search?q=${q}&key=${TENOR_KEY}&limit=24&media_filter=gif,tinygif`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('tenor ' + r.status);
    const data = await r.json();
    const items = (data.results || []).map((g) => ({
      id: g.id,
      url: g.media_formats?.gif?.url || g.media_formats?.tinygif?.url,
      preview: g.media_formats?.tinygif?.url || g.media_formats?.gif?.url,
      desc: g.content_description || '',
    })).filter((x) => x.url);
    res.json({ items });
  } catch (err) {
    res.json({
      items: FALLBACK_GIFS,
      fallback: true,
      error: String(err.message || err),
    });
  }
});

const FALLBACK_GIFS = [
  { id: '1', url: 'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif', preview: 'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/200.gif', desc: 'nebula' },
  { id: '2', url: 'https://media.giphy.com/media/l0MYC0LajbaPoEADu/giphy.gif', preview: 'https://media.giphy.com/media/l0MYC0LajbaPoEADu/200.gif', desc: 'stars' },
  { id: '3', url: 'https://media.giphy.com/media/3o7aD2saalBwwftBIY/giphy.gif', preview: 'https://media.giphy.com/media/3o7aD2saalBwwftBIY/200.gif', desc: 'orbit' },
  { id: '4', url: 'https://media.giphy.com/media/26tn33ai9ld46SJHW/giphy.gif', preview: 'https://media.giphy.com/media/26tn33ai9ld46SJHW/200.gif', desc: 'galaxy' },
  { id: '5', url: 'https://media.giphy.com/media/l41lGvinEgARjB0fK/giphy.gif', preview: 'https://media.giphy.com/media/l41lGvinEgARjB0fK/200.gif', desc: 'comet' },
  { id: '6', url: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif', preview: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/200.gif', desc: 'rocket' },
];

const socketsByUser = new Map();

io.on('connection', (socket) => {
  let user = null;

  socket.emit('hello', {
    iceServers: iceServers(),
    ttl: {
      messageMs: store.TTL_MSG_MS,
      storyMs: store.TTL_STORY_MS,
      postMs: store.TTL_POST_MS,
    },
  });

  socket.on('auth:join', (payload, cb) => {
    try {
      const username = String(payload?.username || '').trim();
      if (!username || username.length < 2) {
        return cb?.({ ok: false, error: 'Username needs at least 2 characters' });
      }
      if (!/^[a-zA-Z0-9_\-. ]{2,24}$/.test(username)) {
        return cb?.({ ok: false, error: 'Use letters, numbers, _ - . or spaces' });
      }
      user = store.createUser({
        username,
        avatarHue: Number(payload?.avatarHue) || Math.floor(Math.random() * 360),
      });
      socketsByUser.set(user.id, socket.id);
      socket.join('lobby');
      socket.data.userId = user.id;
      io.emit('telemetry', store.telemetry());
      io.emit('presence:update', store.telemetry().online);
      cb?.({ ok: true, user });
    } catch (e) {
      cb?.({ ok: false, error: String(e.message || e) });
    }
  });

  socket.on('room:list', (_p, cb) => cb?.({ ok: true, rooms: store.listRooms() }));

  socket.on('room:create', (payload, cb) => {
    if (!user) return cb?.({ ok: false, error: 'Join with a username first' });
    const room = store.createRoom({
      name: payload?.name,
      topic: payload?.topic,
      ownerId: user.id,
      kind: payload?.kind,
    });
    socket.join(room.id);
    store.joinRoom(room.id, user.id);
    io.emit('room:upsert', room);
    io.emit('telemetry', store.telemetry());
    cb?.({ ok: true, room });
  });

  socket.on('room:join', (payload, cb) => {
    if (!user) return cb?.({ ok: false, error: 'Join with a username first' });
    const room = store.joinRoom(payload?.roomId, user.id);
    if (!room) return cb?.({ ok: false, error: 'Room gone — already burned' });
    socket.join(room.id);
    const history = store.getMessages(room.id);
    socket.to(room.id).emit('room:member', { room, user, action: 'join' });
    io.emit('room:upsert', room);
    io.emit('telemetry', store.telemetry());
    cb?.({ ok: true, room, messages: history });
  });

  socket.on('room:leave', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const result = store.leaveRoom(payload?.roomId, user.id);
    socket.leave(payload?.roomId);
    if (result?.deleted) io.emit('room:gone', { id: result.id });
    else if (result) {
      socket.to(result.id).emit('room:member', { room: result, user, action: 'leave' });
      io.emit('room:upsert', result);
    }
    io.emit('telemetry', store.telemetry());
    cb?.({ ok: true, result });
  });

  socket.on('chat:send', (payload, cb) => {
    if (!user) return cb?.({ ok: false, error: 'Not joined' });
    const roomId = payload?.roomId;
    if (!roomId || !store.rooms.has(roomId)) {
      return cb?.({ ok: false, error: 'Room missing' });
    }
    const msg = store.addMessage(roomId, {
      userId: user.id,
      username: user.username,
      avatarHue: user.avatarHue,
      type: payload.type || 'text',
      text: payload.text,
      media: payload.media,
      gifUrl: payload.gifUrl,
      replyTo: payload.replyTo,
    });
    io.to(roomId).emit('chat:message', msg);
    cb?.({ ok: true, message: msg });
  });

  socket.on('chat:react', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const m = store.reactMessage(payload.roomId, payload.messageId, user.id, payload.emoji);
    if (!m) return cb?.({ ok: false });
    io.to(payload.roomId).emit('chat:reacted', m);
    cb?.({ ok: true, message: m });
  });

  socket.on('chat:read', (payload) => {
    if (!user) return;
    const m = store.markRead(payload.roomId, payload.messageId, user.id);
    if (m) socket.to(payload.roomId).emit('chat:read', { messageId: m.id, userId: user.id, readBy: m.readBy });
  });

  socket.on('chat:typing', (payload) => {
    if (!user || !payload?.roomId) return;
    socket.to(payload.roomId).emit('chat:typing', {
      roomId: payload.roomId,
      userId: user.id,
      username: user.username,
    });
  });

  socket.on('dm:send', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const toId = payload?.toId;
    if (!toId || !store.getUser(toId)) return cb?.({ ok: false, error: 'User offline or gone' });
    const msg = store.addDm(user.id, toId, payload);
    const targetSid = socketsByUser.get(toId);
    if (targetSid) io.to(targetSid).emit('dm:message', msg);
    socket.emit('dm:message', msg);
    cb?.({ ok: true, message: msg });
  });

  socket.on('dm:history', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    cb?.({ ok: true, messages: store.getDms(user.id, payload?.toId) });
  });

  socket.on('story:add', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    if (!payload?.media) return cb?.({ ok: false, error: 'Need media' });
    const story = store.addStory(user.id, user.username, user.avatarHue, payload.media, payload.caption);
    io.emit('story:new', story);
    io.emit('telemetry', store.telemetry());
    cb?.({ ok: true, story });
  });

  socket.on('story:list', (_p, cb) => cb?.({ ok: true, stories: store.listStories() }));

  socket.on('story:view', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const s = store.viewStory(payload?.id, user.id);
    if (s) io.emit('story:viewed', { id: s.id, views: s.views.length });
    cb?.({ ok: true, story: s });
  });

  socket.on('feed:add', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const post = store.addPost(user.id, user.username, user.avatarHue, payload.media, payload.caption);
    io.emit('feed:new', post);
    io.emit('telemetry', store.telemetry());
    cb?.({ ok: true, post });
  });

  socket.on('feed:list', (_p, cb) => cb?.({ ok: true, posts: store.listPosts() }));

  socket.on('feed:like', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const p = store.likePost(payload?.id, user.id);
    if (p) io.emit('feed:liked', p);
    cb?.({ ok: true, post: p });
  });

  socket.on('feed:comment', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const p = store.commentPost(payload?.id, user.id, user.username, payload?.text);
    if (p) io.emit('feed:commented', p);
    cb?.({ ok: true, post: p });
  });

  socket.on('privacy:screenshot', (payload) => {
    if (!user) return;
    const roomId = payload?.roomId;
    if (!roomId) return;
    const entry = store.flagScreenshot(roomId, user.id, user.username);
    io.to(roomId).emit('privacy:screenshot', {
      ...entry,
      notice: `${user.username} may have captured the screen`,
    });
  });

  // WebRTC signaling (mesh) — STUN/TURN from /api/ice
  socket.on('rtc:offer', (payload) => {
    if (!user) return;
    const sid = socketsByUser.get(payload?.toId);
    if (sid) {
      io.to(sid).emit('rtc:offer', {
        fromId: user.id,
        fromName: user.username,
        sdp: payload.sdp,
        callType: payload.callType || 'video',
        roomId: payload.roomId,
      });
    }
  });

  socket.on('rtc:answer', (payload) => {
    if (!user) return;
    const sid = socketsByUser.get(payload?.toId);
    if (sid) {
      io.to(sid).emit('rtc:answer', { fromId: user.id, sdp: payload.sdp });
    }
  });

  socket.on('rtc:ice', (payload) => {
    if (!user) return;
    const sid = socketsByUser.get(payload?.toId);
    if (sid) {
      io.to(sid).emit('rtc:ice', { fromId: user.id, candidate: payload.candidate });
    }
  });

  socket.on('rtc:hangup', (payload) => {
    if (!user) return;
    const sid = socketsByUser.get(payload?.toId);
    if (sid) io.to(sid).emit('rtc:hangup', { fromId: user.id });
    store.setPresence(user.id, { status: 'online' });
    io.emit('telemetry', store.telemetry());
  });

  socket.on('presence:set', (payload) => {
    if (!user) return;
    store.setPresence(user.id, { status: payload?.status || 'online' });
    io.emit('telemetry', store.telemetry());
    io.emit('presence:update', store.telemetry().online);
  });

  socket.on('disconnect', () => {
    if (!user) return;
    socketsByUser.delete(user.id);
    for (const [roomId, room] of store.rooms) {
      if (room.members.has(user.id)) {
        const result = store.leaveRoom(roomId, user.id);
        if (result?.deleted) io.emit('room:gone', { id: result.id });
        else if (result) {
          io.to(roomId).emit('room:member', { room: result, user, action: 'leave' });
          io.emit('room:upsert', result);
        }
      }
    }
    store.removeUser(user.id);
    io.emit('telemetry', store.telemetry());
    io.emit('presence:update', store.telemetry().online);
  });
});

setInterval(() => {
  io.emit('telemetry', store.telemetry());
}, 8_000);

server.listen(PORT, () => {
  console.log(`Nebula listening on :${PORT}`);
});
