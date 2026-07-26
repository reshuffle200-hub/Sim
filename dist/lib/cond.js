// ======================================================================
//  cond.js — condenser, circulating water, air removal and condensate
//
//  The condenser was a constant.  `condPsia: 1.0` sat in the secondary
//  parameters as an operator-settable number, the hotwell was permanently at
//  102 F, and generator output was
//
//      MWe = Wturb * dhEff
//
//  with dhEff a fixed enthalpy drop.  So back pressure did not affect
//  generation at all.  On a real unit it is one of the largest single levers
//  there is: about 1 inHg of back pressure is worth 1.5 to 2 per cent of
//  output, which is why losing a circulating water pump on a summer afternoon
//  costs real megawatts and why condenser performance is watched daily.
//
//  WHAT SETS BACK PRESSURE.  Three things in series, and they are diagnosed
//  separately because the fixes are different:
//
//    the SINK              circulating water inlet temperature -- weather
//    the FLOW              how many circ pumps are running
//    the SURFACE           tube fouling and air blanketing
//
//  Condenser saturation temperature is inlet temperature plus the cooling
//  water rise plus the terminal temperature difference:
//
//      Tcond = Tcw_in + dT_rise + TTD,   Pcond = Psat(Tcond)
//
//  which is exactly how condenser performance is actually evaluated.  A clean
//  condenser with design flow has a TTD near 5 F; fouling and air in-leakage
//  both raise it, and air raises it fastest because a blanket of
//  non-condensables kills the film coefficient outright.
//
//  AIR REMOVAL is not optional equipment.  Everything below atmospheric leaks
//  IN, continuously, through every valve stem and flange in the low pressure
//  end.  The air ejectors run all the time simply to stay level with it.  Lose
//  them and the condenser is dead in minutes -- not hours -- which is why
//  losing vacuum trips the turbine.
//
//  THE HOTWELL is the secondary's only inventory buffer.  Condensate pumps
//  take suction from it, and if it empties they cavitate and the main feed
//  pumps lose suction behind them.  That is the path by which a condensate
//  problem becomes a steam generator level problem.
// ======================================================================

import * as PR from './props.js?v=0.27.0';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const INHG_PER_PSI = 2.03602;

export function condParams() {
  return {
    // ------------------------------------------------ circulating water
    nCwPumps: 3,
    cwPumpGpm: 215000,         // large-bore, low head; this is the big flow
                               //  three pumps give ~645k gpm, a ~20 F rise at
                               //  full duty, which is the design point
    cpCW: 1.0,
    cwInletF: 85,              // ultimate heat sink, same weather as ccw.js

    // ------------------------------------------------ condenser surface
    ttdCleanF: 5.0,            // terminal temperature difference, clean
    foulTtdF: 14.0,            // additional TTD at fully fouled
    airTtdF: 55.0,             // additional TTD with air removal lost.  At 26 F
                               //  the plant settled at 5.4 inHg and simply sat
                               //  there; a real unit with no air removal at all
                               //  goes to a turbine trip, because a blanket of
                               //  non-condensables does not just degrade the
                               //  film coefficient, it destroys it
    designPsia: 1.28,          // ~2.6 inHg abs with an 85 F sink
    tubeArea: 300000,          // ft2, for reference on the board

    // ------------------------------------------------ air removal
    nEjectors: 2,
    airInleakScfm: 6.0,        // normal, always present
    ejectorCapScfm: 12.0,      // each
    tauAir: 90,                // s, air burden response

    // ------------------------------------------------ hotwell & condensate
    nCondPumps: 3,             // two running, one standby
    condPumpGpm: 9500,
    hotwellGal: 130000,
    hotwellNormPct: 62,
    cstGal: 400000,            // condensate storage tank, the makeup source
    makeupGpm: 1200,
    hotwellLoPct: 25,
    hotwellHiPct: 88,

    // ------------------------------------------------ turbine sensitivity
    // Gross output falls roughly linearly with back pressure over the working
    // range.  2%/inHg is the usual rule of thumb for a big condensing unit.
    mwePerInHg: 0.020,
    tripPsia: 5.0,             // low vacuum turbine trip
    alarmPsia: 2.5,

    tauCond: 25,
    tauPump: 5
  };
}

