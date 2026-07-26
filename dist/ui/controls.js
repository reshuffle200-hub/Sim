// ======================================================================
//  controls.js — control switches, as hardware
//
//  A control switch is not a button.  Three things are distinct on a real
//  board and are kept distinct here:
//
//    the HANDLE POSITION is what the operator asked for,
//    the INDICATING LAMPS are what the equipment is actually doing,
//    and those two disagree whenever something is broken, interlocked, or
//    still travelling.
//
//  Collapsing them into one lit button destroys exactly the information an
//  operator uses to notice that a pump did not start.  So every switch below
//  reads its lamps from plant state and its handle from the demand, and they
//  are allowed to disagree.
//
//  LAMP COLOUR follows US practice, which is the opposite of what most people
//  expect: RED means running, open, or energised; GREEN means stopped, closed,
//  or de-energised.  The logic is that red is the condition requiring
//  attention on a plant designed to sit still.
//
//  Every switch here writes real state that the physics consumes.  A switch
//  with nothing behind it would be worse than no switch at all, so where the
//  model does not support a position, the position does not exist -- see the
//  auxiliary feedwater switch, which has no STOP because the level logic
//  re-asserts the start signal on the next step and a STOP would be a lie.
// ======================================================================
import * as CWM from '../lib/ccw.js?v=0.28.1';
import * as RDM from '../lib/rad.js?v=0.28.1';
import * as ROM from '../lib/rods.js?v=0.28.1';
import * as ELM from '../lib/elec.js?v=0.28.1';
import * as RHM from '../lib/rhr.js?v=0.28.1';
import * as SIM from '../lib/si.js?v=0.28.1';
import * as RPSM from '../lib/rps.js?v=0.28.1';

/**
 * The control functions the switches call through `actuate`'s api parameter.
 *
 * This lived as an object literal in index.html, which meant it was the ONLY
 * place that knew the full set -- so nothing else could construct a working
 * one, and an audit that assembled its own quietly missed `setChannel` and
 * reported eight channel-bypass switches as broken when they were fine. One
 * definition, exported, used by the shell and by the tests alike.
 */
export function switchApi() {
  return {
    closeGenBreaker: ELM.closeGenBreaker,
    loseOffsite: ELM.loseOffsite,
    restoreOffsite: ELM.restoreOffsite,
    setChannel: RPSM.setChannel,
    blockSI: SIM.blockSI,
    placeInService: RHM.placeInService
  };
}

const bool = (get, set) => ({ get, set });

// Plain state is written DIRECTLY.  There used to be four wired singletons here
// -- CCWAPI, RADAPI, SIAPI, RODAPI -- that index.html populated at startup and
// every switch called through.  The failure mode is silent: unwired, they are
// no-op stubs, so nine switches did nothing at all in any host that had not
// called the matching wire function, and did it without erroring. Importing the
// modules removes the whole category.
//
// The `api` parameter that actuate() takes is a different thing and stays: it
// is passed per call, and a missing one THROWS rather than quietly doing
// nothing, which is the property the singletons lacked.

