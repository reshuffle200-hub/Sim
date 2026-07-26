// ======================================================================
//  rad.js — radiation monitoring
//
//  Two annunciator windows have been reading state that nothing ever wrote:
//  `cw.activityUCiMl` and `cd.tubeLeak`.  Both were stubbed when component
//  cooling and the condenser went in, on the assumption that something would
//  come along and set them.  Until now nothing did, so those windows could
//  never light -- decoration on a board whose entire purpose is that every
//  window means something.  This module is what sets them.
//
//  WHY RADIATION MONITORING IS NOT COSMETIC.  A steam generator tube rupture
//  is, thermally, almost invisible.  Primary inventory goes down and secondary
//  inventory goes up, but a small leak looks like charging flow error, level
//  instrument drift, or nothing at all for a long time.  What actually tells
//  you it is a tube leak, and WHICH generator, is activity appearing where
//  activity does not belong.  Without radiation monitoring, SGTR in this model
//  was diagnosable only by staring at a mass balance and guessing.
//
//  THE TRANSPORT CHAIN.  Primary coolant carries fission products from clad
//  defects.  Every barrier between it and the environment is a place activity
//  can cross, and each crossing has its own monitor:
//
//    primary -> secondary        SG tube leak      blowdown + steam line
//    primary -> component cooling  letdown HX leak   CCW loop monitor
//    primary -> containment      RCS leak          containment particulate
//    secondary -> environment    condenser + vent  off-gas, plant vent
//
//  PARTITIONING is what makes the monitors say different things, and it is the
//  reason there is more than one.  Iodine and particulates stay in the liquid
//  phase -- the partition coefficient is around 100 to 1 -- so they show up in
//  BLOWDOWN.  Noble gases do not partition at all; they follow the steam,
//  through the turbine, into the condenser, and out through the air ejectors.
//
//  So the FIRST indication of a tube leak is the condenser off-gas monitor,
//  not the blowdown monitor: the noble gases arrive within a minute or two of
//  the leak starting, while iodine takes far longer to build a detectable
//  liquid concentration.  Getting that order right is most of what makes the
//  instrument worth simulating.
// ======================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const LN2 = Math.LN2;

export function radParams() {
  return {
    // ---------------------------------------------- primary source term
    // Activity is quoted as I-131 dose equivalent in microcuries per gram,
    // which is how the Tech Spec limit is written.  Intact fuel with the small
    // number of clad defects every core has runs well under 1.
    primaryNormal: 0.28,       // uCi/g, steady with intact cladding
    primarySpec: 60,           // uCi/g, the Tech Spec ceiling
    // Back-calculated so the balance below SETTLES at primaryNormal, rather
    // than being picked independently of it.  Chosen freehand, the source term
    // and the declared normal disagreed by a factor of twelve -- the model's
    // own equilibrium was 3.3 uCi/g while this file claimed 0.28 -- and the
    // letdown monitor, which reads activity against normal, sat at 13x
    // background on a clean plant.
    cladSourcePerMW: 3.60e-5,  // uCi/g-equivalent produced per MW thermal
    demineralizerEff: 0.92,    // fraction removed per pass through letdown
    halfLifeHr: 193,           // I-131, 8.04 d -- sets how fast it clears

    // Noble gases: no chemistry, no filtration, they simply build and decay.
    gasNormal: 12,             // uCi/g Xe-133 equivalent
    gasSourcePerMW: 2.38e-5,
    gasHalfLifeHr: 126,

    // ---------------------------------------------- partitioning
    iodinePartition: 100,      // liquid-to-steam; iodine stays in the water
    gasPartition: 1.0,         // noble gases follow the steam entirely

    // ---------------------------------------------- monitor setpoints
    // Each monitor is a decade-scale instrument, so the alarm points are
    // multiples of background rather than absolute numbers.
    blowdownAlarm: 8,          // x background
    blowdownHiHi: 60,
    steamlineAlarm: 6,
    steamlineHiHi: 45,
    offgasAlarm: 4,            // the most sensitive path, and the first to move
    offgasHiHi: 30,
    // Loop activity monitors are sensitive instruments: a letdown heat
    // exchanger tube leak of a fraction of a gallon a minute into thousands of
    // gallons of CCW is a dilution of five orders of magnitude, so an alarm at
    // 1e-3 uCi/ml could not have detected any leak worth detecting.
    ccwAlarm: 1e-5,            // uCi/ml
    cnmtGasAlarm: 25,          // x background
    cnmtPartAlarm: 18,
    ventAlarm: 40,
    crIntakeAlarm: 12,
    sfpAlarm: 15,
    auxAlarm: 14,

    // containment high range: a post-accident instrument, R/hr, decades wide
    cnmtHighRangeMax: 1e8,

    // ---------------------------------------------- flows
    blowdownGpm: 60,           // per generator, continuous
    ejectorPullGpm: 0.9,       // condensate-equivalent gas draw
    ventCfm: 42000,            // plant vent stack

    // Detector BACKGROUNDS, as concentrations rather than as a fudge factor.
    // These have to be separate numbers: a clean secondary carries far less
    // iodine than it carries noble gas, so normalising both against one
    // reference made the steam line read higher than the blowdown it is
    // supposed to be a hundredth of.
    bgLiquidUCiG: 2.0e-5,      // clean secondary liquid, iodine
    bgSteamUCiG: 4.0e-4,       // clean steam, noble gas
    bgOffgasUCiG: 1.2e-3,      // air ejector discharge

    // Real process monitors are log-scale and they SATURATE.  A reading of
    // 8801 times background is not an instrument output, it is an arithmetic
    // result; the detector went off scale decades earlier and the operator sees
    // exactly that.
    fullScale: 1e5,

    tauMonitor: 8,             // s, detector and sample line response
    sampleLagSec: 45           // blowdown sample line transit -- a real delay
  };
}

