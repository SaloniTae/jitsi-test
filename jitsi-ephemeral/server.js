// server.js
const express = require('express');
const fetch = require('node-fetch');
const app = express();
app.use(express.json());

// Upstash Redis config (same as you gave earlier — replace with env vars if desired)
const REDIS_URL = process.env.REDIS_URL || "https://active-marmoset-8778.upstash.io";
const REDIS_TOKEN = process.env.REDIS_TOKEN || "ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA";

const TTL = 90; // seconds (ephemeral)

// ---------- viewer HTML (served at /viewer) ----------
// NOTE: occurrences of ${...} inside this string are intentionally escaped as \${...}
// so they remain literal in the served page's JS (the page itself will use them).
const viewerHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Viewer — ephemeral join (uses viewer jti)</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root { --bg:#000; --text:#e6f0f3; }
  html,body{height:100%; margin:0; font-family:system-ui,Arial,Helvetica,sans-serif; background:var(--bg); color:var(--text); overflow:hidden;}
  #frameWrap { width:100vw; height:100vh; background:var(--bg); position:relative; overflow:hidden; }
  iframe#viewerFrame { width:100%; height:100%; border:0; display:block; background:var(--bg); }
  .viewer-controls { position:absolute; right:12px; top:12px; z-index:9999; display:flex; gap:8px; align-items:center; }
  .viewer-controls button { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.06); padding:8px 10px; color:var(--text); border-radius:6px; cursor:pointer; font-size:13px; }
  .force-landscape {
    position: fixed !important;
    top: 50% !important;
    left: 50% !important;
    width: 100vh !important;
    height: 100vw !important;
    transform-origin: center center !important;
    transform: translate(-50%, -50%) rotate(90deg) !important;
    z-index: 99999 !important;
    background: var(--bg) !important;
    overflow: hidden !important;
  }
  .status { position:absolute; left:12px; top:12px; z-index:9999; font-size:13px; opacity:.9; }
</style>
</head>
<body>
  <div id="frameWrap" aria-label="viewer-frame">
    <div class="viewer-controls" id="viewerControls" style="display:none">
      <button id="btnFullscreen">Fullscreen</button>
      <button id="btnReload">Reload</button>
    </div>
    <div class="status" id="status">Creating viewer link…</div>
    <iframe id="viewerFrame" src="about:blank" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" title="Viewer"></iframe>
  </div>

