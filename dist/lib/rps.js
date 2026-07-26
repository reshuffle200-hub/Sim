// ======================================================================
//  rps.js — reactor protection and engineered safeguards actuation
//
//  Every protection parameter is measured by FOUR independent instrument
//  channels, and the reactor trips only when TWO OF THE FOUR agree.  That is
//  not decoration: it is the whole reason a plant can run with a failed
//  instrument, and the reason a single channel drifting high does not scram
//  the unit.  Single-channel trips -- which is what this model had until now
//  -- make channel failures, bypasses and surveillance testing meaningless.
//
//  Each channel can be NORMAL, TRIPPED, BYPASSED or FAILED:
//     bypassed  removed from the logic entirely, so 2/4 becomes 2/3
//     failed    stuck at a value, which may be permanently tripped or
//               permanently clear -- a failed-clear channel silently erodes
//               the margin, because now two of the remaining three must trip
//
//  FIRST-OUT latches the parameter that satisfied its coincidence first.
//  After a trip, twenty windows light within a second; only one caused it.
// ======================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Protection parameters. dir: 'hi' trips above setpoint, 'lo' below. */
export const RPS_PARAMS = [
  { id: 'pwrHi',   name: 'POWER RANGE HIGH FLUX',  ch: 4, coin: 2, dir: 'hi', sp: 1.09,  hys: 0.02,
    read: p => p.k.P },
  { id: 'otdt',    name: 'OVERTEMPERATURE dT',     ch: 4, coin: 2, dir: 'hi', sp: 0,     hys: 0.5,
    read: p => p.f.dT, spOf: p => p.f.otdt },
  { id: 'opdt',    name: 'OVERPOWER dT',           ch: 4, coin: 2, dir: 'hi', sp: 0,     hys: 0.5,
    read: p => p.f.dT, spOf: p => p.f.opdt },
  { id: 'pzrHi',   name: 'PZR PRESSURE HIGH',      ch: 4, coin: 2, dir: 'hi', sp: 2385,  hys: 15,
    read: p => p.S.P - 14.7 },
  // Low pressurizer pressure must stay ACTIVE after a trip -- that is exactly
  // when a small break needs it.  Gating it on reactor power (it was disabled
  // below 10%) killed the signal at the moment it mattered, and SI only
  // actuated because containment pressure happened to catch it.  Real plants
  // gate it on a PRESSURE permissive (P-11) that the operator arms during a
  // deliberate cooldown, not on power.
  { id: 'pzrLo',   name: 'PZR PRESSURE LOW',       ch: 4, coin: 2, dir: 'lo', sp: 1865,  hys: 15,
    read: p => p.S.P - 14.7, enable: (p, R) => !R.p11Block },
  { id: 'pzrLvl',  name: 'PZR LEVEL HIGH',         ch: 3, coin: 2, dir: 'hi', sp: 92,    hys: 2,
    read: p => p.S.pzrLevel * 100 },
  { id: 'sgLoLo',  name: 'SG LEVEL LO-LO',         ch: 4, coin: 2, dir: 'lo', sp: 17,    hys: 2,
    read: p => Math.min(...p.sgs.map(s => s.lvlNR)) },
  { id: 'flowLo',  name: 'LOW RCS FLOW',           ch: 4, coin: 2, dir: 'lo', sp: 0.87,  hys: 0.02,
    read: p => Math.min(...p.S.W) / p.rp.Wrated, enable: p => p.k.P > 0.10 },
  { id: 'cnmtHi',  name: 'CONTAINMENT PRESS HIGH', ch: 3, coin: 2, dir: 'hi', sp: 4.0,   hys: 0.5,
    read: p => p.cnmt.psig },
  { id: 'slLo',    name: 'STEAMLINE PRESS LOW',    ch: 4, coin: 2, dir: 'lo', sp: 600,   hys: 15,
    read: p => Math.min(...p.sgs.map(s => s.Psec)), enable: (p, R) => !R.p11Block },
  { id: 'turbTrip',name: 'TURBINE TRIP',           ch: 2, coin: 2, dir: 'hi', sp: 0.5,   hys: 0,
    read: p => (p.sec.tripped ? 1 : 0), enable: p => p.k.P > 0.50 },
  { id: 'uv',      name: 'BUS UNDERVOLTAGE',       ch: 4, coin: 2, dir: 'lo', sp: 0.75,  hys: 0.03,
    read: p => Math.min(...p.E.Vaux), enable: p => p.k.P > 0.10 }
];

