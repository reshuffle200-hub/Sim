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

const bool = (get, set) => ({ get, set });

// Wired in by index.html, like the other switch APIs, so this table stays a
// description of the BOARD and does not become a second place that knows how
// the plant is plumbed.
export const CCWAPI = { loseCCW: () => {}, restoreCCW: () => {} };
export function wireCCW(api) { Object.assign(CCWAPI, api); }

/**
 * Switch specifications.
 *   board     which board it appears on
 *   section   engraved section label it sits under
 *   label     engraved legend plate
 *   pos       position legends, in handle order
 *   read(PL)  current handle position index (the DEMAND)
 *   write     (PL, i) => void
 *   lamp(PL)  'red' | 'green' | 'off' -- what the equipment IS doing
 *   note(PL)  optional short status line
 */
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
    write: (PL, v) => { if (v === 1) CCWAPI.restoreCCW(PL.cw); else CCWAPI.loseCCW(PL.cw); },
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
    board: 'cooling', section: 'SERVICE WATER PUMPS', label: 'STRAINER BACKWASH',
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
  return secs.map(g => `<div class="swsec">
    <div class="swseclabel">${esc(g.name)}</div>
    <div class="swgrid">${g.items.map(([s, i]) => switchHTML(PL, s, i)).join('')}</div>
  </div>`).join('');
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
  try { sw.write(PL, target, api); } catch (e) { return false; }
  return true;
}

export function switchCount(board) {
  return board ? SWITCHES.filter(s => s.board === board).length : SWITCHES.length;
}
