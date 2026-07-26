// ======================================================================
//  ccw.js — component cooling water and service water
//
//  Every heat sink in this model up to now ended in a number.  RHR rejected
//  into a CCW temperature that rhr.js computed for itself from a fixed 85 F
//  service water supply; the letdown heat exchanger rejected into nothing at
//  all; the reactor coolant pumps had thermal barriers that did not exist.
//  That is exactly the pattern the plant.js header warns about -- a boundary
//  condition asserted rather than solved -- and it hides the same class of
//  error here that it hid there.
//
//  The real chain has three links and this module builds all three:
//
//      plant components  ->  CCW (closed)  ->  service water (open)  ->  UHS
//
//  CCW is CLOSED and treated water, because half of what it cools is
//  radioactive and you do not want that inventory going to the river.  Service
//  water is OPEN, drawn from the ultimate heat sink -- lake, river or cooling
//  tower basin -- and its supply temperature is weather, not a constant.  That
//  single fact is why plants have summer power limits.
//
//  WHY THIS MATTERS BEYOND BOOKKEEPING.  Loss of component cooling water is
//  not a comfort problem, it is a reactor coolant pump seal problem.  The
//  thermal barrier heat exchanger is what stops 550 F primary water reaching
//  the seal package; lose cooling and the seals degrade in minutes, and the
//  procedure is to trip the pumps before they are damaged.  A seal LOCA is
//  a small-break LOCA that starts inside containment with the pumps running.
//  None of that was reachable while CCW was a constant.
//
//  Service water also cools the diesel generator jacket water and the
//  containment fan coolers, so a loss of service water takes out the emergency
//  power source and a containment heat sink at the same time as the primary
//  one.  Those couplings are the reason it is a separate loop and not a
//  multiplier on RHR duty.
// ======================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const BTU_PER_MW = 3.412142e6;

export function ccwParams() {
  return {
    // ---------------------------------------------------- component cooling
    nPumps: 3,                 // two running, one standby, as built
    nHx: 2,
    pumpGpm: 8000,
    hxUA: 6.0e6,              // Btu/hr-F per exchanger, CCW to service water
    cpCCW: 1.0,
    loopGal: 42000,            // loop inventory including the surge tank
    surgeGal: 6000,
    surgeNormPct: 62,

    // ---------------------------------------------------- service water
    nSwPumps: 3,
    swPumpGpm: 12000,
    cpSW: 1.0,
    uhsF: 85,                  // ultimate heat sink; weather, not a constant
    strainerFoulMax: 1.0,

    // ---------------------------------------------------- heat loads
    // Steady loads in Btu/hr.  The reactor coolant pump figures are per pump
    // and are the reason CCW cannot simply be secured when the plant is hot.
    rcpBarrierBtuHr: 0.62e6,   // thermal barrier: keeps the primary off the seals
    rcpBearingBtuHr: 1.05e6,   // motor bearing and lube oil coolers
    sfpBtuHr: 11.5e6,          // spent fuel pool cooling
    letdownBtuHrFull: 21e6,    // CVCS letdown at rated 75 gpm from 550 F
    miscBtuHr: 3.8e6,          // sample coolers, waste processing, seal water

    // service water only
    edgJacketBtuHr: 26e6,      // per diesel at full load
    fanCoolerBtuHr: 9.0e6,     // per containment fan cooler

    // ---------------------------------------------------- limits & alarms
    activityAlarm: 1e-5,       // uCi/ml, set to match rad.js
    ccwHiF: 110,          // alarm; the loop is designed to sit near 95-105
    ccwHiHiF: 140,             // letdown isolates, RCP barrier margin gone
    ccwLoFlowFrac: 0.55,       // of two-pump design flow
    surgeLoPct: 25,
    surgeHiPct: 88,
    swHiF: 95,                 // UHS temperature limit, a Tech Spec in summer
    swLoFlowFrac: 0.5,

    // Seal damage does not happen the instant cooling is lost -- the barrier
    // and the seal package have thermal mass.  Ten minutes without cooling and
    // without seal injection is the point at which the procedure has already
    // told you to trip the pumps.
    sealDamageSec: 600,
    tauLoop: 40,               // s, loop thermal response
    tauPump: 6                 // s, pump start
  };
}

