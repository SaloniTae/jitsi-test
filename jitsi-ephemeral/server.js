const express = require('express');
const fetch = require('node-fetch'); // Node >=18 can use global fetch
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(express.json());

// Allow CORS from anywhere (adjust in prod)
app.use(cors({
  origin: true
}));

// Upstash Redis config
const REDIS_URL = process.env.UPSTASH_REST_URL || "https://active-marmoset-8778.upstash.io";
const REDIS_TOKEN = process.env.UPSTASH_REST_TOKEN || "ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA";

function isValidRoomName(name) {
  if (!name || typeof name !== 'string') return false;
  return /^[A-Za-z0-9._:-]{1,80}$/.test(name);
}

function makeJti() {
  return crypto.randomBytes(12).toString('hex');
}

function getServiceBaseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

// === Create persistent token (no TTL) ===
app.post('/api/request-join', async (req, res) => {
  try {
    const room = req.body?.room?.trim() || "AyushLive";
    if (!isValidRoomName(room)) return res.status(400).json({ error: 'invalid_room' });

    const jti = makeJti();

    // Store in Upstash Redis as JSON string
    const setResp = await fetch(`${REDIS_URL}/set/${jti}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ value: room }) // persistent
    });

    if (!setResp.ok) {
      const txt = await setResp.text().catch(() => null);
      console.error('Upstash set failed', setResp.status, txt);
      return res.status(502).json({ error: 'upstash_error' });
    }

    const base = getServiceBaseUrl(req);
    const fullJoinUrl = `${base}/join/${jti}`;

    res.json({ joinUrl: `/join/${jti}`, fullJoinUrl });

  } catch (e) {
    console.error('request-join error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// === Serve join page (persistent token, room hidden) ===
app.get('/join/:jti', async (req, res) => {
  try {
    const jti = req.params.jti;

    const getResp = await fetch(`${REDIS_URL}/get/${jti}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });

    if (!getResp.ok) return res.status(401).send("Unauthorized or unknown token");

    const data = await getResp.json();
    if (!data?.result) return res.status(401).send("Unauthorized or unknown token");

    // Upstash stores JSON as string, parse it
    let roomObj;
    try { roomObj = JSON.parse(data.result); } catch(e){ roomObj = null; }
    const room = roomObj?.value || null;
    if (!room) return res.status(401).send("Unauthorized or unknown token");

    // Serve HTML that dynamically sets iframe src to hide room from network logs
    res.send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>Join Meeting</title>
          <style>
            html,body{height:100%;margin:0;background:#000}
            iframe{width:100vw;height:100vh;border:0}
          </style>
        </head>
        <body>
          <iframe id="meetFrame"
                  allow="camera; microphone; fullscreen; autoplay"
                  allowfullscreen
                  style="border:0;width:100vw;height:100vh;">
          </iframe>
          <script>
            const frame = document.getElementById('meetFrame');
            frame.src = "https://8x8.vc/vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9/${room}";
          </script>
        </body>
      </html>
    `);

  } catch (e) {
    console.error('join error', e);
    res.status(500).send("Server error");
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server running on port ${port}`));