export function makeRad(P) {
  const bg = { r: 1, raw: 1, alarm: false, hihi: false };
  const mon = () => ({ ...bg });
  return {
    // --- source terms ---
    primaryUCiG: P.primaryNormal,
    gasUCiG: P.gasNormal,
    baselineUCiG: P.primaryNormal,
    baselineGasUCiG: P.gasNormal,
    cladDamage: 0,             // 0..1, fraction of clad breached

    // --- fault inputs, all operator- or scenario-settable ---
    sgLeakGpm: [0, 0, 0],      // per generator: the tube leak
    letdownHxLeakGpm: 0,       // primary into component cooling water
    condTubeLeak: false,       // circulating water into condensate

    // --- secondary activity, per generator ---
    sgLiquidUCiG: [0, 0, 0],
    sgSteamUCiG: [0, 0, 0],
    sgGasUCiG: [0, 0, 0],

    // --- process and area monitors, all in multiples of background ---
    blowdown: [mon(), mon(), mon()],
    steamline: [mon(), mon(), mon()],
    offgas: mon(),
    ccw: mon(),
    letdown: mon(),
    cnmtGas: mon(),
    cnmtPart: mon(),
    cnmtIodine: mon(),
    cnmtHighRange: 0.01,       // R/hr
    auxBuilding: mon(),
    fuelHandling: mon(),
    crIntake: mon(),
    vent: mon(),

    // --- releases ---
    releaseRateUCiS: 0,
    releasedCi: 0,

    // --- automatic actions ---
    blowdownIsolated: false,
    crIsolated: false,
    sampleQueue: [],
    bdArmed: false, crArmed: false,
    alarms: {}
  };
}

/** Advance a monitor toward its true reading with detector lag. */
function stepMon(P, m, target, alarmSp, hihiSp, dt) {
  const t = Math.min(target, P.fullScale);
  m.raw = target;
  m.r += (t - m.r) * Math.min(1, dt / P.tauMonitor);
  m.offScale = target >= P.fullScale;
  m.alarm = m.r > alarmSp;
  m.hihi = m.r > hihiSp;
  return m.r;
}

/**
 * One step.
 *
 *   in = { powerMW, MrcsLb, letdownGpm, sgMassLb[], sgSteamLbHr[], msivOpen[],
 *          cnmtSumpLb, rcsLeakLbHr, ccwFlowGpm, fuelDamage, turbineOnline }
 */
