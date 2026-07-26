// ======================================================================
//  rcs.js — reactor coolant system, Westinghouse 3-loop
//
//  NODALISATION (17 control volumes)
//    vessel : lower plenum, core, upper plenum, upper head, downcomer
//    loop A/B/C (x3) : hot leg (+SG inlet plenum), SG tubes,
//                      loop seal (+SG outlet plenum), cold leg
//
//  PRESSURE.  One pressure for the whole RCS.  Acoustic transients settle in
//  milliseconds, far faster than anything on a control panel, so pressure is
//  found from a GLOBAL VOLUME CONSTRAINT instead of being propagated:
//
//        find P such that   sum_i  M_i * v(P, u_i)  =  V_total
//
//  Each node carries mass M_i and internal energy U_i from its own balance;
//  given a trial P, every node's specific volume follows, and the pressure
//  that makes the fluid exactly fill the fixed geometry is the answer.
//  This one formulation covers all three regimes with no mode switching:
//    - water solid      : v barely moves with P, so P is very stiff  (correct)
//    - pressurizer bubble: the steam space absorbs volume easily     (correct)
//    - RCS voiding      : nodes go two-phase and take up the slack   (correct)
//
//  FLOW.  Lumped momentum per loop:
//      (L/A) dW/dt = dP_pump + dP_buoyancy - K W|W|
//  so coastdown, natural circulation and reverse flow all emerge rather than
//  being scripted.  The loop seal is a distinct low-elevation volume; when it
//  voids, its gravity head is lost and the loop can clear -- the mechanism
//  that governs a small-break LOCA.
//
//  LIMITS.  Lumped-parameter, uniform pressure, donor-cell enthalpy, no
//  counter-current flow limiting, no phase separation inside a node beyond a
//  drift-flux void fraction.  Good for trends and timing on a training panel;
//  not a substitute for RELAP.
// ======================================================================

import * as ST from './steam.js?v=0.27.1';
import * as PR from './props.js?v=0.27.1';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------- geometry
export function rcsParams() {
  const P = {
    nLoops: 3,
    // vessel volumes, ft3, and thermal-centre elevations, ft
    vessel: [
      { id: 'LP',  name: 'Lower plenum',  V: 1000, z:  5 },
      { id: 'CR',  name: 'Core',          V:  700, z: 15 },
      { id: 'UP',  name: 'Upper plenum',  V:  900, z: 27 },
      { id: 'UH',  name: 'Upper head',    V:  700, z: 35 },
      { id: 'DC',  name: 'Downcomer',     V:  700, z: 15 }
    ],
    // per-loop volumes and elevations
    loop: [
      { id: 'HL',  name: 'Hot leg',   V: 250, z: 30 },
      { id: 'SG',  name: 'SG tubes',  V: 700, z: 45 },
      { id: 'LS',  name: 'Loop seal', V: 130, z:  8 },
      { id: 'CL',  name: 'Cold leg',  V: 120, z: 25 }
    ],
    pzrV: 1800,            // pressurizer total volume, ft3
    pzrZ: 60,              // pressurizer elevation
    surgeK: 900,           // surge line resistance

    // --- pump / hydraulics ---
    Wrated: 1.209e8 / 3,   // lbm/hr per loop at rated
    pumpHeadRated: 275,    // ft at rated flow
    pumpInertiaS: 6.5,     // pump flywheel speed coastdown time constant, s
    tauLoop: 1.6,          // hydraulic time constant of the loop, s
    Kloop: 1.0,            // normalised friction: w|w| at rated = 1
    headBypassFrac: 0.015, // downcomer -> upper head bypass

    // --- heat ---
    Qrated: 2775e6,        // W
    pumpHeatMW: 4.5,       // per pump
    ambientLossMW: 1.0,

    // --- SG primary-to-secondary: effectiveness-NTU with an isothermal
    //     (boiling) secondary.  Driving a lumped node off (T_node - Tsec)
    //     makes the steady state depend on the nodalisation; effectiveness
    //     does not.   Q = W cp (Tin - Tsec)(1 - exp(-NTU)),  NTU = UA/(W cp)
    UAsg: 0,               // Btu/hr-F per SG, calibrated from design dT
    cpRCS: 1.28,

    // --- reference conditions ---
    Pref: 2250, TavgRef: 577, dTcore: 61.2,
    TcoldRef: 546.4, ThotRef: 607.6,
    Tsec: 520.0            // SG secondary saturation temp at rated (~810 psia)
  };
  calibrate(P);
  return P;
}

