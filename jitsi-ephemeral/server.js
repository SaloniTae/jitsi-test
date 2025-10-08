const express = require('express');
// const fetch = require('node-fetch'); // REMOVED: No longer needed as we don't talk to Redis/Upstash
const fs = require('fs/promises'); // Added to read viewer.html file
const path = require('path');       // Added for path resolution
const app = express();
app.use(express.json());

// ----------------------------------------------------------------------
// REMOVED: Upstash Redis config (REDIS_URL, REDIS_TOKEN, TTL)
// ----------------------------------------------------------------------

// ----------------------------------------------------------------------
// REMOVED: The /api/request-join POST route entirely.
// Links are no longer generated; they are direct access.
// ----------------------------------------------------------------------

// The Permanent Join URL is defined by the room name in the viewer.html.
// We'll use a single route that doesn't rely on ':jti' to validate, 
// but we keep the :jti structure to handle any old link format.
app.get('/join/:jti', async (req, res) => {
  try {
    // 1. Define the actual room name (This is what your HTML uses)
    // NOTE: This room name is now hardcoded on the server and injected.
    const roomConfig = "vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9/AyushLive";
    
    // 2. Read the viewer.html file from disk
    // Assuming viewer.html is in the same directory as server.js
    const filePath = path.join(__dirname, 'viewer.html');
    let viewerHtml = await fs.readFile(filePath, 'utf-8');

    // 3. Inject the room name into the HTML placeholder for security/separation
    // We are replacing a placeholder in the HTML file, which will be defined below.
    viewerHtml = viewerHtml.replace('ROOM_PLACEHOLDER', roomConfig);

    // 4. Send the final HTML content. The link is now permanent, reusable, and reloadable.
    res.send(viewerHtml);

  } catch(e){
    console.error('Error serving permanent join page:', e);
    // If file read fails, we send a basic error page.
    res.status(500).send("Server error: Could not load meeting viewer.");
  }
});


app.listen(process.env.PORT || 10000, ()=>console.log("Server running... (Permanent links enabled)"));
