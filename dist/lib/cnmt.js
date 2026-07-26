// ======================================================================
//  cnmt.js — containment: pressure, temperature, sprays, fan coolers, sump
//
//  Until now break flow simply left the model.  That is a real gap, not a
//  cosmetic one: containment pressure is an ACTUATION SIGNAL.  High pressure
//  starts safety injection and isolates containment even when reactor
//  coolant pressure has not yet fallen far enough to do it, and it is the
//  main thing that distinguishes a break inside containment from a leak
//  somewhere else in the plant.
//
//  The atmosphere is air plus steam.  Total pressure is the SUM OF PARTIAL
//  PRESSURES: the air is trapped and simply gets hotter, while the steam
//  partial pressure follows what the released mass and temperature support,
//  capped at saturation.  Treating the atmosphere as a single ideal gas
//  misses the fact that most of the pressure rise in the first seconds is
//  the air being heated, not the steam itself.
//
//  PASSIVE HEAT SINKS MATTER.  Several million pounds of steel and concrete
//  absorb a large fraction of the blowdown energy in the first minute.
//  Leave them out and the peak pressure is far too high.
// ======================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function cnmtParams() {
  return {
    freeVolFt3: 1.8e6,         // large dry containment, 3-loop
    designPsig: 47,
    initialPsig: 0.3,
    initialF: 110,
    airLbm: 0,                 // derived from the initial state

    // --- passive heat sinks: steel liner, structures, equipment ---
    sinkMassLb: 4.2e6,
    sinkCp: 0.11,              // Btu/lbm-F, mostly steel and concrete
    sinkUA: 4.5e6,             // Btu/hr-F.  At 2.6e5 the sinks absorbed under
                               //  2% of the blowdown and made no difference to
                               //  the peak; real steel and concrete take a
                               //  large share of it in the first minute.

    // --- containment spray ---
    sprayTrains: 2,
    sprayGpmEach: 2600,
    sprayTempF: 100,
    sprayEff: 0.72,            // fraction of the way to saturation

    // --- fan coolers ---
    nFans: 4,
    fanUA: 1.1e5,              // Btu/hr-F each, against service water
    fanSinkF: 95,

    // --- actuation setpoints ---
    isolPsig: 4.0,             // phase A isolation and SI
    sprayPsig: 22.0,           // containment spray high-high
    fanPsig: 4.0,

    // --- leakage and vacuum relief ---
    leakFracPerDay: 0.001,
    vacuumReliefPsig: -0.5     // containment vacuum breakers admit outside air
                               //  rather than let the shell go sub-atmospheric;
                               //  fan coolers running with no heat source drove
                               //  it slightly negative without this
  };
}

export function makeCnmt(P) {
  // trapped air mass from the initial state, ideal gas
  const T0 = P.initialF + 459.67;
  const Pa = (P.initialPsig + 14.7) * 144;             // lbf/ft2
  P.airLbm = Pa * P.freeVolFt3 / (53.35 * T0);         // R_air = 53.35 ft-lbf/lbm-R
  return {
    Tf: P.initialF, psig: P.initialPsig,
    pAir: P.initialPsig + 14.7, pSteam: 0,
    steamLb: 0, sumpLb: 0, sumpFt3: 0, waterLb: 0,
    U: (P.airLbm * 0.171 * P.initialF),               // total internal energy, Btu
    sinkTf: P.initialF, QsinkMW: 0,
    sprayOn: [false, false], sprayGpm: 0, QsprayMW: 0,
    fansOn: [true, true, true, true], QfanMW: 0,
    isolated: false, sprayAuto: true,
    peakPsig: P.initialPsig, peakTf: P.initialF,
    alarms: {}
  };
}

// --- simple water property fits, adequate over 100-350 F ---
function psatF(TF) {                    // psia
  const T = clamp(TF, 60, 400);
  return Math.exp(11.7 - 8100 / (T + 400)) * 14.7 / 1.02;
}
const ufT = TF => TF - 32;                              // liquid internal energy
const hfgT = TF => 1075 - 0.57 * (TF - 32);             // latent heat
const ugT = TF => ufT(TF) + hfgT(TF) - 62;              // vapour internal energy

/**
 * Solve the containment state from total water mass and total energy.
 *
 * This is the part the first version got wrong.  It dumped the entire released
 * enthalpy into sensible heating of the air, which has a heat capacity of only
 * about 31,000 Btu/F -- so one minute of a small break raised the atmosphere
 * 300 F and the temperature simply railed.  Almost all of that energy actually
 * goes into latent heat of the suspended steam and into the sump water.
 *
 * Given V, M_air, M_water and U, find T such that
 *     U = M_air*cv*T + M_steam*ug(T) + M_liquid*uf(T)
 * with the steam saturated:  M_steam = psat(T)*V/(R_s*T), capped at M_water.
 */
