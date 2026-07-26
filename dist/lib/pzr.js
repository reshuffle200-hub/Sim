// ======================================================================
//  pzr.js — pressurizer control and relief path
//
//  The pressurizer VOLUME lives in rcs.js as a node in the global pressure
//  solve; this module supplies the heat and mass sources acting on it:
//    - variable (proportional) and backup heaters
//    - spray from the cold leg of two loops
//    - two power-operated relief valves, each with a motor-operated block
//    - three ASME code safety valves
//    - the pressurizer relief tank, with water seal, nitrogen space,
//      and a rupture disc
//    - level control programme (setpoint ramps with Tavg) driving charging
//      and letdown
//
//  EQUILIBRIUM ASSUMPTION.  Steam and water in the pressurizer are held at
//  the saturation temperature of the common pressure.  Real pressurizers are
//  non-equilibrium: the steam space superheats on an insurge and the water
//  subcools on an outsurge, which is why spray is sized the way it is.  The
//  consequence here is that spray looks slightly MORE effective and insurge
//  pressure peaks slightly LOWER than reality.  Level behaviour, relief
//  valve cycling and the drain-down signature are not affected, so the
//  scenarios this panel is being built for are covered.
// ======================================================================

import * as PR from './props.js?v=0.27.1';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PSIG = 14.7;

export function pzrParams() {
  return {
    // --- heaters ---
    heaterVarKW: 300,          // proportional bank
    heaterBackKW: 1500,        // backup banks (W 3-loop total is near 1800 kW)
    pSet: 2235,                // psig, programme setpoint
    heaterBandOn: -20,         // psig below setpoint: backup heaters on
    heaterVarGain: 0.06,       // fraction per psig error

    // --- spray ---
    sprayMaxGpm: 700,          // both valves wide open
    sprayOpenPsig: 2260,       // starts to open
    sprayFullPsig: 2310,       // fully open
    sprayBypassGpm: 2,         // continuous bypass to keep the line warm

    // --- PORVs ---
    porvLiftPsig: 2335,
    porvResetPsig: 2315,
    porvCapLbHr: 210000,       // each, at lift pressure
    nPorv: 2,

    // --- code safeties ---
    safetyLiftPsig: 2485,
    safetyResetPsig: 2410,
    safetyCapLbHr: 420000,     // each
    nSafety: 3,

    // --- relief tank ---
    prtVolFt3: 1800,
    prtWaterFt3: 1300,         // normal water seal
    prtPsigNorm: 3,            // nitrogen blanket
    prtRuptPsig: 100,          // rupture disc
    prtTempNormF: 120,

    // --- level programme: setpoint vs Tavg ---
    lvlNoLoadPct: 25, lvlFullPct: 60,
    TavgNoLoad: 547, TavgFull: 577,
    lvlDevAlarm: 5,
    chargeMaxGpm: 150, letdownNomGpm: 75,
    lvlGain: 3.0,

    // --- LTOP / COMS: cold overpressure protection ---
    // Below the enable temperature the PORV setpoints are shifted far down,
    // because a cold, water-solid RCS can be pressurised past the brittle
    // fracture limit of the vessel by a very small insurge.  Without this the
    // pressure solve simply rails, which is what the audit exposed.
    ltopEnableF: 350,
    ltopSetPsig: 450,
    ltopResetPsig: 400,
    ltopCapLbHr: 160000,

    // --- alarms ---
    pHiAlarm: 2310, pLoAlarm: 2185,
    pHiTrip: 2385,             // reactor trip on high pressurizer pressure
    pLoTrip: 1865,             // reactor trip / SI on low pressure
    lvlHiTrip: 92              // reactor trip on high level
  };
}

export function makePZR(P) {
  return {
    mode: 'auto',
    heatersOn: true, sprayAuto: true,
    porvOpen: [false, false], porvBlock: [true, true],   // blocks normally open
    porvStuck: [false, false],
    safetyOpen: [false, false, false],
    heaterKW: 0, sprayGpm: 0,
    Wrelief: 0, Qpzr: 0,
    chargeGpm: 0, letdownGpm: 0,
    prtWaterFt3: P.prtWaterFt3, prtPsig: P.prtPsigNorm, prtTempF: P.prtTempNormF,
    prtRuptured: false, prtMassLb: 0,
    lvlSet: 60, lvlDev: 0,
    alarms: {}
  };
}

/**
 * One control step.
 *   Ppsia   current RCS pressure
 *   levelPct pressurizer indicated level, percent
 *   TavgF   RCS average temperature
 *   TcoldF  spray source temperature
 *   dt      seconds
 * Returns the sources rcs.js needs: Qpzr [Btu/hr] and Wrelief [lbm/hr].
 */
