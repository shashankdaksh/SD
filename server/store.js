'use strict';

/**
 * In-memory only. Process restart = wipe. No DB, no disk for chat data.
 */

const TTL_MSG_MS = Number(process.env.MSG_TTL_MS || 5 * 60 * 1000);
const TTL_STORY_MS = Number(process.env.STORY_TTL_MS || 30 * 60 * 1000);
const TTL_POST_MS = Number(process.env.POST_TTL_MS || 15 * 60 * 1000);
const TTL_ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MS || 60 * 60 * 1000);

const users = new Map(); // id -> user
const rooms = new Map(); // id -> room
const messages = new Map(); // roomId -> Message[]
const stories = new Map(); // id -> story
const posts = new Map(); // id -> post
const dmThreads = new Map(); // sortedPairKey -> Message[]
const presence = new Map(); // userId -> { status, lastSeen, roomId }
const screenshotFlags = new Map(); // roomId -> [{ userId, at }]

function now() {
  return Date.now();
}

function pairKey(a, b) {
  return [a, b].sort().join(':');
}

function createUser({ username, avatarHue }) {
  const id = `u_${Math.random().toString(36).slice(2, 10)}`;
  const user = {
    id,
    username: String(username).trim().slice(0, 24),
    avatarHue: avatarHue ?? Math.floor(Math.random() * 360),
    createdAt: now(),
    bio: '',
  };
  users.set(id, user);
  presence.set(id, { status: 'online', lastSeen: now(), roomId: null });
  return user;
}

function getUser(id) {
  return users.get(id) || null;
}

function setPresence(userId, patch) {
  const cur = presence.get(userId) || { status: 'offline', lastSeen: now(), roomId: null };
  const next = { ...cur, ...patch, lastSeen: now() };
  presence.set(userId, next);
  return next;
}

function telemetry() {
  const online = [];
  for (const [id, p] of presence) {
    const u = users.get(id);
    if (!u) continue;
    if (p.status === 'online' || p.status === 'away' || p.status === 'in-call') {
      online.push({
        id: u.id,
        username: u.username,
        avatarHue: u.avatarHue,
        status: p.status,
        roomId: p.roomId,
        lastSeen: p.lastSeen,
      });
    }
  }
  return {
    onlineCount: online.length,
    roomsCount: rooms.size,
    messagesInFlight: [...messages.values()].reduce((n, a) => n + a.length, 0),
    storiesActive: stories.size,
    postsActive: posts.size,
    online,
    ts: now(),
  };
}

function createRoom({ name, topic, ownerId, kind }) {
  const id = `r_${Math.random().toString(36).slice(2, 10)}`;
  const room = {
    id,
    name: String(name).trim().slice(0, 40) || 'Untitled orbit',
    topic: String(topic || '').slice(0, 120),
    ownerId,
    kind: kind === 'voice' ? 'voice' : 'text',
    members: new Set([ownerId]),
    createdAt: now(),
    lastActivity: now(),
  };
  rooms.set(id, room);
  messages.set(id, []);
  return serializeRoom(room);
}

function serializeRoom(room) {
  return {
    id: room.id,
    name: room.name,
    topic: room.topic,
    ownerId: room.ownerId,
    kind: room.kind,
    memberCount: room.members.size,
    members: [...room.members],
    createdAt: room.createdAt,
    lastActivity: room.lastActivity,
  };
}

function listRooms() {
  return [...rooms.values()]
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .map(serializeRoom);
}

function joinRoom(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.members.add(userId);
  room.lastActivity = now();
  setPresence(userId, { roomId, status: 'online' });
  return serializeRoom(room);
}

function leaveRoom(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.members.delete(userId);
  const p = presence.get(userId);
  if (p && p.roomId === roomId) setPresence(userId, { roomId: null });
  room.lastActivity = now();
  if (room.members.size === 0) {
    rooms.delete(roomId);
    messages.delete(roomId);
    return { deleted: true, id: roomId };
  }
  return serializeRoom(room);
}

function addMessage(roomId, msg) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const list = messages.get(roomId) || [];
  const full = {
    id: `m_${Math.random().toString(36).slice(2, 12)}`,
    roomId,
    userId: msg.userId,
    username: msg.username,
    avatarHue: msg.avatarHue,
    type: msg.type || 'text',
    text: msg.text ? String(msg.text).slice(0, 2000) : '',
    media: msg.media || null,
    gifUrl: msg.gifUrl || null,
    replyTo: msg.replyTo || null,
    reactions: {},
    createdAt: now(),
    expiresAt: now() + TTL_MSG_MS,
    readBy: [],
  };
  list.push(full);
  messages.set(roomId, list);
  room.lastActivity = now();
  return full;
}

function getMessages(roomId) {
  purgeExpired();
  return (messages.get(roomId) || []).slice(-200);
}

