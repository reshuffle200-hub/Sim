// ======================================================================
//  net.mjs — the client half of multiplayer.
//
//  The browser no longer runs the simulation.  It:
//    1. fetches a signed ticket from /api/ticket (which knows who you are
//       and whether you hold the `operator` role, via Static Web Apps auth),
//    2. opens a WebSocket straight to the sim server using that ticket,
//    3. restores the plant from every state frame the server sends,
//    4. sends operator inputs up as `{ a, ...args }` messages.
//
//  Observers get the same live state but send() is a no-op for them, so
//  the board is fully view-only without any extra plumbing.
//
//  If /api/ticket isn't reachable (e.g. opening the file locally with no
//  server), connect() quietly gives up and index.html keeps running its
//  own local simulation — so single-player still works unchanged.
// ======================================================================

export const NET = { connected: false, role: 'observer', name: '', status: 'idle' };

let ws = null, apply = null, statusCb = null, wsUrl = null, reconnectT = null;

function setStatus(s) { NET.status = s; if (statusCb) statusCb(s, NET.role); }

export async function connect(applyState, onStatus) {
  apply = applyState; statusCb = onStatus;
  setStatus('connecting');
  let data;
  try {
    const r = await fetch('/api/ticket', { credentials: 'same-origin' });
    if (r.status === 401) {
      // not logged in — bounce through the identity provider, then come back
      location.href = '/.auth/login/github?post_login_redirect_uri=' +
        encodeURIComponent(location.pathname + location.search);
      return;
    }
    if (!r.ok) throw new Error('ticket ' + r.status);
    data = await r.json();
  } catch (e) {
    setStatus('offline');           // no server → local sim keeps running
    return;
  }
  NET.role = data.role || 'observer';
  NET.name = data.name || '';
  wsUrl = data.wsUrl;
  if (!wsUrl) { setStatus('offline'); return; }
  openSocket(data.ticket);
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

/** Send an operator command. No-op (returns false) for observers or while offline. */
export function send(a, extra) {
  if (NET.role !== 'operator') return false;
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(Object.assign({ a }, extra || {})));
  return true;
}