/** Safeguards actuations and what satisfies them. */
export const ESFAS = [
  { id: 'si',      name: 'SAFETY INJECTION',
    from: ['pzrLo', 'cnmtHi', 'slLo'] },
  { id: 'isolA',   name: 'CONTAINMENT ISOLATION A',
    from: ['cnmtHi'], alsoOn: ['si'] },
  { id: 'spray',   name: 'CONTAINMENT SPRAY',
    from: ['cnmtHiHi'] },
  { id: 'afw',     name: 'AUXILIARY FEEDWATER',
    from: ['sgLoLo', 'uv'], alsoOn: ['si'] },
  { id: 'msiv',    name: 'MAIN STEAM ISOLATION',
    from: ['slLo', 'cnmtHiHi'] },
  { id: 'fwIsol',  name: 'FEEDWATER ISOLATION',
    from: ['pzrLvl'], alsoOn: ['si'] }
];

export function makeRPS() {
  const params = {};
  for (const P of RPS_PARAMS) {
    params[P.id] = {
      ch: new Array(P.ch).fill(0).map(() => ({
        state: 'normal',     // normal | bypassed | failed
        failValue: null,     // when failed, the value it is stuck at
        bias: 0,             // calibration offset, for drift
        tripped: false
      })),
      coincidence: false, nTripped: 0, value: 0, sp: 0
    };
  }
  // containment high-high is derived from the same channels at a higher setpoint
  params.cnmtHiHi = { ch: [{ state: 'normal', tripped: false }, { state: 'normal', tripped: false },
                           { state: 'normal', tripped: false }],
                      coincidence: false, nTripped: 0, value: 0, sp: 22 };
  const esf = {};
  for (const E of ESFAS) esf[E.id] = { actuated: false, manual: false, blocked: false, cause: '' };
  return {
    params, esf, trip: false, firstOut: '', firstOutT: null,
    tripBypassed: false,
    // P-11: arming this blocks the low-pressure SI signals for a planned
    // cooldown.  It does NOT block containment pressure or manual actuation.
    p11Block: false, p11Psig: 1950,
    alarms: { trip:false, anyBypassed:false, anyFailed:false, partialTrip:false,
              siActuated:false, sprayActuated:false, afwActuated:false,
              tripBypassed:false, p11Blocked:false }
  };
}

function evalParam(spec, st, value, sp) {
  st.value = value; st.sp = sp;
  let n = 0, active = 0;
  for (const c of st.ch) {
    if (c.state === 'bypassed') { c.tripped = false; continue; }
    active++;
    const v = (c.state === 'failed' && c.failValue !== null) ? c.failValue : value + c.bias;
    const hi = spec.dir === 'hi';
    // hysteresis: needs to clear by hys before resetting
    if (c.tripped) c.tripped = hi ? (v > sp - spec.hys) : (v < sp + spec.hys);
    else           c.tripped = hi ? (v > sp)            : (v < sp);
    if (c.tripped) n++;
  }
  st.nTripped = n;
  st.active = active;
  // Coincidence degrades gracefully: with channels bypassed, 2/4 becomes 2/3,
  // and with only one channel left the logic must not trip on it alone.
  //
  // Degradation applies only when channels have actually been REMOVED.  The
  // old formula applied it unconditionally, so a function DESIGNED with two
  // channels and two-of-two coincidence -- turbine trip -- had its requirement
  // cut to one, meaning a single channel scrammed the unit and the function
  // could never sit in a partial-trip state at all.  That conflated "degraded
  // to two channels" with "designed for two channels".
  const need = active < spec.ch
    ? Math.min(spec.coin, Math.max(active - 1, 1))
    : spec.coin;
  st.coincidence = active > 0 && n >= need;
  st.need = need;
  return st.coincidence;
}

