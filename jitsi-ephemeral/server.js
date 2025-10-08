// server.js — persistent join tokens (no TTL, no single-use)
const express = require('express');
const fetch = require('node-fetch'); // node >=18 can use global fetch
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(express.json());

// CORS: set ALLOWED_ORIGINS in env as comma-separated list in prod
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : true
}));

// Upstash Redis config (use env vars in production)
const REDIS_URL = process.env.UPSTASH_REST_URL || "https://active-marmoset-8778.upstash.io";
const REDIS_TOKEN = process.env.UPSTASH_REST_TOKEN || "ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA";

function isValidRoomName(name) {
  if (!name || typeof name !== 'string') return false;
  return /^[A-Za-z0-9._:-]{1,80}$/.test(name);
}
function makeJti() {
  return crypto.randomBytes(12).toString('hex'); // stable-length secure token
}
function getServiceBaseUrl(req) {
  if (process.env.SERVICE_BASE) return process.env.SERVICE_BASE.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

// === Create persistent token (no TTL) ===
app.post('/api/request-join', async (req, res) => {
  try {
    const room = (req.body && req.body.room) ? String(req.body.room).trim() : "AyushLive";
    if (!isValidRoomName(room)) return res.status(400).json({ error: 'invalid_room' });

    const jti = makeJti();

    // IMPORTANT: omit `ex` (expiry) to make this key persistent in Upstash
    const setResp = await fetch(`${REDIS_URL}/set/${jti}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ value: room }) // no ex => persistent
    });

    if (!setResp.ok) {
      const txt = await setResp.text().catch(()=>null);
      console.error('Upstash set failed', setResp.status, txt);
      return res.status(502).json({ error: 'upstash_error' });
    }

    const base = getServiceBaseUrl(req);
    const fullJoinUrl = `${base}/join/${jti}`;

    // Return both forms to be robust
    res.json({ joinUrl: `/join/${jti}`, fullJoinUrl });

  } catch (e) {
    console.error('request-join error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// === Serve join page (persistent token — do NOT delete) ===
app.get('/join/:jti', async (req, res) => {
  try {
    const jti = req.params.jti;
    if (!jti || typeof jti !== 'string') return res.status(400).send("Bad request");

    const getResp = await fetch(`${REDIS_URL}/get/${jti}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });

    if (!getResp.ok) {
      console.error('Upstash get failed', getResp.status);
      return res.status(401).send("Unauthorized or unknown token");
    }

    const roomData = await getResp.json();
    const room = roomData && roomData.result ? String(roomData.result) : null;
    if (!room) return res.status(401).send("Unauthorized or unknown token");

    if (!isValidRoomName(room)) {
      return res.status(400).send("Invalid room");
    }

    const escapeHtml = (s) => String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

    const safeRoom = escapeHtml(room);

    res.send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>Join — ${safeRoom}</title>
          <style>html,body{height:100%;margin:0;background:#000}iframe{width:100vw;height:100vh;border:0}</style>
        </head>
        <body>
          <iframe src="https://8x8.vc/vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9/${safeRoom}"
                  allow="camera; microphone; fullscreen; autoplay"
                  allowfullscreen
                  style="border:0; width:100vw; height:100vh;">
          </iframe>
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
