const express = require('express');
const fetch = require('node-fetch'); // Node >=18 can use global fetch
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors({ origin: true })); // allow all origins for demo

// Upstash Redis config
const REDIS_URL = "https://active-marmoset-8778.upstash.io";
const REDIS_TOKEN = "ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA";

function isValidRoomName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(name);
}

function makeJti() {
  return crypto.randomBytes(12).toString('hex');
}

// Get server base URL dynamically
function getServiceBaseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

// === Persistent join token ===
app.post('/api/request-join', async (req, res) => {
  try {
    const room = (req.body.room || "AyushLive").trim();
    if (!isValidRoomName(room)) return res.status(400).json({ error: 'invalid_room' });

    const jti = makeJti();

    // Store token persistently (no TTL)
    const setResp = await fetch(`${REDIS_URL}/set/${jti}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value: room })
    });

    if (!setResp.ok) return res.status(502).json({ error: 'upstash_error' });

    const base = getServiceBaseUrl(req);
    res.json({ joinUrl: `/join/${jti}`, fullJoinUrl: `${base}/join/${jti}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// === Serve join page (outer iframe) ===
app.get('/join/:jti', async (req, res) => {
  try {
    const jti = req.params.jti;
    if (!jti) return res.status(400).send("Bad request");

    const getResp = await fetch(`${REDIS_URL}/get/${jti}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    if (!getResp.ok) return res.status(401).send("Unauthorized");

    const roomData = await getResp.json();
    if (!roomData?.result) return res.status(401).send("Unauthorized");

    // Outer HTML embeds **proxy iframe**, so room name never leaks
    const base = getServiceBaseUrl(req);
    res.send(`
      <!doctype html>
      <html>
        <head><meta charset="utf-8"><title>Loading…</title></head>
        <body style="margin:0;background:#000">
          <iframe src="${base}/proxy/${jti}" style="width:100vw;height:100vh;border:0;" allow="camera; microphone; fullscreen; autoplay" allowfullscreen></iframe>
        </body>
      </html>
    `);
  } catch (e) {
    console.error(e);
    res.status(500).send("Server error");
  }
});

// === Proxy iframe endpoint (loads provider iframe) ===
app.get('/proxy/:jti', async (req, res) => {
  try {
    const jti = req.params.jti;
    const getResp = await fetch(`${REDIS_URL}/get/${jti}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    if (!getResp.ok) return res.status(401).send("Unauthorized");

    const roomData = await getResp.json();
    const room = roomData?.result;
    if (!room) return res.status(401).send("Unauthorized");

    const escapeHtml = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
    const safeRoom = escapeHtml(room);

    res.send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>Meeting</title>
          <style>html,body{height:100%;margin:0;background:#000}iframe{width:100vw;height:100vh;border:0}</style>
        </head>
        <body>
          <iframe src="https://8x8.vc/vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9/${safeRoom}"
                  allow="camera; microphone; fullscreen; autoplay"
                  allowfullscreen
                  style="width:100vw;height:100vh;border:0;">
          </iframe>
        </body>
      </html>
    `);
  } catch(e) {
    console.error(e);
    res.status(500).send("Server error");
  }
});

app.listen(process.env.PORT || 10000, () => console.log("Server running..."));
