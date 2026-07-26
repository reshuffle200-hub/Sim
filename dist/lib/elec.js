// ======================================================================
//  elec.js — plant electrical distribution
//
//  Main generator  --24 kV-- GSU --345 kV-- switchyard --- grid
//                     |                          |
//                    UAT                        SAT
//                     |                          |
//              6.9 kV buses 1A / 1B  (RCPs, condensate, circ water)
//                     |
//              4.16 kV SAFETY buses 1A / 1B  <- EDG 1A / 1B
//
//  THE POINT: the reactor coolant pumps are electrical loads.  Lose the
//  buses and they coast down, and the primary drops onto natural
//  circulation -- which rcs.js has always modelled but has never had a
//  reason to use.  Nothing else in the plant couples the grid to the core.
//
//  Machine sizing.  The generator built earlier was 1300 MVA for a four-loop
//  unit.  A 3-loop makes 916 MWe gross, so at 0.90 pf it needs about 1018
//  MVA; rated here at 1080 MVA with margin.  Using the four-loop machine
//  unchanged would have put it at 70% load at full power and given the wrong
//  inertia, wrong reactances and wrong response to a load rejection.
// ======================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const WS = 2 * Math.PI * 60;

// ---- complex helpers (same conventions as the standalone generator sim) ---
const C = (re, im = 0) => ({ re, im });
const add = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
const sub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
const mul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const div = (a, b) => { const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; };
const conj = a => ({ re: a.re, im: -a.im });
const abs = a => Math.hypot(a.re, a.im);
const pol = (m, t) => ({ re: m * Math.cos(t), im: m * Math.sin(t) });

export function elecParams() {
  return {
    // --- main generator, resized for a 3-loop unit ---
    Srated: 1080, Vgen: 24, poles: 4, pfRated: 0.90,
    Xd: 1.75, Xdp: 0.28, XT: 0.13, H: 4.2, D: 12.0,
    Tdop: 6.5, Texc: 0.30, EfCeiling: 3.2,
    KpAvr: 14, KiAvr: 7,
    MWeRated: 916,

    // --- grid ---
    Vgrid: 1.00, Xsys: 0.10, kVhv: 345,

    // --- auxiliary transformers ---
    uatMVA: 60, satMVA: 60,
    Xuat: 0.09, Xsat: 0.09,
    kVaux: 6.9, kVsafety: 4.16,

    // --- house load, MW ---
    rcpMW: 6.0,                 // each, three of them
    condensateMW: 4.5, circWaterMW: 8.0, miscMW: 12.0,
    safetyBaseMW: 3.0,          // per safety train, normal

    // --- bus protection ---
    uvTripPu: 0.70,             // RCP undervoltage trip
    uvSafetyPu: 0.75,           // safety bus undervoltage -> EDG start
    transferTimeS: 0.15,        // fast bus transfer dead time

    // --- diesels (validated in the standalone EDG panel) ---
    edg: {
      kWrated: 6500, kVArated: 8125, kV: 4.16, rated: 900, poles: 8,
      Xdp: 0.22, Xd: 2.20, Tdop: 4.5, Texc: 0.12, EfCeiling: 3.5,
      H: 2.2, Kd: 22.0, Kp: 10.0, Ki: 5.0, Tact: 0.45,
      firingRpm: 120, overspeedRpm: 1035, airCutoutRpm: 300, refRamp: 0.140,
      airTorque: 0.38, airMinPsi: 150, airStartPsi: 250,
      airBurnPsiPerSec: 11, airChargePsiPerSec: 0.9, airMaxPsi: 250,
      turboT: 1.6, KpAvr: 24, KiAvr: 14, startDelayS: 1.0,
      readyRpm: 0.98, readyV: 0.95
    }
  };
}