function calibrate(P) {
  // Momentum is solved in NORMALISED form: w = W/Wrated and every head is
  // divided by the rated pump head, so friction is exactly w|w| at rated.
  // UA from the design terminal temperatures:
  //   (Tcold - Tsec)/(Thot - Tsec) = exp(-NTU)
  const NTU = -Math.log((P.TcoldRef - P.Tsec) / (P.ThotRef - P.Tsec));
  P.UAsg = NTU * P.Wrated * P.cpRCS;
  P.NTUsg = NTU;
  P.Vtotal = P.vessel.reduce((s, n) => s + n.V, 0)
           + P.nLoops * P.loop.reduce((s, n) => s + n.V, 0)
           + P.pzrV;
  return P;
}

// ---------------------------------------------------------------- state
export function makeRCS(P) {
  const mk = (spec, loop) => ({
    id: loop === undefined ? spec.id : spec.id + 'ABC'[loop],
    name: spec.name, V: spec.V, z: spec.z, loop,
    M: 0, U: 0, h: 0, T: 0, x: 0, rho: 0, void: 0
  });
  const nodes = P.vessel.map(s => mk(s));
  for (let L = 0; L < P.nLoops; L++) for (const s of P.loop) nodes.push(mk(s, L));
  // pressurizer is a node in the pressure solve; its controls live in pzr.js
  nodes.push({ id: 'PZR', name: 'Pressurizer', V: P.pzrV, z: P.pzrZ, loop: undefined,
               M: 0, U: 0, h: 0, T: 0, x: 0, rho: 0, void: 0, isPzr: true });

  const idx = {};
  nodes.forEach((n, i) => idx[n.id] = i);

  return {
    P: P.Pref, nodes, idx,
    W: new Array(P.nLoops).fill(P.Wrated),      // loop flows, lbm/hr
    pumpSpeed: new Array(P.nLoops).fill(1),
    pumpOn: new Array(P.nLoops).fill(true),
    Tsec: new Array(P.nLoops).fill(P.Tsec),
    breakArea: 0, breakNode: 'CL_A', breakFlow: 0,
    siFlow: 0, chargeFlow: 0, letdownFlow: 0,
    Qcore: 0, Thot: [0, 0, 0], Tcold: [0, 0, 0], Tavg: 0,
    Qsg: [0, 0, 0], sgHtFactor: [1, 1, 1],
    subcooling: 0, solid: false, ok: true
  };
}

// -------------------------------------------------- thermodynamic helpers
/** Specific volume [ft3/lbm] at pressure [psia] and specific internal energy [Btu/lbm]. */
const vFromPU = (psia, u) => PR.vPU(psia, u);
function stateOf(psia, u) {
  const v = PR.vPU(psia, u);
  const h = u + psia * 144 * v / 778.169;
  return { v, h, T: PR.TPH(psia, h), x: PR.xPH(psia, h),
           alpha: PR.alphaPH(psia, h), Tsat: PR.TsatP(psia) };
}

/**
 * Solve the global volume constraint for system pressure.
 * Secant iteration seeded from the previous pressure -- typically 4-6
 * evaluations instead of 60 bisection steps -- with a bisection fallback
 * if the secant wanders outside the bracket.
 */
