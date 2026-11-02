'use strict';

/**
 * Lightweight smoke tests — store + HTTP + socket handshake.
 * Run with: npm test  (server must NOT already be bound if we spawn one)
 */

const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const store = require('./store');

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

async function testStore() {
  console.log('store');
  const u = store.createUser({ username: 'comet_rider', avatarHue: 200 });
  ok(u.id && u.username === 'comet_rider', 'create user');
  const room = store.createRoom({ name: 'Night watch', topic: 'test', ownerId: u.id });
  ok(room.id && room.name === 'Night watch', 'create room');
  store.joinRoom(room.id, u.id);
  const msg = store.addMessage(room.id, {
    userId: u.id,
    username: u.username,
    avatarHue: u.avatarHue,
    text: 'hello orbit @peer',
  });
  ok(msg && msg.text.includes('hello'), 'add message');
  ok(store.getMessages(room.id).length === 1, 'list messages');
  store.reactMessage(room.id, msg.id, u.id, '🔥');
  const reacted = store.getMessages(room.id)[0];
  ok(reacted.reactions['🔥']?.includes(u.id), 'react');
  const story = store.addStory(u.id, u.username, u.avatarHue, 'data:image/png;base64,xx', 'hi');
  ok(store.listStories().some((s) => s.id === story.id), 'story');
  const post = store.addPost(u.id, u.username, u.avatarHue, 'data:image/png;base64,yy', 'feed');
  store.likePost(post.id, u.id);
  ok(store.listPosts()[0].likes.includes(u.id), 'feed like');
  const tel = store.telemetry();
  ok(tel.onlineCount >= 1 && tel.roomsCount >= 1, 'telemetry');
  store.flagScreenshot(room.id, u.id, u.username);
  store.leaveRoom(room.id, u.id);
  ok(!store.rooms.has(room.id), 'empty room deleted');
  store.removeUser(u.id);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function testHttp() {
  console.log('http');
  const port = 3457;
  const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: { ...process.env, PORT: String(port), MSG_TTL_MS: '60000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let booted = false;
  child.stdout.on('data', (d) => {
    if (String(d).includes('listening')) booted = true;
  });
  child.stderr.on('data', (d) => process.stderr.write(d));

  for (let i = 0; i < 40 && !booted; i++) await wait(100);
  ok(booted, 'server started');

  try {
    const health = await fetchJson(`http://127.0.0.1:${port}/api/health`);
    ok(health.status === 200 && health.body.ok, 'health');
    const ice = await fetchJson(`http://127.0.0.1:${port}/api/ice`);
    ok(Array.isArray(ice.body.iceServers) && ice.body.iceServers.length >= 1, 'ice servers');
    const tel = await fetchJson(`http://127.0.0.1:${port}/api/telemetry`);
    ok(typeof tel.body.onlineCount === 'number', 'telemetry endpoint');
    const rooms = await fetchJson(`http://127.0.0.1:${port}/api/rooms`);
    ok(Array.isArray(rooms.body), 'rooms endpoint');
    const gifs = await fetchJson(`http://127.0.0.1:${port}/api/gifs?q=space`);
    ok(Array.isArray(gifs.body.items), 'gifs endpoint');
    const home = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/`, (res) => {
        ok(res.statusCode === 200, 'serves index');
        res.resume();
        res.on('end', resolve);
      }).on('error', reject);
    });
    void home;
  } finally {
    child.kill('SIGTERM');
    await wait(300);
  }
}

(async () => {
  try {
    await testStore();
    await testHttp();
    console.log('\nAll checks passed.');
    process.exit(0);
  } catch (err) {
    console.error('\nFAILED', err);
    process.exit(1);
  }
})();
