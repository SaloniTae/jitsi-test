// server-proxy.js — persistent tokens + provider proxy to hide room from client
// Requires: npm i node-fetch http-proxy-middleware express cors
const express = require('express');
const fetch = require('node-fetch'); // remove if node >=18 and you want global fetch
const crypto = require('crypto');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
app.use(express.json());

// CORS: configure in env for production
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : true
}));

// Upstash config (move to env in production)
const REDIS_URL = process.env.UPSTASH_REST_URL || "https://active-marmoset-8778.upstash.io";
const REDIS_TOKEN = process.env.UPSTASH_REST_TOKEN || "ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA";

// Provider base and provider path prefix (adjust to your provider)
const PROVIDER_BASE = process.env.PROVIDER_BASE || 'https://8x8.vc';
const PROVIDER_PATH_PREFIX = process.env.PROVIDER_PATH_PREFIX || 'vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9'; 
// Example final provider URL becomes: https://8x8.vc/vpaas-magic-cookie-.../<room> and then provider's UI assets.

// Helpers
function makeJti(){ return crypto.randomBytes(12).toString('hex'); }
function getServiceBaseUrl(req) {
  if (process.env.SERVICE_BASE) return process.env.SERVICE_BASE.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}
function isValidRoomName(name) {
  if (!name || typeof name !== 'string') return false;
  return /^[A-Za-z0-9._:-]{1,80}$/.test(name);
}

// Persist token creation (no TTL)
app.post('/api/request-join', async (req, res) => {
  try {
    const roomHint = (req.body && req.body.room) ? String(req.body.room).trim() : "AyushLive";
    const jti = makeJti();

    const setResp = await fetch(`${REDIS_URL}/set/${jti}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value: roomHint }) // persistent, no ex
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

// Serve join page — this page does NOT include the provider room anywhere.
// It only embeds an iframe pointing at /proxy/:jti/ (your origin)
app.get('/join/:jti', async (req, res) => {
  try {
    const jti = req.params.jti;
    if (!jti) return res.status(400).send('Bad request');

    // Check token exists (but do NOT reveal room)
    const getResp = await fetch(`${REDIS_URL}/get/${jti}`, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
    if (!getResp.ok) {
      console.error('Upstash get failed', getResp.status);
      return res.status(401).send("Unauthorized or unknown token");
    }
    const body = await getResp.json();
    const raw = body && body.result !== undefined ? body.result : null;
    if (!raw) return res.status(401).send("Unauthorized or unknown token");

    // We *do not* place the room anywhere in this HTML source.
    // The iframe points to /proxy/:jti/ which the server will use to lookup the real room and proxy to provider.
    res.send(`
      <!doctype html>
      <html>
        <head>
           <meta charset="utf-8">
           <meta name="viewport" content="width=device-width,initial-scale=1">
           <title>Join</title>
           <style>html,body{height:100%;margin:0;background:#000}iframe{width:100vw;height:100vh;border:0}</style>
        </head>
        <body>
          <!-- IMPORTANT: outer iframe points to server proxy path. It does NOT include provider room. -->
          <iframe src="/proxy/${jti}/" allow="camera; microphone; fullscreen; autoplay" allowfullscreen style="border:0; width:100vw; height:100vh;"></iframe>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('join error', err);
    res.status(500).send('Server error');
  }
});

// PROXY: forward requests under /proxy/:jti/* to the provider while injecting the room server-side.
// We create a small middleware that fetches the room for this jti and then uses http-proxy-middleware
app.use('/proxy/:jti', async (req, res, next) => {
  try {
    const jti = req.params.jti;
    if (!jti) return res.status(400).send('Bad request');

    // Get room for jti
    const getResp = await fetch(`${REDIS_URL}/get/${jti}`, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` }});
    if (!getResp.ok) {
      console.error('Upstash get failed (proxy)', getResp.status);
      return res.status(401).send('Unauthorized or unknown token');
    }
    const roomData = await getResp.json();
    const room = (roomData && roomData.result) ? String(roomData.result) : null;
    if (!room) return res.status(401).send('Unauthorized or unknown token');

    if (!isValidRoomName(room)) {
      console.warn('Invalid room for proxy:', room);
      return res.status(400).send('Invalid room');
    }

    // Build target path to provider (we will rewrite the incoming path to the provider path that contains the room)
    const providerOrigin = PROVIDER_BASE.replace(/\/$/,''); // e.g. https://8x8.vc
    const providerRoomPath = `/${PROVIDER_PATH_PREFIX}/${room}`; // e.g. /vpaas-.../AyushLive

    // Create a proxy middleware instance for this request that rewrites path to the providerRoomPath
    const proxy = createProxyMiddleware({
      target: providerOrigin,
      changeOrigin: true,
      ws: true,
      // rewrite any path under /proxy/:jti/* to providerRoomPath + the rest of the path after /proxy/:jti
      pathRewrite: (path, req) => {
        // req.url contains the path after /proxy/:jti; we want to append it to providerRoomPath
        // Example: /proxy/abcd/ -> providerRoomPath + '/'
        // Example: /proxy/abcd/some.js -> providerRoomPath + '/some.js'
        const prefix = `/proxy/${jti}`;
        let rest = path.startsWith(prefix) ? path.slice(prefix.length) : '';
        if (!rest) rest = '/';
        return providerRoomPath + rest;
      },
      onProxyReq: (proxyReq, req, res) => {
        // Optional headers to add when proxying
        // Example: proxyReq.setHeader('X-Forwarded-For', req.ip);
      },
      logLevel: 'warn'
    });

    // Delegate to proxy
    return proxy(req, res, next);
  } catch (err) {
    console.error('proxy middleware error', err);
    return res.status(500).send('Proxy error');
  }
});

// Optional: a small revoke endpoint (admin) — protects you from permanently exposed links
app.delete('/api/revoke/:jti', async (req, res) => {
  const jti = req.params.jti;
  // Protect this endpoint in production (basic token or admin auth)
  if (!jti) return res.status(400).json({error:'bad_request'});
  try {
    const delResp = await fetch(`${REDIS_URL}/del/${jti}`, { method:'POST', headers:{ Authorization:`Bearer ${REDIS_TOKEN}` }});
    if (!delResp.ok) {
      const t = await delResp.text().catch(()=>null);
      console.error('Upstash del failed', delResp.status, t);
      return res.status(502).json({ error: 'upstash_error' });
    }
    return res.json({ ok:true });
  } catch (e) {
    console.error('revoke error', e);
    return res.status(500).json({ error:'server_error' });
  }
});

const port = process.env.PORT || 10000;
app.listen(port, ()=>console.log(`Server running on port ${port}`));