export function solvePressure(P, S) {
  const N = S.nodes;
  const f = p => {
    let V = 0;
    for (let i = 0; i < N.length; i++) V += N[i].M * PR.vPU(p, N[i].U / Math.max(N[i].M, 1e-9));
    return V - P.Vtotal;
  };
  let p0 = clamp(S.P, 16, 3100);
  let f0 = f(p0);
  if (Math.abs(f0) < 1e-4) return p0;
  let p1 = clamp(p0 * (f0 > 0 ? 1.02 : 0.98), 16, 3100);
  let f1 = f(p1);
  for (let it = 0; it < 30; it++) {
    if (Math.abs(f1) < 1e-5) break;
    let d = (f1 - f0);
    let p2 = Math.abs(d) < 1e-12 ? p1 : p1 - f1 * (p1 - p0) / d;
    if (!isFinite(p2) || p2 < 16 || p2 > 3100) {
      // fall back to bisection over the full range
      let lo = 16, hi = 3100, flo = f(lo);
      if (flo < 0) return lo;
      if (f(hi) > 0) return hi;
      for (let k = 0; k < 45; k++) {
        const m = 0.5 * (lo + hi);
        if (f(m) > 0) lo = m; else hi = m;
      }
      return 0.5 * (lo + hi);
    }
    p0 = p1; f0 = f1; p1 = p2; f1 = f(p1);
    if (Math.abs(p1 - p0) < 1e-5) break;
  }
  return p1;
}

/** Fill every node consistently at a uniform temperature and pressure. */
export function initSteady(P, S, TavgF, psia, pzrLevelFrac) {
  const Pm = ST.MPa_from_psi(psia);
  for (const n of S.nodes) {
    if (n.isPzr) {
      const Ts = ST.Tsat(Pm);
      const vf = ST.ft3lb_from_m3kg(1 / ST.rhof(Ts));
      const vg = ST.ft3lb_from_m3kg(1 / ST.rhog(Ts));
      const Vw = n.V * pzrLevelFrac, Vs = n.V - Vw;
      const Mw = Vw / vf, Ms = Vs / vg;
      const hfB = ST.BTUlb_from_Jkg(ST.hf(Ts)), hgB = ST.BTUlb_from_Jkg(ST.hg(Ts));
      n.M = Mw + Ms;
      const hmix = (Mw * hfB + Ms * hgB) / n.M;
      n.U = n.M * (hmix - psia * 144 * (n.V / n.M) / 778.169);
    } else {
      const T = ST.K_from_F(TavgF);
      const v = ST.ft3lb_from_m3kg(ST.vLiq(Pm, T));
      const h = ST.BTUlb_from_Jkg(ST.hLiq(Pm, T));
      n.M = n.V / v;
      n.U = n.M * (h - psia * 144 * v / 778.169);
    }
  }
  S.P = solvePressure(P, S);
  refresh(P, S);
  return S;
}

function refresh(P, S) {
  // This used to build a state OBJECT per node per call, and then build one
  // more -- a full vPU, TPH, xPH and alphaPH -- purely to read Tsat off it.
  // Tsat is a function of pressure alone and does not depend on the node at
  // all, so that entire evaluation was thrown away.  The per-node objects were
  // the largest single source of garbage in the step; the fields are written
  // straight onto the node now, which is where they were being copied anyway.
  let alphaMax = 0;
  for (const n of S.nodes) {
    const u = n.U / Math.max(n.M, 1e-9);
    const v = PR.vPU(S.P, u);
    const h = u + S.P * 144 * v / 778.169;
    n.h = h;
    n.T = PR.TPH(S.P, h);
    n.x = PR.xPH(S.P, h);
    n.void = PR.alphaPH(S.P, h);
    n.rho = 1 / v;
    if (!n.isPzr && n.void > alphaMax) alphaMax = n.void;
  }
  const Tsat = PR.TsatP(S.P);
  S.Tsat = Tsat;
  for (let L = 0; L < P.nLoops; L++) {
    S.Thot[L]  = S.nodes[S.idx['HL' + 'ABC'[L]]].T;
    S.Tcold[L] = S.nodes[S.idx['CL' + 'ABC'[L]]].T;
  }
  S.Tavg = (S.Thot.reduce((a, b) => a + b, 0) + S.Tcold.reduce((a, b) => a + b, 0)) / (2 * P.nLoops);
  S.subcooling = Tsat - Math.max(...S.Thot);
  S.voidMax = alphaMax;
  S.pzrLevel = pzrLevel(P, S);
  return S;
}