export function stepRad(P, R, IN, dt) {
  const hr = dt / 3600;

  // ------------------------------------------------ primary source term
  // Production scales with power; removal is the letdown demineralizer plus
  // radioactive decay.  Clad damage multiplies the source, which is what makes
  // a fuel failure look completely different from a tube leak: the tube leak
  // moves activity around, a fuel failure CREATES it.
  R.cladDamage = clamp(IN.fuelDamage ?? R.cladDamage, 0, 1);
  // Clad damage does not nudge the source term, it transforms it.  Breaching a
  // fraction of a per cent of the rods releases the fuel-cladding gap
  // inventory, which is orders of magnitude above what intact fuel leaks.  At
  // the 400x-per-unit-damage this started with, 0.2% clad failure raised RCS
  // activity by a factor of 1.8 and never reached the Tech Spec limit -- which
  // would make a fuel failure indistinguishable from a slightly dirty plant.
  const srcMult = 1 + 1.2e5 * R.cladDamage;
  const Mg = Math.max(IN.MrcsLb ?? 5e5, 1) * 453.592;              // grams
  const src = P.cladSourcePerMW * (IN.powerMW ?? 0) * srcMult;
  const cleanup = (IN.letdownGpm ?? 0) * 8.34 * 60 * 453.592 / Mg * P.demineralizerEff;
  const decay = LN2 / P.halfLifeHr;
  R.primaryUCiG += (src - R.primaryUCiG * (cleanup + decay)) * hr;
  R.primaryUCiG = clamp(R.primaryUCiG, 0, 1e5);

  // Noble gases are not filtered -- the demineralizer does nothing for them,
  // which is exactly why they are the sensitive leak indicator.
  const gsrc = P.gasSourcePerMW * (IN.powerMW ?? 0) * srcMult;
  R.gasUCiG += (gsrc - R.gasUCiG * LN2 / P.gasHalfLifeHr) * hr;
  R.gasUCiG = clamp(R.gasUCiG, 0, 1e6);

  // ------------------------------------------------ primary into secondary
  let offgasTarget = 1, ventGas = 0;
  const ejectorGHr = Math.max(P.ejectorPullGpm * 8.34 * 60 * 453.592, 1);
  for (let i = 0; i < 3; i++) {
    const leak = Math.max(R.sgLeakGpm[i], 0);
    const Msg = Math.max((IN.sgMassLb || [])[i] ?? 1e5, 1) * 453.592;   // grams
    const leakG = leak * 8.34 * 60 * 453.592;                          // g/hr

    // liquid-phase iodine: in with the leak, out with blowdown and decay
    const bdG = (R.blowdownIsolated ? 0 : P.blowdownGpm) * 8.34 * 60 * 453.592;
    const inRate = leakG * R.primaryUCiG / Msg;
    const outRate = R.sgLiquidUCiG[i] * (bdG / Msg + decay)
                  + R.sgLiquidUCiG[i] * ((IN.sgSteamLbHr || [])[i] ?? 0)
                    * 453.592 / Msg / P.iodinePartition;
    R.sgLiquidUCiG[i] = clamp(R.sgLiquidUCiG[i] + (inRate - outRate) * hr, 0, 1e5);
    R.sgSteamUCiG[i] = R.sgLiquidUCiG[i] / P.iodinePartition;

    // Noble gases do not stay: whatever leaks in leaves with the steam almost
    // immediately, so the steam concentration tracks the leak rate rather than
    // integrating.  This is why off-gas responds in a minute and blowdown
    // takes an hour.
    const steamLbHr = Math.max((IN.sgSteamLbHr || [])[i] ?? 0, 1);
    R.sgGasUCiG[i] = leak > 0
      ? R.gasUCiG * (leak * 8.34 * 60) / steamLbHr
      : R.sgGasUCiG[i] * Math.max(0, 1 - dt / 25);

    stepMon(P, R.blowdown[i], 1 + R.sgLiquidUCiG[i] / P.bgLiquidUCiG,
            P.blowdownAlarm, P.blowdownHiHi, dt);
    stepMon(P, R.steamline[i], 1 + (R.sgSteamUCiG[i] + R.sgGasUCiG[i]) / P.bgSteamUCiG,
            P.steamlineAlarm, P.steamlineHiHi, dt);

    // Only an unisolated generator feeding the turbine reaches the condenser.
    //
    // The air ejector CONCENTRATES what it removes, and that is the whole
    // reason this is the sensitive monitor.  Noble gas leaving three steam
    // generators is diluted in millions of pounds an hour of steam; the ejector
    // pulls the non-condensables out into a stream four orders of magnitude
    // smaller, so the concentration at the detector is four orders of magnitude
    // higher.  Normalising off-gas against the steam concentration instead --
    // which is what I did first -- made it the LAST monitor to respond rather
    // than the first, and inverted the one diagnostic sequence this module
    // exists to reproduce.
    if ((IN.msivOpen || [])[i] !== false && IN.turbineOnline) {
      const gasRateUCiHr = R.sgGasUCiG[i] * steamLbHr * 453.592;
      offgasTarget += gasRateUCiHr / ejectorGHr / P.bgOffgasUCiG;
      ventGas += gasRateUCiHr / 3600 * 1e-6;
    }
  }
  stepMon(P, R.offgas, offgasTarget, P.offgasAlarm, P.offgasHiHi, dt);

  // ------------------------------------------------ primary into CCW
  // The letdown heat exchanger has primary on one side and component cooling
  // water on the other, so a tube leak there puts activity in a loop that runs
  // all over the plant.  This is the source the CCW ACTIVITY HIGH window has
  // been waiting for.
  const ccwMl = Math.max((IN.ccwFlowGpm ?? 0) * 3785.41, 1);
  R.ccwActivityUCiMl = R.letdownHxLeakGpm > 0
    ? R.primaryUCiG * R.letdownHxLeakGpm * 3785.41 / ccwMl
    : Math.max((R.ccwActivityUCiMl ?? 0) * (1 - dt / 120), 0);
  stepMon(P, R.ccw, 1 + R.ccwActivityUCiMl / P.ccwAlarm, 1, 20, dt);

  // ------------------------------------------------ primary into containment
  // An RCS leak inside containment shows up on the particulate and gas
  // channels long before the sump level moves enough to notice.
  const leakLbHr = IN.rcsLeakLbHr ?? 0;
  const partT = 1 + leakLbHr * R.primaryUCiG * 2.1e-3;
  const gasT  = 1 + leakLbHr * R.gasUCiG * 4.0e-4;
  stepMon(P, R.cnmtPart, partT, P.cnmtPartAlarm, P.cnmtPartAlarm * 8, dt);
  stepMon(P, R.cnmtGas, gasT, P.cnmtGasAlarm, P.cnmtGasAlarm * 8, dt);
  stepMon(P, R.cnmtIodine, 1 + leakLbHr * R.primaryUCiG * 1.4e-3,
          P.cnmtPartAlarm, P.cnmtPartAlarm * 8, dt);

  // The high range monitor is a different instrument for a different purpose:
  // it is useless in normal operation and it is the only thing that reads
  // anything at all after significant fuel damage.
  const hrTarget = 0.01 + 3.2e7 * R.cladDamage
                 + (IN.cnmtSumpLb ?? 0) * R.primaryUCiG * 4e-5;
  R.cnmtHighRange += (Math.min(hrTarget, P.cnmtHighRangeMax) - R.cnmtHighRange)
                     * Math.min(1, dt / P.tauMonitor);

  // ------------------------------------------------ area and effluent
  const pRel = R.primaryUCiG / R.baselineUCiG;
  stepMon(P, R.letdown, pRel, 6, 40, dt);
  stepMon(P, R.auxBuilding, 1 + (pRel - 1) * 0.4
          + R.ccwActivityUCiMl / P.ccwAlarm * 0.6, P.auxAlarm, P.auxAlarm * 6, dt);
  stepMon(P, R.fuelHandling, 1 + R.ccwActivityUCiMl / P.ccwAlarm * 0.3,
          P.sfpAlarm, P.sfpAlarm * 6, dt);
  stepMon(P, R.crIntake, 1 + gasT * 0.06 + ventGas * 0.4,
          P.crIntakeAlarm, P.crIntakeAlarm * 5, dt);
  stepMon(P, R.vent, 1 + ventGas * 1.8 + gasT * 0.05, P.ventAlarm, P.ventAlarm * 6, dt);

  R.releaseRateUCiS = ventGas * 1e6;
  R.releasedCi += R.releaseRateUCiS * dt * 1e-6;

  // ------------------------------------------------ automatic actions
  // Blowdown isolates on high activity, which is both a release-control action
  // and the thing that removes the sample path -- so isolating it costs you the
  // monitor that told you to isolate it.
  // Isolation is EDGE-triggered on the hi-hi signal, not continuously asserted.
  // Asserted continuously, a manual reset was undone on the very next step
  // while activity was still high, so the reset handle did nothing at all.  A
  // real reset holds; the actuation re-arms only once the signal clears.
  const bdHiHi = R.blowdown.some(m => m.hihi);
  if (bdHiHi && !R.bdArmed) { R.blowdownIsolated = true; R.bdArmed = true; }
  if (!bdHiHi) R.bdArmed = false;
  const crHi = R.crIntake.alarm;
  if (crHi && !R.crArmed) { R.crIsolated = true; R.crArmed = true; }
  if (!crHi) R.crArmed = false;

  R.alarms = {
    primaryHi:     R.primaryUCiG > R.baselineUCiG * 10,
    primarySpec:   R.primaryUCiG > P.primarySpec,
    cladDamage:    R.cladDamage > 1e-4,
    gasHi:         R.gasUCiG > R.baselineGasUCiG * 8,
    offgasHi:      R.offgas.alarm,
    offgasHiHi:    R.offgas.hihi,
    ccwActivity:   R.ccwActivityUCiMl > P.ccwAlarm,
    letdownHi:     R.letdown.alarm,
    cnmtGasHi:     R.cnmtGas.alarm,
    cnmtPartHi:    R.cnmtPart.alarm,
    cnmtIodineHi:  R.cnmtIodine.alarm,
    cnmtHighRange: R.cnmtHighRange > 1,
    auxHi:         R.auxBuilding.alarm,
    sfpHi:         R.fuelHandling.alarm,
    crIntakeHi:    R.crIntake.alarm,
    crIsolated:    R.crIsolated,
    ventHi:        R.vent.alarm,
    ventHiHi:      R.vent.hihi,
    releasing:     R.releaseRateUCiS > 1e3,
    bdIsolated:    R.blowdownIsolated,
    tubeLeak:      R.sgLeakGpm.some(v => v > 0),
    condTubeLeak:  R.condTubeLeak
  };
  return R;
}