export function makeCCW(P) {
  return {
    // --- component cooling ---
    pumpOn:   [true, true, false],       // two running, one in standby
    pumpAuto: [false, false, true],      // the standby starts on low header
    pumpSpeed: [1, 1, 0],
    hxInService: [true, true],
    flowGpm: 0, flowFrac: 0,
    supplyF: P.uhsF + 15, returnF: P.uhsF + 20, bulkF: P.uhsF + 17,
    QloadBtuHr: 0, QhxBtuHr: 0, QloadMW: 0,
    surgePct: P.surgeNormPct, leakGpm: 0,
    isolated: false,
    activityUCiMl: 0,                    // letdown HX tube leak shows up here

    // --- service water ---
    swPumpOn: [true, true, false],
    swPumpAuto: [false, false, true],
    swFlowGpm: 0, swFlowFrac: 0,
    swSupplyF: P.uhsF, swReturnF: P.uhsF,
    swQBtuHr: 0,
    strainerDP: 0.08, strainerFoul: 0.08,

    // --- consequences ---
    rcpBarrierOK: [true, true, true],
    sealTimerSec: [0, 0, 0],
    sealDamaged: [false, false, false],
    letdownIsolated: false,
    alarms: {}
  };
}

/**
 * One step of the cooling chain.
 *
 *   loads = { rhrBtuHr, letdownFrac, rcpOn[], fansOn[], edgLoadFrac[] }
 *
 * Returns the CCW supply temperature, which is what every component cooled by
 * the loop actually sees.
 *
 * ORDER MATTERS and it caught me once.  Computing the exchanger duty from the
 * SUPPLY temperature rather than the RETURN temperature understated it by the
 * full loop rise -- about 12 F at rated load -- so CCW ran 12 F hot at every
 * power level and the high-temperature alarm sat in permanently.  The
 * exchanger sees the return header.  Everything downstream sees the supply.
 */