/** Pressurizer water level, fraction of span. */
export function pzrLevel(P, S) {
  // These used to call the IAPWS correlations directly -- Tsat, rhof and rhog,
  // three transcendental evaluations -- on a function called several times
  // every step.  props.js has had both saturated volumes tabulated against
  // pressure the whole time, to identical values.  initSteady can afford the
  // exact call because it runs once; this cannot.
  const n = S.nodes[S.idx.PZR];
  const vf = PR.vfP(S.P);
  const vg = PR.vgP(S.P);
  const v = n.V / Math.max(n.M, 1e-9);
  if (v <= vf) return 1;
  if (v >= vg) return 0;
  const x = (v - vf) / (vg - vf);
  const Mw = n.M * (1 - x);
  return clamp(Mw * vf / n.V, 0, 1);
}

// ------------------------------------------------------------ hydraulics
/** Normalised pump head from speed fraction and normalised flow. */
function pumpHead(P, speed, w) {
  const s = Math.max(speed, 0);
  return s * s + 0.35 * s * w - 0.35 * w * Math.abs(w);
}

/**
 * Normalised buoyancy head around one loop, divided by rated pump head.
 * Sum of (rho - rhoRef)/rhoRef * dz around the circuit, in feet, then
 * normalised.  This is what drives natural circulation once the pumps stop.
 */
function buoyancyHead(P, S, L) {
  const g = 'ABC'[L];
  const rhoRef = 45.0;
  const seg = [
    [S.idx.CR, S.idx.UP], [S.idx.UP, S.idx['HL' + g]],
    [S.idx['HL' + g], S.idx['SG' + g]], [S.idx['SG' + g], S.idx['LS' + g]],
    [S.idx['LS' + g], S.idx['CL' + g]], [S.idx['CL' + g], S.idx.DC],
    [S.idx.DC, S.idx.LP], [S.idx.LP, S.idx.CR]
  ];
  let head = 0;
  for (const [a, b] of seg) {
    const na = S.nodes[a], nb = S.nodes[b];
    const rho = 0.5 * (na.rho + nb.rho);
    head += (rho - rhoRef) / rhoRef * (na.z - nb.z);
  }
  return head / P.pumpHeadRated;
}

