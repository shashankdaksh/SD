(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const EMOJIS = '😀😁😂🤣😊😍🤩😘😋🤗🤔🤨😐😴🥺😢😭😡🤯✨🔥💫⭐🌙🚀🛸🛰️👽👾🪐🌌☄️💫❤️💙💜🖤👍👎👏🙌🎉✅❌⚡🛰️'.split('');

  const state = {
    user: null,
    roomId: null,
    rooms: [],
    view: 'chat',
    dmPeer: null,
    iceServers: null,
    ttlMsg: 300000,
    pendingOffer: null,
    typingTimer: null,
  };

  const socket = io({ transports: ['websocket', 'polling'] });
  NebulaRTC.bindSocket(socket);

  function avatarStyle(hue) {
    return `background:hsl(${hue||200} 55% 32%);color:#fff`;
  }
  function initials(name) {
    return String(name || '?').trim().slice(0, 2).toUpperCase();
  }
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function fmtTTL(ms) {
    const m = Math.round(ms / 60000);
    return m >= 1 ? `${m}m` : `${Math.round(ms / 1000)}s`;
  }

  // —— Gate ——
  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = $('#username').value.trim();
    socket.emit('auth:join', { username }, (res) => {
      if (!res?.ok) {
        alert(res?.error || 'Could not join');
        return;
      }
      state.user = res.user;
      enterApp();
    });
  });

  function enterApp() {
    $('#gate').classList.add('hidden');
    $('#app').classList.remove('hidden');
    const chip = $('#me-chip');
    chip.style.cssText = avatarStyle(state.user.avatarHue);
    chip.textContent = initials(state.user.username);
    chip.title = state.user.username;
    $('#ttl-badge').textContent = `TTL ${fmtTTL(state.ttlMsg)}`;
    socket.emit('room:list', {}, (res) => {
      if (res?.ok) {
        state.rooms = res.rooms;
        renderRooms();
      }
    });
    socket.emit('feed:list', {}, (res) => { if (res?.ok) renderFeed(res.posts); });
    socket.emit('story:list', {}, (res) => { if (res?.ok) renderStories(res.stories); });
    refreshTelemetry();
  }

  $('#btn-sidebar')?.addEventListener('click', () => {
    $('#sidebar').classList.toggle('open');
  });

  // —— Navigation ——
  $$('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.nav-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.view = btn.dataset.view;
      $$('.view').forEach((v) => v.classList.remove('active'));
      $(`#view-${state.view}`).classList.add('active');
      const titles = {
        chat: ['Orbits', state.roomId ? $('#stage-title').textContent : 'Select an orbit', 'Ephemeral channels · auto-erase'],
        feed: ['Pulse', 'Signal feed', 'Posts dissolve after a short burn'],
        stories: ['Flares', 'Orbit stories', 'Stories vanish on their own clock'],
        dms: ['Direct', 'Private signals', 'Peer-to-peer style DMs · still RAM-only'],
        telemetry: ['Sensors', 'Live telemetry', 'Crew, rooms, in-flight payload'],
      };
      const t = titles[state.view];
      $('#sidebar-title').textContent = t[0];
      if (state.view !== 'chat' || !state.roomId) $('#stage-title').textContent = t[1];
      $('#stage-sub').textContent = t[2];
      $('#btn-new-room').style.display = state.view === 'chat' ? '' : 'none';
      if (state.view === 'chat') renderRooms();
      else if (state.view === 'dms') renderDmPeople();
      else if (state.view === 'telemetry') {
        $('#sidebar-body').innerHTML = `<p class="muted" style="padding:0.75rem">Live counters update on the main stage. Nothing here is archived.</p>`;
        refreshTelemetry();
      } else if (state.view === 'feed') {
        $('#sidebar-body').innerHTML = `<p class="muted" style="padding:0.75rem">Feed posts burn after TTL. Upload stays in RAM only.</p>`;
      } else if (state.view === 'stories') {
        $('#sidebar-body').innerHTML = `<p class="muted" style="padding:0.75rem">Stories are flares — brief, then gone.</p>`;
      }
      if (window.innerWidth <= 860) $('#sidebar').classList.add('open');
    });
  });

  // —— Rooms ——
  $('#btn-new-room').addEventListener('click', () => $('#room-modal').showModal());
  $('#room-form').addEventListener('submit', (e) => {
    const submitter = e.submitter;
    if (submitter && submitter.value === 'cancel') return;
    e.preventDefault();
    const name = $('#room-name').value.trim();
    const topic = $('#room-topic').value.trim();
    const kind = $('#room-kind').value;
    socket.emit('room:create', { name, topic, kind }, (res) => {
      if (!res?.ok) return alert(res?.error || 'Failed');
      $('#room-modal').close();
      $('#room-form').reset();
      joinRoom(res.room.id);
    });
  });

  function renderRooms() {
    const body = $('#sidebar-body');
    if (state.view !== 'chat') return;
    if (!state.rooms.length) {
      body.innerHTML = `<p class="muted" style="padding:0.75rem">No orbits yet. Create one.</p>`;
      return;
    }
    body.innerHTML = state.rooms.map((r) => `
      <button type="button" class="room-item ${r.id === state.roomId ? 'active' : ''}" data-id="${esc(r.id)}">
        <div class="avatar" style="background:#143048">${r.kind === 'voice' ? '◎' : '#'}</div>
        <div class="meta">
          <span class="name">${esc(r.name)}</span>
          <span class="sub">${r.memberCount} crew · ${esc(r.topic || r.kind)}</span>
        </div>
      </button>
    `).join('');
    body.querySelectorAll('.room-item').forEach((el) => {
      el.addEventListener('click', () => joinRoom(el.dataset.id));
    });
  }

  function upsertRoom(room) {
    const i = state.rooms.findIndex((r) => r.id === room.id);
    if (i >= 0) state.rooms[i] = room;
    else state.rooms.unshift(room);
    renderRooms();
  }

  function joinRoom(roomId) {
    if (state.roomId && state.roomId !== roomId) {
      socket.emit('room:leave', { roomId: state.roomId });
    }
    socket.emit('room:join', { roomId }, (res) => {
      if (!res?.ok) return alert(res?.error || 'Room unavailable');
      state.roomId = res.room.id;
      $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === 'chat'));
      $$('.view').forEach((v) => v.classList.remove('active'));
      $('#view-chat').classList.add('active');
      state.view = 'chat';
      $('#sidebar-title').textContent = 'Orbits';
      $('#stage-title').textContent = res.room.name;
      $('#stage-sub').textContent = res.room.topic || 'Ephemeral channel';
      $('#btn-leave-room').disabled = false;
      $('#btn-call-audio').disabled = false;
      $('#btn-call-video').disabled = false;
      upsertRoom(res.room);
      renderMessages(res.messages || []);
      $('#sidebar').classList.remove('open');
    });
  }

  $('#btn-leave-room').addEventListener('click', () => {
    if (!state.roomId) return;
    socket.emit('room:leave', { roomId: state.roomId }, () => {
      state.roomId = null;
      $('#messages').innerHTML = '';
      $('#stage-title').textContent = 'Select an orbit';
      $('#btn-leave-room').disabled = true;
      $('#btn-call-audio').disabled = true;
      $('#btn-call-video').disabled = true;
      renderRooms();
    });
  });

  // —— Chat ——
  function renderMessages(list) {
    const box = $('#messages');
    box.innerHTML = '';
    list.forEach((m) => appendMessage(m, false));
    box.scrollTop = box.scrollHeight;
  }

  function appendMessage(m, scroll = true) {
    const box = $('#messages');
    if (box.querySelector(`[data-mid="${m.id}"]`)) return;
    const mine = m.userId === state.user?.id;
    const el = document.createElement('article');
    el.className = `msg ${mine ? 'mine' : ''}`;
    el.dataset.mid = m.id;
    let media = '';
    if (m.gifUrl) media = `<img class="gif" src="${esc(m.gifUrl)}" alt="gif" loading="lazy" />`;
    if (m.media && String(m.media).startsWith('data:audio')) {
      media += `<audio class="media" controls src="${esc(m.media)}"></audio>`;
    } else if (m.media) {
      media += `<img class="media" src="${esc(m.media)}" alt="upload" />`;
    }
    const reacts = Object.entries(m.reactions || {})
      .map(([e, ids]) => `<button type="button" class="react-chip" data-e="${esc(e)}">${esc(e)} ${ids.length}</button>`)
      .join('');
    el.innerHTML = `
      <div class="who">
        <span class="avatar" style="${avatarStyle(m.avatarHue)};width:22px;height:22px;font-size:0.6rem">${esc(initials(m.username))}</span>
        <strong>${esc(m.username)}</strong>
        <span>${new Date(m.createdAt).toLocaleTimeString()}</span>
      </div>
      <div class="body">${linkify(esc(m.text))}</div>
      ${media}
      <div class="reacts">${reacts}</div>
      <div class="msg-actions">
        <button type="button" data-act="react">☺</button>
      </div>
    `;
    el.querySelector('[data-act="react"]')?.addEventListener('click', () => {
      const emoji = prompt('Reaction emoji', '🔥');
      if (!emoji || !state.roomId) return;
      socket.emit('chat:react', { roomId: state.roomId, messageId: m.id, emoji });
    });
    el.querySelectorAll('.react-chip').forEach((b) => {
      b.addEventListener('click', () => {
        socket.emit('chat:react', { roomId: state.roomId, messageId: m.id, emoji: b.dataset.e });
      });
    });
    box.appendChild(el);
    if (scroll) box.scrollTop = box.scrollHeight;
    if (!mine && state.roomId) socket.emit('chat:read', { roomId: state.roomId, messageId: m.id });
  }

  function linkify(text) {
    return text.replace(/@([a-zA-Z0-9_\-.]+)/g, '<span style="color:var(--cyan)">@$1</span>');
  }

  function updateMessage(m) {
    const el = $(`#messages [data-mid="${m.id}"]`);
    if (!el) return;
    const reacts = Object.entries(m.reactions || {})
      .map(([e, ids]) => `<button type="button" class="react-chip" data-e="${esc(e)}">${esc(e)} ${ids.length}</button>`)
      .join('');
    const box = el.querySelector('.reacts');
    if (box) {
      box.innerHTML = reacts;
      box.querySelectorAll('.react-chip').forEach((b) => {
        b.addEventListener('click', () => {
          socket.emit('chat:react', { roomId: state.roomId, messageId: m.id, emoji: b.dataset.e });
        });
      });
    }
  }

  function sendChat(extra = {}) {
    const input = $('#composer-input');
    const text = input.value.trim();
    if (!state.roomId) return alert('Join a room first');
    if (!text && !extra.gifUrl && !extra.media) return;
    socket.emit('chat:send', {
      roomId: state.roomId,
      text,
      type: extra.gifUrl ? 'gif' : extra.media ? 'image' : 'text',
      ...extra,
    }, (res) => {
      if (!res?.ok) alert(res?.error || 'Send failed');
      else input.value = '';
    });
  }

  $('#btn-send').addEventListener('click', () => sendChat());
  $('#composer-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
    if (state.roomId) {
      socket.emit('chat:typing', { roomId: state.roomId });
    }
  });

  // Emoji / GIF / attach
  const emojiPanel = $('#emoji-panel');
  emojiPanel.innerHTML = `<div class="emoji-grid">${EMOJIS.map((e) => `<button type="button">${e}</button>`).join('')}</div>`;
  emojiPanel.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      const input = $('#composer-input');
      input.value += b.textContent;
      input.focus();
    });
  });
  $('#btn-emoji').addEventListener('click', () => {
    $('#gif-panel').classList.add('hidden');
    emojiPanel.classList.toggle('hidden');
  });
  $('#btn-gif').addEventListener('click', () => {
    emojiPanel.classList.add('hidden');
    $('#gif-panel').classList.toggle('hidden');
    if (!$('#gif-panel').classList.contains('hidden')) loadGifs('space');
  });
  $('#gif-go').addEventListener('click', () => loadGifs($('#gif-q').value || 'space'));
  $('#gif-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadGifs($('#gif-q').value || 'space');
  });

  async function loadGifs(q) {
    const grid = $('#gif-grid');
    grid.innerHTML = `<p class="muted">Loading…</p>`;
    try {
      const r = await fetch(`/api/gifs?q=${encodeURIComponent(q)}`);
      const data = await r.json();
      grid.innerHTML = (data.items || []).map((g) => `
        <button type="button" data-url="${esc(g.url)}"><img src="${esc(g.preview || g.url)}" alt="${esc(g.desc)}" loading="lazy" /></button>
      `).join('') || `<p class="muted">No GIFs</p>`;
      grid.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => {
          sendChat({ gifUrl: b.dataset.url });
          $('#gif-panel').classList.add('hidden');
        });
      });
    } catch {
      grid.innerHTML = `<p class="muted">GIF search unavailable</p>`;
    }
  }

  $('#btn-attach').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', async () => {
    const file = $('#file-input').files?.[0];
    if (!file) return;
    const media = await readImage(file);
    sendChat({ media });
    $('#file-input').value = '';
  });

  // Voice notes (press & hold)
  let mediaRecorder = null;
  let voiceChunks = [];
  const voiceBtn = $('#btn-voice');
  async function startVoice() {
    if (!state.roomId) return alert('Join a room first');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => { if (e.data.size) voiceChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(voiceChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        if (blob.size > 2_500_000) return alert('Voice note too large');
        const reader = new FileReader();
        reader.onload = () => sendChat({ media: reader.result, type: 'voice', text: '🎙 voice note' });
        reader.readAsDataURL(blob);
        voiceBtn.classList.remove('recording');
      };
      mediaRecorder.start();
      voiceBtn.classList.add('recording');
    } catch {
      alert('Microphone blocked');
    }
  }
  function stopVoice() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  }
  voiceBtn.addEventListener('mousedown', startVoice);
  voiceBtn.addEventListener('mouseup', stopVoice);
  voiceBtn.addEventListener('mouseleave', stopVoice);
  voiceBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startVoice(); }, { passive: false });
  voiceBtn.addEventListener('touchend', stopVoice);

  function readImage(file) {
    return new Promise((resolve, reject) => {
      if (file.size > 2_500_000) {
        alert('Keep images under ~2.5MB (ephemeral RAM)');
        reject(new Error('too large'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // —— Feed ——
  $('#btn-feed-post').addEventListener('click', async () => {
    const file = $('#feed-file').files?.[0];
    if (!file) return alert('Pick an image');
    const media = await readImage(file);
    const caption = $('#feed-caption').value.trim();
    socket.emit('feed:add', { media, caption }, (res) => {
      if (!res?.ok) return alert(res?.error || 'Failed');
      $('#feed-caption').value = '';
      $('#feed-file').value = '';
    });
  });

  function renderFeed(posts) {
    const list = $('#feed-list');
    list.innerHTML = (posts || []).map((p) => feedCardHtml(p)).join('') || `<p class="muted">Feed is empty — post something.</p>`;
    bindFeedCards(list);
  }

  function feedCardHtml(p) {
    const liked = (p.likes || []).includes(state.user?.id);
    const comments = (p.comments || []).map((c) => `<div class="muted" style="font-size:0.85rem"><strong>${esc(c.username)}</strong> ${esc(c.text)}</div>`).join('');
    return `
      <article class="feed-card" data-pid="${esc(p.id)}">
        ${p.media ? `<img src="${esc(p.media)}" alt="" />` : ''}
        <div class="pad">
          <div class="who" style="display:flex;gap:0.4rem;align-items:center;margin-bottom:0.4rem">
            <span class="avatar" style="${avatarStyle(p.avatarHue)};width:28px;height:28px">${esc(initials(p.username))}</span>
            <strong>${esc(p.username)}</strong>
          </div>
          <p>${esc(p.caption || '')}</p>
          <p class="likes">${p.likes.length} like${p.likes.length === 1 ? '' : 's'}</p>
          <div class="row">
            <button type="button" class="btn ghost sm" data-like>${liked ? 'Unlike' : 'Like'}</button>
          </div>
          <div class="comments" style="margin-top:0.5rem">${comments}</div>
          <div class="row" style="margin-top:0.4rem">
            <input data-cmt placeholder="Comment…" maxlength="300" style="flex:1;background:var(--ink);border:1px solid var(--line);border-radius:8px;padding:0.4rem 0.55rem" />
            <button type="button" class="btn ghost sm" data-cmt-btn>↵</button>
          </div>
        </div>
      </article>
    `;
  }

  function bindFeedCards(root) {
    root.querySelectorAll('.feed-card').forEach((card) => {
      const id = card.dataset.pid;
      card.querySelector('[data-like]')?.addEventListener('click', () => socket.emit('feed:like', { id }));
      card.querySelector('[data-cmt-btn]')?.addEventListener('click', () => {
        const text = card.querySelector('[data-cmt]')?.value?.trim();
        if (!text) return;
        socket.emit('feed:comment', { id, text });
        card.querySelector('[data-cmt]').value = '';
      });
    });
  }

  function upsertFeed(post) {
    const list = $('#feed-list');
    const existing = list.querySelector(`[data-pid="${post.id}"]`);
    const html = feedCardHtml(post);
    if (existing) {
      existing.outerHTML = html;
    } else {
      if (list.querySelector('.muted')) list.innerHTML = '';
      list.insertAdjacentHTML('afterbegin', html);
    }
    bindFeedCards(list);
  }

  // —— Stories ——
  $('#btn-story-add').addEventListener('click', async () => {
    const file = $('#story-file').files?.[0];
    if (!file) return alert('Pick an image');
    const media = await readImage(file);
    const caption = $('#story-caption').value.trim();
    socket.emit('story:add', { media, caption }, (res) => {
      if (!res?.ok) return alert(res?.error || 'Failed');
      $('#story-file').value = '';
      $('#story-caption').value = '';
    });
  });

  function renderStories(stories) {
    const rail = $('#stories-rail');
    rail.innerHTML = (stories || []).map((s) => `
      <button type="button" class="story-bubble" data-sid="${esc(s.id)}">
        <div class="ring"><img src="${esc(s.media)}" alt="" /></div>
        <span>${esc(s.username)}</span>
      </button>
    `).join('') || `<p class="muted">No live stories</p>`;
    rail.querySelectorAll('.story-bubble').forEach((b) => {
      b.addEventListener('click', () => openStory(b.dataset.sid, stories));
    });
  }

  function openStory(id, stories) {
    const s = (stories || []).find((x) => x.id === id);
    if (!s) return;
    socket.emit('story:view', { id });
    $('#story-viewer').classList.remove('hidden');
    $('#story-img').src = s.media;
    $('#story-meta').textContent = `${s.username} · ${s.caption || 'no caption'} · ${s.views.length} views`;
  }
  $('#story-close').addEventListener('click', () => $('#story-viewer').classList.add('hidden'));

  // —— DMs ——
  function renderDmPeople() {
    const body = $('#sidebar-body');
    fetch('/api/telemetry').then((r) => r.json()).then((t) => {
      const people = (t.online || []).filter((u) => u.id !== state.user?.id);
      body.innerHTML = people.map((u) => `
        <button type="button" class="person-item" data-id="${esc(u.id)}">
          <div class="avatar" style="${avatarStyle(u.avatarHue)}">${esc(initials(u.username))}</div>
          <div class="meta">
            <span class="name">${esc(u.username)}</span>
            <span class="sub">${esc(u.status)}</span>
          </div>
        </button>
      `).join('') || `<p class="muted" style="padding:0.75rem">Nobody else online</p>`;
      body.querySelectorAll('.person-item').forEach((el) => {
        el.addEventListener('click', () => openDm(el.dataset.id, el.querySelector('.name').textContent));
      });
      $('#dm-people').innerHTML = body.innerHTML;
      $('#dm-people').querySelectorAll('.person-item').forEach((el) => {
        el.addEventListener('click', () => openDm(el.dataset.id, el.querySelector('.name').textContent));
      });
    });
  }

  function openDm(toId, name) {
    state.dmPeer = { id: toId, name };
    $('#stage-title').textContent = `DM · ${name}`;
    socket.emit('dm:history', { toId }, (res) => {
      const box = $('#dm-messages');
      box.innerHTML = '';
      (res?.messages || []).forEach((m) => appendDm(m));
    });
  }

  function appendDm(m) {
    const box = $('#dm-messages');
    const mine = m.fromId === state.user?.id;
    const el = document.createElement('article');
    el.className = `msg ${mine ? 'mine' : ''}`;
    el.innerHTML = `
      <div class="who"><span>${mine ? 'You' : 'Them'}</span><span>${new Date(m.createdAt).toLocaleTimeString()}</span></div>
      <div class="body">${esc(m.text)}</div>
      ${m.gifUrl ? `<img class="gif" src="${esc(m.gifUrl)}" />` : ''}
      ${m.media ? `<img class="media" src="${esc(m.media)}" />` : ''}
    `;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }

  $('#btn-dm-send').addEventListener('click', () => {
    if (!state.dmPeer) return alert('Pick someone online');
    const text = $('#dm-input').value.trim();
    if (!text) return;
    socket.emit('dm:send', { toId: state.dmPeer.id, text }, (res) => {
      if (!res?.ok) alert(res?.error || 'Failed');
      else $('#dm-input').value = '';
    });
  });

  // —— Calls ——
  function pickCallTarget() {
    return fetch('/api/telemetry').then((r) => r.json()).then((t) => {
      const peers = (t.online || []).filter((u) => u.id !== state.user?.id && u.roomId === state.roomId);
      if (!peers.length) {
        alert('No other crew in this room to call');
        return null;
      }
      if (peers.length === 1) return peers[0];
      const name = prompt(`Call who?\n${peers.map((p) => p.username).join(', ')}`, peers[0].username);
      return peers.find((p) => p.username === name) || peers[0];
    });
  }

  $('#btn-call-audio').addEventListener('click', async () => {
    const peer = await pickCallTarget();
    if (!peer) return;
    socket.emit('presence:set', { status: 'in-call' });
    NebulaRTC.call(peer.id, 'audio');
  });
  $('#btn-call-video').addEventListener('click', async () => {
    const peer = await pickCallTarget();
    if (!peer) return;
    socket.emit('presence:set', { status: 'in-call' });
    NebulaRTC.call(peer.id, 'video');
  });
  $('#btn-hangup').addEventListener('click', () => {
    NebulaRTC.hangup(true);
    socket.emit('presence:set', { status: 'online' });
  });
  $('#btn-accept').addEventListener('click', async () => {
    const p = state.pendingOffer;
    if (!p) return;
    $('#incoming-call').classList.add('hidden');
    socket.emit('presence:set', { status: 'in-call' });
    await NebulaRTC.accept(p.fromId, p.sdp, p.callType);
    state.pendingOffer = null;
  });
  $('#btn-reject').addEventListener('click', () => {
    if (state.pendingOffer) socket.emit('rtc:hangup', { toId: state.pendingOffer.fromId });
    state.pendingOffer = null;
    $('#incoming-call').classList.add('hidden');
  });

  // —— Telemetry ——
  function refreshTelemetry() {
    fetch('/api/telemetry').then((r) => r.json()).then(paintTelemetry).catch(() => {});
  }
  function paintTelemetry(t) {
    if (!t) return;
    $('#t-online').textContent = t.onlineCount;
    $('#t-rooms').textContent = t.roomsCount;
    $('#t-msgs').textContent = t.messagesInFlight;
    $('#t-stories').textContent = t.storiesActive;
    $('#t-posts').textContent = t.postsActive;
    $('#t-crew').innerHTML = (t.online || []).map((u) => `
      <li>
        <span class="avatar" style="${avatarStyle(u.avatarHue)};width:22px;height:22px;font-size:0.6rem">${esc(initials(u.username))}</span>
        ${esc(u.username)}
        <span class="status-pip ${esc(u.status)}"></span>
      </li>
    `).join('') || '<li class="muted">Empty space</li>';
  }

  // —— Screenshot detection ——
  function announceScreenshot() {
    if (!state.roomId || !state.user) return;
    socket.emit('privacy:screenshot', { roomId: state.roomId });
  }
  window.addEventListener('keyup', (e) => {
    if (e.key === 'PrintScreen') announceScreenshot();
  });
  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.shiftKey && ['3', '4', '5', 's', 'S'].includes(e.key)) announceScreenshot();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.roomId) {
      // soft signal — not definitive, but privacy-forward cue
    }
  });

  function showSsBanner(text) {
    const b = $('#ss-banner');
    b.textContent = text;
    b.classList.remove('hidden');
    clearTimeout(b._t);
    b._t = setTimeout(() => b.classList.add('hidden'), 5000);
  }

  // —— Socket events ——
  socket.on('hello', (payload) => {
    NebulaRTC.setIce(payload.iceServers);
    state.iceServers = payload.iceServers;
    if (payload.ttl?.messageMs) {
      state.ttlMsg = payload.ttl.messageMs;
      $('#ttl-badge').textContent = `TTL ${fmtTTL(state.ttlMsg)}`;
    }
  });
  socket.on('telemetry', paintTelemetry);
  socket.on('presence:update', () => {
    if (state.view === 'dms') renderDmPeople();
  });
  socket.on('room:upsert', upsertRoom);
  socket.on('room:gone', ({ id }) => {
    state.rooms = state.rooms.filter((r) => r.id !== id);
    if (state.roomId === id) {
      state.roomId = null;
      $('#messages').innerHTML = '';
      $('#stage-title').textContent = 'Orbit closed';
    }
    renderRooms();
  });
  socket.on('room:member', ({ user, action }) => {
    if (!user || user.id === state.user?.id) return;
    const tip = document.createElement('div');
    tip.className = 'muted';
    tip.style.textAlign = 'center';
    tip.style.fontSize = '0.8rem';
    tip.textContent = `${user.username} ${action === 'join' ? 'entered' : 'left'} the orbit`;
    $('#messages').appendChild(tip);
  });
  socket.on('chat:message', (m) => {
    if (m.roomId === state.roomId) appendMessage(m);
  });
  socket.on('chat:reacted', updateMessage);
  socket.on('chat:typing', ({ username, roomId, userId }) => {
    if (roomId !== state.roomId || userId === state.user?.id) return;
    $('#typing').textContent = `${username} is transmitting…`;
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => { $('#typing').textContent = ''; }, 1500);
  });
  socket.on('dm:message', (m) => {
    if (state.dmPeer && (m.fromId === state.dmPeer.id || m.toId === state.dmPeer.id)) appendDm(m);
  });
  socket.on('feed:new', upsertFeed);
  socket.on('feed:liked', upsertFeed);
  socket.on('feed:commented', upsertFeed);
  socket.on('story:new', () => socket.emit('story:list', {}, (res) => { if (res?.ok) renderStories(res.stories); }));
  socket.on('story:viewed', () => {});
  socket.on('privacy:screenshot', (entry) => {
    showSsBanner(`⚠ ${entry.notice || 'Screenshot signal'}`);
  });
  socket.on('rtc:offer', (payload) => {
    state.pendingOffer = payload;
    $('#incoming-label').textContent = `${payload.fromName} · ${payload.callType || 'video'} call`;
    $('#incoming-call').classList.remove('hidden');
  });
  socket.on('rtc:answer', (payload) => NebulaRTC.handleAnswer(payload.sdp));
  socket.on('rtc:ice', (payload) => NebulaRTC.handleIce(payload.candidate));
  socket.on('rtc:hangup', () => {
    NebulaRTC.hangup(false);
    socket.emit('presence:set', { status: 'online' });
    $('#incoming-call').classList.add('hidden');
  });
})();
