const express = require('express');
const fetch = require('node-fetch'); // Still imported, though no longer used in the GET route
const app = express();
app.use(express.json());

// Upstash Redis config (These variables are kept but are only used by the POST route)
const REDIS_URL = "https://active-marmoset-8778.upstash.io";
const REDIS_TOKEN = "ASJKAAImcDI0Mjc0NjZhMzJlODY0OWRiODc0OWUwODEwMTU2N2Q4ZnAyODc3OA";

const TTL = 90; // seconds

// Generate ephemeral token (This still works, and the generated link will now be permanent)
app.post('/api/request-join', async (req,res)=>{
  try {
    const room = req.body.room || "AyushLive";
    const jti = Math.random().toString(36).substr(2,16);

    // Store ephemeral token in Upstash (This step is kept, but the GET route ignores it)
    await fetch(`${REDIS_URL}/set/${jti}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type":"application/json"
      },
      body: JSON.stringify({ value: room, ex: TTL })
    });

    // NOTE: The generated joinUrl will now be PERMANENT because the /join/:jti route ignores deletion.
    res.json({ joinUrl: `/join/${jti}`, ttl: TTL }); 
  } catch(e){
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// --------------------------------------------------------------------------------
// PERMANENT JOIN LINK LOGIC: Replaces the original Redis-dependent GET route.
// --------------------------------------------------------------------------------
app.get('/join/:jti', (req, res) => {
  try {
    // The room name is hardcoded based on your viewer HTML script, 
    // and Redis check/deletion is removed.
    const room = "vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9/AyushLive";
    
    // NOTE: The full custom HTML is embedded here as a string.
    const viewerHtml = `
      <!doctype html>
      <html>
      <head>
      <meta charset="utf-8"/>
      <title>Viewer — Black background (auto-join, fullscreen landscape mobile, auto-pin screenshare)</title>
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <script src="https://8x8.vc/vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9/external_api.js"></script>
      <style>
        :root { --bg:#000; --text:#e6f0f3; }
        html,body{height:100%; margin:0; font-family:system-ui,Arial,Helvetica,sans-serif; background:var(--bg); color:var(--text); overflow:hidden;}
        #jaas {height:100vh; background:var(--bg); position:relative; overflow:hidden; width:100vw;}
        .viewer-controls { position:absolute; right:12px; top:12px; z-index:9999; display:none; gap:8px; align-items:center; }
        .viewer-controls button { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.06); padding:8px 10px; color:var(--text); border-radius:6px; cursor:pointer; font-size:13px; }

        /* Fallback rotate styling when orientation lock isn't available on small/touch devices.
          The .force-landscape class swaps the container to landscape visually. */
        .force-landscape {
          position: fixed !important;
          top: 50% !important;
          left: 50% !important;
          width: 100vh !important;    /* swapped */
          height: 100vw !important;   /* swapped */
          transform-origin: center center !important;
          transform: translate(-50%, -50%) rotate(90deg) !important;
          z-index: 99999 !important;
          background: var(--bg) !important;
          overflow: hidden !important;
        }
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
        // ROOM / JWT are embedded here and not exposed in UI
        const ROOM = "${room}"; // Injected room name
        const JWT = ""; // set token here if needed
        const DOMAIN = "8x8.vc";

        let api = null;
        let isForcingLandscapeViaCSS = false;

        // Only apply the CSS rotation fallback on touch/small screens (mobile/tablet).
        function isMobileOrTouchSmall() {
          try {
            const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
            const smallWidth = window.innerWidth <= 900; // tweak threshold if you want
            return hasTouch && smallWidth;
          } catch (e) {
            return false;
          }
        }

        function ensureHideFilmstrip(apiInstance){
          try {
            setTimeout(()=> {
              try { apiInstance.executeCommand('toggleFilmStrip'); } catch(e) { /* ignore */ }
            }, 300);
          } catch(e){ /* ignore */ }
        }

        function initJitsi(){
          if (api) return;

          const options = {
            roomName: ROOM,
            parentNode: document.getElementById('jaas'),
            userInfo: { displayName: 'Viewer' },
            configOverwrite: {
              prejoinPageEnabled: false,
              prejoinConfig: { enabled: false },
              disableInitialGUM: true,
              startWithAudioMuted: true,
              startWithVideoMuted: true,
              filmstrip: { disabled: true },
              desktopSharingFrameRate: { min: 15, max: 30 }
            },
            interfaceConfigOverwrite: {
              TOOLBAR_BUTTONS: [], /* keep toolbar empty */
              SHOW_JITSI_WATERMARK: false,
              SHOW_BRAND_WATERMARK: false,
              SHOW_POWERED_BY: false,
              SHOW_CHROME_EXTENSION_BANNER: false,
              SHOW_DEEP_LINKING_IMAGE: false,
              SHOW_WATERMARK_FOR_GUESTS: false,
              VIDEO_LAYOUT_FIT: 'both',
              filmStripOnly: false,
              SHOW_PARTICIPANT_NAME: false,
              DISABLE_VIDEO_BACKGROUND: true
            },
            width: '100%',
            height: '100%'
          };

          if (JWT) options.jwt = JWT;

          try {
            api = new JitsiMeetExternalAPI(DOMAIN, options);

            // when joined, try to hide filmstrip and reveal the small fullscreen btn
            api.addEventListener('videoConferenceJoined', async () => {
              const jaas = document.getElementById('jaas');
              if (jaas) jaas.style.background = '#000';
              ensureHideFilmstrip(api);
              const vc = document.getElementById('viewerControls');
              if (vc) vc.style.display = 'flex';

              // After join, check if anyone is already sharing and pin them
              try {
                const info = api.getParticipantsInfo && api.getParticipantsInfo();
                const list = (info && typeof info.then === 'function') ? await info : info;
                if (Array.isArray(list)) {
                  const sharer = list.find(p => p.isSharingScreen || p.videoType === 'desktop' || p.videoType === 'screen' || p.screen || p.screenShare);
                  if (sharer) {
                    const pid = sharer.participantId || sharer.id || sharer.participant;
                    if (pid && api.getCurrentUserID && pid !== api.getCurrentUserID()) {
                      try { api.executeCommand('setTileView', false); api.executeCommand('pinParticipant', pid); } catch(e){/* ignore */ }
                    }
                  }
                }
              } catch(e){ /* ignore */ }
            });

            api.addEventListener('videoConferenceLeft', () => {
              const vc = document.getElementById('viewerControls');
              if (vc) vc.style.display = 'none';
            });

            // Auto-pin when screen sharing status changes (primary mechanism)
            api.addEventListener('screenSharingStatusChanged', async (payload) => {
              try {
                // payload shapes vary between deployments; check common fields
                const pid = payload && (payload.id || payload.participantId || payload.participant);
                if (pid && api.getCurrentUserID && pid !== api.getCurrentUserID()) {
                  try { api.executeCommand('setTileView', false); api.executeCommand('pinParticipant', pid); return; } catch(e){ /* ignore and fallback */ }
                }
                // fallback: query participants and pick any that is sharing
                const info = api.getParticipantsInfo && api.getParticipantsInfo();
                const list = (info && typeof info.then === 'function') ? await info : info;
                if (Array.isArray(list)) {
                  const sharer = list.find(p => p.isSharingScreen || p.videoType === 'desktop' || p.videoType === 'screen' || p.screen || p.screenShare);
                  if (sharer) {
                    const foundId = sharer.participantId || sharer.id || sharer.participant;
                    if (foundId && api.getCurrentUserID && foundId !== api.getCurrentUserID()) {
                      try { api.executeCommand('setTileView', false); api.executeCommand('pinParticipant', foundId); } catch(e){ /* ignore */ }
                    }
                  }
                }
              } catch(e){
                // silent
              }
            });

            // Also handle participantJoined events — if they join while sharing, pin them
            api.addEventListener('participantJoined', async (payload) => {
              try {
                // payload may contain flag info, but safe to query participants
                const info = api.getParticipantsInfo && api.getParticipantsInfo();
                const list = (info && typeof info.then === 'function') ? await info : info;
                if (Array.isArray(list)) {
                  const sharer = list.find(p => p.isSharingScreen || p.videoType === 'desktop' || p.videoType === 'screen' || p.screen || p.screenShare);
                  if (sharer) {
                    const pid = sharer.participantId || sharer.id || sharer.participant;
                    if (pid && api.getCurrentUserID && pid !== api.getCurrentUserID()) {
                      try { api.executeCommand('setTileView', false); api.executeCommand('pinParticipant', pid); } catch(e){/* ignore */ }
                    }
                  }
                }
              } catch(e){/* ignore */ }
            });

          } catch (err) {
            // silent fail — do not add UI noise
            console.error('ExternalAPI create error', err);
            api = null;
          }
        }

        // Try multiple vendor-prefixed locks where supported
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
            } catch (e) {
              return Promise.reject(e);
            }
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
          // apply only for mobile/touch small devices (additional safety)
          if (!isMobileOrTouchSmall()) return;
          if (isForcingLandscapeViaCSS) return;
          const jaas = document.getElementById('jaas');
          if (!jaas) return;
          document.body.style.overflow = 'hidden';
          jaas.classList.add('force-landscape');
          isForcingLandscapeViaCSS = true;
        }

        function removeCssLandscapeFallback(){
          if (!isForcingLandscapeViaCSS) return;
          const jaas = document.getElementById('jaas');
          if (!jaas) return;
          jaas.classList.remove('force-landscape');
          document.body.style.overflow = '';
          isForcingLandscapeViaCSS = false;
        }

        // Enter DOM fullscreen then attempt orientation lock; fallback to CSS rotate (only on mobile)
        async function enterFullscreenAndLandscape(){
          const el = document.getElementById('jaas');
          if (!el) return;

          try {
            if (el.requestFullscreen) await el.requestFullscreen();
            else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
            else if (el.msRequestFullscreen) await el.msRequestFullscreen();
          } catch(e) {
            /* ignore */
          }

          try {
            await tryLockOrientation('landscape');
            // success -> ensure CSS fallback removed (not needed)
            removeCssLandscapeFallback();
          } catch (err) {
            // lock failed or unsupported -> apply CSS fallback only on mobile/touch small screens
            applyCssLandscapeFallback();
          }
        }

        // Exit fullscreen and restore orientation
        async function exitFullscreenAndRestore(){
          try {
            if (document.exitFullscreen) await document.exitFullscreen();
            else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
            else if (document.msExitFullscreen) await document.msExitFullscreen();
          } catch(e){ /* ignore */ }

          tryUnlockOrientation();
          removeCssLandscapeFallback();
        }

        // Toggle based on current fullscreen state
        function toggleFullscreen(){
          const el = document.getElementById('jaas');
          if (!document.fullscreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
            enterFullscreenAndLandscape();
          } else {
            exitFullscreenAndRestore();
          }
        }

        // Detect user-triggered fullscreen change (handle ESC)
        function onFullScreenChange(){
          const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
          if (!isFull) {
            tryUnlockOrientation();
            removeCssLandscapeFallback();
          }
        }

        document.addEventListener('fullscreenchange', onFullScreenChange);
        document.addEventListener('webkitfullscreenchange', onFullScreenChange);
        document.addEventListener('msfullscreenchange', onFullScreenChange);

        // auto-start on load
        window.addEventListener('load', () => {
          initJitsi();
          const fsBtn = document.getElementById('btnFullscreen');
          if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
        });

      })();
      </script>
      </body>
      </html>
    `;

    res.send(viewerHtml);

  } catch(e){
    console.error(e);
    res.status(500).send("Server error");
  }
});
// --------------------------------------------------------------------------------

app.listen(process.env.PORT || 10000, ()=>console.log("Server running..."));