<script>
(function () {
  /* ========== CONFIG ========== */
  const SERVICE_BASE = "https://oor-islive.onrender.com"; // your Node service
  const APP_ID = "vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9";
  const DOMAIN = "8x8.vc";
  const FALLBACK_ROOM = "AyushLive"; // used only if server call fails
  /* ============================ */

  const frameWrap = document.getElementById('frameWrap');
  const viewerFrame = document.getElementById('viewerFrame');
  const statusEl = document.getElementById('status');
  const controls = document.getElementById('viewerControls');

  let isForcingLandscapeViaCSS = false;

  function isMobileOrTouchSmall() {
    try {
      const hasTouch   = ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
      const smallWidth = window.innerWidth <= 900;
      return hasTouch && smallWidth;
    } catch (e) { return false; }
  }

  function tryLockOrientation(orientation) {
    if (!orientation) return Promise.reject('No orientation API');
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      return screen.orientation.lock(orientation);
    }
    const maybeLock = screen.lockOrientation || screen.mozLockOrientation || screen.msLockOrientation;
    if (typeof maybeLock === 'function') {
      try {
        const ok = maybeLock.call(screen, orientation);
        return (ok && typeof ok.then === 'function') ? ok : Promise.resolve(ok);
      } catch (e) { return Promise.reject(e); }
    }
    return Promise.reject('Orientation lock not supported');
  }

  function tryUnlockOrientation(){
    try {
      if (screen.orientation && typeof screen.orientation.unlock === 'function') {
        screen.orientation.unlock();
      } else if (screen.unlockOrientation) {
        screen.unlockOrientation();
      } else if (screen.mozUnlockOrientation) {
        screen.mozUnlockOrientation();
      } else if (screen.msUnlockOrientation) {
        screen.msUnlockOrientation();
      }
    } catch(e){ /* ignore */ }
  }

  function applyCssLandscapeFallback(){
    if (!isMobileOrTouchSmall()) return;
    if (isForcingLandscapeViaCSS) return;
    const jaas = frameWrap;
    if (!jaas) return;
    document.body.style.overflow = 'hidden';
    jaas.classList.add('force-landscape');
    isForcingLandscapeViaCSS = true;
  }

  function removeCssLandscapeFallback(){
    if (!isForcingLandscapeViaCSS) return;
    const jaas = frameWrap;
    if (!jaas) return;
    jaas.classList.remove('force-landscape');
    document.body.style.overflow = '';
    isForcingLandscapeViaCSS = false;
  }

  async function enterFullscreenAndLandscape(){
    const el = frameWrap;
    if (!el) return;

    try {
      if (el.requestFullscreen)           await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      else if (el.msRequestFullscreen)     await el.msRequestFullscreen();
    } catch(e) { /* ignore */ }

    try {
      await tryLockOrientation('landscape');
      removeCssLandscapeFallback();
    } catch (err) {
      applyCssLandscapeFallback();
    }
  }

  async function exitFullscreenAndRestore(){
    try {
      if (document.exitFullscreen)           await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      else if (document.msExitFullscreen)     await document.msExitFullscreen();
    } catch(e){ /* ignore */ }

    tryUnlockOrientation();
    removeCssLandscapeFallback();
  }

  function toggleFullscreen(){
    const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
    if (!isFull) enterFullscreenAndLandscape(); else exitFullscreenAndRestore();
  }

  document.addEventListener('fullscreenchange',        () => { if (!document.fullscreenElement) tryUnlockOrientation(); });
  document.addEventListener('webkitfullscreenchange',  () => { if (!document.webkitFullscreenElement) tryUnlockOrientation(); });
  document.addEventListener('msfullscreenchange',      () => { if (!document.msFullscreenElement) tryUnlockOrientation(); });

  /* ========== Create viewer jti and embed (same flow as /join/:jti) ========== */
  async function createViewerJtiAndEmbed() {
    statusEl.textContent = 'Requesting ephemeral viewer link…';

    try {
      const r = await fetch(\`\${SERVICE_BASE.replace(/\\/?$/,'')}/api/request-join\`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({})
      });

      if (!r.ok) throw new Error('request failed ' + r.status);

      const data = await r.json();

      // server returns { joinUrl: "/join/<jti>", ttl }
      let joinUrl = null;
      if (data && data.joinUrl) joinUrl = data.joinUrl;
      else if (data && data.jti) joinUrl = '/join/' + data.jti;
      else if (data && data.join) joinUrl = data.join;
      else if (data && data.url) joinUrl = data.url;

      if (!joinUrl) {
        if (data && data.room) {
          const room = encodeURIComponent(String(data.room));
          const src = \`https://\${DOMAIN}/\${APP_ID}/\${room}\`;
          viewerFrame.src = src;
          statusEl.textContent = 'Embedded direct room (server returned room).';
          controls.style.display = 'flex';
          return;
        }
        throw new Error('unexpected server response');
      }

      const abs = (joinUrl.startsWith('http') ? joinUrl : (SERVICE_BASE.replace(/\\/?$/,'') + joinUrl));
      viewerFrame.src = abs;
      statusEl.textContent = 'Viewer link created — embedded ephemeral join page.';
      controls.style.display = 'flex';
    } catch (err) {
      console.warn('Could not create viewer jti:', err);
      viewerFrame.src = \`https://\${DOMAIN}/\${APP_ID}/\${FALLBACK_ROOM}\`;
      statusEl.textContent = 'Using fallback direct room (no ephemeral link).';
      controls.style.display = 'flex';
    }
  }

  async function reloadViewer() {
    viewerFrame.src = 'about:blank';
    statusEl.textContent = 'Recreating viewer link…';
    await new Promise(r=>setTimeout(r,200));
    await createViewerJtiAndEmbed();
  }

  document.getElementById('btnFullscreen').addEventListener('click', toggleFullscreen);
  document.getElementById('btnReload').addEventListener('click', reloadViewer);

  window.addEventListener('load', async () => {
    await createViewerJtiAndEmbed();
  });

})();
</script>
</body>
</html>`;

// ---------- route: GET /viewer ----------
app.get('/viewer', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(viewerHtml);
});

// ---------- route: POST /api/request-join (ephemeral jti creation) ----------
app.post('/api/request-join', async (req, res) => {
  try {
    // default room if none provided on client
    const room = (req.body && req.body.room) ? String(req.body.room) : "AyushLive";
    const jti = Math.random().toString(36).substr(2, 16);

    // Upstash set: set jti -> room with TTL (seconds)
    const resp = await fetch(\`\${REDIS_URL}/set/\${jti}\`, {
      method: 'POST',
      headers: {
        Authorization: \`Bearer \${REDIS_TOKEN}\`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ value: room, ex: TTL })
    });

    // best-effort: read response (not strictly necessary)
    try { await resp.json(); } catch(e){ /* ignore parse */ }

    // return the joinUrl (same shape your viewer expects)
    return res.json({ joinUrl: `/join/\${jti}`, ttl: TTL, jti });
  } catch (e) {
    console.error('request-join error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// ---------- route: GET /join/:jti (serves the inner join page with Jitsi iframe) ----------
app.get('/join/:jti', async (req, res) => {
  try {
    const jti = req.params.jti;
    if (!jti) return res.status(400).send('Missing jti');

    // fetch the stored room
    const getResp = await fetch(\`\${REDIS_URL}/get/\${jti}\`, {
      headers: { Authorization: \`Bearer \${REDIS_TOKEN}\` }
    });
    const roomData = await getResp.json().catch(()=>null);

    if (!roomData || !roomData.result) {
      return res.status(401).send('Unauthorized or expired token');
    }

    let room = roomData.result;

    // recover common shapes: if object-like or JSON-string
    if (typeof room === 'object' && room !== null) {
      room = room.room || room.value || room.name || JSON.stringify(room);
    }
    if (typeof room === 'string' && room.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(room);
        room = parsed.room || parsed.value || parsed.name || JSON.stringify(parsed);
      } catch(e) { /* leave as-is */ }
    }
    room = String(room).trim();

    // delete the jti immediately (single-use)
    await fetch(\`\${REDIS_URL}/del/\${jti}\`, {
      method: 'POST',
      headers: { Authorization: \`Bearer \${REDIS_TOKEN}\` }
    }).catch(()=>{});

    // serve the minimal inner page containing the 8x8 iframe
    // THIS is the page that will produce the same network requests (conference-request/v1?room=...) you liked.
    const APP_ID = "vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9";
    const safeRoom = encodeURIComponent(room); // encode for URL path
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(\`<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>\${room}</title></head>
  <body style="margin:0; background:#000;">
    <iframe src="https://8x8.vc/\${APP_ID}/\${safeRoom}"
            style="width:100vw; height:100vh; border:0; background:#000;"
            allow="camera; microphone; fullscreen; autoplay; display-capture">
    </iframe>
  </body>
</html>\`);
  } catch (e) {
    console.error('join error', e);
    res.status(500).send('Server error');
  }
});

// ---------- start server ----------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Server running on port', PORT));
