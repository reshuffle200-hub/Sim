// ======================================================================
//  secondary.js — steam header, turbine, steam dumps, feedwater train
//
//  STEAM HEADER   three SGs through MSIVs into a common header.  Flow to the
//                 turbine is choked through the nozzle chest, so it is linear
//                 in header pressure and in valve position.
//
//  TURBINE        EHC with a load setpoint, ramp rate limit and runback.
//                 Impulse pressure is proportional to steam flow, which is
//                 what the operator actually reads as turbine load.
//
//  STEAM DUMPS    two control modes, and they are genuinely different:
//                   Tavg mode     - modulates on (Tavg - Tref), used on a
//                                   load rejection or trip to absorb the
//                                   mismatch until the reactor catches up
//                   pressure mode - modulates on header pressure, used for
//                                   the controlled cooldown to RHR entry
//
//  FEEDWATER      condenser and hotwell, condensate pumps, LP heaters, main
//                 feed pumps, HP heaters, and a regulating valve per SG.
//                 Final feedwater temperature is NOT a lookup: the heaters
//                 are driven by turbine extraction, so it falls out of load.
//                 That coupling matters because cold feedwater is what makes
//                 shrink severe at low power.
// ======================================================================

import * as PR from './props.js?v=0.27.0';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function secParams() {
  const P = {
    // --- header / turbine ---
    Prated: 812,               // header pressure at rated, psia
    Wrated: 0,                 // set by the caller from the SG module
    MWeRated: 916,             // gross electrical at rated
    dhEff: 0,                  // derived effective enthalpy drop, Btu/lbm
    headerLoss: 12,            // psi from SG to header at rated flow
    Kturb: 0,                  // choked-flow coefficient, derived

    // --- EHC ---
    rampPctPerMin: 5.0,        // normal load ramp limit
    rampFastPctPerMin: 200,    // runback rate
    tauValve: 1.5,             // governor valve stroke time constant, s

    // --- steam dumps ---
    dumpCapFrac: 0.40,         // fraction of rated steam flow
    dumpTavgGain: 0.055,       // fraction open per degF of Tavg error
    dumpDeadbandF: 3.0,        // degF of Tavg error before the dumps respond
    dumpPressSet: 1005,        // psia, pressure-mode setpoint
    dumpPressGain: 0.010,      // fraction open per psi above setpoint
    tauDump: 2.0,
    condenserOK: true,
    dumpInterlockPsia: 3.4,    // dumps blocked above this condenser pressure
                               //  (~7 inHg abs).  8 psia was 16 inHg -- so far
                               //  above the turbine's own low-vacuum trip that
                               //  the interlock could never act first

    // --- condenser / hotwell ---
    condPsia: 1.0,             // ~2 inHg absolute
    hotwellF: 102,
    condDutyMW: 0,

    // --- feedwater heaters ---
    // Each stage is fed by turbine extraction; extraction pressure scales
    // with steam flow, so the heaters get weaker as load falls.
    heaterStages: [
      { frac: 0.16, tauS: 20 },   // LP heaters
      { frac: 0.28, tauS: 25 },
      { frac: 0.30, tauS: 30 },   // HP heaters
      { frac: 0.26, tauS: 35 }
    ],
    TfwRated: 440,
    heatersInService: true,

    // --- main feed pumps ---
    nMFP: 2,
    mfpCapFrac: 0.60,          // each, as a fraction of rated feed flow
    tauMFP: 6.0,

    // --- feed regulating valves ---
    frvGain: 0.020,            // fraction per % level error
    frvFlowGain: 0.55,         // three-element: steam/feed mismatch term
    tauFRV: 3.0,
    lvlSet: 50,

    // --- auxiliary feedwater ---
    afwCapLbHr: 4.4e5,         // total, all pumps
    afwStartLevel: 17,         // NR % that starts AFW
    TafwF: 100
  };
  return P;
}

export function calibrateSec(P, WsteamTotal) {
  P.Wrated = WsteamTotal;
  // The turbine sees the HEADER, not the steam generator, so the choked-flow
  // coefficient must be referred to header pressure.  Calibrating on SG
  // pressure left the valve wide open at 98.5% flow: the plant could never
  // reach 100% load, and rod control chased a load it could not have.
  P.PheaderRated = P.Prated - P.headerLoss;
  P.Kturb = P.Wrated / P.PheaderRated;                 // choked: W = K * Pos * P
  P.dhEff = (P.MWeRated * 1e6 * 3.412142) / P.Wrated;  // Btu/lbm, derived
  P.dumpCapLbHr = P.dumpCapFrac * P.Wrated;
  return P;
}