export function stepCCW(P, C, loads, dt) {
  const rcpOn = loads.rcpOn || [true, true, true];
  const fansOn = loads.fansOn || [true, true, true, true];
  const edgLoad = loads.edgLoadFrac || [0, 0];

  // ------------------------------------------------ pump response
  // The standby pump starts on low header flow, which is what the real
  // permissive is -- not on a pump breaker trip signal, because the pump can
  // also be running and delivering nothing.
  const running = () => C.pumpOn.reduce((a, b, i) => a + (b && C.pumpSpeed[i] > 0.5 ? 1 : 0), 0);
  const swRunning = () => C.swPumpOn.reduce((a, b, i) => a + (b ? 1 : 0), 0);

  if (running() < 2) for (let i = 0; i < P.nPumps; i++) if (C.pumpAuto[i]) C.pumpOn[i] = true;
  if (swRunning() < 2) for (let i = 0; i < P.nSwPumps; i++) if (C.swPumpAuto[i]) C.swPumpOn[i] = true;

  for (let i = 0; i < P.nPumps; i++) {
    const want = C.pumpOn[i] ? 1 : 0;
    C.pumpSpeed[i] += (want - C.pumpSpeed[i]) * Math.min(1, dt / P.tauPump);
  }

  const nCcw = C.pumpSpeed.reduce((a, s) => a + s, 0);
  C.flowGpm = C.isolated ? 0 : nCcw * P.pumpGpm;
  C.flowFrac = C.flowGpm / (2 * P.pumpGpm);

  // service water flow falls off as the strainers foul -- a real and slow
  // degradation that shows up first as rising CCW temperature, not as an alarm
  const foulLoss = 1 - 0.55 * clamp(C.strainerFoul, 0, P.strainerFoulMax);
  C.swFlowGpm = swRunning() * P.swPumpGpm * foulLoss;
  C.swFlowFrac = C.swFlowGpm / (2 * P.swPumpGpm);
  C.strainerDP = 0.08 + 2.4 * Math.pow(clamp(C.strainerFoul, 0, 1), 1.6);

  // ------------------------------------------------ heat into CCW
  let Q = P.sfpBtuHr + P.miscBtuHr;
  Q += (loads.rhrBtuHr || 0);
  Q += P.letdownBtuHrFull * clamp(loads.letdownFrac ?? 1, 0, 1.2)
       * (C.letdownIsolated ? 0 : 1);
  for (let i = 0; i < rcpOn.length; i++)
    if (rcpOn[i]) Q += P.rcpBarrierBtuHr + P.rcpBearingBtuHr;
  C.QloadBtuHr = Q;
  C.QloadMW = Q / BTU_PER_MW;

  // ------------------------------------------------ CCW to service water
  const Cccw = Math.max(C.flowGpm * 8.34 * 60 * P.cpCCW, 1);      // Btu/hr-F
  const nHx = C.hxInService.filter(Boolean).length;

  // Service water is shared: the exchangers get what the diesels and the fan
  // coolers do not take.  Modelling that split is the whole reason a loss of
  // service water is different from a loss of component cooling.
  const swOther = fansOn.filter(Boolean).length * 0.22 + edgLoad.filter(x => x > 0).length * 0.14;
  const swToHx = Math.max(C.swFlowGpm * (1 - clamp(swOther, 0, 0.75)), 0);
  const Csw = Math.max(swToHx * 8.34 * 60 * P.cpSW, 1);

  // The loop rise the pumps actually produce.  With NO flow there is no rise
  // to compute: heat is not being carried anywhere, the loop is stagnant, and
  // supply and return are both simply the bulk temperature.  Dividing the full
  // load by a floored flow instead drove the supply header to -2e7 F, which is
  // the sort of number that makes every downstream comparison silently true.
  const flowing = C.flowGpm > 1;
  const rise = flowing ? clamp(Q / Cccw, 0, 80) : 0;
  C.returnF = C.bulkF + rise / 2;
  C.supplyF = C.bulkF - rise / 2;

  let Qhx = 0;
  if (nHx > 0 && C.flowGpm > 1 && swToHx > 1) {
    const UA = nHx * P.hxUA;
    const Cmin = Math.min(Cccw, Csw), Cmax = Math.max(Cccw, Csw);
    const Cr = Cmin / Cmax, NTU = UA / Cmin;
    // counterflow effectiveness; the Cr -> 1 limit is the removable
    // singularity, and leaving it in produced NaN the first time both flows
    // happened to match after a pump swap
    const eff = Math.abs(1 - Cr) < 1e-6
      ? NTU / (1 + NTU)
      : (1 - Math.exp(-NTU * (1 - Cr))) / (1 - Cr * Math.exp(-NTU * (1 - Cr)));
    Qhx = Math.max(eff * Cmin * (C.returnF - C.swSupplyF), 0);
  }
  C.QhxBtuHr = Qhx;

  // ------------------------------------------------ loop temperature
  // Heat only reaches the loop if the loop is moving.  A stagnant CCW system
  // is not a hot CCW system -- it is an ABSENT one, and the components it
  // serves heat up locally instead.  That distinction is what makes the seal
  // timer, not the loop temperature, the thing that matters on a loss of CCW.
  const Mcp = P.loopGal * 8.34 * P.cpCCW;                          // Btu/F
  const Qloop = flowing ? Q : 0;
  const dTdt = (Qloop - Qhx) / Math.max(Mcp, 1) / 3600;            // F/s
  C.bulkF = clamp(C.bulkF + dTdt * dt, 40, 320);

  // ------------------------------------------------ service water side
  C.swSupplyF = P.uhsF;
  const Qsw = Qhx
    + fansOn.filter(Boolean).length * P.fanCoolerBtuHr
    + edgLoad.reduce((a, f) => a + f * P.edgJacketBtuHr, 0);
  C.swQBtuHr = Qsw;
  // Same trap as the CCW side, and it bit in the same way: with the service
  // water pumps stopped the flow floor of 1 turned a 36 MBtu/hr duty into a
  // 36,000,085 F return temperature.  Number.isFinite() is perfectly happy
  // with that, which is why the NaN sweep did not catch it.  No flow means no
  // return header to read, not an infinitely hot one.
  const CswTot = C.swFlowGpm * 8.34 * 60 * P.cpSW;
  C.swReturnF = CswTot > 1 ? C.swSupplyF + Qsw / CswTot : C.swSupplyF;

  // ------------------------------------------------ surge tank inventory
  // The surge tank is the loop's only indication of a leak, and it is a
  // sensitive one: CCW piping runs through containment, so a falling surge
  // tank with rising containment sump is a CCW leak inside containment.
  if (C.leakGpm > 0)
    C.surgePct = clamp(C.surgePct - C.leakGpm * dt / 60 / P.surgeGal * 100, 0, 100);
  if (C.surgePct <= 0.5) { C.flowGpm = 0; C.flowFrac = 0; }        // pumps lose suction

  // ------------------------------------------------ consequences
  // Reactor coolant pump seals.  Cooling is lost when the loop is too hot to
  // do the job or there is no flow at all; either way the timer runs.
  const barrierOK = C.flowFrac > 0.25 && C.supplyF < P.ccwHiHiF;
  for (let i = 0; i < C.sealTimerSec.length; i++) {
    if (!rcpOn[i]) { C.sealTimerSec[i] = 0; C.rcpBarrierOK[i] = true; continue; }
    C.rcpBarrierOK[i] = barrierOK;
    C.sealTimerSec[i] = barrierOK ? 0 : C.sealTimerSec[i] + dt;
    if (C.sealTimerSec[i] > P.sealDamageSec) C.sealDamaged[i] = true;
  }

  // Letdown isolates on high CCW temperature: the letdown heat exchanger is
  // the largest single load and shedding it is the first thing that buys the
  // loop margin back.
  if (C.supplyF > P.ccwHiHiF) C.letdownIsolated = true;
  else if (C.supplyF < P.ccwHiF - 5) C.letdownIsolated = false;

  C.alarms = {
    ccwHi:        C.supplyF > P.ccwHiF,
    ccwHiHi:      C.supplyF > P.ccwHiHiF,
    ccwLoFlow:    C.flowFrac < P.ccwLoFlowFrac,
    ccwLost:      C.flowGpm < 1,
    surgeLo:      C.surgePct < P.surgeLoPct,
    surgeHi:      C.surgePct > P.surgeHiPct,
    surgeEmpty:   C.surgePct <= 0.5,
    ccwLeak:      C.leakGpm > 0,
    ccwActivity:  C.activityUCiMl > (P.activityAlarm ?? 1e-5),
    hxOut:        nHx < P.nHx,
    letdownIsol:  C.letdownIsolated,
    barrierLost:  C.rcpBarrierOK.some((ok, i) => !ok && rcpOn[i]),
    sealDamage:   C.sealDamaged.some(Boolean),
    swHi:         C.swSupplyF > P.swHiF,
    swLoFlow:     C.swFlowFrac < P.swLoFlowFrac,
    swLost:       C.swFlowGpm < 1,
    strainerDP:   C.strainerDP > 1.6,
    pumpsRunning: nCcw
  };
  return C.supplyF;
}

