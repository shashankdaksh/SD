window.NebulaRTC = (() => {
  let pc = null;
  let localStream = null;
  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  let peerId = null;
  let socket = null;

  const remoteEl = () => document.getElementById('remote-video');
  const localEl = () => document.getElementById('local-video');
  const overlay = () => document.getElementById('call-overlay');
  const label = () => document.getElementById('call-label');

  function setIce(servers) {
    if (Array.isArray(servers) && servers.length) iceServers = servers;
  }

  function bindSocket(s) {
    socket = s;
  }

  async function ensurePc() {
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers });
    pc.onicecandidate = (ev) => {
      if (ev.candidate && peerId && socket) {
        socket.emit('rtc:ice', { toId: peerId, candidate: ev.candidate });
      }
    };
    pc.ontrack = (ev) => {
      const v = remoteEl();
      if (v) v.srcObject = ev.streams[0];
    };
    pc.onconnectionstatechange = () => {
      if (!pc) return;
      if (label()) label().textContent = `Call · ${pc.connectionState}`;
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        // keep overlay until hangup for disconnected flicker
      }
    };
    return pc;
  }

  async function getMedia(video) {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: video ? { facingMode: 'user', width: { ideal: 1280 } } : false,
    });
    const lv = localEl();
    if (lv) lv.srcObject = localStream;
    return localStream;
  }

  function showOverlay(text) {
    overlay()?.classList.remove('hidden');
    if (label()) label().textContent = text || 'Connecting…';
  }

  async function call(toId, callType) {
    peerId = toId;
    showOverlay(callType === 'audio' ? 'Audio call…' : 'Video call…');
    const conn = await ensurePc();
    const stream = await getMedia(callType !== 'audio');
    stream.getTracks().forEach((t) => conn.addTrack(t, stream));
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    socket.emit('rtc:offer', { toId, sdp: offer, callType });
  }

  async function accept(fromId, sdp, callType) {
    peerId = fromId;
    showOverlay('Connecting…');
    const conn = await ensurePc();
    const stream = await getMedia(callType !== 'audio');
    stream.getTracks().forEach((t) => conn.addTrack(t, stream));
    await conn.setRemoteDescription(sdp);
    const answer = await conn.createAnswer();
    await conn.setLocalDescription(answer);
    socket.emit('rtc:answer', { toId: fromId, sdp: answer });
  }

  async function handleAnswer(sdp) {
    if (!pc) return;
    await pc.setRemoteDescription(sdp);
  }

  async function handleIce(candidate) {
    if (!pc || !candidate) return;
    try {
      await pc.addIceCandidate(candidate);
    } catch (_) { /* ignore late candidates */ }
  }

  function hangup(notify) {
    if (notify && peerId && socket) socket.emit('rtc:hangup', { toId: peerId });
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    if (pc) {
      pc.close();
      pc = null;
    }
    peerId = null;
    const rv = remoteEl();
    const lv = localEl();
    if (rv) rv.srcObject = null;
    if (lv) lv.srcObject = null;
    overlay()?.classList.add('hidden');
  }

  return { setIce, bindSocket, call, accept, handleAnswer, handleIce, hangup, get peerId() { return peerId; } };
})();