/**
 * Put the activity inventories at the equilibrium the source terms support.
 *
 * Iodine takes days to settle and the noble gases take longer -- a 126 hour
 * half life is about five days to steady state -- so integrating into it from a
 * cold start means every monitor on the board reads wrong for longer than
 * anybody will ever run the simulation.  The equilibrium is algebraic, so it is
 * solved rather than approached, exactly as primeCCW does for the cooling loop.
 */
export function primeRad(P, R, IN) {
  const Mg = Math.max(IN.MrcsLb ?? 5e5, 1) * 453.592;
  const cleanup = (IN.letdownGpm ?? 0) * 8.34 * 60 * 453.592 / Mg * P.demineralizerEff;
  const srcMult = 1 + 1.2e5 * R.cladDamage;
  const src = P.cladSourcePerMW * (IN.powerMW ?? 0) * srcMult;
  R.primaryUCiG = src / Math.max(cleanup + LN2 / P.halfLifeHr, 1e-9);
  R.gasUCiG = P.gasSourcePerMW * (IN.powerMW ?? 0) * srcMult
              / Math.max(LN2 / P.gasHalfLifeHr, 1e-9);
  // A real monitor is CALIBRATED against the plant it is installed in: one
  // times background means whatever this plant reads when it is clean, not a
  // number chosen in advance.  Normalising against a hand-picked constant left
  // the letdown monitor reading twice background on an intact core, because the
  // constant and the equilibrium were never going to agree exactly.
  R.baselineUCiG = Math.max(R.primaryUCiG, 1e-9);
  R.baselineGasUCiG = Math.max(R.gasUCiG, 1e-9);
  return R;
}

/** Which generator is leaking, by monitor response rather than by cheating. */
export function suspectGenerator(R) {
  let best = -1, peak = 0;
  for (let i = 0; i < 3; i++) {
    const r = Math.max(R.steamline[i].r, R.blowdown[i].r);
    if (r > peak) { peak = r; best = i; }
  }
  return peak > 3 ? best : -1;
}

export function setTubeLeak(R, i, gpm) { R.sgLeakGpm[i] = Math.max(gpm, 0); }
export function setLetdownHxLeak(R, gpm) { R.letdownHxLeakGpm = Math.max(gpm, 0); }
export function setCladDamage(R, frac) { R.cladDamage = clamp(frac, 0, 1); }
export function resetBlowdown(R) { R.blowdownIsolated = false; }
export function resetCrIsolation(R) { R.crIsolated = false; }
