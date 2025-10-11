import express       from 'express';
import cookieParser  from 'cookie-parser';
import { v4 as uuid } from 'uuid';
import path          from 'path';
import { fileURLToPath } from 'url';
import admin         from 'firebase-admin';

/////////////////////////////////////////////////////////////////
// 0.  Firebase admin SDK – uses application-default credentials
/////////////////////////////////////////////////////////////////
admin.initializeApp({
  credential   : admin.credential.applicationDefault(),
  databaseURL  : 'https://testing-6de54-default-rtdb.firebaseio.com'
});

/////////////////////////////////////////////////////////////////
// 1.  Express basics
/////////////////////////////////////////////////////////////////
const app       = express();
const PORT      = process.env.PORT || 3000;
const COOKIE_KEY = 'OOR';      // <-- sign cookies with this
const SESSION_DAYS = 30;                    // stay logged-in for 30 days
const SESSION_MS   = SESSION_DAYS * 24 * 60 * 60 * 1e3;
const SESSIONS = new Map();                 // sid -> {orderId, exp}

// resolve /public folder
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(express.json());
app.use(cookieParser(COOKIE_KEY));

/////////////////////////////////////////////////////////////////
// 2.  Small helper to check cookie on protected routes
/////////////////////////////////////////////////////////////////
function auth(req, res, next) {
  const sid = req.signedCookies.sid;
  if (!sid) return res.redirect('/login');

  const sess = SESSIONS.get(sid);
  if (!sess)          return res.redirect('/login');
  if (Date.now() > sess.exp) {
     SESSIONS.delete(sid);
     res.clearCookie('sid');
     return res.redirect('/login');
  }
  req.orderId = sess.orderId;               // make it available downstream
  next();
}

/////////////////////////////////////////////////////////////////
// 3.  Validate order-id against Firebase RTDB
/////////////////////////////////////////////////////////////////
async function validateOrderId(id){
  if(!id) return false;
  try{
    const snap = await admin.database().ref('transactions/'+id).get();
    if(!snap.exists()) return false;

    const tx = snap.val();
    if(tx.hidden) return false;

    const now = Date.now();
    const start = Date.parse(tx.start_time);
    const end   = Date.parse(tx.end_time);
    return (now >= start && now <= end);
  }catch(e){
    console.error('Firebase error', e);
    return false;
  }
}

/////////////////////////////////////////////////////////////////
// 4.  LOGIN  (POST /login)
/////////////////////////////////////////////////////////////////
app.post('/login', async (req,res)=>{
  const { orderId } = req.body || {};
  const ok = await validateOrderId(String(orderId).trim().toUpperCase());
  if(!ok) return res.status(401).json({error:'Invalid / inactive order-id'});

  const sid = uuid();
  SESSIONS.set(sid, {orderId, exp: Date.now() + SESSION_MS});

  res.cookie('sid', sid, {
    signed   : true,
    httpOnly : true,
    secure   : true,          // Render uses HTTPS
    sameSite : 'lax',
    maxAge   : SESSION_MS
  });
  res.json({ok:true});
});

/////////////////////////////////////////////////////////////////
// 5.  LOGOUT  (POST /logout)
/////////////////////////////////////////////////////////////////
app.post('/logout', (req,res)=>{
  const sid = req.signedCookies.sid;
  if(sid) SESSIONS.delete(sid);
  res.clearCookie('sid');
  res.json({ok:true});
});

/////////////////////////////////////////////////////////////////
// 6.  Tiny API so front-end knows its order-id
/////////////////////////////////////////////////////////////////
app.get('/session', auth, (req,res)=>{
  res.json({orderId: req.orderId});
});

/////////////////////////////////////////////////////////////////
// 7.  Static files  (login is public, others are protected)
/////////////////////////////////////////////////////////////////
app.get('/login', (_,res)=> res.sendFile(path.join(PUBLIC_DIR,'login.html')));

app.get('/', auth, (_,res)=> res.sendFile(path.join(PUBLIC_DIR,'index.html')));
app.get('/viewer.html', auth, (_,res)=> res.sendFile(path.join(PUBLIC_DIR,'viewer.html')));

// anything under /static (JS, CSS, images, etc.)
app.use('/static', express.static(PUBLIC_DIR));

// fallback 404
app.use((_,res)=> res.status(404).send('Not found'));

app.listen(PORT, ()=> console.log('Listening on', PORT));