export function makeCond(P) {
  return {
    cwPumpOn: [true, true, true],
    cwPumpSpeed: [1, 1, 1],
    cwFlowGpm: 0, cwFlowFrac: 1,
    cwInletF: P.cwInletF, cwOutletF: P.cwInletF, cwRiseF: 0,

    tubeFoul: 0.05,            // 0 clean, 1 fully fouled
    tubeLeak: false,
    ttdF: P.ttdCleanF,
    TcondF: P.cwInletF + 12, psia: P.designPsia, inHg: 0,
    dutyMW: 0,

    ejectorOn: [true, true],
    airInleakScfm: P.airInleakScfm,
    airBurden: 0,              // 0 = fully removed, 1 = removal overwhelmed

    condPumpOn: [true, true, false],
    condPumpAuto: [false, false, true],
    condFlowGpm: 0,
    hotwellPct: P.hotwellNormPct, cstGal: P.cstGal,
    makeupOn: false, rejectOn: false,

    mweFactor: 1,              // multiplies gross output
    alarms: {}
  };
}

/**
 * One step.
 *   dutyMW    heat the turbine and dumps are throwing at the condenser
 *   makeupIn  condensate returning (feedwater that came back), gpm equivalent
 *
 * Returns { psia, mweFactor }, which is what the secondary needs back.
 */