export const SWITCHES = [
  // =================================================== REACTOR COOLANT PUMPS
  ...[0, 1, 2].map(i => ({
    board: 'rcs', section: 'REACTOR COOLANT PUMPS', label: `RCP ${'ABC'[i]}`,
    pos: ['STOP', 'START'],
    read: PL => PL.E.rcpOn[i] ? 1 : 0,
    write: (PL, v) => { PL.E.rcpOn[i] = v === 1; },
    lamp: PL => PL.E.rcpOn[i] ? 'red' : 'green',
    note: PL => `${(PL.S.W[i] / PL.rp.Wrated * 100).toFixed(0)}% flow`
  })),

  // ========================================================== PRESSURIZER
  {
    board: 'rcs', section: 'PRESSURIZER', label: 'PRESS CONTROL',
    pos: ['MANUAL', 'AUTO'],
    read: PL => PL.z.mode === 'auto' ? 1 : 0,
    write: (PL, v) => { PL.z.mode = v === 1 ? 'auto' : 'manual'; },
    lamp: PL => PL.z.mode === 'auto' ? 'green' : 'red'
  },
  {
    board: 'rcs', section: 'PRESSURIZER', label: 'HEATERS',
    pos: ['OFF', 'ON'],
    read: PL => PL.z.heatersOn ? 1 : 0,
    write: (PL, v) => { PL.z.heatersOn = v === 1; },
    lamp: PL => PL.z.heatersOn ? 'red' : 'green',
    note: PL => `${(PL.z.heaterKW ?? 0).toFixed(0)} kW`
  },
  {
    board: 'rcs', section: 'PRESSURIZER', label: 'SPRAY',
    pos: ['MANUAL', 'AUTO'],
    read: PL => PL.z.sprayAuto ? 1 : 0,
    write: (PL, v) => { PL.z.sprayAuto = v === 1; },
    lamp: PL => (PL.z.sprayGpm ?? 0) > 1 ? 'red' : 'green',
    note: PL => `${(PL.z.sprayGpm ?? 0).toFixed(0)} gpm`
  },
  // PORV block valves.  Closing one is the actual response to a stuck PORV,
  // so this switch is the fix for the event the board can already cause.
  ...[0, 1].map(i => ({
    board: 'rcs', section: 'PRESSURIZER', label: `PORV ${i + 1} BLOCK`,
    pos: ['CLOSED', 'OPEN'],
    read: PL => PL.z.porvBlock[i] ? 1 : 0,
    write: (PL, v) => { PL.z.porvBlock[i] = v === 1; },
    lamp: PL => PL.z.porvBlock[i] ? 'red' : 'green',
    note: PL => PL.z.porvStuck[i] ? 'PORV STUCK' : (PL.z.porvOpen[i] ? 'relieving' : '')
  })),

  // ==================================================== MAIN STEAM & FEED
  ...[0, 1, 2].map(i => ({
    board: 'secondary', section: 'MAIN STEAM ISOLATION', label: `MSIV ${'ABC'[i]}`,
    pos: ['CLOSE', 'OPEN'],
    read: PL => PL.sgs[i].msivOpen ? 1 : 0,
    write: (PL, v) => { PL.sgs[i].msivOpen = v === 1; PL.sec.msivOpen[i] = v === 1; },
    lamp: PL => PL.sgs[i].msivOpen ? 'red' : 'green',
    note: PL => `${PL.sgs[i].Psec.toFixed(0)} psia`
  })),
  ...[0, 1].map(i => ({
    board: 'secondary', section: 'FEEDWATER', label: `MAIN FEED PUMP ${'AB'[i]}`,
    pos: ['STOP', 'START'],
    read: PL => PL.sec.mfpOn[i] ? 1 : 0,
    write: (PL, v) => { PL.sec.mfpOn[i] = v === 1; },
    lamp: PL => PL.sec.mfpOn[i] ? 'red' : 'green'
  })),
  {
    // No STOP position: the low-level logic re-asserts the start signal on the
    // next step, so a STOP handle would not hold and must not be offered.
    board: 'secondary', section: 'FEEDWATER', label: 'AUX FEEDWATER',
    pos: ['AUTO', 'START'],
    read: PL => PL.sec.afwManual ? 1 : 0,
    write: (PL, v) => { PL.sec.afwManual = v === 1; if (v === 1) PL.sec.afwOn = true; },
    lamp: PL => PL.sec.afwOn ? 'red' : 'green',
    note: PL => PL.sec.afwOn ? 'feeding' : 'standby'
  },
  {
    board: 'secondary', section: 'STEAM DUMPS', label: 'DUMP MODE',
    pos: ['Tavg', 'PRESSURE'],
    read: PL => PL.sec.dumpMode === 'pressure' ? 1 : 0,
    write: (PL, v) => { PL.sec.dumpMode = v === 1 ? 'pressure' : 'tavg'; },
    lamp: PL => PL.sec.dumpPos > 0.02 ? 'red' : 'green',
    note: PL => `${(PL.sec.dumpPos * 100).toFixed(0)}% open`
  },
  {
    // Condenser pressure gates the dumps through the existing interlock
    // (dumpAvail = condenserOK && condPsia < dumpInterlockPsia), so degrading
    // vacuum genuinely takes the dumps away.
    board: 'secondary', section: 'STEAM DUMPS', label: 'CONDENSER VACUUM',
    pos: ['NORMAL', 'DEGRADED'],
    read: PL => PL.sec.condPsia > 5 ? 1 : 0,
    write: (PL, v) => { PL.sec.condPsia = v === 1 ? 9.5 : 1.0; },
    lamp: PL => PL.sec.dumpAvail ? 'green' : 'red',
    note: PL => `${PL.sec.condPsia.toFixed(1)} psia`
  },

  // ============================================================ SAFEGUARDS
  ...[0, 1].map(i => ({
    board: 'safeguards', section: 'CHARGING / HIGH HEAD', label: `CHG PUMP ${'AB'[i]}`,
    pos: ['STOP', 'START'],
    read: PL => PL.si.hhOn[i] ? 1 : 0,
    write: (PL, v) => { PL.si.hhOn[i] = v === 1; },
    lamp: PL => PL.si.hhOn[i] ? 'red' : 'green'
  })),
  ...[0, 1].map(i => ({
    board: 'safeguards', section: 'SAFETY INJECTION', label: `SI PUMP ${'AB'[i]}`,
    pos: ['STOP', 'START'],
    read: PL => PL.si.siOn[i] ? 1 : 0,
    write: (PL, v) => { PL.si.siOn[i] = v === 1; },
    lamp: PL => PL.si.siOn[i] ? 'red' : 'green'
  })),
  ...[0, 1].map(i => ({
    board: 'safeguards', section: 'LOW HEAD / RHR', label: `LH PUMP ${'AB'[i]}`,
    pos: ['STOP', 'START'],
    read: PL => PL.si.lhOn[i] ? 1 : 0,
    write: (PL, v) => { PL.si.lhOn[i] = v === 1; },
    lamp: PL => PL.si.lhOn[i] ? 'red' : 'green'
  })),
  {
    board: 'safeguards', section: 'SAFETY INJECTION', label: 'SI ACTUATION',
    pos: ['NORMAL', 'BLOCK'],
    read: PL => PL.si.manualBlock ? 1 : 0,
    write: (PL, v) => { PL.si.manualBlock = v === 1; },
    lamp: PL => PL.si.actuated ? 'red' : 'green',
    note: PL => PL.si.actuated ? `${PL.si.totalGpm.toFixed(0)} gpm` : 'armed'
  },
  ...[0, 1, 2].map(i => ({
    board: 'safeguards', section: 'ACCUMULATORS', label: `ACCUM ${'ABC'[i]}`,
    pos: ['ISOLATED', 'OPEN'],
    read: PL => PL.si.acc[i].isolated ? 0 : 1,
    write: (PL, v) => { PL.si.acc[i].isolated = v === 0; },
    lamp: PL => PL.si.acc[i].discharging ? 'red' : 'green',
    note: PL => `${PL.si.acc[i].psig.toFixed(0)} psig`
  })),

  // =========================================================== CONTAINMENT
  {
    board: 'safeguards', section: 'CONTAINMENT SPRAY', label: 'SPRAY CONTROL',
    pos: ['MANUAL', 'AUTO'],
    read: PL => PL.cnmt.sprayAuto ? 1 : 0,
    write: (PL, v) => { PL.cnmt.sprayAuto = v === 1; },
    lamp: PL => PL.cnmt.sprayGpm > 0 ? 'red' : 'green'
  },
  ...[0, 1].map(i => ({
    board: 'safeguards', section: 'CONTAINMENT SPRAY', label: `SPRAY PUMP ${'AB'[i]}`,
    pos: ['STOP', 'START'],
    read: PL => PL.cnmt.sprayOn[i] ? 1 : 0,
    write: (PL, v) => { PL.cnmt.sprayOn[i] = v === 1; },
    lamp: PL => PL.cnmt.sprayOn[i] ? 'red' : 'green'
  })),
  // Fan coolers carry real heat: cnmt.js removes fanUA * (Tf - sink) per fan.
  ...[0, 1, 2, 3].map(i => ({
    board: 'safeguards', section: 'CONTAINMENT FAN COOLERS', label: `FAN ${i + 1}`,
    pos: ['STOP', 'START'],
    read: PL => PL.cnmt.fansOn[i] ? 1 : 0,
    write: (PL, v) => { PL.cnmt.fansOn[i] = v === 1; },
    lamp: PL => PL.cnmt.fansOn[i] ? 'red' : 'green'
  })),

  // =================================================== RESIDUAL HEAT REMOVAL
  ...[0, 1].map(i => ({
    board: 'safeguards', section: 'RHR TRAINS', label: `RHR ${'AB'[i]} PUMP`,
    pos: ['STOP', 'START'],
    read: PL => PL.rhr.trains[i].pumpOn ? 1 : 0,
    write: (PL, v) => { PL.rhr.trains[i].pumpOn = v === 1; },
    lamp: PL => PL.rhr.trains[i].pumpOn ? 'red' : 'green',
    note: PL => PL.rhr.trains[i].interlocked ? 'INTERLOCKED'
      : `${PL.rhr.trains[i].flowGpm.toFixed(0)} gpm`
  })),
  ...[0, 1].map(i => ({
    board: 'safeguards', section: 'RHR TRAINS', label: `RHR ${'AB'[i]} SUCTION`,
    pos: ['CLOSE', 'OPEN'],
    read: PL => PL.rhr.trains[i].suctionOpen ? 1 : 0,
    write: (PL, v) => { PL.rhr.trains[i].suctionOpen = v === 1; },
    lamp: PL => PL.rhr.trains[i].suctionOpen ? 'red' : 'green',
    note: PL => PL.rhr.trains[i].interlocked ? 'INTERLOCKED' : ''
  })),

  // ============================================================= ELECTRICAL
  // ================================================ ROD POSITION INDICATION
  //  DRPI channel selection is a real handle: with one cabinet out you are not
  //  blind, you are at half resolution, and the operator needs to know which
  //  state the indication is in before trusting a deviation reading.
  ...['A', 'B'].map(ch => ({
    board: 'reactor', section: 'ROD POSITION INDICATION', label: `DRPI CHANNEL ${ch}`,
    pos: ['OFF', 'ON'],
    read: PL => PL.ro.rods.every(r => r['drpi' + ch]) ? 1 : 0,
    write: (PL, v) => PL.ro.rods.forEach(r => { r['drpi' + ch] = v === 1; }),
    lamp: PL => PL.ro.rods.every(r => r['drpi' + ch]) ? 'red' : 'green',
    note: PL => PL.ro.degradedChannels
      ? `±${PL.rop.coilSpacing} steps` : `±${PL.rop.coilSpacing / 2} steps`
  })),
  {
    board: 'reactor', section: 'ROD POSITION INDICATION', label: 'ROD DROP TEST', momentary: true,
    pos: ['NORMAL', 'DROP CD-3'],
    read: PL => PL.ro.rods.some(r => r.dropped) ? 1 : 0,
    write: (PL, v) => {
      const r = PL.ro.rods.find(x => x.id === 'CD-3');
      if (r) { r.dropped = v === 1; if (v === 0) r.actual = r.demand; }
    },
    lamp: PL => PL.ro.anyDropped ? 'red' : 'green',
    note: PL => PL.ro.anyDropped ? 'rod on the bottom' : ''
  },
  {
    board: 'reactor', section: 'ROD POSITION INDICATION', label: 'STUCK ROD',
    pos: ['NORMAL', 'STICK CC-1'],
    read: PL => PL.ro.rods.some(r => r.stuck) ? 1 : 0,
    write: (PL, v) => {
      const r = PL.ro.rods.find(x => x.id === 'CC-1');
      if (r) r.stuck = v === 1;
    },
    lamp: PL => PL.ro.anyStuck ? 'red' : 'green',
    note: PL => PL.ro.anyStuck ? 'not following demand' : ''
  },
  ...['A', 'B'].map(t => ({
    board: 'reactor', section: 'DADS DISPLAY', label: `DISPLAY TRAIN ${t}`,
    pos: ['OUT', 'IN SVC'],
    read: PL => PL.ro['train' + t] ? 1 : 0,
    write: (PL, v) => { PL.ro['train' + t] = v === 1; },
    lamp: PL => PL.ro['train' + t] ? 'red' : 'green',
    note: PL => PL.ro.alarms.displayLost ? 'NO INDICATION' : ''
  })),
  ...[0, 1, 2, 3].map(n => ({
    board: 'reactor', section: 'DADS DISPLAY', label: `DATA CABINET ${n + 1}`,
    pos: ['FAULT', 'NORMAL'],
    read: PL => PL.ro.cabinetOK[n] ? 1 : 0,
    write: (PL, v) => { PL.ro.cabinetOK[n] = v === 1; },
    lamp: PL => PL.ro.cabinetOK[n] ? 'red' : 'green',
    note: PL => PL.ro.cabinetOK[n] ? '12 rods' : '12 rods dark'
  })),
  {
    board: 'reactor', section: 'DADS DISPLAY', label: 'HALF ACCURACY',
    pos: ['NORMAL', 'FORCE CD-1'],
    read: PL => PL.ro.rods.some(r => r.halfAccuracy) ? 1 : 0,
    write: (PL, v) => ROM.setHalfAccuracy(PL.ro, 'CD-1', v === 1),
    lamp: PL => PL.ro.forcedHalf ? 'red' : 'green',
    note: PL => PL.ro.forcedHalf ? `${PL.ro.forcedHalf} rod on 1 channel` : ''
  },
  {
    board: 'reactor', section: 'DADS DISPLAY', label: 'ROD DROP TEST', momentary: true,
    pos: ['OFF', 'START'],
    read: PL => PL.ro.dropTest.running ? 1 : 0,
    write: (PL, v) => { if (v === 1) ROM.startDropTest(PL.ro); },
    lamp: PL => PL.ro.dropTest.running ? 'red' : 'green',
    note: PL => PL.ro.dropTest.done
      ? `${Math.max(...PL.ro.dropTest.times.filter(t => t !== null)).toFixed(2)} s`
      : 'needs a trip'
  },
  {
    board: 'reactor', section: 'ROD POSITION INDICATION', label: 'ROD MOTION',
    pos: ['INHIBIT', 'PERMIT'],
    read: PL => PL.rodInhibit ? 0 : 1,
    write: (PL, v) => { PL.rodInhibit = v === 0; },
    lamp: PL => PL.rodInhibit ? 'green' : 'red',
    note: PL => PL.rodInhibit ? 'banks frozen' : `${PL.banks.ctrlDemand.toFixed(0)} steps`
  },

  // ================================================ VALVE LINEUP
  //  Every pump here already had a start/stop handle; none of them had a
  //  DISCHARGE VALVE.  Those are separate switches on a real board because a
  //  pump running against a shut valve is a pump doing nothing, and the board
  //  has to be able to show that: pump lamp red, flow indication zero.
  ...['A', 'B'].map((L, i) => ({
    board: 'safeguards', section: 'HIGH HEAD DISCHARGE', label: `HH ${L} DISCH`,
    pos: ['SHUT', 'OPEN'],
    read: PL => PL.si.hhValve[i] ? 1 : 0,
    write: (PL, v) => { PL.si.hhValve[i] = v === 1; },
    lamp: PL => PL.si.hhValve[i] ? 'red' : 'green',
    note: PL => PL.si.hhOn[i] && !PL.si.hhValve[i] ? 'DEADHEADED' : ''
  })),
  ...['A', 'B'].map((L, i) => ({
    board: 'safeguards', section: 'HIGH HEAD DISCHARGE', label: `SI ${L} DISCH`,
    pos: ['SHUT', 'OPEN'],
    read: PL => PL.si.siValve[i] ? 1 : 0,
    write: (PL, v) => { PL.si.siValve[i] = v === 1; },
    lamp: PL => PL.si.siValve[i] ? 'red' : 'green',
    note: PL => PL.si.siOn[i] && !PL.si.siValve[i] ? 'DEADHEADED' : ''
  })),
  ...['A', 'B'].map((L, i) => ({
    board: 'safeguards', section: 'HIGH HEAD DISCHARGE', label: `LH ${L} DISCH`,
    pos: ['SHUT', 'OPEN'],
    read: PL => PL.si.lhValve[i] ? 1 : 0,
    write: (PL, v) => { PL.si.lhValve[i] = v === 1; },
    lamp: PL => PL.si.lhValve[i] ? 'red' : 'green',
    note: PL => PL.si.lhOn[i] && !PL.si.lhValve[i] ? 'DEADHEADED' : ''
  })),
  ...[0, 1, 2].map(i => ({
    board: 'safeguards', section: 'ACCUMULATOR ISOLATION',
    label: `ACCUM ${'ABC'[i]} ISOL`,
    pos: ['SHUT', 'OPEN'],
    read: PL => PL.si.acc[i].isolated ? 0 : 1,
    // Written directly rather than through a wired API.  Routing plain state
    // through SIAPI meant the handle did nothing at all unless index.html had
    // called wireSI first, so it was inert in every test and would have been
    // inert in any other host.  Indirection is for functions with side effects,
    // not for setting a boolean.
    write: (PL, v) => { PL.si.acc[i].isolated = v === 0; },
    lamp: PL => PL.si.acc[i].isolated ? 'green' : 'red',
    note: PL => PL.si.acc[i].discharging
      ? `${PL.si.acc[i].flowGpm.toFixed(0)} gpm`
      : (PL.si.acc[i].empty ? 'empty' : `${PL.si.acc[i].psig.toFixed(0)} psig`)
  })),

  //  Letdown runs through three parallel orifices, which is how letdown flow is
  //  actually adjusted.  It used to be a constant that nothing could change.
  ...[0, 1, 2].map(i => ({
    board: 'rcs', section: 'LETDOWN ORIFICES', label: `ORIFICE ${i + 1}`,
    pos: ['SHUT', 'OPEN'],
    read: PL => PL.cv.orifice[i] ? 1 : 0,
    write: (PL, v) => { PL.cv.orifice[i] = v === 1; },
    lamp: PL => PL.cv.orifice[i] ? 'red' : 'green'
  })),
  {
    board: 'rcs', section: 'LETDOWN ORIFICES', label: 'LETDOWN ISOL',
    pos: ['SHUT', 'OPEN'],
    read: PL => PL.cv.letdownIsol ? 1 : 0,
    write: (PL, v) => { PL.cv.letdownIsol = v === 1; },
    lamp: PL => PL.cv.letdownIsol ? 'red' : 'green',
    note: PL => `${PL.cv.letdownGpm.toFixed(0)} gpm`
  },
  {
    board: 'rcs', section: 'CHARGING', label: 'CHARGING ISOL',
    pos: ['SHUT', 'OPEN'],
    read: PL => PL.cv.chargingIsol ? 1 : 0,
    write: (PL, v) => { PL.cv.chargingIsol = v === 1; },
    lamp: PL => PL.cv.chargingIsol ? 'red' : 'green',
    note: PL => `${PL.cv.chargeGpm.toFixed(0)} gpm`
  },
  {
    board: 'rcs', section: 'CHARGING', label: 'SEAL INJECTION',
    pos: ['SHUT', 'OPEN'],
    read: PL => PL.cv.sealInjection ? 1 : 0,
    write: (PL, v) => { PL.cv.sealInjection = v === 1; },
    lamp: PL => PL.cv.sealInjection ? 'red' : 'green',
    note: PL => PL.cv.sealInjection ? 'to RCP seals' : 'RCP seals dry'
  },
  {
    board: 'rcs', section: 'CHARGING', label: 'BORIC ACID ISOL',
    pos: ['SHUT', 'OPEN'],
    read: PL => PL.cv.baIsol ? 1 : 0,
    write: (PL, v) => { PL.cv.baIsol = v === 1; },
    lamp: PL => PL.cv.baIsol ? 'red' : 'green',
    note: PL => PL.cv.baIsol ? `${(PL.cv.baTankGal / 1000).toFixed(0)}k gal` : 'no borate path'
  },

  // ================================================ RADIATION MONITORING
  //  Blowdown isolation is the awkward one: isolating on high activity is
  //  correct for release control, and it also removes the sample path -- so the
  //  action costs you the monitor that told you to take it.  The handle has to
  //  be here for that reason, not despite it.
  ...[0, 1, 2].map(i => ({
    board: 'cooling', section: 'SG BLOWDOWN', label: `SG ${'ABC'[i]} TUBE LEAK`,
    pos: ['NONE', '1 GPM', '25 GPM'],
    read: PL => PL.rd.sgLeakGpm[i] > 10 ? 2 : (PL.rd.sgLeakGpm[i] > 0 ? 1 : 0),
    write: (PL, v) => RDM.setTubeLeak(PL.rd, i, [0, 1, 25][v]),
    lamp: PL => PL.rd.sgLeakGpm[i] > 0 ? 'red' : 'green',
    note: PL => PL.rd.sgLeakGpm[i] > 0
      ? `${PL.rd.sgLeakGpm[i].toFixed(0)} gpm`
      : `bd ${PL.rd.blowdown[i].r.toFixed(1)}x`
  })),
  {
    board: 'cooling', section: 'SG BLOWDOWN', label: 'BLOWDOWN ISOL',
    pos: ['ISOLATE', 'OPEN'],
    read: PL => PL.rd.blowdownIsolated ? 0 : 1,
    write: (PL, v) => {
      PL.rd.blowdownIsolated = v === 0;
      if (v === 1) PL.rd.bdArmed = false;      // re-arm only after a real reset
    },
    lamp: PL => PL.rd.blowdownIsolated ? 'green' : 'red',
    note: PL => PL.rd.blowdownIsolated ? 'no sample path' : 'sampling'
  },
  {
    board: 'cooling', section: 'SG BLOWDOWN', label: 'LETDOWN HX LEAK',
    pos: ['NONE', 'LEAKING'],
    read: PL => PL.rd.letdownHxLeakGpm > 0 ? 1 : 0,
    write: (PL, v) => RDM.setLetdownHxLeak(PL.rd, v === 1 ? 0.4 : 0),
    lamp: PL => PL.rd.letdownHxLeakGpm > 0 ? 'red' : 'green',
    note: PL => `${(PL.cw.activityUCiMl * 1e3).toFixed(2)} nCi/ml`
  },
  {
    board: 'safeguards', section: 'CONTROL ROOM HVAC', label: 'CR VENTILATION',
    pos: ['ISOLATE', 'NORMAL'],
    read: PL => PL.rd.crIsolated ? 0 : 1,
    write: (PL, v) => {
      PL.rd.crIsolated = v === 0;
      if (v === 1) PL.rd.crArmed = false;
    },
    lamp: PL => PL.rd.crIsolated ? 'green' : 'red',
    note: PL => `intake ${PL.rd.crIntake.r.toFixed(1)}x`
  },

  // ================================================ TRIP SWITCHES
  //  Both of these already existed as functions -- the scram button in the
  //  header and the RPS turbine-trip input -- but neither had a HANDLE on the
  //  board, which is where an operator would actually reach for them.  They
  //  are spring-return-to-normal, so they read NORMAL and are momentary: you
  //  cannot leave a trip switch sitting in the tripped position.
  {
    board: 'reactor', section: 'REACTOR TRIP', label: 'MANUAL TRIP', key: true, momentary: true,
    pos: ['NORMAL', 'TRIP'],
    read: () => 0,
    write: (PL, v) => {
      if (v !== 1) return;
      PL.trip = true;
      PL.tripMsg = 'MANUAL TRIP';
      if (!PL.tripFirst) PL.tripFirst = 'MANUAL TRIP';
    },
    lamp: PL => PL.trip ? 'red' : 'green',
    note: PL => PL.trip ? (PL.tripFirst || 'tripped') : 'reactor on line'
  },
  {
    board: 'secondary', section: 'TURBINE', label: 'TURBINE TRIP', momentary: true,
    pos: ['NORMAL', 'TRIP'],
    read: () => 0,
    write: (PL, v) => { if (v === 1) { PL.sec.tripped = true; PL.sec.online = false; } },
    lamp: PL => PL.sec.tripped ? 'red' : 'green',
    note: PL => PL.sec.tripped ? 'tripped' : `${PL.sec.MWe.toFixed(0)} MWe`
  },
  {
    board: 'secondary', section: 'TURBINE', label: 'LOAD LIMIT',
    pos: ['100%', '75%', '50%'],
    read: PL => PL.sec.loadSet >= 0.95 ? 0 : (PL.sec.loadSet >= 0.7 ? 1 : 2),
    write: (PL, v) => { PL.sec.loadSet = [1.0, 0.75, 0.5][v]; },
    lamp: PL => PL.sec.online ? 'red' : 'green',
    note: PL => `${(PL.sec.loadSet * 100).toFixed(0)}% demand`
  },

  // ================================================ CONDENSER & CONDENSATE
  ...[0, 1, 2].map(i => ({
    board: 'cooling', section: 'CIRCULATING WATER', label: `CIRC WTR PUMP ${i + 1}`,
    pos: ['STOP', 'START'],
    read: PL => PL.cd.cwPumpOn[i] ? 1 : 0,
    write: (PL, v) => { PL.cd.cwPumpOn[i] = v === 1; },
    lamp: PL => PL.cd.cwPumpSpeed[i] > 0.5 ? 'red' : 'green',
    note: PL => PL.cd.cwPumpSpeed[i] > 0.5 ? `${(PL.cdp.cwPumpGpm / 1000).toFixed(0)}k gpm` : 'stopped'
  })),
  ...[0, 1].map(i => ({
    board: 'cooling', section: 'CONDENSER AIR REMOVAL', label: `AIR EJECTOR ${'AB'[i]}`,
    pos: ['OFF', 'ON'],
    read: PL => PL.cd.ejectorOn[i] ? 1 : 0,
    write: (PL, v) => { PL.cd.ejectorOn[i] = v === 1; },
    lamp: PL => PL.cd.ejectorOn[i] ? 'red' : 'green',
    note: PL => `${(PL.cd.airBurden * 100).toFixed(0)}% burden`
  })),
  {
    board: 'cooling', section: 'CONDENSER AIR REMOVAL', label: 'AIR IN-LEAKAGE',
    pos: ['NORMAL', 'FAULT'],
    read: PL => PL.cd.airInleakScfm > PL.cdp.airInleakScfm * 1.2 ? 1 : 0,
    write: (PL, v) => { PL.cd.airInleakScfm = v === 1 ? 34 : PL.cdp.airInleakScfm; },
    lamp: PL => PL.cd.alarms.airInleakHi ? 'red' : 'green',
    note: PL => `${PL.cd.airInleakScfm.toFixed(0)} scfm`
  },
  {
    board: 'cooling', section: 'CONDENSER AIR REMOVAL', label: 'TUBE FOULING',
    pos: ['CLEAN', 'FOULED'],
    read: PL => PL.cd.tubeFoul > 0.4 ? 1 : 0,
    write: (PL, v) => { PL.cd.tubeFoul = v === 1 ? 0.85 : 0.05; },
    lamp: PL => PL.cd.alarms.fouled ? 'red' : 'green',
    note: PL => `TTD ${PL.cd.ttdF.toFixed(1)} \u00b0F`
  },
  ...[0, 1, 2].map(i => ({
    board: 'cooling', section: 'CONDENSATE', label: `COND PUMP ${i + 1}`,
    pos: ['STOP', 'AUTO', 'START'],
    read: PL => PL.cd.condPumpOn[i] ? 2 : (PL.cd.condPumpAuto[i] ? 1 : 0),
    write: (PL, v) => { PL.cd.condPumpAuto[i] = v === 1; PL.cd.condPumpOn[i] = v === 2; },
    lamp: PL => PL.cd.condPumpOn[i] ? 'red' : 'green',
    note: PL => PL.cd.condPumpOn[i] ? 'running' : (PL.cd.condPumpAuto[i] ? 'standby' : 'stopped')
  })),

  // ============================================ COMPONENT COOLING & SERVICE WATER
  //  The standby pump switch has three positions, not two, because AUTO is a
  //  real and distinct handle position on this equipment: the pump is stopped
  //  but armed, and the lamp is green while the plant is one signal away from
  //  starting it.  Collapsing AUTO into STOP would hide the single most
  //  important thing about a standby train.
  ...[0, 1, 2].map(i => ({
    board: 'cooling', section: 'COMPONENT COOLING PUMPS', label: `CCW PUMP ${i + 1}`,
    pos: ['STOP', 'AUTO', 'START'],
    read: PL => PL.cw.pumpOn[i] ? 2 : (PL.cw.pumpAuto[i] ? 1 : 0),
    write: (PL, v) => {
      PL.cw.pumpAuto[i] = v === 1;
      PL.cw.pumpOn[i] = v === 2;
    },
    lamp: PL => PL.cw.pumpSpeed[i] > 0.5 ? 'red' : 'green',
    note: PL => PL.cw.pumpSpeed[i] > 0.5
      ? `${(PL.cwp.pumpGpm / 1000).toFixed(0)}k gpm`
      : (PL.cw.pumpAuto[i] ? 'standby' : 'stopped')
  })),
  ...[0, 1].map(i => ({
    board: 'cooling', section: 'COMPONENT COOLING PUMPS', label: `CCW HX ${'AB'[i]}`,
    pos: ['OUT', 'IN SVC'],
    read: PL => PL.cw.hxInService[i] ? 1 : 0,
    write: (PL, v) => { PL.cw.hxInService[i] = v === 1; },
    lamp: PL => PL.cw.hxInService[i] ? 'red' : 'green'
  })),
  {
    board: 'cooling', section: 'COMPONENT COOLING PUMPS', label: 'CCW HEADER',
    pos: ['ISOLATE', 'NORMAL'],
    read: PL => PL.cw.isolated ? 0 : 1,
    write: (PL, v) => { if (v === 1) CWM.restoreCCW(PL.cw); else CWM.loseCCW(PL.cw); },
    lamp: PL => PL.cw.isolated ? 'green' : 'red',
    note: PL => `${PL.cw.supplyF.toFixed(0)} \u00b0F supply`
  },
  ...[0, 1, 2].map(i => ({
    board: 'cooling', section: 'SERVICE WATER PUMPS', label: `SW PUMP ${i + 1}`,
    pos: ['STOP', 'AUTO', 'START'],
    read: PL => PL.cw.swPumpOn[i] ? 2 : (PL.cw.swPumpAuto[i] ? 1 : 0),
    write: (PL, v) => { PL.cw.swPumpAuto[i] = v === 1; PL.cw.swPumpOn[i] = v === 2; },
    lamp: PL => PL.cw.swPumpOn[i] ? 'red' : 'green',
    note: PL => PL.cw.swPumpOn[i] ? 'running' : (PL.cw.swPumpAuto[i] ? 'standby' : 'stopped')
  })),
  {
    board: 'cooling', section: 'SERVICE WATER PUMPS', label: 'STRAINER BACKWASH', momentary: true,
    pos: ['OFF', 'BACKWASH'],
    read: () => 0,
    write: (PL, v) => { if (v === 1) PL.cw.strainerFoul = 0.08; },
    lamp: PL => PL.cw.strainerDP > 1.6 ? 'red' : 'green',
    note: PL => `${PL.cw.strainerDP.toFixed(2)} psid`
  },

  {
    board: 'electrical', section: 'GENERATOR', label: 'GEN BREAKER',
    pos: ['OPEN', 'CLOSE'],
    read: PL => PL.E.genBkr ? 1 : 0,
    write: (PL, v, api) => { if (v === 1) api.closeGenBreaker(PL.E); else PL.E.genBkr = false; },
    lamp: PL => PL.E.genBkr ? 'red' : 'green',
    note: PL => PL.E.tripped ? 'TRIPPED' : `${PL.E.MWe.toFixed(0)} MWe`
  },
  {
    board: 'electrical', section: 'AUXILIARY POWER', label: 'UAT BREAKER',
    pos: ['OPEN', 'CLOSE'],
    read: PL => PL.E.uatBkr ? 1 : 0,
    write: (PL, v) => { PL.E.uatBkr = v === 1; },
    lamp: PL => PL.E.uatBkr ? 'red' : 'green'
  },
  {
    board: 'electrical', section: 'AUXILIARY POWER', label: 'SAT BREAKER',
    pos: ['OPEN', 'CLOSE'],
    read: PL => PL.E.satBkr ? 1 : 0,
    write: (PL, v) => { PL.E.satBkr = v === 1; },
    lamp: PL => PL.E.satBkr ? 'red' : 'green'
  },
  {
    board: 'electrical', section: 'OFFSITE POWER', label: 'OFFSITE SUPPLY',
    pos: ['LOST', 'AVAILABLE'],
    read: PL => PL.E.gridAvail ? 1 : 0,
    write: (PL, v, api) => { v === 1 ? api.restoreOffsite(PL.E) : api.loseOffsite(PL.E); },
    lamp: PL => PL.E.gridAvail ? 'red' : 'green'
  },
  ...[0, 1].map(i => ({
    board: 'electrical', section: 'EMERGENCY DIESELS', label: `DIESEL ${i + 1}`,
    pos: ['STOP', 'AUTO', 'START'],
    read: PL => PL.E.edg[i].startSignal ? 2 : (PL.E.edg[i].autoStart ? 1 : 0),
    write: (PL, v) => {
      const d = PL.E.edg[i];
      d.autoStart = v >= 1;
      d.startSignal = v === 2;
      if (v === 0) { d.startSignal = false; d.fired = false; }
    },
    lamp: PL => PL.E.edg[i].running ? 'red' : 'green',
    note: PL => {
      const d = PL.E.edg[i];
      return d.tripped ? 'FAILED'
        : d.running ? `${d.rpm.toFixed(0)} rpm  ${d.loadMW.toFixed(1)} MW`
        : `air ${d.airPsi.toFixed(0)} psi`;
    }
  })),

  // ============================================ REACTOR PROTECTION (keylocks)
  {
    board: 'reactor', section: 'ROD CONTROL', label: 'ROD CONTROL',
    pos: ['MANUAL', 'AUTO'],
    read: PL => PL.rodAuto ? 1 : 0,
    write: (PL, v) => { PL.rodAuto = v === 1; },
    lamp: PL => PL.rodAuto ? 'green' : 'red'
  },
  {
    board: 'reactor', section: 'REACTOR PROTECTION', label: 'TRIP BYPASS',
    kind: 'key',
    pos: ['NORMAL', 'BYPASS'],
    read: PL => PL.rps.tripBypassed ? 1 : 0,
    write: (PL, v) => { PL.rps.tripBypassed = v === 1; },
    lamp: PL => PL.rps.tripBypassed ? 'red' : 'green',
    note: () => 'keylock'
  },
  // Channel bypass is keylocked in reality.  Bypassing a channel across every
  // protection parameter is what a real bypass switch does, so that is what
  // this writes -- all 13 parameters for that channel at once.
  ...[0, 1, 2, 3].map(i => ({
    board: 'reactor', section: 'PROTECTION CHANNEL BYPASS',
    label: `CHANNEL ${['I', 'II', 'III', 'IV'][i]}`,
    kind: 'key',
    pos: ['NORMAL', 'BYPASS'],
    read: PL => {
      const ps = Object.keys(PL.rps.params);
      return PL.rps.params[ps[0]].ch[i].state === 'bypass' ? 1 : 0;
    },
    write: (PL, v, api) => {
      for (const id of Object.keys(PL.rps.params)) {
        api.setChannel(PL.rps, id, i, v === 1 ? 'bypass' : 'normal');
      }
    },
    lamp: PL => {
      const ps = Object.keys(PL.rps.params);
      return PL.rps.params[ps[0]].ch[i].state === 'bypass' ? 'red' : 'green';
    },
    note: PL => {
      let f = 0;
      for (const id of Object.keys(PL.rps.params)) {
        if (PL.rps.params[id].ch[i].state === 'fail') f++;
      }
      return f ? `${f} failed` : 'keylock';
    }
  }))
];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** One switch: legend plate, indicating lamps, handle on its escutcheon. */
function switchHTML(PL, sw, idx) {
  let cur = 0, lamp = 'off', note = '';
  try { cur = sw.read(PL) | 0; } catch (e) { cur = 0; }
  try { lamp = sw.lamp ? sw.lamp(PL) : 'off'; } catch (e) { lamp = 'off'; }
  try { note = sw.note ? (sw.note(PL) || '') : ''; } catch (e) { note = ''; }

  const n = sw.pos.length;
  // handle sweeps -46deg .. +46deg across the available positions
  const ang = n <= 1 ? 0 : -46 + 92 * (cur / (n - 1));
  const kind = sw.kind === 'key' ? ' key' : '';

  const positions = sw.pos.map((label, i) =>
    `<button class="swp${i === cur ? ' sel' : ''}" data-sw="${idx}" data-pos="${i}"
       aria-pressed="${i === cur}">${esc(label)}</button>`).join('');

  return `<div class="sw${kind}">
    <div class="swlabel">${esc(sw.label)}</div>
    <div class="swhead">
      <span class="lamp red${lamp === 'red' ? ' lit' : ''}" title="running / open"></span>
      <span class="lamp grn${lamp === 'green' ? ' lit' : ''}" title="stopped / closed"></span>
      <button class="escut" data-sw="${idx}" data-pos="next"
        aria-label="${esc(sw.label)} — ${esc(sw.pos[cur])}, tap to change">
        <i class="handle" style="transform:rotate(${ang.toFixed(1)}deg)"></i>
      </button>
    </div>
    <div class="swpos">${positions}</div>
    <div class="swnote">${esc(note)}</div>
  </div>`;
}