export function makeElec(P) {
  return {
    // generator
    online: false, tripped: false, tripMsg: '',
    delta: 0, omega: 0, Eqp: 1.0, Efd: 1.6, avrInt: 1.6, vSet: 1.0,
    Pmech: 0, Pe: 0, Qe: 0, MWe: 0, MVAr: 0, Vt: C(1, 0), Ia: C(0, 0),
    pf: 1, lead: false,
    // breakers
    genBkr: false, uatBkr: false, satBkr: true, gridAvail: true,
    // buses, per unit voltage
    Vaux: [1.0, 1.0],           // 6.9 kV buses 1A, 1B
    Vsafety: [1.0, 1.0],        // 4.16 kV safety buses
    safetyFrom: ['offsite', 'offsite'],
    transferTimer: 0,
    // loads
    rcpOn: [true, true, true], rcpV: [1, 1, 1],
    houseMW: 0, netMWe: 0,
    // diesels
    edg: [makeEDG(P.edg), makeEDG(P.edg)],
    // grid
    gridFreq: 60.0
  };
}

function makeEDG(p) {
  return {
    rpm: 0, fired: false, rack: 0, gInt: 0, sRef: 0, boost: 0,
    airPsi: p.airStartPsi, airValve: false, crankT: 0,
    Eqp: 0.02, Efd: 0, avrInt: 0, delta: 0, omega: 0,
    running: false, ready: false, tripped: false, tripMsg: '',
    bkr: false, loadMW: 0, loadFrac: 0, V: 0, autoStart: false,
    startSignal: false, startT: null, readyT: null
  };
}

// ---------------------------------------------------------------- diesel
function stepEDG(p, e, dt, demandMW) {
  const w = e.rpm / p.rated;

  if (e.startSignal && !e.running && !e.tripped) e.airValve = true;
  const cranking = e.airValve && e.airPsi > p.airMinPsi && e.rpm < 250;
  if (e.airValve && e.airPsi > 20 && e.rpm < 250) e.airPsi = Math.max(0, e.airPsi - p.airBurnPsiPerSec * dt);
  else e.airPsi = Math.min(p.airMaxPsi, e.airPsi + p.airChargePsiPerSec * dt);

  if (e.airValve && !e.fired) { e.crankT += dt;
    if (e.crankT > 15) { e.airValve = false; e.tripped = true; e.tripMsg = 'FAILED TO START'; } }
  else if (e.fired) e.crankT = 0;

  if (!e.fired && e.rpm > p.firingRpm && e.rack > 0.05 && e.airValve) e.fired = true;
  if (e.rpm < 40) e.fired = false;
  if (e.fired && e.rpm > p.airCutoutRpm) e.airValve = false;

  // isochronous governor with anti-windup
  if (!e.tripped) {
    const tgt = e.fired ? 1.0 : 0.20;
    e.sRef = clamp(e.sRef + (tgt > e.sRef ? p.refRamp : -0.6) * dt, 0, 1);
    const err = e.sRef - w;
    const raw = p.Kp * err + e.gInt, cmd = clamp(raw, 0, 1.15);
    e.gInt = clamp(e.gInt + p.Ki * err * dt + (cmd - raw) * 0.8, 0, 1.15);
    e.rack += (cmd - e.rack) * Math.min(1, dt / p.Tact);
  } else { e.rack += (0 - e.rack) * Math.min(1, dt / 0.4); e.gInt = 0; e.sRef = 0; }

  e.boost += (clamp(e.rack, 0, 1) - e.boost) * Math.min(1, dt / p.turboT);

  const Pload = e.bkr ? clamp(demandMW / (p.kWrated / 1000), 0, 1.4) : 0;
  const Tair = cranking ? p.airTorque : 0;
  const Tcomb = e.fired ? e.rack * (0.55 + 0.45 * e.boost) : 0;
  const Tfric = 0.015 + 0.045 * w + (e.fired ? 0 : 0.02);
  const Telec = Pload / Math.max(w, 0.06);
  const Tdamp = e.bkr ? p.Kd * (w - 1) : 0;
  e.rpm = Math.max(0, e.rpm + ((Tair + Tcomb - Tfric - Telec - Tdamp) / (2 * p.H)) * p.rated * dt);
  e.running = e.fired && e.rpm > 0.9 * p.rated;

  // excitation
  if (e.tripped) e.Efd = Math.max(0, e.Efd - dt);
  else {
    const err = e.vSet0 ?? 1.0;
    const ev = 1.0 - e.V;
    const raw = p.KpAvr * ev + e.avrInt;
    const cmdE = clamp(raw, 0, p.EfCeiling);
    e.avrInt = clamp(e.avrInt + p.KiAvr * ev * dt + (cmdE - raw) * 0.9, 0, p.EfCeiling);
    const flash = (e.startSignal && e.rpm > 150) ? 0.55 : 0;
    const gate = clamp((w - 0.25) / 0.5, 0, 1);
    e.Efd += (Math.max(cmdE * gate, flash) - e.Efd) * Math.min(1, dt / p.Texc);
  }
  e.Eqp = clamp(e.Eqp + (e.Efd - e.Eqp) / p.Tdop * dt, 0, 4);
  e.V = e.bkr ? clamp(e.Eqp * clamp(w, 0, 1.15) - p.Xdp * Pload * 0.9, 0, 1.3)
              : clamp(e.Eqp * clamp(w, 0, 1.15), 0, 1.3);

  e.ready = e.rpm > p.readyRpm * p.rated && e.V > p.readyV && !e.tripped;
  if (e.startT !== null && e.readyT === null && e.ready) e.readyT = e.startT;
  e.loadMW = e.bkr ? demandMW : 0;
  e.loadFrac = e.loadMW / (p.kWrated / 1000);
  if (e.rpm > p.overspeedRpm && !e.tripped) { e.tripped = true; e.tripMsg = 'OVERSPEED'; e.bkr = false; }
  return e;
}

