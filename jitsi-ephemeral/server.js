const express = require('express');
const fetch = require('node-fetch'); // v2.6.7
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ==== CONFIG ====
const UPSTASH_REDIS_REST_URL = "https://active-marmoset-8778.upstash.io";
const UPSTASH_REDIS_REST_TOKEN = "ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA";

const INACTIVE_TIMEOUT = 45; // seconds, owner inactive timeout

// ==== HELPERS ====
async function redisSet(key, value, ex) {
  const body = JSON.stringify({
    commands: [
      ["SET", key, JSON.stringify(value), "EX", ex]
    ]
  });
  await fetch(UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    body,
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json"
    }
  });
}

async function redisGet(key) {
  const body = JSON.stringify({ commands: [["GET", key]] });
  const resp = await fetch(UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    body,
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json"
    }
  });
  const data = await resp.json();
  if (!data || !data.results || !data.results[0]) return null;
  const val = data.results[0].value;
  if (!val) return null;
  return JSON.parse(val);
}

// ==== GENERATE RANDOM TOKEN ====
function genToken() {
  return crypto.randomBytes(16).toString('hex');
}

// ==== API: request join ====
app.post('/api/request-join', async (req, res) => {
  const { room } = req.body;
  if (!room) return res.status(400).json({ error: "room required" });

  const jti = genToken(); // ephemeral join token
  const ownerClient = genToken(); // unique owner id

  const ttl = 24 * 60 * 60; // 1 day, can adjust
  const data = {
    room,
    ownerClient,
    lastSeen: Date.now()
  };

  await redisSet(`jitsi:join:${jti}`, data, ttl);

  res.json({
    joinUrl: `${req.protocol}://${req.get('host')}/join/${jti}`,
    jti,
    ownerClient,
    ttl
  });
});

// ==== JOIN LINK ====
app.get('/join/:jti', async (req, res) => {
  const jti = req.params.jti;
  const clientId = req.query.client || ''; // unique per browser

  const key = `jitsi:join:${jti}`;
  const data = await redisGet(key);

  if (!data) return res.status(404).send("Invalid or expired join link");

  // First time: allow if clientId empty -> generate ownerClient cookie
  if (!clientId) {
    res.json({
      message: "Your ephemeral link",
      jti,
      room: data.room,
      ownerClient: data.ownerClient
    });
    return;
  }

  // If clientId matches ownerClient -> refresh lastSeen
  if (clientId === data.ownerClient) {
    data.lastSeen = Date.now();
    await redisSet(key, data, 24 * 60 * 60);
    return res.json({
      message: "Welcome back, owner",
      jti,
      room: data.room
    });
  }

  // Otherwise, check if owner is inactive
  if (Date.now() - data.lastSeen > INACTIVE_TIMEOUT * 1000) {
    // assign new owner
    data.ownerClient = clientId;
    data.lastSeen = Date.now();
    await redisSet(key, data, 24 * 60 * 60);
    return res.json({
      message: "Owner expired, you now own this join",
      jti,
      room: data.room
    });
  }

  // Still active by another client
  return res.status(403).send("Not authorized - link in use by another client");
});

// ==== HEARTBEAT ====
app.post('/api/heartbeat', async (req, res) => {
  const { jti, ownerClient } = req.body;
  if (!jti || !ownerClient) return res.status(400).json({ error: "jti + ownerClient required" });

  const key = `jitsi:join:${jti}`;
  const data = await redisGet(key);
  if (!data) return res.status(404).json({ error: "invalid join link" });

  if (ownerClient !== data.ownerClient) return res.status(403).json({ error: "not owner" });

  data.lastSeen = Date.now();
  await redisSet(key, data, 24*60*60);

  res.json({ ok: true });
});

// ==== START SERVER ====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
