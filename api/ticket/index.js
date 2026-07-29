// /api/ticket — mint a short-lived signed ticket for the WebSocket server.
//
// Static Web Apps injects the logged-in user (and their roles) as the
// base64 header x-ms-client-principal.  We read the role here, sign a
// compact HMAC ticket, and hand it back with the sim server's wss URL.
// The client can read the ticket but cannot alter the role without
// invalidating the signature — the sim server checks it with the same
// TICKET_SECRET.
const crypto = require('crypto');

module.exports = async function (context, req) {
  const hdr = req.headers['x-ms-client-principal'];
  let principal = null;
  if (hdr) { try { principal = JSON.parse(Buffer.from(hdr, 'base64').toString('utf8')); } catch (e) {} }

  if (!principal || !principal.userId) {
    context.res = { status: 401, body: 'login required' };
    return;
  }

  const secret = process.env.TICKET_SECRET;
  const wsUrl  = process.env.SIM_WS_URL;               // e.g. wss://my-sim.azurewebsites.net/ws
  if (!secret || !wsUrl) {
    context.res = { status: 500, body: 'server not configured (TICKET_SECRET / SIM_WS_URL)' };
    return;
  }

  const roles = principal.userRoles || [];
  const role = roles.includes('operator') ? 'operator' : 'observer';

  const payload = {
    sub: principal.userId,
    name: principal.userDetails || '',
    role,
    exp: Math.floor(Date.now() / 1000) + 120            // 2-minute ticket, used once to connect
  };
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(p).digest('base64url');

  context.res = {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ ticket: p + '.' + sig, wsUrl, role, name: payload.name })
  };
};
