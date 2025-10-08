// server.js
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');            // ← NEW
const app     = express();

app.use(express.json());

// Serve everything in ./public (viewer.html, images, etc.)
app.use(express.static(path.join(__dirname, 'public')));   // ← NEW

// ───── Upstash Redis (move to env-vars for prod!) ─────────
const REDIS_URL   = 'https://active-marmoset-8778.upstash.io';
const REDIS_TOKEN = 'ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA';

const TTL = 90;                       // seconds
const DEFAULT_ROOM = 'AyushLive';     // fallback

// ───── POST /api/request-join ──────────────────────────────
app.post('/api/request-join', async (req, res) => {
  try {
    const room = (req.body.room || '').trim() || DEFAULT_ROOM;
    const jti  = Math.random().toString(36).substring(2, 18);

    // store mapping jti → room with expiry
    await fetch(`${REDIS_URL}/set/${jti}`, {
      method : 'POST',
      headers: {
        Authorization : `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ value: room, ex: TTL })
    });

    return res.json({
      joinUrl : `/join/${jti}`,
      ttl     : TTL,
      room    : room,
      jwt     : ''          // put a JWT here if you mint one
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// ───── GET /join/:jti  (validates token, then sends viewer.html) ────
app.get('/join/:jti', async (req, res) => {
  try {
    const { jti } = req.params;

    const roomData = await fetch(`${REDIS_URL}/get/${jti}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    }).then(r => r.json());

    if (!roomData || !roomData.result) {
      return res.status(401).send('Unauthorized or expired token');
    }

    // NOTE: we keep the key so the link is reusable until TTL expiry

    // Serve the *real* viewer UI
    return res.sendFile(path.join(__dirname, 'public', 'viewer.html')); // ← CHANGED
  } catch (err) {
    console.error(err);
    return res.status(500).send('Server error');
  }
});

// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 10_000;
app.listen(PORT, () => console.log('🟢 server listening on', PORT));
