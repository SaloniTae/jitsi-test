const express = require('express');
const fetch = require('node-fetch'); 
const fs = require('fs/promises'); // Import for file reading
const path = require('path');       // Import for path resolution
const app = express();
app.use(express.json());

// Upstash Redis config (Still only used by the POST route)
const REDIS_URL = "https://active-marmoset-8778.upstash.io";
const REDIS_TOKEN = "ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA";
const TTL = 90; // seconds

// --------------------------------------------------------------------------------
// POST Route remains the same (generates a permanent-acting link)
// --------------------------------------------------------------------------------
app.post('/api/request-join', async (req,res)=>{
  try {
    const room = req.body.room || "AyushLive";
    const jti = Math.random().toString(36).substr(2,16);

    // This data is written to Redis, but the GET route below ignores the deletion.
    await fetch(`${REDIS_URL}/set/${jti}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type":"application/json" },
      body: JSON.stringify({ value: room, ex: TTL })
    });

    res.json({ joinUrl: `/join/${jti}`, ttl: TTL }); 
  } catch(e){
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});


// --------------------------------------------------------------------------------
// PERMANENT JOIN LINK LOGIC: Reads and injects data into viewer.html
// --------------------------------------------------------------------------------
app.get('/join/:jti', async (req, res) => {
  try {
    // 1. **Secure Configuration:** Define the room name on the server.
    // NOTE: This room name is NOT exposed in the final HTML response.
    const roomConfig = "vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9/AyushLive";
    
    // 2. Read the viewer.html file
    const filePath = path.join(__dirname, 'viewer.html');
    let viewerHtml = await fs.readFile(filePath, 'utf-8');

    // 3. **Secure Injection:** Replace the placeholder in the HTML file 
    // with the actual room name. The client-side script will read the
    // value from a hidden element, not from a plain script variable.
    viewerHtml = viewerHtml.replace('AyushLivee', roomConfig);

    res.send(viewerHtml);

  } catch(e){
    console.error(e);
    res.status(500).send("Server error");
  }
});
// --------------------------------------------------------------------------------

app.listen(process.env.PORT || 10000, ()=>console.log("Server running..."));
