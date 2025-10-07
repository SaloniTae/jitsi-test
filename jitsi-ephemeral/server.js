// server.js
// Node 16+
// Uses node-fetch 2.6.7 and Upstash REST
const express = require('express');
const fetch = require('node-fetch'); // 2.6.7
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(helmet());

// serve static viewer.html from ./public
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 10000;

// ----------------- CONFIG -----------------
const UPSTASH_REDIS_REST_URL = "https://active-marmoset-8778.upstash.io";
const UPSTASH_REDIS_REST_TOKEN = "ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA";

const JOIN_PREFIX = 'join:';
const PERSIST_TTL = 24 * 60 * 60; // 24 hours - keep jti around (so reloads still find it)
const HEARTBEAT_INTERVAL = 20; // seconds - client pings this often
const INACTIVE_TIMEOUT = 45; // seconds - if lastSeen older than this, owner considered gone
const CLIENT_COOKIE_NAME = 'viewer_client';

// ---------------- Helpers ----------------
function genId(len = 28) {
  return crypto.randomBytes(Math.ceil(len/2)).toString('hex').slice(0, len);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(';').map(c => c.split(/=(.+)/)).reduce((acc, [k, v]) => {
    if (!k) return acc;
    acc[k.trim()] = decodeURIComponent((v||'').trim());
    return acc;
  }, {});
}

// Upstash REST helpers (simple wrappers)
async function upstashSet(key, jsonValue, exSeconds) {
  const url = `${UPSTASH_REDIS_REST_URL}/set/${key}`;
  const body = { value: JSON.stringify(jsonValue), ex: exSeconds };
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return r.json();
}

