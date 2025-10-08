// ─────────────────────────────────────────────────────────────────────────────
// Express + Upstash “ephemeral but NOT single-use” room join service
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const fetch   = require('node-fetch');

const app  = express();
app.use(express.json());

// Upstash Redis (hard-coded demo creds – move to env vars in prod!)
const REDIS_URL   = 'https://active-marmoset-8778.upstash.io';
const REDIS_TOKEN = 'ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA';

// “How long should this join-token live?” (seconds). 90 s = 1½ min.
const TTL = 90;

// ── POST /api/request-join ───────────────────────────────────────────────────
// Creates a one-time-use-until-TTL token (NOT deleted on first use anymore)
app.post('/api/request-join', async (req, res) => {
  try {
    const room = req.body.room || 'AyushLive';
    const jti  = Math.random().toString(36).substring(2, 18);  // pseudo-random id

    // Store token → room mapping in Redis with an expiry
    await fetch(`${REDIS_URL}/set/${jti}`, {
      method : 'POST',
      headers: {
        Authorization : `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ value: room, ex: TTL })
    });

    return res.json({ joinUrl: `/join/${jti}`, ttl: TTL });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// ── GET /join/:jti ───────────────────────────────────────────────────────────
// Reads the token and serves the meeting page. ❶ NO deletion anymore.
app.get('/join/:jti', async (req, res) => {
  try {
    const { jti } = req.params;

    const roomData = await fetch(`${REDIS_URL}/get/${jti}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    }).then(r => r.json());

    if (!roomData || !roomData.result) {
      return res.status(401).send('Unauthorized or expired token');
    }

    const room = roomData.result;

    // ❶  — Removed “DEL” so token can be used repeatedly until TTL hits zero
    // await fetch(`${REDIS_URL}/del/${jti}`, { … });

    // Serve an HTML page that embeds the provider’s iframe
    return res.send(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>${room}</title></head>
<body style="margin:0;background:#000;">
  <iframe src="https://8x8.vc/vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9/${room}"
          style="width:100vw;height:100vh;border:0;"
          allow="camera; microphone; fullscreen">
  </iframe>
</body>
</html>`);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Server error');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
app.listen(process.env.PORT || 10_000,
  () => console.log('🔗  Join-link service listening …')
);
