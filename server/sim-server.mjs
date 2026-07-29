// ======================================================================
//  sim-server.mjs — the authoritative simulation server.
//
//  Runs ONE plant instance and the step loop that used to live in the
//  browser (index.html), calling the exact same PLANT.stepPlant(PL, dt).
//  Clients are terminals: they connect over WebSocket, receive a full
//  state frame ~7x/second, and (if they hold the operator role) send
//  control commands back up.
//
//  Auth: the browser can't attach headers to a WebSocket, so it passes a
//  short-lived HMAC ticket in the query string.  The ticket is minted by
//  the /api/ticket function, which trusts Static Web Apps' logged-in
//  identity and stamps in the user's role.  We verify the signature here
//  with the shared secret — a client cannot forge or elevate its role.
//
//  Env:
//    PORT            (set by App Service)         default 8080
//    TICKET_SECRET   shared HMAC secret           REQUIRED
//    ALLOWED_ORIGIN  e.g. https://xxx.azurestaticapps.net (optional CORS/Origin check)
//    START_LOAD      initial power fraction        default 1.0 (100%)
// ======================================================================
import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import * as PLANT from '../lib/plant.js';
import * as IC from '../lib/ic.js';
import { apply as applyAction } from '../lib/actions.mjs';

const PORT = process.env.PORT || 8080;
const SECRET = process.env.TICKET_SECRET || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const START_LOAD = Number(process.env.START_LOAD || 1.0);
const DT = 0.05;              // sim timestep, matches the original browser loop
const BROADCAST_MS = 150;     // ~7 state frames per second

if (!SECRET) { console.error('FATAL: TICKET_SECRET is not set'); process.exit(1); }

// ---- the one true plant ----------------------------------------------
const PL = PLANT.makePlant({ life: 'MOL' });
PLANT.initPlant(PL, START_LOAD, 900);
PL.rodAuto = true;
let simT = 0, speed = 1, paused = false;

// Prebuild the standard initial conditions ONCE at boot, so "reset" is an
// instant server-side restore instead of an 18,000-step rebuild in each
// browser (which froze the tab and raced the socket).
const STD = {};
for (const [label, load] of [['100', 1.0], ['70', 0.7], ['40', 0.4]]) {
  const t = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(t, load, 900);
  t.rodAuto = true;
  STD[label] = IC.snapshot(t);
}
console.log('standard ICs ready:', Object.keys(STD).join(', '));

// ---- ticket verification ---------------------------------------------
function verifyTicket(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [p, sig] = parts;
  const good = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
  if (sig.length !== good.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { return null; }
  if (!payload.exp || Date.now() / 1000 > payload.exp) return null;
  return payload;   // { sub, name, role, exp }
}

// ---- step loop (wall-clock accumulator, like the browser) ------------
let last = Date.now(), acc = 0;
setInterval(() => {
  const now = Date.now();
  const real = Math.min((now - last) / 1000, 0.25); last = now;
  if (paused) return;
  acc += real * speed;
  let n = 0;
  while (acc >= DT && n < 400) { PLANT.stepPlant(PL, DT); simT += DT; acc -= DT; n++; }
  if (acc > 1) acc = 0;
}, 20);

// ---- broadcast -------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });

function frame() { return JSON.stringify({ type: 'state', ic: IC.snapshot(PL), t: simT }); }

setInterval(() => {
  if (!wss.clients.size) return;
  const msg = frame();
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}, BROADCAST_MS);

// ---- connections -----------------------------------------------------
wss.on('connection', (ws, principal) => {
  ws.role = principal.role === 'operator' ? 'operator' : 'observer';
  ws.send(JSON.stringify({ type: 'init', role: ws.role, ic: IC.snapshot(PL), t: simT }));

  ws.on('message', buf => {
    if (ws.role !== 'operator') return;               // observers are view-only
    let m; try { m = JSON.parse(buf.toString()); } catch { return; }
    try {
      if (m.a === 'reset')   { const ic = STD[m.load]; if (ic) { IC.restore(PL, ic); paused = false; speed = 1; } return; }
      if (m.a === 'restore') { IC.restore(PL, m.ic); return; }
      if (m.a === 'pause')   { paused = !paused; return; }
      if (m.a === 'speed')   { speed = Math.max(1, Math.min(60, +m.v || 1)); return; }
      applyAction(PL, m);
    } catch (e) { /* one bad command never takes the plant down */ }
  });
});

// ---- http + upgrade --------------------------------------------------
const server = http.createServer((req, res) => {
  if (req.url === '/healthz' || req.url === '/') { res.writeHead(200); res.end('ok'); return; }
  res.writeHead(404); res.end();
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  if (ALLOWED_ORIGIN && req.headers.origin && req.headers.origin !== ALLOWED_ORIGIN) {
    socket.destroy(); return;
  }
  const principal = verifyTicket(url.searchParams.get('ticket'));
  if (!principal) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, principal));
});

server.listen(PORT, () => console.log(`pwr-sim server on :${PORT} (start load ${START_LOAD})`));
