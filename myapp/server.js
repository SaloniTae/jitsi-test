/**
 *  OOR Viewer – Express + cookie-session gatekeeper
 *  Deploy as a Render “Web Service”.
 *
 *  Required environment variables (Render dashboard → Environment):
 *    COOKIE_KEY                       – long random hex (see bottom)
 *    FIREBASE_SERVICE_ACCOUNT_JSON    – entire service-account JSON (one line OK)
 *    SESSION_DAYS      (optional)     – default 30
 */

import express              from 'express';
import cookieParser         from 'cookie-parser';
import { v4 as uuid }       from 'uuid';
import admin                from 'firebase-admin';
import path, { dirname }    from 'path';
import { fileURLToPath }    from 'url';

/* ────────────────────────────────────────────────
   0.  Firebase Admin SDK – initialise with secret
   ────────────────────────────────────────────────*/
const serviceJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceJson) {
  console.error('FIREBASE_SERVICE_ACCOUNT_JSON env-var missing!');
  process.exit(1);
}

admin.initializeApp({
  credential  : admin.credential.cert(JSON.parse(serviceJson)),
  databaseURL : 'https://testing-6de54-default-rtdb.firebaseio.com'
});

/* ────────────────────────────────────────────────
   1.  Express basics
   ────────────────────────────────────────────────*/
const app           = express();
const PORT          = process.env.PORT || 3000;
const COOKIE_KEY    = process.env.COOKIE_KEY ||
  'd8d07e4dc57f474e86da4a93d5ca3357dfefb9c6ea2f3c8daaacfef53e4ed07b';
const SESSION_DAYS  = Number(process.env.SESSION_DAYS || 30);
const SESSION_MS    = SESSION_DAYS * 24 * 60 * 60 * 1000;
const SESSIONS      = new Map();                 // sid -> {orderId, exp}

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(express.json());
app.use(cookieParser(COOKIE_KEY));

/* ────────────────────────────────────────────────
   2.  Auth middleware (cookie session)
   ────────────────────────────────────────────────*/
function auth(req, res, next) {
  const sid = req.signedCookies.sid;
  if (!sid) return res.redirect('/login');

  const sess = SESSIONS.get(sid);
  if (!sess) return res.redirect('/login');

  if (Date.now() > sess.exp) {
    SESSIONS.delete(sid);
    res.clearCookie('sid');
    return res.redirect('/login');
  }
  req.orderId = sess.orderId;
  next();
}

/* ────────────────────────────────────────────────
   3.  Check order-id in Firebase RTDB
   ────────────────────────────────────────────────*/
async function validateOrderId(id) {
  if (!id) return false;
  try {
    const snap = await admin.database().ref('transactions/' + id).get();
    if (!snap.exists()) return false;

    const tx = snap.val();
    if (tx.hidden) return false;

    const now   = Date.now();
    const start = Date.parse(tx.start_time);
    const end   = Date.parse(tx.end_time);
    return now >= start && now <= end;
  } catch (e) {
    console.error('Firebase error:', e);
    return false;
  }
}

/* ────────────────────────────────────────────────
   4.  LOGIN  : POST /login
   ────────────────────────────────────────────────*/
app.post('/login', async (req, res) => {
  const { orderId = '' } = req.body || {};
  const cleanId = orderId.trim().toUpperCase();
  const ok = await validateOrderId(cleanId);

  if (!ok) return res.status(401).json({ error: 'Invalid / inactive Order-ID' });

  const sid = uuid();
  SESSIONS.set(sid, { orderId: cleanId, exp: Date.now() + SESSION_MS });

  res.cookie('sid', sid, {
    signed   : true,
    httpOnly : true,
    secure   : true,          // Render = HTTPS
    sameSite : 'lax',
    maxAge   : SESSION_MS
  });
  res.json({ ok: true });
});

/* ────────────────────────────────────────────────
   5.  LOGOUT : POST /logout
   ────────────────────────────────────────────────*/
app.post('/logout', (req, res) => {
  const sid = req.signedCookies.sid;
  if (sid) SESSIONS.delete(sid);
  res.clearCookie('sid');
  res.json({ ok: true });
});

/* ────────────────────────────────────────────────
   6.  Tiny API so front-end knows its Order-ID
   ────────────────────────────────────────────────*/
app.get('/session', auth, (req, res) => {
  res.json({ orderId: req.orderId });
});

/* ────────────────────────────────────────────────
   7.  Routes & static files
   ────────────────────────────────────────────────*/
app.get('/login', (_, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));
app.get('/', auth, (_, res)     => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/viewer.html', auth, (_, res) =>
  res.sendFile(path.join(PUBLIC_DIR, 'viewer.html'))
);

// Option A: serve assets under /static
app.use('/static', express.static(PUBLIC_DIR));

// fallback 404
app.use((_, res) => res.status(404).send('Not found'));

/* ────────────────────────────────────────────────
   8.  Start server
   ────────────────────────────────────────────────*/
app.listen(PORT, () => console.log('🚀  OOR viewer running on', PORT));
