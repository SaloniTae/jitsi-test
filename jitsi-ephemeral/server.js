// server.js
import express from 'express';
import path    from 'path';
import dotenv  from 'dotenv';

dotenv.config();                     // pulls vars from Render OR local .env
const app  = express();
const __dirname = path.resolve();

app.use(express.static(path.join(__dirname, 'public')));

// Anyone who can reach /config will learn the secret.
// Add real auth if you need stronger protection.
app.get('/config', (_req, res) => {
  res.json({
    roomName: process.env.ROOM_NAME,
    roomPass: process.env.ROOM_PASS
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
