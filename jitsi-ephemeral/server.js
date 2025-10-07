// server.js
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

// Upstash REST info (hardcoded as you requested)
const UPSTASH_REDIS_REST_URL = "https://active-marmoset-8778.upstash.io";
const UPSTASH_REDIS_REST_TOKEN = "ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA";

const JOIN_PREFIX = 'join:';
const EPHEMERAL_TTL = 90; // seconds (you can increase if you want longer reload window)
const CLIENT_COOKIE_NAME = 'viewer_client';

// helpers
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

// Upstash REST helpers
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

// rate limiter for join requests
const limiter = rateLimit({
  windowMs: 60*1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false
});

// POST /api/request-join
// Reads/creates viewer_client cookie, stores jti -> { providerUrl, ownerClientId } in Upstash
app.post('/api/request-join', limiter, async (req, res) => {
  try {
    const room = (req.body && req.body.room) ? String(req.body.room) : 'AyushLive';
    // read client cookie or create one
    const cookies = parseCookies(req);
    let clientId = cookies[CLIENT_COOKIE_NAME];
    if (!clientId) {
      clientId = genId(32);
      // set cookie (HttpOnly). Note: secure: false for local testing. Set true in production (HTTPS).
      res.cookie(CLIENT_COOKIE_NAME, clientId, { httpOnly: true, sameSite: 'Lax', secure: false, maxAge: 30*24*60*60*1000 });
    }

    // provider URL (server-side generated)
    const providerUrl = `https://8x8.vc/vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9/${encodeURIComponent(room)}?t=${Date.now()}`;

    const jti = genId(28);
    const entry = { providerUrl, ownerClientId: clientId, room, createdAt: Date.now() };

    // store in Upstash with TTL
    await upstashSet(JOIN_PREFIX + jti, entry, EPHEMERAL_TTL);

    // join URL - serve from this server (full absolute URL)
    const host = req.get('host');
    const protocol = req.protocol;
    const joinUrl = `${protocol}://${host}/join/${jti}`;

    return res.json({ joinUrl, ttl: EPHEMERAL_TTL });

  } catch (err) {
    console.error('request-join error', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// GET /join/:jti
// Allows access only if the requesting browser's cookie matches the stored ownerClientId.
// If match, refresh TTL so reloads keep working.
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
    const cookies = parseCookies(req);
    const clientId = cookies[CLIENT_COOKIE_NAME];

    if (!clientId || clientId !== entry.ownerClientId) {
      // not the original browser
      return res.status(403).send('Not authorized to use this join link from this browser.');
    }

    // refresh TTL so owner can reload multiple times
    await upstashSet(key, entry, EPHEMERAL_TTL);

    // serve small HTML that embeds provider iframe
    const safeProviderUrl = String(entry.providerUrl).replace(/"/g, '&quot;');
    res.set('Cache-Control', 'no-store, must-revalidate');
    return res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Meeting Viewer</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>html,body{height:100%;margin:0} iframe{width:100%;height:100vh;border:0;display:block;}</style>
</head>
<body>
<iframe src="${safeProviderUrl}" allow="camera; microphone; fullscreen" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
</body>
</html>`);
  } catch (err) {
    console.error('/join error', err);
    return res.status(500).send('server error');
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