function solveState(P, Mwater, U) {
  const V = P.freeVolFt3, cvAir = 0.171;
  const f = TF => {
    const T = TF + 459.67;
    const msMax = psatF(TF) * 144 * V / (85.78 * T);
    const ms = Math.min(Math.max(Mwater, 0), msMax);
    const ml = Math.max(Mwater - ms, 0);
    return P.airLbm * cvAir * TF + ms * ugT(TF) + ml * ufT(TF) - U;
  };
  let lo = 60, hi = 400;
  if (f(lo) > 0) return { Tf: lo, steam: 0 };
  if (f(hi) < 0) hi = 400;
  for (let i = 0; i < 45; i++) {
    const m = 0.5 * (lo + hi);
    if (f(m) < 0) lo = m; else hi = m;
  }
  const TF = 0.5 * (lo + hi), T = TF + 459.67;
  const msMax = psatF(TF) * 144 * V / (85.78 * T);
  return { Tf: TF, steam: Math.min(Math.max(Mwater, 0), msMax) };
}

export function stepCnmt(P, C, WbreakLbHr, hBreak, dt, opt = {}) {
  const dtHr = dt / 3600;
  const V = P.freeVolFt3;

  // ---------------- mass and energy in ----------------
  const dm = Math.max(WbreakLbHr, 0) * dtHr;
  C.waterLb += dm;
  C.U += dm * hBreak;                                  // discharged enthalpy

  // ---------------- heat removal ----------------
  const Qsink = P.sinkUA * (C.Tf - C.sinkTf) * dtHr;
  C.sinkTf += Qsink / (P.sinkMassLb * P.sinkCp);
  C.QsinkMW = Qsink / Math.max(dtHr, 1e-9) / 3.412142 / 1e6;

  let Qfan = 0;
  for (let i = 0; i < P.nFans; i++)
    if (C.fansOn[i]) Qfan += P.fanUA * Math.max(C.Tf - P.fanSinkF, 0) * dtHr;
  C.QfanMW = Qfan / Math.max(dtHr, 1e-9) / 3.412142 / 1e6;

  if (C.sprayAuto && C.psig > P.sprayPsig) C.sprayOn = [true, true];
  if (C.psig < P.sprayPsig * 0.6) C.sprayOn = [false, false];
  let sprayGpm = 0;
  for (let i = 0; i < P.sprayTrains; i++) if (C.sprayOn[i]) sprayGpm += P.sprayGpmEach;
  C.sprayGpm = sprayGpm;
  const Wspray = sprayGpm * 8.34 * 60;
  // spray water enters cold and leaves at containment temperature: it removes
  // energy AND adds mass to the sump
  const dmSpray = Wspray * dtHr;
  C.waterLb += dmSpray;
  C.U += dmSpray * ufT(P.sprayTempF);
  const Qspray = 0;                                    // accounted by the cold mass
  C.QsprayMW = dmSpray > 0
    ? dmSpray * Math.max(C.Tf - P.sprayTempF, 0) / Math.max(dtHr, 1e-9) / 3.412142 / 1e6 : 0;

  C.U -= (Qsink + Qfan);

  // ---------------- solve the state ----------------
  const st = solveState(P, C.waterLb, C.U);
  C.Tf = st.Tf;
  C.steamLb = st.steam;
  C.sumpLb = Math.max(C.waterLb - C.steamLb, 0);

  // ---------------- pressure: partial pressures ----------------
  const T = C.Tf + 459.67;
  C.pAir = P.airLbm * 53.35 * T / V / 144;
  C.pSteam = C.steamLb * 85.78 * T / V / 144;
  C.psig = C.pAir + C.pSteam - 14.7;

  if (C.psig > 0) {
    const leak = P.leakFracPerDay * dtHr / 24;
    C.waterLb *= (1 - leak);
    C.U *= (1 - leak * 0.5);
  }

  // vacuum breakers: admit air rather than allow a sub-atmospheric shell
  if (C.psig < P.vacuumReliefPsig) {
    const need = (P.vacuumReliefPsig + 14.7) * 144 * V / (53.35 * T) - P.airLbm;
    if (need > 0) { P.airLbm += need; C.vacuumRelief = true; }
    C.pAir = P.airLbm * 53.35 * T / V / 144;
    C.psig = C.pAir + C.pSteam - 14.7;
  } else C.vacuumRelief = false;

  C.sumpFt3 = C.sumpLb / 60;
  C.peakPsig = Math.max(C.peakPsig, C.psig);
  C.peakTf = Math.max(C.peakTf, C.Tf);
  if (C.psig > P.isolPsig) C.isolated = true;
  C.hiPressure = C.psig > P.isolPsig;

  C.alarms = {
    hiPress: C.psig > P.isolPsig,
    hiHiPress: C.psig > P.sprayPsig,
    nearDesign: C.psig > P.designPsig * 0.85,
    overDesign: C.psig > P.designPsig,
    isolated: C.isolated,
    spraying: sprayGpm > 0,
    hiTemp: C.Tf > 250,
    sumpHi: C.sumpFt3 > 20000
  };
  return C;
}