export function stepPZR(P, Z, Ppsia, levelPct, TavgF, TcoldF, dt) {
  const psig = Ppsia - PSIG;

  // ---------------- level programme ----------------
  const f = clamp((TavgF - P.TavgNoLoad) / (P.TavgFull - P.TavgNoLoad), 0, 1);
  Z.lvlSet = P.lvlNoLoadPct + f * (P.lvlFullPct - P.lvlNoLoadPct);
  Z.lvlDev = levelPct - Z.lvlSet;

  // Charging and letdown trim level only.
  //
  // I tried giving charging PRESSURE priority on a low-pressure signal, on the
  // reasoning that level control was throttling charging back while pressure
  // fell.  It made things measurably WORSE -- minimum 1791 psig against 1833
  // without it -- because charging fills the pressurizer with water some 70 F
  // COOLER than the saturated water already there.  That insurge condenses
  // steam and drops pressure faster than 1800 kW of heaters can raise it.
  // More charging is the wrong lever for low pressurizer pressure.
  if (Z.mode === 'auto') {
    const cmd = -Z.lvlDev * P.lvlGain;
    Z.chargeGpm = clamp(P.letdownNomGpm + cmd, 0, P.chargeMaxGpm);
    Z.letdownGpm = P.letdownNomGpm;
  }

  // ---------------- heaters ----------------
  let kW = 0;
  if (Z.heatersOn) {
    const err = P.pSet - psig;
    // proportional-plus-integral: proportional alone leaves a standing droop
    Z.pInt = clamp((Z.pInt ?? 0.35) + err * 0.004 * dt, 0, 1);
    if (err > -5) kW += P.heaterVarKW * clamp(err * P.heaterVarGain + Z.pInt, 0, 1);
    if (psig < P.pSet + P.heaterBandOn) kW += P.heaterBackKW;
    // heaters are covered only while there is water above them
    if (levelPct < 12) kW *= clamp(levelPct / 12, 0, 1);
  }
  Z.heaterKW = kW;

  // ---------------- spray ----------------
  let gpm = P.sprayBypassGpm;
  if (Z.sprayAuto && psig > P.sprayOpenPsig) {
    gpm += P.sprayMaxGpm * clamp((psig - P.sprayOpenPsig) / (P.sprayFullPsig - P.sprayOpenPsig), 0, 1);
  }
  Z.sprayGpm = gpm;

  // ---------------- relief valves ----------------
  // LTOP arms automatically when the plant is cold
  Z.ltopArmed = TavgF < P.ltopEnableF;
  const liftP  = Z.ltopArmed ? P.ltopSetPsig   : P.porvLiftPsig;
  const resetP = Z.ltopArmed ? P.ltopResetPsig : P.porvResetPsig;
  const capP   = Z.ltopArmed ? P.ltopCapLbHr   : P.porvCapLbHr;

  let W = 0;
  for (let i = 0; i < P.nPorv; i++) {
    if (Z.porvStuck[i]) Z.porvOpen[i] = true;
    else if (!Z.porvOpen[i] && psig > liftP) Z.porvOpen[i] = true;
    else if (Z.porvOpen[i] && psig < resetP) Z.porvOpen[i] = false;
    if (Z.porvOpen[i] && Z.porvBlock[i]) {
      W += capP * Math.sqrt(clamp(psig / liftP, 0, 2));
    }
  }
  for (let i = 0; i < P.nSafety; i++) {
    if (!Z.safetyOpen[i] && psig > P.safetyLiftPsig) Z.safetyOpen[i] = true;
    else if (Z.safetyOpen[i] && psig < P.safetyResetPsig) Z.safetyOpen[i] = false;
    if (Z.safetyOpen[i]) W += P.safetyCapLbHr * Math.sqrt(clamp(psig / P.safetyLiftPsig, 0, 2));
  }
  Z.Wrelief = W;

  // ---------------- relief tank ----------------
  if (W > 0 && !Z.prtRuptured) {
    const dM = W * dt / 3600;                       // lbm discharged this step
    Z.prtMassLb += dM;
    // steam condenses in the water seal, heating and expanding it
    Z.prtTempF += dM * 900 / (Z.prtWaterFt3 * 60 * 1.0) * 1.0;
    Z.prtWaterFt3 += dM / 58;                       // condensed volume
    const gasV = Math.max(P.prtVolFt3 - Z.prtWaterFt3, 1);
    Z.prtPsig = (P.prtPsigNorm + PSIG) * (P.prtVolFt3 - P.prtWaterFt3) / gasV
              * (Z.prtTempF + 460) / (P.prtTempNormF + 460) - PSIG;
    if (Z.prtPsig > P.prtRuptPsig) Z.prtRuptured = true;
  } else if (Z.prtRuptured) {
    Z.prtPsig = 5;                                  // discharged to containment
  }

  // ---------------- heat and mass sources for the RCS node ----------------
  // heaters add energy; spray adds cold mass which condenses steam.
  const Qheat = Z.heaterKW * 3412.14;               // Btu/hr
  const sprayLbHr = Z.sprayGpm * 8.02 * 60 * (PR.vfP(Ppsia) > 0 ? 1 : 1);
  const hSpray = 0;                                 // handled by rcs mass source
  Z.sprayLbHr = sprayLbHr;
  Z.Qpzr = Qheat;
  Z.chargeLbHr = Z.chargeGpm * 8.34 * 60;
  Z.letdownLbHr = Z.letdownGpm * 8.34 * 60;

  // ---------------- alarms ----------------
  Z.alarms = {
    pHi: psig > P.pHiAlarm,
    pLo: psig < P.pLoAlarm,
    pHiTrip: psig > P.pHiTrip,
    pLoTrip: psig < P.pLoTrip,
    lvlHi: Z.lvlDev > P.lvlDevAlarm,
    lvlLo: Z.lvlDev < -P.lvlDevAlarm,
    lvlHiTrip: levelPct > P.lvlHiTrip,
    heatersUncovered: levelPct < 12,
    porvOpen: Z.porvOpen.some((o, i) => o && Z.porvBlock[i]),
    safetyOpen: Z.safetyOpen.some(o => o),
    prtHiPress: Z.prtPsig > P.prtRuptPsig * 0.5,
    prtRuptured: Z.prtRuptured,
    ltopArmed: Z.ltopArmed,
    solidPlant: levelPct > 99,
    reliefFlow: Z.Wrelief > 0
  };
  return Z;
}

/** Total relief discharged, useful for the panel. */
export function reliefTotalLb(Z) { return Z.prtMassLb; }
