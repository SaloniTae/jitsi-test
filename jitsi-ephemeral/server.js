/*************************************************************************
 * server.js  –  One-time join links with two flavours of HTML
 *               /join/:jti   → plain <iframe>
 *               /viewer/:jti → External-API “fancy viewer”
 *************************************************************************/
const express = require('express');
const fetch   = require('node-fetch');
const app     = express();
app.use(express.json());

/*──────────────── Upstash Redis ‑- replace with env vars in prod ─────────────*/
const REDIS_URL   = 'https://active-marmoset-8778.upstash.io';
const REDIS_TOKEN = 'ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA';
const TTL         = 90;                       // seconds

/*──────────────── Optional: request logger ───────────────────────────────────*/
app.use((req, _res, next) => {
  console.log('[REQ]', req.method, req.path);
  next();
});

/*──────────────── 1.  create one-time token ──────────────────────────────────*/
app.post('/api/request-join', async (req, res) => {
  try {
    const room = req.body.room || 'AyushLive';                // default room
    const jti  = Math.random().toString(36).slice(2, 18);     // 16-char id

    /*  Store:   /set/<key>/<value>?ex=<ttl>                                   */
    await fetch(
      `${REDIS_URL}/set/${jti}/${encodeURIComponent(room)}?ex=${TTL}`,
      { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}` } }
    );

    res.json({
      joinUrl   : `/join/${jti}`,
      viewerUrl : `/viewer/${jti}`,
      ttl       : TTL
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

/*──────────────── helper: read-once & delete token ───────────────────────────*/
async function consumeJTI(jti) {
  const r = await fetch(`${REDIS_URL}/get/${jti}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  }).then(r => r.json());

  if (!r || !r.result) return null;          // missing / expired

  /* single-use → delete immediately */
  await fetch(`${REDIS_URL}/del/${jti}`, {
    method : 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  });

  return r.result;                           // plain room string
}

/*──────────────── 2A.  /join/:jti – plain iframe page ────────────────────────*/
app.get('/join/:jti', async (req, res) => {
  try {
    const room = await consumeJTI(req.params.jti);
    if (!room) return res.status(401).send('Unauthorized or expired token');

    res.send(`<!doctype html>
<html><head><meta charset="utf-8"><title>${room}</title></head>
<body style="margin:0;background:#000;">
  <iframe src="https://8x8.vc/vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9/${room}"
          style="width:100vw;height:100vh;border:0;"
          allow="camera; microphone; fullscreen"></iframe>
</body></html>`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/*──────────────── 2B.  /viewer/:jti – fancy External-API viewer ──────────────*/
app.get('/viewer/:jti', async (req, res) => {
  try {
    const room = await consumeJTI(req.params.jti);
    if (!room) return res.status(401).send('Unauthorized or expired token');

    const APP_ID     = 'vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9';
    const ROOM_CONST = JSON.stringify(`${APP_ID}/${room}`);

    res.type('html').send(`<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Viewer — auto-join & fullscreen</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<script src="https://8x8.vc/${APP_ID}/external_api.js"></script>
<style>
  :root{--bg:#000;--text:#e6f0f3;}
  html,body{height:100%;margin:0;background:var(--bg);color:var(--text);
            font-family:system-ui,Arial,sans-serif;overflow:hidden;}
  #jaas{height:100vh;width:100vw;background:var(--bg);position:relative;overflow:hidden;}
  .viewer-controls{position:absolute;right:12px;top:12px;z-index:9999;
                   display:none;gap:8px;}
  .viewer-controls button{background:rgba(255,255,255,.06);
        border:1px solid rgba(255,255,255,.06);padding:8px 10px;
        color:var(--text);border-radius:6px;cursor:pointer;font-size:13px;}
  .force-landscape{position:fixed!important;top:50%!important;left:50%!important;
        width:100vh!important;height:100vw!important;transform-origin:center center!important;
        transform:translate(-50%,-50%) rotate(90deg)!important;z-index:99999!important;
        background:var(--bg)!important;overflow:hidden!important;}
</style>
</head>
<body>
  <div id="jaas" aria-label="meeting">
    <div class="viewer-controls" id="viewerControls">
      <button id="btnFullscreen">Fullscreen</button>
    </div>
  </div>

<script>
(function(){
  const ROOM   = ${ROOM_CONST};           // ← clean value now
  const DOMAIN = "8x8.vc";
  let api=null,isForceCss=false;

  function isMobileSmall(){return(('ontouchstart'in window)||navigator.maxTouchPoints>0)&&window.innerWidth<=900;}
  function cssLandscape(){if(!isMobileSmall()||isForceCss)return;
    document.body.style.overflow='hidden';
    document.getElementById('jaas').classList.add('force-landscape');isForceCss=true;}
  function unCssLandscape(){if(!isForceCss)return;
    document.getElementById('jaas').classList.remove('force-landscape');
    document.body.style.overflow='';isForceCss=false;}
  async function lockLandscape(){try{
      if(screen.orientation&&screen.orientation.lock)await screen.orientation.lock('landscape');
      else throw 0;unCssLandscape();}catch(e){cssLandscape();}}
  async function enterFS(){const el=document.getElementById('jaas');
    if(el.requestFullscreen)await el.requestFullscreen();await lockLandscape();}
  async function exitFS(){if(document.exitFullscreen)await document.exitFullscreen();
    unCssLandscape();if(screen.orientation&&screen.orientation.unlock)screen.orientation.unlock();}
  function toggleFS(){!!document.fullscreenElement?exitFS():enterFS();}
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)unCssLandscape();});

  function init(){
    if(api)return;
    api=new JitsiMeetExternalAPI(DOMAIN,{
      roomName:ROOM,parentNode:document.getElementById('jaas'),
      userInfo:{displayName:'Viewer'},width:'100%',height:'100%',
      configOverwrite:{prejoinPageEnabled:false,disableInitialGUM:true,
                       startWithAudioMuted:true,startWithVideoMuted:true,
                       filmstrip:{disabled:true}},
      interfaceConfigOverwrite:{TOOLBAR_BUTTONS:[],SHOW_WATERMARK_FOR_GUESTS:false,
        SHOW_JITSI_WATERMARK:false,SHOW_BRAND_WATERMARK:false,SHOW_POWERED_BY:false}
    });
    api.addEventListener('videoConferenceJoined',()=>{
      document.getElementById('viewerControls').style.display='flex';
      setTimeout(()=>{try{api.executeCommand('toggleFilmStrip');}catch(e){}},300);
    });
    api.addEventListener('videoConferenceLeft',()=>{
      document.getElementById('viewerControls').style.display='none';
    });
  }
  window.addEventListener('load',()=>{
    init();
    document.getElementById('btnFullscreen')
            .addEventListener('click',toggleFS);
  });
})();
</script>
</body>
</html>`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/*──────────────── start server ───────────────────────────────────────────────*/
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Server running on', PORT));
