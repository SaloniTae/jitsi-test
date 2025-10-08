const express = require('express');
const fetch   = require('node-fetch');
const app     = express();

app.use(express.json());

// Upstash Redis (move to env-vars for prod!)
const REDIS_URL   = 'https://active-marmoset-8778.upstash.io';
const REDIS_TOKEN = 'ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA';

const TTL = 90;                       // seconds
const DEFAULT_ROOM = 'AyushLive';     // fallback if none sent

// ───── POST /api/request-join ───────────────────────────────
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

    /* NEW: also send the room back so the viewer can craft “APP_ID/room” */
    return res.json({
      joinUrl : `/join/${jti}`,
      ttl     : TTL,
      room    : room,
      jwt     : ''          // if you mint a JWT, put it here and the viewer will use it
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// ───── GET /join/:jti (NOT single use any more) ─────────────
app.get('/join/:jti', async (req, res) => {
  try {
    const { jti } = req.params;
    const roomData = await fetch(`${REDIS_URL}/get/${jti}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    }).then(r => r.json());

    if (!roomData || !roomData.result)
      return res.status(401).send('Unauthorized or expired token');

    const room = roomData.result;

    // NOTE: no deletion -> link reusable until TTL expires

    return res.send(`<!doctype html><html><head><meta charset="utf-8">
<title>${room}</title></head><body style="margin:0;background:#000;">
<iframe src="https://8x8.vc/vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9/${room}"
        style="width:100vw;height:100vh;border:0;"
        allow="camera; microphone; fullscreen">
</iframe></body></html>`);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Server error');
  }
});

// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 10_000;
app.listen(PORT, () => console.log('🟢 server listening on', PORT));
