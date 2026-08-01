// ======================================================================
//  net.mjs — client half of multiplayer (no-accounts / shared-password).
//
//  Everyone connects as OBSERVER. Entering the shared operator password
//  swaps in an operator ticket. The role lives in the HMAC-signed ticket,
//  so it can't be forged.
//
//  Two invariants that keep the plant from twitching:
//    * usingServer: once we've reached the server, we NEVER run local
//      physics again (even during a reconnect) — index.html only steps
//      locally when there is genuinely no server (opening the file directly).
//    * one socket: a generation counter + clean teardown guarantee exactly
//      one live socket and no reconnect pile-up when swapping tickets.
// ======================================================================

export const NET = { connected: false, role: 'observer', status: 'idle', usingServer: false };

let ws = null, apply = null, statusCb = null, wsUrl = null;
let reconnectT = null, curPass = '', generation = 0, localHandler = null;

/** Register a handler used to apply commands locally when there is no server. */
export function onLocal(fn) { localHandler = fn; }

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

function killSocket() {
  clearTimeout(reconnectT); reconnectT = null;
  if (ws) {
    try { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; ws.close(); } catch {}
    ws = null;
  }
}

export async function connect(applyState, onStatus) {
  apply = applyState; statusCb = onStatus;
  setStatus('connecting');
  let data;
  try { data = await getTicket(curPass); }
  catch (e) { setStatus('offline'); return; }   // no server → local sim keeps running
  NET.usingServer = true;                         // from here on, never simulate locally
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
  curPass = pass;                                 // remember so reconnects stay operator
  NET.role = 'operator';
  NET.usingServer = true;
  wsUrl = data.wsUrl;
  openSocket(data.ticket);                        // killSocket() inside retires the old one cleanly
  return true;
}

function openSocket(ticket) {
  killSocket();                                   // exactly one socket, no stray reconnect
  const myGen = ++generation;
  let sock;
  try {
    sock = new WebSocket(wsUrl + (wsUrl.includes('?') ? '&' : '?') +
      'ticket=' + encodeURIComponent(ticket));
  } catch (e) { setStatus('offline'); return; }
  ws = sock;

  sock.onopen = () => { if (myGen !== generation) return; NET.connected = true; setStatus('connected'); };
  sock.onmessage = ev => {
    if (myGen !== generation) return;             // ignore late frames from a retired socket
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'init') { NET.role = m.role || NET.role; if (apply) apply(m.ic, m.t); setStatus('connected'); }
    else if (m.type === 'state') { if (apply) apply(m.ic, m.t); }
  };
  sock.onclose = () => {
    if (myGen !== generation) return;             // an intentional swap, not a real drop
    NET.connected = false; setStatus('reconnecting');
    reconnectT = setTimeout(() => connect(apply, statusCb), 2000);
  };
  sock.onerror = () => {};
}

/** Send an operator command. Offline → apply locally; online → send (operators only). */
export function send(a, extra) {
  if (!NET.usingServer) { if (localHandler) localHandler(a, extra || {}); return true; }
  if (NET.role !== 'operator') return false;
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(Object.assign({ a }, extra || {})));
  return true;
}
