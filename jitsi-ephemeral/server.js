const express = require('express');
const fetch = require('node-fetch');
const app = express();
app.use(express.json());

// Upstash Redis config (hardcoded)
const REDIS_URL = "https://active-marmoset-8778.upstash.io";
const REDIS_TOKEN = "ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA";

const TTL = 90; // seconds

// Generate ephemeral token
app.post('/api/request-join', async (req,res)=>{
  try {
    const room = req.body.room || "AyushLive";
    const jti = Math.random().toString(36).substr(2,16);

    // Store ephemeral token in Upstash
    await fetch(`${REDIS_URL}/set/${jti}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type":"application/json"
      },
      body: JSON.stringify({ value: room, ex: TTL })
    });

    res.json({ joinUrl: `/join/${jti}`, ttl: TTL });
  } catch(e){
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Serve ephemeral join page
app.get('/join/:jti', async (req,res)=>{
  try {
    const jti = req.params.jti;
    const roomData = await fetch(`${REDIS_URL}/get/${jti}`, {
      headers:{ Authorization: `Bearer ${REDIS_TOKEN}` }
    }).then(r=>r.json());

    if(!roomData || !roomData.result) return res.status(401).send("Unauthorized or expired token");

    const room = roomData.result;
    // Delete token immediately to enforce single-use
    await fetch(`${REDIS_URL}/del/${jti}`, {
      method: 'POST',
      headers:{ Authorization: `Bearer ${REDIS_TOKEN}` }
    });

    // Serve a minimal HTML that embeds Jitsi iframe
    res.send(`
      <!doctype html>
      <html>
        <head><meta charset="utf-8"><title>${room}</title></head>
        <body style="margin:0; background:#000;">
          <iframe src="https://8x8.vc/vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9/${room}"
                  style="width:100vw; height:100vh; border:0;"
                  allow="camera; microphone; fullscreen">
          </iframe>
        </body>
      </html>
    `);

  } catch(e){
    console.error(e);
    res.status(500).send("Server error");
  }
});

app.listen(process.env.PORT || 10000, ()=>console.log("Server running..."));
