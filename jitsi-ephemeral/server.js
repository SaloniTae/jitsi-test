const express = require('express');
const fetch   = require('node-fetch');
const fs      = require('fs');
const path    = require('path');

const app = express();
app.use(express.json());

/* ── verbose logger ───────────────────────────────────────── */
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

/* ── Upstash config ───────────────────────────────────────── */
const REDIS_URL   = 'https://active-marmoset-8778.upstash.io';
const REDIS_TOKEN = 'ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA';

const TTL          = 90;            // seconds
const DEFAULT_ROOM = 'AyushLive';   // fallback room

/* ── util: create key in Redis and return jti ─────────────── */
async function createToken(room) {
  const jti = Math.random().toString(36).substring(2, 18);
  const r   = await fetch(`${REDIS_URL}/set/${jti}`, {
    method : 'POST',
    headers: { Authorization:`Bearer ${REDIS_TOKEN}`,
               'Content-Type':'application/json' },
    body   : JSON.stringify({ value: room, ex: TTL })
  });
  console.log('  [redis/set] status', r.status);
  return jti;
}

/* ── GET /  → make token, redirect ────────────────────────── */
app.get('/', async (req, res) => {
  try {
    const room = DEFAULT_ROOM;
    const jti  = await createToken(room);
    console.log('  [/ root] redirect to /join/' + jti);
    res.redirect(`/join/${jti}`);
  } catch (e) {
    console.error('  [root] ERROR', e);
    res.status(500).send('error creating token');
  }
});

/* ── POST /api/request-join ───────────────────────────────── */
app.post('/api/request-join', async (req, res) => {
  try {
    const room = (req.body.room || '').trim() || DEFAULT_ROOM;
    const jti  = await createToken(room);
    return res.json({ joinUrl:`/join/${jti}`, ttl:TTL });
  } catch (err) {
    console.error('  [request-join] ERROR', err);
    res.status(500).json({ error:'server_error' });
  }
});

/* ── GET /join/:jti  (validate token, stream viewer) ─────── */
app.get('/join/:jti', async (req, res) => {
  try {
    const { jti } = req.params;
    console.log('  [/join] token =', jti);

    const redisResp = await fetch(`${REDIS_URL}/get/${jti}`, {
      headers:{ Authorization:`Bearer ${REDIS_TOKEN}` }
    }).then(r=>r.json());

    console.log('  [/join] redis answered', redisResp);

    if (!redisResp || !redisResp.result) {
      console.log('  [/join] token invalid → 401');
      return res.status(401).send('Unauthorized or expired token');
    }

    const room       = redisResp.result;
    const viewerPath = path.resolve(__dirname,'viewer.html');

    if (!fs.existsSync(viewerPath)) {
      console.error('  [/join] viewer.html missing at', viewerPath);
      return res.status(500).send('viewer.html missing on server');
    }

    let html = fs.readFileSync(viewerPath,'utf8');
    html = html.replace(/%%ROOM_PLACEHOLDER%%/g, room);

    console.log('  [/join] sending viewer.html (bytes', html.length, ')');
    res.type('html').send(html);

  } catch (err) {
    console.error('  [/join] ERROR', err);
    res.status(500).send('Server error');
  }
});

/* ── catch-all 404 (should rarely appear now) ─────────────── */
app.use((req, res) => {
  console.log('  [404] fell through →', req.originalUrl);
  res.status(404).send('not found');
});

/* ── boot ─────────────────────────────────────────────────── */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🟢  listening on ${PORT}`));
