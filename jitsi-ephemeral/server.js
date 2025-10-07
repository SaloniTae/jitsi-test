// server.js
// Ephemeral Jitsi join service (Render Free Tier + Upstash REST)

const express = require('express');
const fetch = require('node-fetch'); // node-fetch v2
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(helmet());

const PORT = process.env.PORT || 3000;
const EPHEMERAL_TTL = 90; // seconds
const JOIN_PREFIX = 'join:';

const BASE_URL = "https://oor-islive.onrender.com";

const UPSTASH_REDIS_REST_URL = "https://active-marmoset-8778.upstash.io";
const UPSTASH_REDIS_REST_TOKEN = "ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA";

// --- Helpers ---
function genId(len = 28) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

async function upstashSet(key, value, exSeconds) {
  const url = `${UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}`;
  const body = { value: JSON.stringify(value), ex: exSeconds };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function upstashGet(key) {
  const url = `${UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } });
  const json = await res.json();
  return json && json.result ? JSON.parse(json.result) : null;
}

async function upstashDel(key) {
  const url = `${UPSTASH_REDIS_REST_URL}/del/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` }
  });
  return res.json();
}

async function saveJoin(jti, payload, ttl = EPHEMERAL_TTL) {
  return upstashSet(`${JOIN_PREFIX}${jti}`, payload, ttl);
}

async function consumeJoin(jti) {
  const val = await upstashGet(`${JOIN_PREFIX}${jti}`);
  if (!val) return null;
  await upstashDel(`${JOIN_PREFIX}${jti}`);
  return val;
}

// --- Simple auth middleware ---
function requireAuth(req, res, next) {
  const sessionId = req.get('x-session-id') || req.get('authorization');
  if (!sessionId) return res.status(401).json({ error: 'unauthenticated (set x-session-id header)' });
  req.sessionId = sessionId;
  next();
}

// Rate limiter for join requests
const createTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false
});

// --- POST /api/request-join ---
app.post('/api/request-join', createTokenLimiter, requireAuth, async (req, res) => {
  try {
    const { room } = req.body || {};
    if (!room) return res.status(400).json({ error: 'room required' });

    const providerUrl = `https://8x8.vc/vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9/${encodeURIComponent(room)}?t=${Date.now()}`;

    const jti = genId(32);
    const entry = { providerUrl, createdBy: req.sessionId, createdAt: Date.now(), room };
    await saveJoin(jti, entry, EPHEMERAL_TTL);

    const joinUrl = `${BASE_URL}/join/${jti}`;
    return res.json({ joinUrl, ttl: EPHEMERAL_TTL });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// --- GET /join/:jti ---
app.get('/join/:jti', requireAuth, async (req, res) => {
  try {
    const { jti } = req.params;
    if (!jti) return res.status(400).send('bad request');

    const entry = await consumeJoin(jti);
    if (!entry) return res.status(410).send('This join link is invalid or expired.');
    if (entry.createdBy !== req.sessionId) return res.status(403).send('Not authorized to use this join link.');

    const safeProviderUrl = String(entry.providerUrl).replace(/"/g, '&quot;');

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Meeting Viewer</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>html,body{height:100%;margin:0;background:#000} iframe{width:100%;height:100vh;border:0}</style>
</head>
<body>
<iframe id="providerFrame" src="${safeProviderUrl}" allow="camera; microphone; fullscreen" sandbox="allow-same-origin allow-scripts allow-forms allow-popups"></iframe>
<script>
setTimeout(function(){
  try{ document.getElementById('providerFrame').src='about:blank'; } catch(e){}
}, ${EPHEMERAL_TTL*1000 + 60000});
</script>
</body>
</html>`;
    res.set('Cache-Control', 'no-store, must-revalidate');
    res.type('html').send(html);
  } catch (err) {
    console.error(err);
    return res.status(500).send('server error');
  }
});

// --- Health check ---
app.get('/', (req, res) => {
  res.send('Ephemeral Jitsi join service alive.');
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
