// /api/ticket — no accounts. Anyone gets an OBSERVER ticket. If the caller
// supplies the shared operator password (checked here, server-side), they get
// an OPERATOR ticket instead. The ticket is HMAC-signed so the sim server can
// trust the role without the client being able to forge it.
//
// Env:
//   TICKET_SECRET  shared HMAC secret (same value on the App Service)
//   SIM_WS_URL     wss://<your-app>.azurewebsites.net/ws
//   OPERATOR_PASS  the shared password operators type to take control
const crypto = require('crypto');

module.exports = async function (context, req) {
  const secret = process.env.TICKET_SECRET;
  const wsUrl  = process.env.SIM_WS_URL;
  const opPass = process.env.OPERATOR_PASS || '';
  if (!secret || !wsUrl) {
    context.res = { status: 500, body: 'server not configured (TICKET_SECRET / SIM_WS_URL)' };
    return;
  }

  const given = (req.body && typeof req.body.pass === 'string') ? req.body.pass : '';
  // constant-time compare so a wrong password can't be probed by timing
  let ok = false;
  if (opPass && given.length === opPass.length) {
    ok = crypto.timingSafeEqual(Buffer.from(given), Buffer.from(opPass));
  }
  const role = ok ? 'operator' : 'observer';

  const payload = { role, exp: Math.floor(Date.now() / 1000) + 120 };
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(p).digest('base64url');

  context.res = {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ ticket: p + '.' + sig, wsUrl, role })
  };
};
