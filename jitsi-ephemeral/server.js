/*
 * server.js  —  full debug output
 * place next to  viewer.html
 * run:  node server.js
 */
const express = require('express');
const fetch   = require('node-fetch');
const fs      = require('fs');
const path    = require('path');

const app = express();
app.use(express.json());

/* 0. global request logger (catches 404 targets too) */
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

/* 1. Upstash Redis ------------------------------------------------ */
const REDIS_URL   = 'https://active-marmoset-8778.upstash.io';
const REDIS_TOKEN = 'ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA';

const TTL          = 90;          // seconds
const DEFAULT_ROOM = 'AyushLive';

/* 2. POST /api/request-join -------------------------------------- */
app.post('/api/request-join', async (req, res) => {
  try {
    const room = (req.body.room || '').trim() || DEFAULT_ROOM;
    const jti  = Math.random().toString(36).substring(2, 18);

    console.log('  [api] new token', jti, '→ room', room);

    const r = await fetch(`${REDIS_URL}/set/${jti}`, {
      method : 'POST',
      headers: { Authorization:`Bearer ${REDIS_TOKEN}`,
                 'Content-Type':'application/json' },
      body   : JSON.stringify({ value: room, ex: TTL })
    });
    console.log('  [api] Upstash /set status', r.status);

    return res.json({ joinUrl:`/join/${jti}`, ttl:TTL });
  } catch (e) {
    console.error('  [api] ERROR', e);
    res.status(500).json({ error:'server_error' });
  }
});

/* 3. GET /join/:jti --------------------------------------------- */
app.get('/join/:jti', async (req, res) => {
  try {
    const jti = req.params.jti;
    console.log('  [join] token =', jti);

    /* 3-a : fetch from Redis */
    const redisResp = await fetch(`${REDIS_URL}/get/${jti}`, {
      headers:{ Authorization:`Bearer ${REDIS_TOKEN}` }
    }).then(r => r.json());

    console.log('  [join] Upstash answered', redisResp);

    if (!redisResp || !redisResp.result) {
      console.log('  [join] token not found / expired  → 401');
      return res.status(401).send('Unauthorized or expired token');
    }
    const room = redisResp.result;
    console.log('  [join] OK  room =', room);

    /* 3-b : locate viewer.html */
    const viewerPath = path.resolve(__dirname, 'viewer.html');
    console.log('  [join] viewer path', viewerPath);

    if (!fs.existsSync(viewerPath)) {
      console.error('  [join] viewer.html MISSING');
      return res.status(500).send('viewer.html missing on server');
    }

    /* 3-c : inject room placeholder */
    let html = fs.readFileSync(viewerPath, 'utf8');
    html = html.replace(/%%ROOM_PLACEHOLDER%%/g, room);

    console.log('  [join] sending viewer.html (length', html.length, ')');
    res.type('html').send(html);

  } catch (e) {
    console.error('  [join] ERROR', e);
    res.status(500).send('Server error');
  }
});

/* 4. catch-all 404 (to see what slips through) ------------------- */
app.use((req, res) => {
  console.log('  [404] fell through router →', req.originalUrl);
  res.status(404).send('not found');
});

/* 5. boot --------------------------------------------------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('🟢  server listening on', PORT));