/**
 * One step. Returns the RPS state; the caller applies the trip and actuations.
 */
export function stepRPS(R, PL, dt) {
  let anyTrip = false;
  for (const spec of RPS_PARAMS) {
    const st = R.params[spec.id];
    const enabled = spec.enable ? spec.enable(PL, R) : true;
    let value = 0, sp = spec.sp;
    try { value = spec.read(PL); if (spec.spOf) sp = spec.spOf(PL); } catch (e) { value = 0; }
    if (!enabled) { st.coincidence = false; st.nTripped = 0; st.value = value; st.sp = sp; continue; }
    const hit = evalParam(spec, st, value, sp);
    if (hit) {
      anyTrip = true;
      if (!R.firstOut) { R.firstOut = spec.name; R.firstOutT = PL.t; }
    }
  }

  // containment high-high, for spray and steam line isolation
  {
    const st = R.params.cnmtHiHi;
    const v = PL.cnmt ? PL.cnmt.psig : 0;
    let n = 0, active = 0;
    for (const c of st.ch) {
      if (c.state === 'bypassed') { c.tripped = false; continue; }
      active++;
      c.tripped = c.tripped ? (v > st.sp - 2) : (v > st.sp);
      if (c.tripped) n++;
    }
    st.nTripped = n; st.active = active; st.value = v;
    st.coincidence = active > 0 && n >= Math.min(2, Math.max(active - 1, 1));
  }

  if (anyTrip && !R.tripBypassed) R.trip = true;

  // ---------------- safeguards ----------------
  for (const E of ESFAS) {
    const e = R.esf[E.id];
    if (e.blocked) { e.actuated = e.manual; continue; }
    let hit = e.manual, cause = e.manual ? 'MANUAL' : '';
    for (const src of E.from) {
      const st = R.params[src];
      if (st && st.coincidence) { hit = true; cause = cause || src; }
    }
    for (const src of (E.alsoOn || [])) {
      if (R.esf[src] && R.esf[src].actuated) { hit = true; cause = cause || src.toUpperCase(); }
    }
    if (hit && !e.actuated) e.cause = cause;
    if (hit) e.actuated = true;
  }

  R.alarms = {
    trip: R.trip,
    anyBypassed: Object.values(R.params).some(p => p.ch.some(c => c.state === 'bypassed')),
    anyFailed: Object.values(R.params).some(p => p.ch.some(c => c.state === 'failed')),
    partialTrip: Object.values(R.params).some(p => p.nTripped > 0 && !p.coincidence),
    siActuated: R.esf.si.actuated,
    sprayActuated: R.esf.spray.actuated,
    afwActuated: R.esf.afw.actuated,
    tripBypassed: R.tripBypassed,
    p11Blocked: R.p11Block
  };
  return R;
}

export function resetRPS(R) {
  R.trip = false; R.firstOut = ''; R.firstOutT = null;
  for (const id in R.params) for (const c of R.params[id].ch) c.tripped = false;
  for (const id in R.esf) { R.esf[id].actuated = false; R.esf[id].manual = false; R.esf[id].cause = ''; }
}
/** Put one channel in bypass, trip, or failure. */
export function setChannel(R, paramId, idx, state, failValue = null) {
  const p = R.params[paramId]; if (!p || !p.ch[idx]) return false;
  p.ch[idx].state = state;
  p.ch[idx].failValue = failValue;
  return true;
}
/** Summary of channels not in their normal state. */
export function abnormalChannels(R) {
  const out = [];
  for (const spec of RPS_PARAMS) {
    const p = R.params[spec.id];
    p.ch.forEach((c, i) => {
      if (c.state !== 'normal') out.push(`${spec.name} ch${i + 1} ${c.state.toUpperCase()}`);
    });
  }
  return out;
}
