'use strict';

/**
 * Public STUN + optional TURN from env (e.g. Metered / Twilio).
 * Never hardcode secrets — read from process.env.
 */

function iceServers() {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  const turnUrl = process.env.TURN_URL;
  const turnUser = process.env.TURN_USERNAME;
  const turnPass = process.env.TURN_CREDENTIAL;

  if (turnUrl && turnUser && turnPass) {
    servers.push({
      urls: turnUrl.split(',').map((s) => s.trim()).filter(Boolean),
      username: turnUser,
      credential: turnPass,
    });
  }

  return servers;
}

module.exports = { iceServers };