function reactMessage(roomId, messageId, userId, emoji) {
  const list = messages.get(roomId);
  if (!list) return null;
  const m = list.find((x) => x.id === messageId);
  if (!m) return null;
  if (!m.reactions[emoji]) m.reactions[emoji] = [];
  const i = m.reactions[emoji].indexOf(userId);
  if (i >= 0) m.reactions[emoji].splice(i, 1);
  else m.reactions[emoji].push(userId);
  if (m.reactions[emoji].length === 0) delete m.reactions[emoji];
  return m;
}

function markRead(roomId, messageId, userId) {
  const list = messages.get(roomId);
  if (!list) return null;
  const m = list.find((x) => x.id === messageId);
  if (!m) return null;
  if (!m.readBy.includes(userId)) m.readBy.push(userId);
  return m;
}

function addDm(fromId, toId, payload) {
  const key = pairKey(fromId, toId);
  const list = dmThreads.get(key) || [];
  const full = {
    id: `dm_${Math.random().toString(36).slice(2, 12)}`,
    thread: key,
    fromId,
    toId,
    type: payload.type || 'text',
    text: payload.text ? String(payload.text).slice(0, 2000) : '',
    media: payload.media || null,
    gifUrl: payload.gifUrl || null,
    createdAt: now(),
    expiresAt: now() + TTL_MSG_MS,
  };
  list.push(full);
  dmThreads.set(key, list);
  return full;
}

function getDms(a, b) {
  purgeExpired();
  return (dmThreads.get(pairKey(a, b)) || []).slice(-100);
}

function addStory(userId, username, avatarHue, media, caption) {
  const id = `s_${Math.random().toString(36).slice(2, 10)}`;
  const story = {
    id,
    userId,
    username,
    avatarHue,
    media,
    caption: String(caption || '').slice(0, 200),
    createdAt: now(),
    expiresAt: now() + TTL_STORY_MS,
    views: [],
  };
  stories.set(id, story);
  return story;
}

function listStories() {
  purgeExpired();
  return [...stories.values()].sort((a, b) => b.createdAt - a.createdAt);
}

function viewStory(id, userId) {
  const s = stories.get(id);
  if (!s) return null;
  if (!s.views.includes(userId)) s.views.push(userId);
  return s;
}

function addPost(userId, username, avatarHue, media, caption) {
  const id = `p_${Math.random().toString(36).slice(2, 10)}`;
  const post = {
    id,
    userId,
    username,
    avatarHue,
    media,
    caption: String(caption || '').slice(0, 500),
    createdAt: now(),
    expiresAt: now() + TTL_POST_MS,
    likes: [],
    comments: [],
  };
  posts.set(id, post);
  return post;
}

function listPosts() {
  purgeExpired();
  return [...posts.values()].sort((a, b) => b.createdAt - a.createdAt);
}

function likePost(id, userId) {
  const p = posts.get(id);
  if (!p) return null;
  const i = p.likes.indexOf(userId);
  if (i >= 0) p.likes.splice(i, 1);
  else p.likes.push(userId);
  return p;
}

function commentPost(id, userId, username, text) {
  const p = posts.get(id);
  if (!p) return null;
  const c = {
    id: `c_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    username,
    text: String(text).slice(0, 300),
    createdAt: now(),
  };
  p.comments.push(c);
  return p;
}

function flagScreenshot(roomId, userId, username) {
  const list = screenshotFlags.get(roomId) || [];
  const entry = { userId, username, at: now() };
  list.push(entry);
  screenshotFlags.set(roomId, list.slice(-20));
  return entry;
}

function purgeExpired() {
  const t = now();
  for (const [roomId, list] of messages) {
    messages.set(
      roomId,
      list.filter((m) => m.expiresAt > t)
    );
  }
  for (const [key, list] of dmThreads) {
    const next = list.filter((m) => m.expiresAt > t);
    if (next.length) dmThreads.set(key, next);
    else dmThreads.delete(key);
  }
  for (const [id, s] of stories) {
    if (s.expiresAt <= t) stories.delete(id);
  }
  for (const [id, p] of posts) {
    if (p.expiresAt <= t) posts.delete(id);
  }
  for (const [id, room] of rooms) {
    if (room.members.size === 0 && t - room.lastActivity > TTL_ROOM_IDLE_MS) {
      rooms.delete(id);
      messages.delete(id);
    }
  }
}

function removeUser(userId) {
  users.delete(userId);
  presence.delete(userId);
  for (const [roomId, room] of rooms) {
    if (room.members.has(userId)) leaveRoom(roomId, userId);
  }
}

setInterval(purgeExpired, 15_000);

module.exports = {
  createUser,
  getUser,
  setPresence,
  telemetry,
  createRoom,
  listRooms,
  joinRoom,
  leaveRoom,
  serializeRoom,
  addMessage,
  getMessages,
  reactMessage,
  markRead,
  addDm,
  getDms,
  addStory,
  listStories,
  viewStory,
  addPost,
  listPosts,
  likePost,
  commentPost,
  flagScreenshot,
  removeUser,
  purgeExpired,
  rooms,
  users,
  presence,
  TTL_MSG_MS,
  TTL_STORY_MS,
  TTL_POST_MS,
};
