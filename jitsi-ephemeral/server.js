// server.js — persistent tokens with robust join-room parsing + debug logging
const express = require('express');
const fetch = require('node-fetch'); // remove if running node >= 18 and want global fetch
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(express.json());

// Enable CORS (set ALLOWED_ORIGINS in env for production)
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : true
}));

const REDIS_URL = process.env.UPSTASH_REST_URL || "https://active-marmoset-8778.upstash.io";
const REDIS_TOKEN = process.env.UPSTASH_REST_TOKEN || "ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA";

function isValidRoomName(name) {
  if (!name || typeof name !== 'string') return false;
  // same rule as before: letters, digits, dot, underscore, colon, dash
  return /^[A-Za-z0-9._:-]{1,80}$/.test(name);
}
function makeJti() {
  return crypto.randomBytes(12).toString('hex');
}
function getServiceBaseUrl(req) {
  if (process.env.SERVICE_BASE) return process.env.SERVICE_BASE.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

// Helper to robustly parse a room value returned from Upstash
function normalizeRoomValue(raw) {
  // raw may be: "AyushLive", '"AyushLive"', '["AyushLive"]', {"room":"AyushLive"} or even other JSON
  if (raw == null) return null;

  // If already string and looks fine, return trimmed
  if (typeof raw === 'string') {
    let s = raw.trim();

    // If it looks like a JSON string with extra quotes, try to parse
    // e.g. '"AyushLive"' -> "AyushLive"
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      try {
        const parsed = JSON.parse(s);
        if (typeof parsed === 'string') return parsed;
      } catch(e){
        // fallback: strip quotes manually
        s = s.slice(1, -1);
      }
    }

    // If it's a JSON-like object/array string, try parse
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try {
        const parsed = JSON.parse(s);
        // If parsed is object and has a likely key, attempt to extract
        if (typeof parsed === 'string') return parsed;
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') return parsed[0];
        if (parsed && typeof parsed === 'object') {
          // try common properties
          if (typeof parsed.room === 'string') return parsed.room;
          if (typeof parsed.value === 'string') return parsed.value;
        }
      } catch(e){
        // ignore parse error
      }
    }

    // final fallback: return the (possibly trimmed/stripped) string
    return s;
  }

  // if raw is number/bool, convert to string
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);

  // if it's an object, try to find useful fields
  if (typeof raw === 'object') {
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') return raw[0];
    if (raw.room && typeof raw.room === 'string') return raw.room;
    if (raw.value && typeof raw.value === 'string') return raw.value;
  }

  return null;
}

// === Create persistent token (no TTL) ===
app.post('/api/request-join', async (req, res) => {
  try {
    const roomHint = (req.body && req.body.room) ? String(req.body.room).trim() : "AyushLive";
    // we accept the hint here, but we will *still* validate on join
    const jti = makeJti();

    const setResp = await fetch(`${REDIS_URL}/set/${jti}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ value: roomHint }) // persistent
    });

    if (!setResp.ok) {
      const txt = await setResp.text().catch(()=>null);
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

// === Serve join page (persistent token — robust parsing) ===
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

    // DEBUG: print raw response so you can inspect exactly what Upstash returned
    console.log('DEBUG: raw roomData for jti=', jti, JSON.stringify(roomData));

    // Upstash returns { result: <value> } — normalize that value
    const rawValue = roomData && roomData.result !== undefined ? roomData.result : null;
    const room = normalizeRoomValue(rawValue);

    console.log('DEBUG: normalized room value =', room);

    if (!room) return res.status(401).send("Unauthorized or unknown token");

    if (!isValidRoomName(room)) {
      console.warn('Invalid room rejected by validator:', room);
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

// Optional debug endpoint: return raw Upstash get response (only when DEBUG=true)
if (process.env.DEBUG === 'true') {
  app.get('/debug/raw/:jti', async (req, res) => {
    const jti = req.params.jti;
    try {
      const getResp = await fetch(`${REDIS_URL}/get/${jti}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
      });
      const body = await getResp.text();
      return res.status(getResp.ok ? 200 : 502).send(body);
    } catch (err) {
      return res.status(500).send(String(err));
    }
  });
}

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server running on port ${port}`));
