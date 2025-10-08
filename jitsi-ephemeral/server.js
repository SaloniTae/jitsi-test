/******************************************************************
 * Secure join-link server  – VERBOSE EDITION
 *   • every request is logged
 *   • each internal step dumps variables
 ******************************************************************/
const express = require('express');
const fetch   = require('node-fetch');
const fs      = require('fs');
const path    = require('path');

const app = express();
app.use(express.json());

/* ───── global request logger (prints 404 targets too) ───── */
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

/* ───── Upstash creds (move to env vars in prod) ─────────── */
const REDIS_URL   = 'https://active-marmoset-8778.upstash.io';
const REDIS_TOKEN = 'ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA';

const TTL          = 90;          // seconds
const DEFAULT_ROOM = 'AyushLive'; // fallback

/* ───────────────────────────────────────────────────────────
   POST /api/request-join
─────────────────────────────────────────────────────────── */
app.post('/api/request-join', async (req, res) => {
  try {
    const room = (req.body.room || '').trim() || DEFAULT_ROOM;
    const jti  = Math.random().toString(36).substring(2, 18);   // pseudo-random id

    console.log('  [request-join] creating key', jti, '→ room', room);

    await fetch(`${REDIS_URL}/set/${jti}`, {
      method : 'POST',
      headers: {
        Authorization : `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ value: room, ex: TTL })
    });

    console.log('  [request-join] stored in Redis with TTL', TTL);

    return res.json({ joinUrl: `/join/${jti}`, ttl: TTL });
  } catch (err) {
    console.error('  [request-join] ERROR', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

/* ───────────────────────────────────────────────────────────
   GET /join/:jti
─────────────────────────────────────────────────────────── */
app.get('/join/:jti', async (req, res) => {
  try {
    const { jti } = req.params;
    console.log('  [join] incoming token', jti);

    const redisResp = await fetch(`${REDIS_URL}/get/${jti}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    }).then(r => r.json());

    console.log('  [join] Redis answered', redisResp);

    if (!redisResp || !redisResp.result) {
      console.log('  [join] token missing or expired → 401');
      return res.status(401).send('Unauthorized or expired token');
    }

    const room = redisResp.result;
    console.log('  [join] validated → room =', room);

    const viewerPath = path.resolve(__dirname, 'viewer.html');
    if (!fs.existsSync(viewerPath)) {
      console.error('  [join] viewer.html NOT FOUND at', viewerPath);
      return res.status(500).send('viewer.html missing on server');
    }

    let html = fs.readFileSync(viewerPath, 'utf8');
    html     = html.replace(/%%ROOM_PLACEHOLDER%%/g, room);

    console.log('  [join] viewer.html loaded, placeholder replaced – sending');
    res.type('html').send(html);

  } catch (err) {
    console.error('  [join] ERROR', err);
    res.status(500).send('Server error');
  }
});

/* ─────────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🟢  server listening on ${PORT}`));
