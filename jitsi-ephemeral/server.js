const express = require('express');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(helmet());

const PORT = process.env.PORT || 10000;
const EPHEMERAL_TTL = 90; // seconds
const JOIN_PREFIX = 'join:';

// ---------------- Upstash REST constants ----------------
const UPSTASH_REDIS_REST_URL = "https://active-marmoset-8778.upstash.io";
const UPSTASH_REDIS_REST_TOKEN = "ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA";

// ---------------- Helpers ----------------
function genId(len = 28) {
  return crypto.randomBytes(Math.ceil(len/2)).toString('hex').slice(0,len);
}

async function saveJoin(jti, payload, ttl = EPHEMERAL_TTL) {
  const url = `${UPSTASH_REDIS_REST_URL}/set/${JOIN_PREFIX}${jti}`;
  const body = {
    value: JSON.stringify(payload),
    ex: ttl
  };
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

async function consumeJoin(jti) {
  const key = `${JOIN_PREFIX}${jti}`;
  // GET value
  const getUrl = `${UPSTASH_REDIS_REST_URL}/get/${key}`;
  const getRes = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` }
  });
  const getData = await getRes.json();
  if (!getData.result) return null;
  // DELETE key (single-use)
  const delUrl = `${UPSTASH_REDIS_REST_URL}/del/${key}`;
  await fetch(delUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` }
  });
  try {
    return JSON.parse(getData.result);
  } catch(e) { return null; }
}

// ---------------- Auth Middleware ----------------
function requireAuth(req, res, next) {
  if (!req.headers['x-session-id']) return res.status(401).json({ error: 'unauthenticated' });
  req.sessionId = req.headers['x-session-id'];
  next();
}

// ---------------- Rate Limiter ----------------
const createTokenLimiter = rateLimit({
  windowMs: 60*1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false
});

// ---------------- POST /api/request-join ----------------
app.post('/api/request-join', createTokenLimiter, requireAuth, async (req,res)=>{
  try{
    const { room } = req.body;
    if(!room) return res.status(400).json({ error: 'room required' });

    // Generate ephemeral provider URL
    const providerUrl = `https://8x8.vc/vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9/${encodeURIComponent(room)}?t=${Date.now()}`;

    const jti = genId();
    const entry = { providerUrl, createdBy:req.sessionId, room, createdAt:Date.now() };
    await saveJoin(jti, entry, EPHEMERAL_TTL);

    const joinUrl = `https://oor-islive.onrender.com/join/${jti}`;
    return res.json({ joinUrl, ttl: EPHEMERAL_TTL });

  }catch(err){
    console.error(err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// ---------------- GET /join/:jti ----------------
app.get('/join/:jti', requireAuth, async (req,res)=>{
  try{
    const { jti } = req.params;
    if(!jti) return res.status(400).send('bad request');

    const entry = await consumeJoin(jti);
    if(!entry) return res.status(410).send('This join link is invalid or expired.');

    if(entry.createdBy !== req.sessionId) return res.status(403).send('Not authorized');

    const safeProviderUrl = entry.providerUrl.replace(/"/g,'&quot;');
    const html = `<!doctype html>
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
</html>`;
    res.set('Cache-Control','no-store, must-revalidate');
    res.type('html').send(html);

  }catch(err){
    console.error(err);
    res.status(500).send('server error');
  }
});

// ---------------- Start server ----------------
app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