/** Every switch for one board, grouped under engraved section labels. */
export function switchBank(PL, board) {
  const mine = SWITCHES.map((s, i) => [s, i]).filter(([s]) => s.board === board);
  if (!mine.length) return '';
  const secs = [];
  for (const [s, i] of mine) {
    let g = secs.find(x => x.name === s.section);
    if (!g) { g = { name: s.section, items: [] }; secs.push(g); }
    g.items.push([s, i]);
  }
  return `<div class="swbank">` + secs.map(g => `<div class="swsec">
    <div class="swseclabel">${esc(g.name)}</div>
    <div class="swgrid">${g.items.map(([s, i]) => switchHTML(PL, s, i)).join('')}</div>
  </div>`).join('') + `</div>`;
}

/** Apply a switch action. pos is an index, or 'next' to advance the handle. */
export function actuate(PL, idx, pos, api) {
  const sw = SWITCHES[idx];
  if (!sw) return false;
  let target;
  if (pos === 'next') {
    let cur = 0;
    try { cur = sw.read(PL) | 0; } catch (e) { cur = 0; }
    target = (cur + 1) % sw.pos.length;
  } else target = Math.max(0, Math.min(sw.pos.length - 1, pos | 0));
  // Failures are REPORTED, not swallowed.  This used to return false on any
  // exception and callers ignored the return value, so a switch whose write
  // threw -- a missing api, a bad import -- looked exactly like a switch that
  // worked. That is how nine dead handles went unnoticed.
  try {
    sw.write(PL, target, api);
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn)
      console.warn(`switch "${sw.label}" write failed:`, e && e.message);
    return false;
  }
  return true;
}

export function switchCount(board) {
  return board ? SWITCHES.filter(s => s.board === board).length : SWITCHES.length;
}