export function makeSec(P) {
  return {
    // turbine
    online: false, tripped: false,
    loadSet: 0, loadDemand: 0, valvePos: 0, valveDemand: 0,
    Wturb: 0, MWe: 0, impulsePsia: 0,
    // dumps
    dumpMode: 'tavg', dumpPos: 0, dumpDemand: 0, Wdump: 0, dumpAvail: true,
    // header
    Pheader: P.Prated, msivOpen: [true, true, true],
    // feedwater
    TfwF: P.hotwellF, TfwTarget: P.hotwellF, stageT: P.heaterStages.map(() => P.hotwellF),
    mfpOn: [true, true], mfpSpeed: [1, 1], WfwTotal: 0,
    frvPos: [0.5, 0.5, 0.5], Wfw: [0, 0, 0],
    afwOn: false, Wafw: [0, 0, 0],
    // misc
    condPsia: P.condPsia, runback: false, mweFactor: 1
  };
}

/**
 * Advance the secondary plant.
 *   sgs     the steam generator array (read for pressure and level)
 *   Tavg    RCS average temperature
 *   Tref    programmed Tavg for the current load
 *   dt      seconds
 * Returns steam demand per SG and feedwater flow per SG for the SG module.
 */
export function stepSec(P, S, sgs, Tavg, Tref, dt) {
  const n = sgs.length;

  // ---------------- header pressure ----------------
  let pSum = 0, nOpen = 0;
  for (let i = 0; i < n; i++) if (S.msivOpen[i]) { pSum += sgs[i].Psec; nOpen++; }
  const Pavg = nOpen ? pSum / nOpen : sgs[0].Psec;
  S.Pheader = Math.max(Pavg - P.headerLoss * Math.pow(clamp(S.Wturb / Math.max(P.Wrated, 1), 0, 2), 2), 1);

  // ---------------- turbine EHC ----------------
  if (S.tripped) { S.loadDemand = 0; S.valveDemand = 0; }
  else if (S.online) {
    const rate = (S.runback ? P.rampFastPctPerMin : P.rampPctPerMin) / 100 / 60 * dt;
    S.loadDemand += clamp(S.loadSet - S.loadDemand, -rate * (S.runback ? 1 : 1), rate);
    S.loadDemand = clamp(S.loadDemand, 0, 1.05);
    // valve position needed for this load at the current header pressure
    S.valveDemand = clamp(S.loadDemand * P.PheaderRated / Math.max(S.Pheader, 50), 0, 1);
  } else { S.loadDemand = 0; S.valveDemand = 0; }
  S.valvePos += (S.valveDemand - S.valvePos) * Math.min(1, dt / P.tauValve);
  S.valvePos = clamp(S.valvePos, 0, 1);

  S.Wturb = (nOpen ? 1 : 0) * P.Kturb * S.valvePos * S.Pheader;
  S.impulsePsia = S.Pheader * S.valvePos * 0.92;
  const hg = PR.hgP(S.Pheader);
  // Gross output now rides on condenser back pressure (cond.js).  It used to
  // be flow times a fixed enthalpy drop, so a lost circulating water pump on a
  // hot day cost nothing at all -- on a real unit it is one of the biggest
  // levers on generation there is.
  S.MWe = S.Wturb * P.dhEff / 3.412142 / 1e6 * (S.mweFactor ?? 1);

  // ---------------- steam dumps ----------------
  S.dumpAvail = P.condenserOK && S.condPsia < P.dumpInterlockPsia;
  let dd = 0;
  if (S.dumpAvail) {
    if (S.dumpMode === 'tavg') dd = clamp((Tavg - Tref - P.dumpDeadbandF) * P.dumpTavgGain, 0, 1);
    else dd = clamp((S.Pheader - P.dumpPressSet) * P.dumpPressGain, 0, 1);
  }
  S.dumpDemand = dd;
  S.dumpPos += (S.dumpDemand - S.dumpPos) * Math.min(1, dt / P.tauDump);
  S.dumpPos = clamp(S.dumpPos, 0, 1);
  S.Wdump = S.dumpAvail ? P.dumpCapLbHr * S.dumpPos * (S.Pheader / P.Prated) : 0;

  // ---------------- feedwater heating ----------------
  // Extraction pressure follows steam flow, so each stage's achievable
  // temperature rise scales with load.  This is why feedwater is cold at low
  // power, which is in turn why shrink is severe there.
  const loadFrac = clamp(S.Wturb / Math.max(P.Wrated, 1), 0, 1.2);
  let T = P.hotwellF;
  const span = P.TfwRated - P.hotwellF;
  for (let i = 0; i < P.heaterStages.length; i++) {
    const st = P.heaterStages[i];
    const target = P.heatersInService
      ? T + span * st.frac * Math.pow(loadFrac, 0.45)
      : T;
    S.stageT[i] += (target - S.stageT[i]) * Math.min(1, dt / st.tauS);
    T = S.stageT[i];
  }
  S.TfwTarget = T;
  S.TfwF = T;

  // ---------------- main feed pumps ----------------
  let cap = 0;
  for (let i = 0; i < P.nMFP; i++) {
    if (S.mfpOn[i]) S.mfpSpeed[i] += (1 - S.mfpSpeed[i]) * Math.min(1, dt / P.tauMFP);
    else S.mfpSpeed[i] += (0 - S.mfpSpeed[i]) * Math.min(1, dt / P.tauMFP);
    cap += P.mfpCapFrac * S.mfpSpeed[i];
  }
  S.mfpCapacity = cap;

  // ---------------- feed regulating valves: three-element ----------------
  const steamPerSG = (S.Wturb + S.Wdump) / n;
  for (let i = 0; i < n; i++) {
    const lvlErr = P.lvlSet - sgs[i].lvlNR;
    const mismatch = (steamPerSG - S.Wfw[i]) / Math.max(P.Wrated / n, 1);
    const dem = clamp(steamPerSG / Math.max(P.Wrated / n, 1)
                    + lvlErr * P.frvGain
                    + mismatch * P.frvFlowGain, 0, 1.3);
    S.frvPos[i] += (dem - S.frvPos[i]) * Math.min(1, dt / P.tauFRV);
    S.frvPos[i] = clamp(S.frvPos[i], 0, 1.3);
    S.Wfw[i] = S.frvPos[i] * (P.Wrated / n) * clamp(cap / 1.2, 0, 1.2);
  }

  // ---------------- auxiliary feedwater ----------------
  const anyLow = sgs.some(s => s.lvlNR < P.afwStartLevel);
  if (anyLow) S.afwOn = true;
  for (let i = 0; i < n; i++) {
    S.Wafw[i] = S.afwOn ? (P.afwCapLbHr / n) * (sgs[i].lvlNR < 50 ? 1 : 0) : 0;
  }

  S.WfwTotal = S.Wfw.reduce((a, b) => a + b, 0) + S.Wafw.reduce((a, b) => a + b, 0);
  // Condenser duty is heat IN minus work OUT, not a fudge factor on the steam
  // enthalpy.  The 0.62 that used to be here gave 2508 MW of rejection on a
  // unit that only takes 2775 MW of heat and makes 916 MW of it electricity,
  // so the condenser was being asked to reject a third more than the plant
  // produces.  Feedwater heating is internal to the cycle, so the correct
  // balance is against feedwater enthalpy, and the dumps bypass the turbine
  // entirely -- they do no work, so all of their heat lands in the condenser.
  const hfw = PR.hfT(S.TfwF);
  S.condDutyMW = Math.max(
    (S.Wturb * (hg - hfw) + S.Wdump * (hg - hfw)) / 3.412142 / 1e6 - S.MWe, 0);
  return S;
}

/** Steam demand seen by each SG. */
export function steamDemand(P, S, n) {
  const tot = S.Wturb + S.Wdump;
  return new Array(n).fill(tot / n);
}
/** Feedwater flow and temperature for each SG. */
export function feedTo(P, S, i) {
  const w = S.Wfw[i] + S.Wafw[i];
  const T = w > 1 ? (S.Wfw[i] * S.TfwF + S.Wafw[i] * P.TafwF) / w : S.TfwF;
  return { W: w, T };
}