async function upstashGet(key) {
  const url = `${UPSTASH_REDIS_REST_URL}/get/${key}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } });
  return r.json(); // { result: "..." } or { result: null }
}

async function upstashDel(key) {
  const url = `${UPSTASH_REDIS_REST_URL}/del/${key}`;
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } });
  return r.json();
}

// rate limiter
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false
});

// ---------------- API: create request-join ----------------
// Creates jti entry if not exists. Returns /join/:jti
app.post('/api/request-join', limiter, async (req, res) => {
  try {
    const room = (req.body && req.body.room) ? String(req.body.room) : 'AyushLive';

    // create a jti if not provided (caller may want a pre-known id)
    const jti = genId(28);

    // provider URL (server-side); if you use provider JWT create it here
    const providerUrl = `https://8x8.vc/vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9/${encodeURIComponent(room)}?t=${Date.now()}`;

    // entry structure:
    // { providerUrl, ownerClientId: null | 'id', active: false, lastSeen: null, room, createdAt }
    const entry = {
      providerUrl,
      ownerClientId: null,
      active: false,
      lastSeen: null,
      room,
      createdAt: Date.now()
    };

    await upstashSet(JOIN_PREFIX + jti, entry, PERSIST_TTL);

    // return absolute join URL
    const protocol = req.protocol;
    const host = req.get('host');
    const joinUrl = `${protocol}://${host}/join/${jti}`;

    return res.json({ joinUrl, jti, ttl: PERSIST_TTL });
  } catch (err) {
    console.error('request-join error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ---------------- GET /join/:jti (claiming & owner checks) ----------------
app.get('/join/:jti', async (req, res) => {
  try {
    const { jti } = req.params;
    if (!jti) return res.status(400).send('bad request');

    const key = JOIN_PREFIX + jti;
    const getRes = await upstashGet(key);
    if (!getRes || !getRes.result) {
      return res.status(410).send('This join link is invalid or expired.');
    }
    const entry = JSON.parse(getRes.result);

    // parse incoming cookie (viewer_client) if any
    const cookies = parseCookies(req);
    let clientId = cookies[CLIENT_COOKIE_NAME];

    // Helper: check if stored owner is still active (based on lastSeen)
    const now = Date.now();
    function ownerIsActive(ent) {
      if (!ent.ownerClientId || !ent.lastSeen) return false;
      const diffSec = (now - ent.lastSeen) / 1000;
      return diffSec <= INACTIVE_TIMEOUT;
    }

    // If entry has owner and is active
    if (entry.ownerClientId && ownerIsActive(entry)) {
      // If client has same cookie -> allow access (refresh lastSeen)
      if (clientId && clientId === entry.ownerClientId) {
        entry.lastSeen = Date.now();
        entry.active = true;
        // refresh persistent TTL
        await upstashSet(key, entry, PERSIST_TTL);
        const safeProviderUrl = String(entry.providerUrl).replace(/"/g, '&quot;');
        res.set('Cache-Control', 'no-store, must-revalidate');
        return res.send(renderProviderEmbedHtml(safeProviderUrl));
      }
      // owner is someone else and still active -> block
      return res.status(403).send('Not authorized - link currently in use by another viewer.');
    }

    // Owner is not active (either not set or timed out) -> allow claim by this browser
    if (!clientId) {
      // generate a client id cookie for this browser and set it
      clientId = genId(32);
      // secure should be true in production (HTTPS). For local testing leave false.
      res.cookie(CLIENT_COOKIE_NAME, clientId, { httpOnly: true, sameSite: 'Lax', secure: false, maxAge: 30*24*60*60*1000 });
    }

    // Claim the entry for this client
    entry.ownerClientId = clientId;
    entry.lastSeen = Date.now();
    entry.active = true;
    await upstashSet(key, entry, PERSIST_TTL);

    const safeProviderUrl = String(entry.providerUrl).replace(/"/g, '&quot;');
    res.set('Cache-Control', 'no-store, must-revalidate');
    return res.send(renderProviderEmbedHtml(safeProviderUrl));

  } catch (err) {
    console.error('/join error', err);
    return res.status(500).send('server error');
  }
});

// ---------------- POST /api/heartbeat ----------------
// Body: { jti: '...' } - must be called by owner periodically to stay active
app.post('/api/heartbeat', async (req, res) => {
  try {
    const { jti } = req.body || {};
    if (!jti) return res.status(400).json({ error: 'jti required' });

    const key = JOIN_PREFIX + jti;
    const getRes = await upstashGet(key);
    if (!getRes || !getRes.result) return res.status(410).json({ error: 'expired' });
    const entry = JSON.parse(getRes.result);

    const cookies = parseCookies(req);
    const clientId = cookies[CLIENT_COOKIE_NAME];
    if (!clientId || entry.ownerClientId !== clientId) {
      return res.status(403).json({ error: 'not owner' });
    }

    // update lastSeen and keep entry active
    entry.lastSeen = Date.now();
    entry.active = true;
    await upstashSet(key, entry, PERSIST_TTL);

    return res.json({ ok: true, lastSeen: entry.lastSeen });
  } catch (err) {
    console.error('heartbeat error', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// ---------------- POST /api/leave ----------------
// Optional: owner explicitly releases the link
app.post('/api/leave', async (req, res) => {
  try {
    const { jti } = req.body || {};
    if (!jti) return res.status(400).json({ error: 'jti required' });

    const key = JOIN_PREFIX + jti;
    const getRes = await upstashGet(key);
    if (!getRes || !getRes.result) return res.status(410).json({ error: 'expired' });
    const entry = JSON.parse(getRes.result);

    const cookies = parseCookies(req);
    const clientId = cookies[CLIENT_COOKIE_NAME];
    if (!clientId || entry.ownerClientId !== clientId) {
      return res.status(403).json({ error: 'not owner' });
    }

    // release the link: clear owner and active
    entry.ownerClientId = null;
    entry.active = false;
    entry.lastSeen = null;
    await upstashSet(key, entry, PERSIST_TTL);

    return res.json({ ok: true });
  } catch (err) {
    console.error('leave error', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// ---------------- helper render ----------------
function renderProviderEmbedHtml(providerUrl) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Meeting Viewer</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>html,body{height:100%;margin:0} iframe{width:100%;height:100vh;border:0;display:block;}</style>
</head>
<body>
<iframe src="${providerUrl}" allow="camera; microphone; fullscreen" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
</body>
</html>`;
}

// ---------------- Start server ----------------
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