/**
 * Put the loop at the temperature the heat balance actually supports.
 *
 * Starting it at a guessed value and letting it drift there costs about
 * twenty-five minutes of simulated time, during which every reading on the
 * cooling board is wrong and the exchangers are rejecting eight per cent more
 * than the loads are producing.  The steady state is algebraic -- effectiveness
 * and both flows are independent of the loop temperature -- so there is no
 * reason to integrate toward an answer that can simply be solved.  This is the
 * same correction initHotStandby applies to the secondary temperature, for the
 * same reason.
 */
export function primeCCW(P, C, loads, iters = 40) {
  for (let i = 0; i < iters; i++) stepCCW(P, C, loads, 60);
  return C.supplyF;
}

/** Trip a CCW pump; the standby picks it up if it is in automatic. */
export function tripPump(C, i)   { C.pumpOn[i] = false; C.pumpAuto[i] = false; }
export function startPump(C, i)  { C.pumpOn[i] = true; }
export function tripSwPump(C, i) { C.swPumpOn[i] = false; C.swPumpAuto[i] = false; }
export function startSwPump(C, i){ C.swPumpOn[i] = true; }

/** Total loss of component cooling: the initiating event for a seal LOCA. */
export function loseCCW(C) {
  C.pumpOn = C.pumpOn.map(() => false);
  C.pumpAuto = C.pumpAuto.map(() => false);
  C.isolated = true;
}
export function restoreCCW(C) {
  C.isolated = false;
  C.pumpOn = [true, true, false];
  C.pumpAuto = [false, false, true];
}
/** Loss of service water: takes the diesels and the fan coolers with it. */
export function loseSW(C) {
  C.swPumpOn = C.swPumpOn.map(() => false);
  C.swPumpAuto = C.swPumpAuto.map(() => false);
}