// --------------------------------------------------------------- stepper
export function stepRCS(P, S, Qcore, dt, opt = {}) {
  const dtHr = dt / 3600;
  const N = S.nodes, I = S.idx;
  S.Qcore = Qcore;

  // ---- loop momentum, normalised ----
  for (let L = 0; L < P.nLoops; L++) {
    const g = 'ABC'[L];
    // pump flywheel coastdown when power is removed
    if (!S.pumpOn[L]) S.pumpSpeed[L] = Math.max(0, S.pumpSpeed[L] * (1 - dt / P.pumpInertiaS));
    const w = S.W[L] / P.Wrated;
    const hP = pumpHead(P, S.pumpSpeed[L], w);
    const hB = buoyancyHead(P, S, L);
    const fric = P.Kloop * w * Math.abs(w);
    let wNew = w + (hP + hB - fric) / P.tauLoop * dt;
    // a voided loop seal or tube bundle cannot pass liquid flow
    const seal = N[I['LS' + g]], tube = N[I['SG' + g]];
    const blocked = Math.max(seal.void, tube.void);
    if (blocked > 0.5) wNew *= Math.max(0, 1 - (blocked - 0.5) * 4 * dt);
    if (!isFinite(wNew)) wNew = 0;
    S.W[L] = clamp(wNew, -1.5, 1.5) * P.Wrated;
  }

  const Wtot = S.W.reduce((a, b) => a + b, 0);

  // ---- build the transport network: [fromIdx, toIdx, flow lbm/hr] ----
  const links = [];
  const Wbyp = Wtot * P.headBypassFrac;
  links.push([I.LP, I.CR, Math.max(Wtot - Wbyp, 0)]);
  links.push([I.CR, I.UP, Math.max(Wtot - Wbyp, 0)]);
  links.push([I.DC, I.UH, Wbyp]);
  links.push([I.UH, I.UP, Wbyp]);
  for (let L = 0; L < P.nLoops; L++) {
    const g = 'ABC'[L], W = S.W[L];
    links.push([I.UP, I['HL' + g], W]);
    links.push([I['HL' + g], I['SG' + g], W]);
    links.push([I['SG' + g], I['LS' + g], W]);
    links.push([I['LS' + g], I['CL' + g], W]);
    links.push([I['CL' + g], I.DC, W]);
  }
  links.push([I.DC, I.LP, Math.max(Wtot - Wbyp, 0)]);

  // ---- heat sources per node, Btu/hr ----
  const Q = new Array(N.length).fill(0);
  Q[I.CR] += Qcore * 3.412142;
  for (let L = 0; L < P.nLoops; L++) {
    const g = 'ABC'[L];
    if (S.pumpOn[L] || S.pumpSpeed[L] > 0.02)
      Q[I['CL' + g]] += P.pumpHeatMW * 1e6 * 3.412142 * Math.pow(S.pumpSpeed[L], 3);
    // SG primary -> secondary, effectiveness form
    const sg = N[I['SG' + g]];
    const Tin = N[I['HL' + g]].T;
    const W = Math.abs(S.W[L]);
    const dry = clamp(1 - sg.void, 0, 1);            // a voided bundle loses UA
    let Qsg;
    if (W > 1e3) {
      const NTU = (P.UAsg * dry) / (W * P.cpRCS);
      const eff = 1 - Math.exp(-NTU);
      Qsg = W * P.cpRCS * (Tin - S.Tsec[L]) * eff;
    } else {
      // stagnant loop: fall back on a conduction-limited sink
      Qsg = P.UAsg * dry * 0.02 * (sg.T - S.Tsec[L]);
    }
    // degrade with secondary tube coverage if the plant module supplies it
    Qsg *= (S.sgHtFactor ? S.sgHtFactor[L] : 1);
    Q[I['SG' + g]] -= Qsg;
    S.Qsg[L] = Qsg;                                   // Btu/hr, given to the SG
  }
  Q[I.UP] -= P.ambientLossMW * 1e6 * 3.412142;
  if (opt.Qpzr) Q[I.PZR] += opt.Qpzr;                // heater power, Btu/hr
  // RHR: suction from a hot leg, return to the cold legs.  Modelled as a sink
  // on the hot legs so the loop transport carries the cooled water forward.
  if (opt.QrhrW) {
    const per = (opt.QrhrW * 3.412142) / P.nLoops;
    for (let L = 0; L < P.nLoops; L++) Q[I['HL' + 'ABC'[L]]] -= per;
    S.Qrhr = opt.QrhrW;
  } else S.Qrhr = 0;

  // ---- mass and energy balances (donor cell) ----
  const dM = new Array(N.length).fill(0);
  const dU = new Array(N.length).fill(0);
  for (const [a, b, W] of links) {
    const w = W;
    const up = w >= 0 ? a : b, dn = w >= 0 ? b : a;
    const hUp = N[up].h;
    dM[a] -= w; dM[b] += w;
    dU[a] -= w * hUp; dU[b] += w * hUp;
  }

  // --- pressurizer spray: cold-leg water into the steam space ---
  if (opt.Wspray > 0) {
    const src = N[I['CLB']];
    dM[I.PZR] += opt.Wspray;  dU[I.PZR] += opt.Wspray * src.h;
    dM[I['CLB']] -= opt.Wspray; dU[I['CLB']] -= opt.Wspray * src.h;
  }
  // --- relief: PORVs and code safeties discharge saturated steam ---
  if (opt.Wrelief > 0) {
    const hSteam = PR.hgP(S.P);
    dM[I.PZR] -= opt.Wrelief;
    dU[I.PZR] -= opt.Wrelief * hSteam;
    S.reliefFlow = opt.Wrelief;
  } else S.reliefFlow = 0;
  // charging / letdown / SI / break
  const chg = opt.chargeLbHr ?? S.chargeFlow;
  const ltd = opt.letdownLbHr ?? S.letdownFlow;
  if (chg) { dM[I['CLA']] += chg; dU[I['CLA']] += chg * (opt.hCharge ?? 90); }
  if (ltd) { const n = N[I['CLA']]; dM[I['CLA']] -= ltd; dU[I['CLA']] -= ltd * n.h; }
  if (S.siFlow) { dM[I['CLA']] += S.siFlow / 3; dM[I['CLB']] += S.siFlow / 3; dM[I['CLC']] += S.siFlow / 3;
    for (const g of 'ABC') dU[I['CL' + g]] += (S.siFlow / 3) * (opt.hSI ?? 60); }

  // break flow: Moody-ish critical flow from the break node
  S.breakFlow = 0;
  if (S.breakArea > 0) {
    const bi = I[S.breakNode] !== undefined ? I[S.breakNode] : I['CLA'];
    const n = N[bi];
    const Pd = Math.max(S.P - 14.7, 0);
    // Critical (choked) discharge.  Subcooled water at 2250 psia chokes near
    // 10,000 lbm/s-ft2, i.e. about 3.6e7 lbm/hr-ft2, so the coefficient on
    // sqrt(dP) is of order 7.6e5 -- NOT 8e3, which is what was here and gave
    // 105 lbm/s-ft2.  A hundredfold error: a 2 square inch break leaked
    // 5000 lbm/hr, the charging pumps simply made it up, and the plant never
    // depressurised or actuated safety injection at all.
    // Two-phase discharge is substantially lower for the same area.
    const Csub = 7.64e5, Ctwo = 3.6e5;
    const G = n.void > 0.02
      ? Ctwo * Math.sqrt(Pd) * (1 - 0.45 * n.void)
      : Csub * Math.sqrt(Pd);
    S.breakFlow = G * S.breakArea;                    // lbm/hr
    dM[bi] -= S.breakFlow;
    dU[bi] -= S.breakFlow * n.h;
  }

  for (let i = 0; i < N.length; i++) {
    N[i].M = Math.max(N[i].M + dM[i] * dtHr, 1e-3);
    N[i].U = N[i].U + (dU[i] + Q[i]) * dtHr;
  }

  // ---- pressure from the global volume constraint ----
  S.P = solvePressure(P, S);
  // solid-plant detection: no steam anywhere, so pressure is set purely by
  // liquid compressibility and becomes extremely stiff
  S.solid = S.pzrLevel !== undefined ? (S.pzrLevel > 0.995 && S.voidMax < 1e-6) : false;
  S.railed = S.P >= 3099 || S.P <= 16.1;

  // ---- project back onto the fixed-volume constraint ----
  // Transport conserves mass and energy but does not respect each node's
  // fixed geometry; the surge line and the loops physically do that
  // redistribution.  Mass moved here must carry the DONOR's enthalpy, exactly
  // as in the transport step.  Rescaling each node's mass at constant specific
  // internal energy -- the obvious implementation -- silently creates or
  // destroys energy: it lost 13% in 200 s of a closed, unheated system.
  let Mreq = 0;
  const vNode = [], hNode = [];
  for (let i = 0; i < N.length; i++) {
    const u = N[i].U / Math.max(N[i].M, 1e-9);
    const v = vFromPU(S.P, u);
    vNode.push(v);
    hNode.push(u + S.P * 144 * v / 778.169);
    Mreq += N[i].V / v;
  }
  let Mtot = 0; for (const n of N) Mtot += n.M;
  const scale = Mtot / Math.max(Mreq, 1e-9);

  const Mnew = new Array(N.length);
  let Mex = 0, Uex = 0;
  for (let i = 0; i < N.length; i++) {
    Mnew[i] = (N[i].V / vNode[i]) * scale;
    const d = Mnew[i] - N[i].M;
    if (d < 0) { Mex += -d; Uex += -d * hNode[i]; }
  }
  const hMix = Mex > 1e-12 ? Uex / Mex : 0;
  for (let i = 0; i < N.length; i++) {
    const d = Mnew[i] - N[i].M;
    N[i].U += d * (d < 0 ? hNode[i] : hMix);
    N[i].M = Mnew[i];
  }

  refresh(P, S);
  S.ok = isFinite(S.P) && S.P > 14 && S.P < 3300;
  return S;
}

/** Total RCS mass, lbm. */
export function totalMass(S) { return S.nodes.reduce((a, n) => a + n.M, 0); }
