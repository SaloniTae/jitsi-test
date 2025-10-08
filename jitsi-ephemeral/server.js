// server.js — persistent tokens + proxy; join page uses RELATIVE /proxy/:jti to avoid base mismatches
const express = require('express');
const fetch = require('node-fetch'); // remove if Node >= 18 and you want global fetch
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(express.json());
// For production, set ALLOWED_ORIGINS env to a comma-separated list
app.use(cors({ origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : true }));

// Upstash (move to env in production)
const REDIS_URL = process.env.UPSTASH_REST_URL || "https://active-marmoset-8778.upstash.io";
const REDIS_TOKEN = process.env.UPSTASH_REST_TOKEN || "ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA";

function isValidRoomName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(name);
}
function makeJti() { return crypto.randomBytes(12).toString('hex'); }

// Create persistent token
app.post('/api/request-join', async (req, res) => {
  try {
    const room = (req.body && req.body.room) ? String(req.body.room).trim() : "AyushLive";
    if (!isValidRoomName(room)) return res.status(400).json({ error: 'invalid_room' });

    const jti = makeJti();
    const setResp = await fetch(`${REDIS_URL}/set/${jti}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value: room }) // persistent: no ex
    });

    if (!setResp.ok) {
      const txt = await setResp.text().catch(()=>null);
      console.error('Upstash set failed', setResp.status, txt);
      return res.status(502).json({ error: 'upstash_error' });
    }

    // Return both forms; client will prefer fullJoinUrl if absolute
    const baseJoin = `/join/${jti}`;
    const fullJoin = `${req.protocol}://${req.get('host')}${baseJoin}`; // best-effort absolute
    console.log('Created token', jti, 'for room', room);
    res.json({ joinUrl: baseJoin, fullJoinUrl: fullJoin });
  } catch (e) {
    console.error('request-join error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Serve join page (outer iframe) — uses RELATIVE /proxy/:jti so no host mismatch
app.get('/join/:jti', async (req, res) => {
  try {
    const jti = req.params.jti;
    if (!jti) return res.status(400).send("Bad request");

    // Verify token exists (do not reveal room)
    const getResp = await fetch(`${REDIS_URL}/get/${jti}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    if (!getResp.ok) {
      console.warn('Upstash get failed (join):', getResp.status);
      return res.status(401).send("Unauthorized or unknown token");
    }
    const body = await getResp.json();
    if (!body?.result) return res.status(401).send("Unauthorized or unknown token");

    // Serve an HTML that embeds a RELATIVE proxy path (no provider room in source)
    res.send(`
      <!doctype html>
      <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Join</title></head>
        <body style="margin:0;background:#000">
          <!-- RELATIVE path prevents host mismatches -->
          <iframe src="/proxy/${jti}" style="width:100vw;height:100vh;border:0;" allow="camera; microphone; fullscreen; autoplay" allowfullscreen></iframe>
        </body>
      </html>
    `);
  } catch (e) {
    console.error('join error', e);
    res.status(500).send("Server error");
  }
});

// Proxy endpoint — returns a small page that embeds the provider iframe with the real room.
// This page runs on YOUR ORIGIN, so the browser's network log only shows /proxy/:jti entries.
app.get('/proxy/:jti', async (req, res) => {
  try {
    const jti = req.params.jti;
    const getResp = await fetch(`${REDIS_URL}/get/${jti}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    if (!getResp.ok) {
      console.warn('Upstash get failed (proxy):', getResp.status);
      return res.status(401).send("Unauthorized or unknown token");
    }
    const roomData = await getResp.json();
    const room = roomData?.result;
    if (!room) return res.status(401).send("Unauthorized or unknown token");
    if (!isValidRoomName(room)) return res.status(400).send("Invalid room");

    const escapeHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    const safeRoom = escapeHtml(room);

    // IMPORTANT: provider URL uses the room; it's inside this proxied page which is served from your origin
    res.send(`
      <!doctype html>
      <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Meeting</title>
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
  } catch (e) {
    console.error('proxy error', e);
    res.status(500).send("Server error");
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server running on ${port}`));