// ------------------------------------------------------------- main step
/**
 * @param Pmech  mechanical power from the turbine, MW
 * @param safetyLoadMW  per-train safety load demand, MW
 */
export function stepElec(P, E, Pmech, safetyLoadMW, dt) {
  const Sb = P.Srated;

  // ---------------- house load ----------------
  // Only ENERGISED loads draw power.  Summing nameplate regardless of bus
  // voltage made the plant appear to import 35 MW through a dead switchyard.
  let rcpLoad = 0;
  for (let i = 0; i < 3; i++) if (E.rcpOn[i] && (E.Vaux[i % 2] ?? 0) > 0.5) rcpLoad += P.rcpMW;
  const auxLive = ((E.Vaux[0] ?? 0) > 0.5 || (E.Vaux[1] ?? 0) > 0.5) ? 1 : 0;
  const auxLoad = rcpLoad + auxLive * (P.condensateMW + P.circWaterMW + P.miscMW);
  let safeLoad = 0;
  for (let i = 0; i < 2; i++) if ((E.Vsafety[i] ?? 0) > 0.5) safeLoad += safetyLoadMW;
  E.auxMW = auxLoad; E.safetyMW = safeLoad;
  E.houseMW = auxLoad + safeLoad;

  // ---------------- generator ----------------
  if (!E.tripped && E.genBkr) {
    E.Pmech = Pmech / Sb;                              // pu on generator base
    const Xt = P.Xdp + P.XT + P.Xsys;
    const Vinf = C(P.Vgrid, 0);
    const Eq = pol(E.Eqp, E.delta);
    E.Ia = div(sub(Eq, Vinf), C(0, Xt));
    E.Vt = sub(Eq, mul(C(0, P.Xdp), E.Ia));
    const S = mul(E.Vt, conj(E.Ia));
    E.Pe = S.re; E.Qe = S.im;
    const acc = (WS / (2 * P.H)) * (E.Pmech - E.Pe - P.D * E.omega / WS);
    E.omega += acc * dt;
    E.delta += E.omega * dt;
    // AVR
    const ev = E.vSet - abs(E.Vt);
    const raw = P.KpAvr * ev + E.avrInt;
    const cmd = clamp(raw, 0, P.EfCeiling);
    E.avrInt = clamp(E.avrInt + P.KiAvr * ev * dt + (cmd - raw) * 0.9, 0, P.EfCeiling);
    E.Efd += (cmd - E.Efd) * Math.min(1, dt / P.Texc);
    E.Eqp = clamp(E.Eqp + (E.Efd - (E.Eqp + (P.Xd - P.Xdp) * 0)) / P.Tdop * dt, 0, 4);
    if (Math.abs(E.delta) > Math.PI) { E.tripped = true; E.tripMsg = 'OUT OF STEP'; E.genBkr = false; }
  } else {
    E.Pe = 0; E.Qe = 0; E.Pmech = 0;
    E.Vt = C(E.genBkr ? 0 : E.Eqp, 0);
    E.omega *= Math.max(0, 1 - dt / 20);
  }
  E.MWe = E.Pe * Sb;
  E.MVAr = E.Qe * Sb;
  const Smag = Math.hypot(E.Pe, E.Qe);
  E.pf = Smag > 1e-6 ? Math.abs(E.Pe) / Smag : 1;
  E.lead = E.Qe < 0;
  E.netMWe = E.MWe - E.houseMW;

  // ---------------- auxiliary buses ----------------
  // Fed from the UAT while the generator is on line, otherwise from the SAT.
  // On a generator trip the fast transfer takes a short dead time, during
  // which bus voltage sags -- long enough to matter to the RCPs.
  const uatLive = E.genBkr && !E.tripped;
  const satLive = E.satBkr && E.gridAvail;
  E.uatBkr = uatLive;

  let src = 'none', Vsrc = 0;
  if (uatLive) { src = 'uat'; Vsrc = abs(E.Vt); }
  else if (satLive) { src = 'sat'; Vsrc = P.Vgrid; }

  if (E.lastSrc && E.lastSrc !== src && src !== 'none') E.transferTimer = P.transferTimeS;
  E.lastSrc = src;
  if (E.transferTimer > 0) { E.transferTimer -= dt; Vsrc *= 0.15; }

  // loading drop on the aux transformer
  const loadPu = auxLoad / P.uatMVA;
  for (let i = 0; i < 2; i++) {
    const target = Vsrc > 0 ? Math.max(Vsrc - P.Xuat * loadPu * 0.5, 0) : 0;
    E.Vaux[i] += (target - E.Vaux[i]) * Math.min(1, dt / 0.08);
  }
  E.auxSource = src;

  // ---------------- RCP undervoltage ----------------
  for (let i = 0; i < 3; i++) {
    E.rcpV[i] = E.Vaux[i % 2];
    if (E.rcpV[i] < P.uvTripPu) E.rcpOn[i] = false;
  }

  // ---------------- safety buses and diesels ----------------
  for (let i = 0; i < 2; i++) {
    const e = E.edg[i];
    const offsiteV = E.Vaux[i];
    const degraded = offsiteV < P.uvSafetyPu;

    if (degraded && !e.startSignal && !e.tripped) {
      e.startSignal = true; e.autoStart = true; e.startT = 0; e.readyT = null;
    }
    if (e.startSignal && e.startT !== null) e.startT += dt;

    const demand = degraded ? safetyLoadMW : 0;
    stepEDG(P.edg, e, dt, e.bkr ? demand : 0);

    // dead bus: close the diesel breaker as soon as it is ready
    if (degraded && e.ready && !e.bkr && !e.tripped) e.bkr = true;
    if (!degraded && e.bkr && offsiteV > 0.9) e.bkr = false;   // restored: shed back

    if (e.bkr) { E.Vsafety[i] = e.V; E.safetyFrom[i] = 'edg'; }
    else if (offsiteV > 0.5) { E.Vsafety[i] = offsiteV; E.safetyFrom[i] = 'offsite'; }
    else { E.Vsafety[i] = 0; E.safetyFrom[i] = 'dead'; }
  }
  return E;
}

/** Trip the main generator (and hence the unit auxiliary transformer). */
export function tripGenerator(E, msg) {
  E.tripped = true; E.genBkr = false; E.tripMsg = msg || 'GENERATOR TRIP';
}
/** Loss of offsite power: the switchyard goes dead. */
export function loseOffsite(E) { E.gridAvail = false; E.satBkr = false; }
export function restoreOffsite(E) { E.gridAvail = true; E.satBkr = true; }

/** Synchronise and close the generator breaker. */
export function closeGenBreaker(E) {
  if (E.tripped) return false;
  E.genBkr = true; E.delta = 0.05; E.omega = 0;
  return true;
}
export function anyRCPRunning(E) { return E.rcpOn.some(Boolean); }
