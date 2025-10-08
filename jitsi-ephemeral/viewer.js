<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Viewer — Permanent Join Link</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<script src="https://8x8.vc/vpaas-magic-cookie-45b14c029c1e43698634a0ad0d0838a9/external_api.js"></script>
<style>
  :root { --bg:#000; --text:#e6f0f3; }
  html,body{height:100%; margin:0; font-family:system-ui,Arial,Helvetica,sans-serif; background:var(--bg); color:var(--text); overflow:hidden;}
  #jaas {height:100vh; background:var(--bg); position:relative; overflow:hidden; width:100vw;}
  .viewer-controls { position:absolute; right:12px; top:12px; z-index:9999; display:none; gap:8px; align-items:center; }
  .viewer-controls button { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.06); padding:8px 10px; color:var(--text); border-radius:6px; cursor:pointer; font-size:13px; }

  /* Fallback rotate styling when orientation lock isn't available on small/touch devices. */
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
</style>
</head>
<body>
  <div id="config" data-room="ROOM_PLACEHOLDER" style="display:none;"></div>

  <div id="jaas" aria-label="meeting">
    <div class="viewer-controls" id="viewerControls">
      <button id="btnFullscreen">Fullscreen</button>
    </div>
  </div>

<script>
(function(){
  // --- Core Configuration Retrieval ---
  const configElement = document.getElementById('config');
  // Read the room name that the server dynamically injected.
  const ROOM = configElement ? configElement.getAttribute('data-room') : '';
  
  if (!ROOM || ROOM === 'Ayushh') {
    console.error("Critical error: Room configuration missing or failed to inject.");
    document.getElementById('jaas').innerHTML = '<h2 style="color:red;padding:20px;">Configuration Error</h2>';
    return;
  }
  // --- End Configuration ---

  const JWT = ""; 
  const DOMAIN = "8x8.vc";

  let api = null;
  let isForcingLandscapeViaCSS = false;

  // Only apply the CSS rotation fallback on touch/small screens (mobile/tablet).
  function isMobileOrTouchSmall() {
    try {
      const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
      const smallWidth = window.innerWidth <= 900;
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
      roomName: ROOM, // Uses the permanent room name
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
        TOOLBAR_BUTTONS: [], 
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
      // Direct call to initialize the Jitsi meeting (no token request/iframe needed)
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
          const pid = payload && (payload.id || payload.participantId || payload.participant);
          if (pid && api.getCurrentUserID && pid !== api.getCurrentUserID()) {
            try { api.executeCommand('setTileView', false); api.executeCommand('pinParticipant', pid); return; } catch(e){ /* ignore and fallback */ }
          }
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
      console.error('ExternalAPI create error', err);
      api = null;
    }
  }

  // --- Orientation & Fullscreen helpers (Your existing code) ---
  function tryLockOrientation(orientation) { /* ... same code ... */ }
  function tryUnlockOrientation(){ /* ... same code ... */ }
  function applyCssLandscapeFallback(){ /* ... same code ... */ }
  function removeCssLandscapeFallback(){ /* ... same code ... */ }
  async function enterFullscreenAndLandscape(){ /* ... same code ... */ }
  async function exitFullscreenAndRestore(){ /* ... same code ... */ }
  function toggleFullscreen(){ /* ... same code ... */ }
  function onFullScreenChange(){ /* ... same code ... */ }
  
  document.addEventListener('fullscreenchange', onFullScreenChange);
  document.addEventListener('webkitfullscreenchange', onFullScreenChange);
  document.addEventListener('msfullscreenchange', onFullScreenChange);

  // auto-start on load
  window.addEventListener('load', () => {
    initJitsi(); // Directly initialize the meeting
    const fsBtn = document.getElementById('btnFullscreen');
    if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
  });

})();
</script>
</body>
</html>
