// ======================================================================
//  net.mjs — client half of multiplayer (no-accounts / shared-password).
//
//  Everyone connects as an OBSERVER automatically. To take control, the
//  user enters the shared operator password; net.authenticate() asks the
//  /api/ticket function to mint an operator ticket and reconnects with it.
//  The role lives inside the HMAC-signed ticket, so it can't be forged.
//
//  If /api/ticket isn't reachable (opening the file locally), connect()
//  quietly gives up and index.html keeps running its own local sim.
// ======================================================================

export const NET = { connected: false, role: 'observer', status: 'idle' };

let ws = null, apply = null, statusCb = null, wsUrl = null, reconnectT = null, curPass = '';

function setStatus(s) { NET.status = s; if (statusCb) statusCb(s, NET.role); }

async function getTicket(pass) {
  const r = await fetch('/api/ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pass: pass || '' })
  });
  if (!r.ok) throw new Error('ticket ' + r.status);
  return r.json();
}

export async function connect(applyState, onStatus) {
  apply = applyState; statusCb = onStatus;
  setStatus('connecting');
  let data;
  try { data = await getTicket(curPass); }
  catch (e) { setStatus('offline'); return; }   // no server → local sim keeps running
  NET.role = data.role || 'observer';
  wsUrl = data.wsUrl;
  if (!wsUrl) { setStatus('offline'); return; }
  openSocket(data.ticket);
}

// Try to become operator with a password. Returns true on success.
export async function authenticate(pass) {
  let data;
  try { data = await getTicket(pass); } catch (e) { return false; }
  if (data.role !== 'operator') return false;    // wrong password
  curPass = pass;                                 // remember it so reconnects stay operator
  NET.role = 'operator';
  try { if (ws) ws.close(); } catch {}
  wsUrl = data.wsUrl;
  openSocket(data.ticket);
  return true;
}

function openSocket(ticket) {
  try {
    ws = new WebSocket(wsUrl + (wsUrl.includes('?') ? '&' : '?') +
      'ticket=' + encodeURIComponent(ticket));
  } catch (e) { setStatus('offline'); return; }

  ws.onopen = () => { NET.connected = true; setStatus('connected'); };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'init') {
      NET.role = m.role || NET.role;
      if (apply) apply(m.ic, m.t);
      setStatus('connected');
    } else if (m.type === 'state') {
      if (apply) apply(m.ic, m.t);
    }
  };
  ws.onclose = () => { NET.connected = false; setStatus('reconnecting'); schedule(); };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

function schedule() {
  clearTimeout(reconnectT);
  reconnectT = setTimeout(() => connect(apply, statusCb), 2000);
}

/** Send an operator command. No-op for observers or while offline. */
export function send(a, extra) {
  if (NET.role !== 'operator') return false;
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(Object.assign({ a }, extra || {})));
  return true;
}
