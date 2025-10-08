const express = require('express');
const fetch   = require('node-fetch');
const fs      = require('fs');
const path    = require('path');

const app = express();
app.use(express.json());

/* ---------- Upstash Redis ---------- */
const REDIS_URL   = 'https://active-marmoset-8778.upstash.io';
const REDIS_TOKEN = 'ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA';

const TTL          = 90;          // token life in seconds
const DEFAULT_ROOM = 'AyushLive'; // fallback room

/* ---------- POST /api/request-join ---------- */
app.post('/api/request-join', async (req, res) => {
  try {
    const room = (req.body.room || '').trim() || DEFAULT_ROOM;
    const jti  = Math.random().toString(36).substring(2, 18);

    await fetch(`${REDIS_URL}/set/${jti}`, {
      method : 'POST',
      headers: {
        Authorization : `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ value: room, ex: TTL })
    });

    res.json({ joinUrl: `/join/${jti}`, ttl: TTL });
  } catch (e) {
    console.error('[request-join]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/* ---------- GET /join/:jti ---------- */
app.get('/join/:jti', async (req, res) => {
  try {
    const { jti } = req.params;

    const roomData = await fetch(`${REDIS_URL}/get/${jti}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    }).then(r => r.json());

    if (!roomData || !roomData.result) {
      return res.status(401).send('Unauthorized or expired token');
    }

    const room = roomData.result; // the validated room

    /* --- locate viewer.html --- */
    const viewerPath = path.resolve(__dirname, 'viewer.html');

    if (!fs.existsSync(viewerPath)) {
      console.error(`viewer.html not found at ${viewerPath}`);
      return res.status(500).send('viewer.html missing on server');
    }

    /* --- stream viewer.html after injecting the room --- */
    let html = fs.readFileSync(viewerPath, 'utf8');
    html = html.replace(/%%ROOM_PLACEHOLDER%%/g, room);

    res.type('html').send(html);

  } catch (e) {
    console.error('[join]', e);
    res.status(500).send('Server error');
  }
});

/* ---------- boot ---------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('🟢  listening on', PORT));
