/*
 * Secure join-link service
 * ------------------------------------------------------------
 * 1. POST /api/request-join   → returns { joinUrl:"/join/<id>", … }
 * 2. GET  /join/<id>          → validates token, injects room into
 *                               viewer.html, sends it to the browser
 */
const express = require('express');
const fetch   = require('node-fetch');
const fs      = require('fs');
const path    = require('path');

const app = express();
app.use(express.json());

/*  Upstash Redis (put these in env vars for real deployments)  */
const REDIS_URL   = 'https://active-marmoset-8778.upstash.io';
const REDIS_TOKEN = 'ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA';

const TTL         = 90;            // seconds – how long the link works
const DEFAULT_ROOM= 'AyushLive';   // fallback if client didn’t send one

/* ------------------------------------------------------------
   POST /api/request-join
------------------------------------------------------------ */
app.post('/api/request-join', async (req, res) => {
  try {
    const room = (req.body.room || '').trim() || DEFAULT_ROOM;
    const jti  = Math.random().toString(36).substring(2, 18); // 16-char id

    // store jti → room mapping with expiry
    await fetch(`${REDIS_URL}/set/${jti}`, {
      method : 'POST',
      headers: {
        Authorization : `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ value: room, ex: TTL })
    });

    return res.json({
      joinUrl: `/join/${jti}`,
      ttl    : TTL
      /* add jwt:"…" here if you mint one */
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server_error' });
  }
});

/* ------------------------------------------------------------
   GET /join/:jti
   – validates token
   – streams viewer.html with the real room substituted
------------------------------------------------------------ */
app.get('/join/:jti', async (req, res) => {
  try {
    const { jti } = req.params;

    const roomData = await fetch(`${REDIS_URL}/get/${jti}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    }).then(r => r.json());

    if (!roomData || !roomData.result) {
      return res.status(401).send('Unauthorized or expired token');
    }

    const room = roomData.result;   // e.g.  AyushLive

    // ---- stream viewer.html with placeholder replaced ----
    const viewerPath = path.join(__dirname, 'viewer.html');
    let html         = fs.readFileSync(viewerPath, 'utf8');

    html = html.replace(/%%ROOM_PLACEHOLDER%%/g, room);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);

  } catch (err) {
    console.error(err);
    return res.status(500).send('Server error');
  }
});

/* ------------------------------------------------------------ */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('🟢 server listening on', PORT));