export function stepCond(P, C, dutyMW, dt, opt = {}) {
  C.cwInletF = opt.sinkF ?? P.cwInletF;

  // ------------------------------------------------ circulating water
  for (let i = 0; i < P.nCwPumps; i++) {
    const want = C.cwPumpOn[i] ? 1 : 0;
    C.cwPumpSpeed[i] += (want - C.cwPumpSpeed[i]) * Math.min(1, dt / P.tauPump);
  }
  C.cwFlowGpm = C.cwPumpSpeed.reduce((a, s) => a + s, 0) * P.cwPumpGpm;
  C.cwFlowFrac = C.cwFlowGpm / (P.nCwPumps * P.cwPumpGpm);

  // ------------------------------------------------ air removal
  // Air in-leakage is continuous.  The ejectors either keep up or they do not,
  // and the burden is the shortfall -- which is why the condenser degrades
  // over minutes when they are lost rather than instantly.
  const cap = C.ejectorOn.filter(Boolean).length * P.ejectorCapScfm;
  const shortfall = clamp((C.airInleakScfm - cap) / Math.max(P.airInleakScfm, 1), 0, 1);
  C.airBurden += (shortfall - C.airBurden) * Math.min(1, dt / P.tauAir);

  // ------------------------------------------------ condenser performance
  C.dutyMW = Math.max(dutyMW, 0);
  const Qbtu = C.dutyMW * 3.412142e6;
  const Ccw = C.cwFlowGpm * 8.34 * 60 * P.cpCW;                  // Btu/hr-F

  // No circulating water is not "a very hot condenser", it is no condenser at
  // all.  Dividing the full turbine duty by a floored flow is the same trap
  // that put the CCW supply header at -2e7 F, so the no-flow branch is
  // explicit: the shell simply climbs toward the steam temperature and the
  // back pressure runs away, which is what actually happens.
  C.cwRiseF = Ccw > 1 ? clamp(Qbtu / Ccw, 0, 120) : 0;
  C.cwOutletF = C.cwInletF + C.cwRiseF;

  C.ttdF = P.ttdCleanF
         + P.foulTtdF * clamp(C.tubeFoul, 0, 1)
         + P.airTtdF * clamp(C.airBurden, 0, 1);

  const Ttarget = Ccw > 1
    ? C.cwInletF + C.cwRiseF + C.ttdF
    : 212 + 90 * clamp(C.dutyMW / 1800, 0, 1);       // no flow: shell runs away
  C.TcondF += (Ttarget - C.TcondF) * Math.min(1, dt / P.tauCond);
  C.TcondF = clamp(C.TcondF, 60, 340);
  C.psia = clamp(PR.PsatT(C.TcondF), 0.15, 120);
  C.inHg = C.psia * INHG_PER_PSI;

  // ------------------------------------------------ effect on the generator
  // This is the whole reason the module exists: back pressure is a lever on
  // output, and while the condenser was a constant it was a lever nobody could
  // pull.  Below design the gain is real but small; above it, it bites.
  const dInHg = (C.psia - P.designPsia) * INHG_PER_PSI;
  C.mweFactor = clamp(1 - P.mwePerInHg * dInHg, 0.55, 1.05);

  // ------------------------------------------------ hotwell and condensate
  for (let i = 0; i < P.nCondPumps; i++) { /* discrete, no coastdown modelled */ }
  const nCp = C.condPumpOn.filter(Boolean).length;
  if (nCp < 2) for (let i = 0; i < P.nCondPumps; i++) if (C.condPumpAuto[i]) C.condPumpOn[i] = true;
  C.condFlowGpm = C.condPumpOn.filter(Boolean).length * P.condPumpGpm;

  // Level control: makeup from the condensate storage tank on low, reject to
  // it on high.  The hotwell is small relative to the flow through it, so
  // without control it swings on any load change.
  const lvlErr = P.hotwellNormPct - C.hotwellPct;
  C.makeupOn = C.hotwellPct < P.hotwellNormPct - 4;
  C.rejectOn = C.hotwellPct > P.hotwellNormPct + 6;
  let net = (opt.netInGpm ?? 0);                       // leakage, AFW draw etc.
  if (C.makeupOn && C.cstGal > 100) net += P.makeupGpm;
  if (C.rejectOn) net -= P.makeupGpm;
  if (C.makeupOn) C.cstGal = Math.max(C.cstGal - P.makeupGpm * dt / 60, 0);
  if (C.rejectOn) C.cstGal = Math.min(C.cstGal + P.makeupGpm * dt / 60, P.cstGal);
  C.hotwellPct = clamp(C.hotwellPct + net * dt / 60 / P.hotwellGal * 100
                       + lvlErr * 0.0004 * dt, 0, 100);

  C.alarms = {
    vacuumLow:     C.psia > P.alarmPsia,
    vacuumTrip:    C.psia > P.tripPsia,
    cwLoFlow:      C.cwFlowFrac < 0.6,
    cwLost:        C.cwFlowGpm < 1,
    cwOutletHi:    C.cwOutletF > 115,
    ttdHigh:       C.ttdF > P.ttdCleanF + 6,
    fouled:        C.tubeFoul > 0.45,
    airHigh:       C.airBurden > 0.15,
    ejectorLost:   C.ejectorOn.filter(Boolean).length < P.nEjectors,
    airInleakHi:   C.airInleakScfm > P.airInleakScfm * 1.6,
    tubeLeak:      C.tubeLeak,
    hotwellLo:     C.hotwellPct < P.hotwellLoPct,
    hotwellHi:     C.hotwellPct > P.hotwellHiPct,
    hotwellEmpty:  C.hotwellPct <= 1,
    condPumpLost:  C.condPumpOn.filter(Boolean).length < 2,
    condLostAll:   C.condPumpOn.every(v => !v),
    makeup:        C.makeupOn,
    reject:        C.rejectOn,
    cstLo:         C.cstGal < P.cstGal * 0.25,
    outputLoss:    C.mweFactor < 0.985
  };
  return { psia: C.psia, mweFactor: C.mweFactor };
}

export function tripCwPump(C, i)   { C.cwPumpOn[i] = false; }
export function startCwPump(C, i)  { C.cwPumpOn[i] = true; }
export function tripCondPump(C, i) { C.condPumpOn[i] = false; C.condPumpAuto[i] = false; }
/** Lose air removal: the classic slow loss of vacuum. */
export function loseEjectors(C)    { C.ejectorOn = C.ejectorOn.map(() => false); }
export function restoreEjectors(C) { C.ejectorOn = C.ejectorOn.map(() => true); }
/** An air in-leakage fault: vacuum degrades even with the ejectors running. */
export function setAirInleak(C, scfm) { C.airInleakScfm = Math.max(scfm, 0); }
export function loseCirc(C) { C.cwPumpOn = C.cwPumpOn.map(() => false); }
