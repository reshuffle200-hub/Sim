// ======================================================================
//  alarms.js — annunciator engine, shared by every board
//
//  Sequence: a new alarm flashes until acknowledged, then goes steady.
//  The FIRST alarm of a group latches separately and stays marked, because
//  after a trip the initiating window is the only one worth reading -- the
//  other twenty are consequences.
//
//  WHY THERE ARE SO MANY WINDOWS.  A real board does not have one SG LEVEL LOW
//  window; it has one per steam generator, because "which one" is the first
//  question an operator asks and a shared window cannot answer it.  The same
//  goes for loops, safeguards trains, diesels, buses and protection channels.
//  Every window below reads a distinct piece of plant state -- none is
//  decorative, and de-aggregating is the whole reason the count is high.
//
//  Windows are grouped into SECTIONS matching how a board is physically laid
//  out, and first-out latches per section, so a feedwater upset and an
//  electrical upset each keep their own initiating window.
// ======================================================================

import { RPS_PARAMS } from '../lib/rps.js';
import { GROUPS as ROD_GROUPS } from '../lib/rods.js';

const LOOP = ['A', 'B', 'C'];
const AB = ['A', 'B'];

/** Short window legends for the protection functions. */
const RPS_SHORT = {
  pwrHi:'PWR RANGE FLUX', otdt:'OVERTEMP dT', opdt:'OVERPOWER dT',
  pzrHi:'PZR PRESS HI', pzrLo:'PZR PRESS LO', pzrLvl:'PZR LEVEL HI',
  sgLoLo:'SG LEVEL LO-LO', flowLo:'RCS FLOW LO', cnmtHi:'CNMT PRESS HI',
  slLo:'STM LINE PRESS LO', turbTrip:'TURBINE TRIP', uv:'BUS UNDERVOLT',
  cnmtHiHi:'CNMT PRESS HI-HI'
};

/** Build one window per item of a family: per loop, per train, per channel. */
const per = (items, fn) => items.flatMap(fn);

export const ALARMS = [
  // ---------------------------------------------------------- reactor / RPS
  ['REACTOR TRIP',        'all', p => p.trip, 'bad', 'REACTOR & PROTECTION'],
  ['TURBINE TRIP',        'all', p => p.sec.tripped, 'bad', 'REACTOR & PROTECTION'],
  ['RPS TRIP BYPASSED',   'rx',  p => p.rps && p.rps.tripBypassed, '', 'REACTOR & PROTECTION'],
  ['HIGH FLUX',           'rx',  p => p.k.P > 1.08, 'bad', 'REACTOR & PROTECTION'],
  ['OT dT',               'rx',  p => p.f.otdtTrip, 'bad', 'REACTOR & PROTECTION'],
  ['OP dT',               'rx',  p => p.f.opdtTrip, 'bad', 'REACTOR & PROTECTION'],
  ['OT dT MARGIN LOW',    'rx',  p => (p.f.otdtMargin ?? 99) < 5, '', 'REACTOR & PROTECTION'],
  ['OP dT MARGIN LOW',    'rx',  p => (p.f.opdtMargin ?? 99) < 5, '', 'REACTOR & PROTECTION'],
  ['LOW DNBR',            'rx',  p => (p.dnbr ?? 9) < 1.5, 'bad', 'REACTOR & PROTECTION'],
  ['DNBR AT LIMIT',       'rx',  p => (p.dnbr ?? 9) < 1.3, 'bad', 'REACTOR & PROTECTION'],
  ['Tavg DEVIATION',      'rx',  p => Math.abs(p.S.Tavg - p.Tref) > 4, '', 'REACTOR & PROTECTION'],
  ['Tavg HIGH',           'rx',  p => p.S.Tavg > 590, '', 'REACTOR & PROTECTION'],
  ['ROD BOTTOM',          'rx',  p => p.banks.ctrlDemand < 5, '', 'REACTOR & PROTECTION'],
  ['ROD BANK HIGH LIMIT', 'rx',  p => p.banks.ctrlDemand > 520, '', 'REACTOR & PROTECTION'],
  ['RODS IN MANUAL',      'rx',  p => !p.rodAuto, '', 'REACTOR & PROTECTION'],
  ['P-11 BLOCK',          'rcs', p => p.rps && p.rps.p11Block, '', 'REACTOR & PROTECTION'],
  ['PARTIAL TRIP',        'rx',  p => p.rps && p.rps.alarms && p.rps.alarms.partialTrip, '', 'REACTOR & PROTECTION'],
  ['CHANNEL BYPASSED',    'rx',  p => p.rps && p.rps.alarms && p.rps.alarms.anyBypassed, '', 'REACTOR & PROTECTION'],
  ['CHANNEL FAILED',      'rx',  p => p.rps && p.rps.alarms && p.rps.alarms.anyFailed, 'bad', 'REACTOR & PROTECTION'],

  // ---------------------------------------------- protection channels (bistables)
  //  A real board carries a window per protection FUNCTION for the partial
  //  trip and another for channel status, because "one channel is calling for
  //  a trip" and "one channel is out of service" are the two things that
  //  change what the coincidence logic will do next.  Thirteen functions, each
  //  with three or four independent channels, is where a genuine board gets
  //  most of its window count.
  //  The aggregated PART TRIP and CH INOP windows stay, because "this function
  //  is one channel from actuating" is a summary an operator wants at a glance.
  //  But they cannot answer WHICH channel, and which channel is what determines
  //  whether the next failure trips the plant or defeats the function: with one
  //  channel already bypassed, a two-of-four becomes a two-of-three, and a
  //  second bypass in the same function leaves it unable to actuate at all.
  ...per(RPS_PARAMS, spec => {
    const nm = RPS_SHORT[spec.id] || spec.name;
    return [
      [`${nm} PART TRIP`, 'rx',
        p => { const q = p.rps && p.rps.params[spec.id];
               return !!q && q.nTripped > 0 && !q.coincidence; },
        '', 'PROTECTION CHANNELS'],
      [`${nm} CH INOP`, 'rx',
        p => { const q = p.rps && p.rps.params[spec.id];
               return !!q && q.ch.some(c => c.state !== 'normal'); },
        '', 'PROTECTION CHANNELS']
    ];
  }),

  //  Per-channel windows, one bay per channel rather than one bay per function.
  //  A real board is wired this way round: all of channel I's bistables sit
  //  together on the channel I panel, because when you take a protection rack
  //  out of service you want to see everything you just defeated in one place.
  ...per([0, 1, 2, 3], c => per(RPS_PARAMS.filter(sp => sp.ch > c), spec => {
    const nm = RPS_SHORT[spec.id] || spec.name;
    const rom = ['I', 'II', 'III', 'IV'][c];
    return [
      [`${nm} ${rom}`, 'rx',
        p => { const q = p.rps && p.rps.params[spec.id];
               return !!q && !!q.ch[c] && (q.ch[c].tripped || q.ch[c].state !== 'normal'); },
        '', `PROTECTION CHANNEL ${rom}`]
    ];
  })),

  // -------------------------------------------------- nuclear instrumentation
  //  Source range is blocked and de-energised above P-6.  Being off scale at
  //  power is what is SUPPOSED to happen, so annunciating it meant two windows
  //  lit for the entire time the plant was at power.  Gated on reactor power
  //  rather than on `su.blocked`, which is an operator action and stays false
  //  through a normal ascent.
  ['SR HIGH FLUX',        'rx',
    p => p.su && p.su.alarms.srHi && p.k.Ptot < 1e-4, '', 'NUCLEAR INSTRUMENTATION'],
  ['SR OFF SCALE',        'rx',
    p => p.su && p.su.alarms.offScale && p.k.Ptot < 1e-4, '', 'NUCLEAR INSTRUMENTATION'],
  ['STARTUP RATE HIGH',   'rx',  p => p.su && p.su.alarms.surHi, '', 'NUCLEAR INSTRUMENTATION'],
  ['STARTUP RATE TRIP',   'rx',  p => p.su && p.su.alarms.surTrip, 'bad', 'NUCLEAR INSTRUMENTATION'],
  ['APPROACHING CRITICAL','rx',  p => p.su && p.su.alarms.critical, 'ok', 'NUCLEAR INSTRUMENTATION'],
  ['PR BELOW RANGE',      'rx',  p => p.su && !p.su.onScalePR, '', 'NUCLEAR INSTRUMENTATION'],

  // --------------------------------------------------------------- pressurizer
  ['PZR PRESS HIGH',      'rcs', p => p.z.alarms.pHi, '', 'PRESSURIZER'],
  ['PZR PRESS LOW',       'rcs', p => p.z.alarms.pLo, '', 'PRESSURIZER'],
  ['PZR PRESS HI TRIP',   'rcs', p => p.z.alarms.pHiTrip, 'bad', 'PRESSURIZER'],
  ['PZR PRESS LO TRIP',   'rcs', p => p.z.alarms.pLoTrip, 'bad', 'PRESSURIZER'],
  ['PZR LEVEL HIGH',      'rcs', p => p.z.alarms.lvlHi, '', 'PRESSURIZER'],
  ['PZR LEVEL LOW',       'rcs', p => p.z.alarms.lvlLo, '', 'PRESSURIZER'],
  ['PZR LEVEL HI TRIP',   'rcs', p => p.z.alarms.lvlHiTrip, 'bad', 'PRESSURIZER'],
  ['HEATERS UNCOVERED',   'rcs', p => p.z.alarms.heatersUncovered, 'bad', 'PRESSURIZER'],
  ['HEATERS OFF',         'rcs', p => !p.z.heatersOn, '', 'PRESSURIZER'],
  ['PZR MANUAL CONTROL',  'rcs', p => p.z.mode !== 'auto', '', 'PRESSURIZER'],
  ['SPRAY IN MANUAL',     'rcs', p => !p.z.sprayAuto, '', 'PRESSURIZER'],
  ['SOLID PLANT',         'rcs', p => p.z.alarms.solidPlant, 'bad', 'PRESSURIZER'],
  ['LTOP ARMED',          'rcs', p => p.z.alarms.ltopArmed, 'ok', 'PRESSURIZER'],
  ['RELIEF FLOW',         'rcs', p => p.z.alarms.reliefFlow, '', 'PRESSURIZER'],
  ...per([0, 1], i => [
    [`PORV ${i + 1} OPEN`,   'rcs', p => p.z.porvOpen[i], 'bad', 'PRESSURIZER'],
    [`PORV ${i + 1} BLOCKED`,'rcs', p => !p.z.porvBlock[i], '', 'PRESSURIZER'],
    [`PORV ${i + 1} STUCK`,  'rcs', p => p.z.porvStuck[i], 'bad', 'PRESSURIZER']
  ]),
  ['PZR SAFETY OPEN',     'rcs', p => p.z.safetyOpen.some(Boolean), 'bad', 'PRESSURIZER'],
  ['PRT PRESS HIGH',      'rcs', p => p.z.alarms.prtHiPress, '', 'PRESSURIZER'],
  ['PRT RUPTURED',        'rcs', p => p.z.prtRuptured, 'bad', 'PRESSURIZER'],

  // ------------------------------------------------------------ reactor coolant
  ['LOW SUBCOOLING',      'rcs', p => p.S.subcooling < 25, 'bad', 'REACTOR COOLANT'],
  //  Set at 50 F against a normal full-power subcooling of 43 F, so it was lit
  //  whenever the plant was running correctly.  The subcooling monitor exists
  //  to warn that margin to saturation is being LOST; 25 F is where that starts
  //  to mean something.
  ['SUBCOOLING MARGIN',   'rcs', p => p.S.subcooling < 25, '', 'REACTOR COOLANT'],
  ['RCS VOID',            'rcs', p => p.S.voidMax > 0.01, 'bad', 'REACTOR COOLANT'],
  ['RCS LEAK / BREAK',    'rcs', p => (p.breakIn2 || 0) > 0, 'bad', 'REACTOR COOLANT'],
  ['LOOP SEALS CLEARED',  'rcs', p => p.S.solid === false && p.S.voidMax > 0.02, '', 'REACTOR COOLANT'],
  ...per(LOOP, (L, i) => [
    [`RCP ${L} TRIPPED`,    'rcs', p => !p.E.rcpOn[i], '', 'REACTOR COOLANT'],
    [`LOOP ${L} FLOW LOW`,  'rcs', p => p.S.W[i] < 0.9 * p.rp.Wrated, '', 'REACTOR COOLANT'],
    [`LOOP ${L} Thot HIGH`, 'rcs', p => p.S.Thot[i] > 618, '', 'REACTOR COOLANT'],
    [`LOOP ${L} Tcold LOW`, 'rcs', p => p.S.Tcold[i] < 540, '', 'REACTOR COOLANT'],
    [`LOOP ${L} dT HIGH`,   'rcs', p => p.S.Thot[i] - p.S.Tcold[i] > 70, '', 'REACTOR COOLANT']
  ]),

  // ---------------------------------------------------------- steam generators
  ...per(LOOP, (L, i) => [
    [`SG ${L} LEVEL LO-LO`, 'sec', p => p.sgs[i].lvlNR < p.sp.lvlLoLo, 'bad', `STEAM GENERATOR ${L}`],
    [`SG ${L} LEVEL LOW`,   'sec', p => p.sgs[i].lvlNR < p.sp.lvlLo, '', `STEAM GENERATOR ${L}`],
    [`SG ${L} LEVEL HIGH`,  'sec', p => p.sgs[i].lvlNR > p.sp.lvlHi, '', `STEAM GENERATOR ${L}`],
    [`SG ${L} ARV OPEN`,    'sec', p => p.sgs[i].arvOpen, '', `STEAM GENERATOR ${L}`],
    [`SG ${L} SAFETY OPEN`, 'sec', p => p.sgs[i].nSafetyOpen > 0, 'bad', `STEAM GENERATOR ${L}`],
    [`SG ${L} MSIV CLOSED`, 'sec', p => !p.sgs[i].msivOpen, 'bad', `STEAM GENERATOR ${L}`],
    [`SG ${L} DRYOUT`,      'sec', p => p.sgs[i].dryout, 'bad', `STEAM GENERATOR ${L}`],
    [`SG ${L} TUBES UNCOV`, 'sec', p => p.sgs[i].tubeUncovered, 'bad', `STEAM GENERATOR ${L}`],
    [`SG ${L} STEAM PRESS LO`,'sec', p => p.sgs[i].Psec < 700, '', `STEAM GENERATOR ${L}`],
    [`SG ${L} FEED FLOW LO`, 'sec', p => p.sec.online && p.sec.Wfw[i] < 0.4 * p.sgs[i].Wsteam,
      '', `STEAM GENERATOR ${L}`],
    [`SG ${L} TUBE COV LOW`, 'sec', p => p.sgs[i].tubeCoverage < 0.92, '', `STEAM GENERATOR ${L}`],
    [`SG ${L} LEVEL DEVIATION`,'sec',
      p => Math.abs(p.sgs[i].lvlNR - p.sgs.reduce((a,s)=>a+s.lvlNR,0)/3) > 8,
      '', `STEAM GENERATOR ${L}`]
  ]),

  // ---------------------------------------------------------- steam & feedwater
  ['STEAM DUMPS OPEN',    'sec', p => p.sec.dumpPos > 0.02, '', 'STEAM & FEEDWATER'],
  ['DUMPS UNAVAILABLE',   'sec', p => !p.sec.dumpAvail, '', 'STEAM & FEEDWATER'],
  ['CONDENSER VACUUM LOW','sec', p => p.sec.condPsia > 3, '', 'STEAM & FEEDWATER'],
  ['TURBINE OFF LINE',    'sec', p => !p.sec.online, '', 'STEAM & FEEDWATER'],
  ...per(AB, (L, i) => [
    [`MAIN FEED PUMP ${L} TRIP`, 'sec', p => !p.sec.mfpOn[i], 'bad', 'STEAM & FEEDWATER'],
    [`MFP ${L} SPEED LOW`,       'sec', p => p.sec.mfpOn[i] && p.sec.mfpSpeed[i] < 0.5, '', 'STEAM & FEEDWATER']
  ]),
  ['AFW ACTUATED',        'sec', p => p.sec.afwOn, '', 'STEAM & FEEDWATER'],
  ['FEEDWATER ISOLATION', 'sec', p => p.rps && p.rps.esf.fwIsol.actuated, 'bad', 'STEAM & FEEDWATER'],
  ['MSIV CLOSURE SIGNAL', 'sec', p => p.rps && p.rps.esf.msiv.actuated, 'bad', 'STEAM & FEEDWATER'],
  ['STEAMLINE PRESS LOW', 'sec', p => p.sgs.some(s => s.Psec < 600), '', 'STEAM & FEEDWATER'],
  ['FEED / STEAM MISMATCH','sec',p => Math.abs(p.sec.WfwTotal - p.sec.Wturb) > 0.12 * p.sc.Wrated, '', 'STEAM & FEEDWATER'],
  ['TURBINE RUNBACK',     'sec', p => !!p.sec.runback, '', 'STEAM & FEEDWATER'],
  //  Feed regulating valves ARE full open at full power -- that is the design
  //  point, not a condition.  What matters is being full open and still losing
  //  level: the valve is against its stop with nowhere left to go.
  ['FEED REG VALVES OPEN','sec',
    p => p.sec.frvPos.some((v, i) => v > 0.95 && p.sgs[i].lvlNR < p.sp.lvlSetPct - 2),
    '', 'STEAM & FEEDWATER'],
  ['AFW FLOW LOW',        'sec', p => p.sec.afwOn
      && p.sec.Wafw.reduce((a, b) => a + b, 0) < 1e5, '', 'STEAM & FEEDWATER'],
  ['FEEDWATER TEMP LOW',  'sec', p => p.sec.online && p.sec.TfwF < 380, '', 'STEAM & FEEDWATER'],

  // ------------------------------------------------------------------ safeguards
  ['SAFETY INJECTION',    'rcs', p => p.si && p.si.actuated, 'bad', 'SAFEGUARDS'],
  ['SI BLOCKED',          'rcs', p => p.si && p.si.alarms.blocked, '', 'SAFEGUARDS'],
  ['SI INJECTING',        'rcs', p => p.si && p.si.alarms.injecting, 'bad', 'SAFEGUARDS'],
  ['ACCUMULATORS FIRING', 'rcs', p => p.si && p.si.alarms.accDischarging, 'bad', 'SAFEGUARDS'],
  ['ACCUMULATOR EMPTY',   'rcs', p => p.si && p.si.alarms.accEmpty, 'bad', 'SAFEGUARDS'],
  ['RWST LEVEL LOW',      'rcs', p => p.si && p.si.alarms.rwstLo, 'bad', 'SAFEGUARDS'],
  ['RWST EMPTY',          'rcs', p => p.si && p.si.alarms.rwstEmpty, 'bad', 'SAFEGUARDS'],
  ['ON SUMP RECIRC',      'rcs', p => p.si && p.si.suction === 'sump', '', 'SAFEGUARDS'],
  ...per(AB, (L, i) => [
    [`CHARGING PUMP ${L} OFF`, 'rcs', p => p.si && !p.si.hhOn[i], '', 'SAFEGUARDS'],
    [`SI PUMP ${L} OFF`,       'rcs', p => p.si && !p.si.siOn[i], '', 'SAFEGUARDS'],
    [`RHR PUMP ${L} OFF`,      'rcs', p => p.si && !p.si.lhOn[i], '', 'SAFEGUARDS']
  ]),
  ...per([0, 1, 2], i => [
    [`ACCUM ${LOOP[i]} ISOLATED`,    'rcs', p => p.si && p.si.acc[i] && p.si.acc[i].isolated, '', 'SAFEGUARDS'],
    [`ACCUM ${LOOP[i]} DISCHARGING`, 'rcs', p => p.si && p.si.acc[i] && p.si.acc[i].discharging, 'bad', 'SAFEGUARDS'],
    [`ACCUM ${LOOP[i]} PRESS LOW`,   'rcs', p => p.si && p.si.acc[i] && p.si.acc[i].psig < 585, '', 'SAFEGUARDS']
  ]),

  // ----------------------------------------------------------------- containment
  ['CNMT PRESS HIGH',     'rcs', p => p.cnmt && p.cnmt.alarms.hiPress, 'bad', 'CONTAINMENT'],
  ['CNMT PRESS HI-HI',    'rcs', p => p.cnmt && p.cnmt.alarms.hiHiPress, 'bad', 'CONTAINMENT'],
  ['CNMT NEAR DESIGN',    'rcs', p => p.cnmt && p.cnmt.alarms.nearDesign, 'bad', 'CONTAINMENT'],
  ['CNMT OVER DESIGN',    'rcs', p => p.cnmt && p.cnmt.alarms.overDesign, 'bad', 'CONTAINMENT'],
  ['CNMT TEMP HIGH',      'rcs', p => p.cnmt && p.cnmt.alarms.hiTemp, '', 'CONTAINMENT'],
  ['CNMT SUMP HIGH',      'rcs', p => p.cnmt && p.cnmt.alarms.sumpHi, '', 'CONTAINMENT'],
  ['CNMT ISOLATED',       'rcs', p => p.cnmt && p.cnmt.isolated, 'bad', 'CONTAINMENT'],
  ['CNMT ISOLATION A',    'rcs', p => p.rps && p.rps.esf.isolA.actuated, 'bad', 'CONTAINMENT'],
  ['VACUUM RELIEF',       'rcs', p => p.cnmt && p.cnmt.vacuumRelief, '', 'CONTAINMENT'],
  ['CNMT SPRAY SIGNAL',   'rcs', p => p.rps && p.rps.esf.spray.actuated, 'bad', 'CONTAINMENT'],
  ...per(AB, (L, i) => [
    [`CNMT SPRAY ${L} RUNNING`, 'rcs', p => p.cnmt && p.cnmt.sprayOn[i], 'bad', 'CONTAINMENT']
  ]),
  ...per([0, 1, 2, 3], i => [
    [`CNMT FAN ${i + 1} OFF`, 'rcs', p => p.cnmt && !p.cnmt.fansOn[i], '', 'CONTAINMENT']
  ]),

  // ------------------------------------------------------- residual heat removal
  ['RHR IN SERVICE',      'rcs', p => p.rhr && p.rhr.inService, 'ok', 'RESIDUAL HEAT REMOVAL'],
  ['RHR ENTRY PERMITTED', 'rcs', p => p.rhr && !p.rhr.inService
      && (p.S.P - 14.7) <= 400 && p.S.Thot[0] <= 350, 'ok', 'RESIDUAL HEAT REMOVAL'],
  ['COOLDOWN RATE HIGH',  'rcs', p => p.rhr && p.rhr.cooldownFperHr > 100, '', 'RESIDUAL HEAT REMOVAL'],
  ['CCW TEMP HIGH',       'rcs', p => p.rhr && p.rhr.ccwTempF > 110, '', 'RESIDUAL HEAT REMOVAL'],
  ...per(AB, (L, i) => [
    //  RHR is correctly out of service, interlocked and isolated at operating
    //  pressure -- it CANNOT be in service there.  Annunciating that lit six
    //  windows through every hour of normal power operation.  These are only
    //  conditions once the plant is below the entry permissive and RHR is
    //  something you might actually want.
    [`RHR TRAIN ${L} PUMP OFF`,   'rcs',
      p => p.rhr && !p.rhr.trains[i].pumpOn && p.S.P - 14.7 < p.rh.permissivePsig, '',
      'RESIDUAL HEAT REMOVAL'],
    [`RHR TRAIN ${L} INTERLOCK`,  'rcs',
      p => p.rhr && p.rhr.trains[i].interlocked && p.S.P - 14.7 < p.rh.permissivePsig, '',
      'RESIDUAL HEAT REMOVAL'],
    [`RHR TRAIN ${L} TRIPPED`,    'rcs', p => p.rhr && p.rhr.trains[i].tripped, 'bad', 'RESIDUAL HEAT REMOVAL'],
    [`RHR TRAIN ${L} SUCTION SHUT`,'rcs',
      p => p.rhr && !p.rhr.trains[i].suctionOpen && p.S.P - 14.7 < p.rh.permissivePsig, '',
      'RESIDUAL HEAT REMOVAL']
  ]),

  // -------------------------------------------------- chemical & volume control
  ['BORATING',            'rx',  p => p.borateGpm > 0, '', 'CHEMICAL & VOLUME CONTROL'],
  ['DILUTING',            'rx',  p => p.diluteGpm > 0, '', 'CHEMICAL & VOLUME CONTROL'],
  ['EMERGENCY BORATION',  'rx',  p => p.cv && p.cv.emergency, 'bad', 'CHEMICAL & VOLUME CONTROL'],
  ['CVCS IN MANUAL',      'rx',  p => p.cv && p.cv.mode !== 'auto', '', 'CHEMICAL & VOLUME CONTROL'],
  ['VCT LEVEL LOW',       'rx',  p => p.cv && p.cv.vctPct < 20, '', 'CHEMICAL & VOLUME CONTROL'],
  ['VCT LEVEL HIGH',      'rx',  p => p.cv && p.cv.vctPct > 85, '', 'CHEMICAL & VOLUME CONTROL'],
  ['BORIC ACID TANK LOW', 'rx',  p => p.cv && p.cv.baTankGal < 4000, '', 'CHEMICAL & VOLUME CONTROL'],
  ['PRIMARY WATER LOW',   'rx',  p => p.cv && p.cv.pwTankGal < 4000, '', 'CHEMICAL & VOLUME CONTROL'],
  ['CHARGING FLOW LOW',   'rx',  p => p.cv && p.cv.chargeGpm < 10, '', 'CHEMICAL & VOLUME CONTROL'],
  ['LETDOWN ISOLATED',    'rx',  p => p.cv && p.cv.letdownGpm < 1, '', 'CHEMICAL & VOLUME CONTROL'],

  // ----------------------------------------------------- rod position indication
  //  ROD DEVIATION and ROD BOTTOM are different windows because they are
  //  different failures.  Deviation means a rod is not where the counter says;
  //  bottom means it is on the floor.  A dropped rod lights both, a slipping
  //  one lights only the first, and the response differs.
  ['ROD DEVIATION',       'rx', p => p.ro && p.ro.alarms.rodDeviation, '', 'ROD CONTROL'],
  ['ROD AT BOTTOM',       'rx', p => p.ro && p.ro.alarms.rodBottom, 'bad', 'ROD CONTROL'],
  ['ROD STUCK',           'rx', p => p.ro && p.ro.alarms.rodStuck, 'bad', 'ROD CONTROL'],
  ['BANK MISALIGNED',     'rx', p => p.ro && p.ro.alarms.bankMisaligned, 'bad', 'ROD CONTROL'],
  ['RODS NOT AT BOTTOM',  'rx', p => p.ro && p.ro.alarms.notAtBottom, 'bad', 'ROD CONTROL'],
  ['URGENT ROD FAILURE',  'rx', p => p.ro && p.ro.alarms.urgentFailure, 'bad', 'ROD CONTROL'],
  ['DRPI DEGRADED',       'rx', p => p.ro && p.ro.alarms.drpiDegraded, '', 'ROD CONTROL'],
  ['DRPI LOST',           'rx', p => p.ro && p.ro.alarms.drpiLost, 'bad', 'ROD CONTROL'],
  ['ROD CONTROL MANUAL',  'rx', p => p.rodAuto === false, '', 'ROD CONTROL'],
  ['ROD MOTION INHIBIT',  'rx', p => p.ro && (p.ro.alarms.urgentFailure
      || p.ro.alarms.drpiLost), 'bad', 'ROD CONTROL'],
  ...per(ROD_GROUPS, g => [
    [`${g.id} MISALIGNED`, 'rx',
      p => { const q = p.ro && p.ro.groups && p.ro.groups.find(x => x.id === g.id);
             return !!q && q.spread > p.rop.bankDeviationSteps; },
      '', 'ROD BANKS'],
    [`${g.id} NO INDICATION`, 'rx',
      p => { const q = p.ro && p.ro.groups && p.ro.groups.find(x => x.id === g.id);
             return !!q && q.noIndication > 0; },
      '', 'ROD BANKS'],
    [`${g.id} FULLY INSERTED`, 'rx',
      p => { const q = p.ro && p.ro.groups && p.ro.groups.find(x => x.id === g.id);
             return !!q && q.hi !== null && q.hi <= p.rop.rodBottomSteps; },
      '', 'ROD BANKS']
  ]),

  // ------------------------------------------------------------ valve lineup
  //  A pump running against a shut discharge valve is the failure these exist
  //  for.  Nothing else on the board shows it: the pump lamp is red, the pump
  //  is drawing current, and it is delivering nothing.
  ...per(['A', 'B'], (L, i) => [
    [`HH ${L} DEADHEADED`, 'sg',
      p => p.si && p.si.hhOn[i] && !p.si.hhValve[i], 'bad', 'VALVE LINEUP'],
    [`SI ${L} DEADHEADED`, 'sg',
      p => p.si && p.si.siOn[i] && !p.si.siValve[i], 'bad', 'VALVE LINEUP'],
    [`LH ${L} DEADHEADED`, 'sg',
      p => p.si && p.si.lhOn[i] && !p.si.lhValve[i], 'bad', 'VALVE LINEUP']
  ]),
  //  Accumulator isolation and letdown isolation already have windows in the
  //  safeguards and CVCS bays; duplicating them here would put the same signal
  //  in two places on one board, which is how an operator ends up acknowledging
  //  a condition twice and believing it cleared.
  ['LETDOWN FLOW REDUCED', 'rcs',
    p => p.cv && p.cv.letdownIsol && p.cv.orifice.some(o => !o), '', 'VALVE LINEUP'],
  ['CHARGING ISOLATED',   'rcs', p => p.cv && !p.cv.chargingIsol, 'bad', 'VALVE LINEUP'],
  ['SEAL INJECTION LOST', 'rcs', p => p.cv && !p.cv.sealInjection, 'bad', 'VALVE LINEUP'],
  ['NO BORATION PATH',    'rcs', p => p.cv && !p.cv.baIsol, 'bad', 'VALVE LINEUP'],

  // ---------------------------------------------------- radiation monitoring
  //  Off-gas tells you there IS primary-to-secondary leakage; blowdown and the
  //  steam line monitors tell you WHICH generator.  Those are two different
  //  questions and they get separate windows, per unit, because the answer to
  //  the second one determines which generator gets isolated.
  ['RCS ACTIVITY HIGH',   'rad', p => p.rd && p.rd.alarms.primaryHi, '', 'RADIATION - PROCESS'],
  ['RCS ACTIVITY > SPEC', 'rad', p => p.rd && p.rd.alarms.primarySpec, 'bad', 'RADIATION - PROCESS'],
  ['FUEL CLAD DAMAGE',    'rad', p => p.rd && p.rd.alarms.cladDamage, 'bad', 'RADIATION - PROCESS'],
  ['NOBLE GAS HIGH',      'rad', p => p.rd && p.rd.alarms.gasHi, '', 'RADIATION - PROCESS'],
  ['LETDOWN ACTIVITY HI', 'rad', p => p.rd && p.rd.alarms.letdownHi, '', 'RADIATION - PROCESS'],
  ['CCW ACTIVITY',        'rad', p => p.rd && p.rd.alarms.ccwActivity, 'bad', 'RADIATION - PROCESS'],
  ['OFF-GAS ACTIVITY HI', 'rad', p => p.rd && p.rd.alarms.offgasHi, '', 'RADIATION - PROCESS'],
  ['OFF-GAS HI-HI',       'rad', p => p.rd && p.rd.alarms.offgasHiHi, 'bad', 'RADIATION - PROCESS'],
  ['PRI-SEC LEAKAGE',     'rad', p => p.rd && p.rd.alarms.tubeLeak, 'bad', 'RADIATION - PROCESS'],
  ['COND TUBE LEAKAGE',   'rad', p => p.rd && p.rd.alarms.condTubeLeak, '', 'RADIATION - PROCESS'],
  ['BLOWDOWN ISOLATED',   'rad', p => p.rd && p.rd.alarms.bdIsolated, 'bad', 'RADIATION - PROCESS'],
  ...per(LOOP, (L, i) => [
    [`SG ${L} BLOWDOWN RAD`, 'rad', p => p.rd && p.rd.blowdown[i].alarm, '', 'RADIATION - SG'],
    [`SG ${L} BLOWDOWN HI-HI`, 'rad', p => p.rd && p.rd.blowdown[i].hihi, 'bad', 'RADIATION - SG'],
    [`MS LINE ${L} RAD HI`, 'rad', p => p.rd && p.rd.steamline[i].alarm, '', 'RADIATION - SG'],
    [`MS LINE ${L} HI-HI`,  'rad', p => p.rd && p.rd.steamline[i].hihi, 'bad', 'RADIATION - SG'],
    [`SG ${L} MONITOR OFF SCALE`, 'rad',
      p => p.rd && (p.rd.blowdown[i].offScale || p.rd.steamline[i].offScale), 'bad', 'RADIATION - SG']
  ]),

  ['CNMT GAS MONITOR HI',  'rad', p => p.rd && p.rd.alarms.cnmtGasHi, '', 'RADIATION - AREA'],
  ['CNMT PARTICULATE HI',  'rad', p => p.rd && p.rd.alarms.cnmtPartHi, '', 'RADIATION - AREA'],
  ['CNMT IODINE HI',       'rad', p => p.rd && p.rd.alarms.cnmtIodineHi, '', 'RADIATION - AREA'],
  ['CNMT HIGH RANGE',      'rad', p => p.rd && p.rd.alarms.cnmtHighRange, 'bad', 'RADIATION - AREA'],
  ['AUX BLDG RAD HIGH',    'rad', p => p.rd && p.rd.alarms.auxHi, '', 'RADIATION - AREA'],
  ['FUEL HANDLING RAD',    'rad', p => p.rd && p.rd.alarms.sfpHi, '', 'RADIATION - AREA'],
  ['CR INTAKE RAD HIGH',   'rad', p => p.rd && p.rd.alarms.crIntakeHi, 'bad', 'RADIATION - AREA'],
  ['CONTROL ROOM ISOLATED','rad', p => p.rd && p.rd.alarms.crIsolated, 'bad', 'RADIATION - AREA'],
  ['PLANT VENT RAD HIGH',  'rad', p => p.rd && p.rd.alarms.ventHi, '', 'RADIATION - AREA'],
  ['PLANT VENT HI-HI',     'rad', p => p.rd && p.rd.alarms.ventHiHi, 'bad', 'RADIATION - AREA'],
  ['GASEOUS RELEASE',      'rad', p => p.rd && p.rd.alarms.releasing, 'bad', 'RADIATION - AREA'],

  // ------------------------------------------------- condenser & condensate
  //  Back pressure is a symptom with three independent causes -- the sink, the
  //  flow and the surface -- and they want different actions, so each is
  //  annunciated on its own rather than behind one CONDENSER VACUUM LOW.
  ['CONDENSER VAC LOW',   'cnd', p => p.cd && p.cd.alarms.vacuumLow, '', 'CONDENSER & VACUUM'],
  ['CONDENSER VAC TRIP',  'cnd', p => p.cd && p.cd.alarms.vacuumTrip, 'bad', 'CONDENSER & VACUUM'],
  ['COND TTD HIGH',       'cnd', p => p.cd && p.cd.alarms.ttdHigh, '', 'CONDENSER & VACUUM'],
  ['COND TUBES FOULED',   'cnd', p => p.cd && p.cd.alarms.fouled, '', 'CONDENSER & VACUUM'],
  ['COND TUBE LEAK',      'cnd', p => p.cd && p.cd.alarms.tubeLeak, 'bad', 'CONDENSER & VACUUM'],
  ['AIR REMOVAL LOST',    'cnd', p => p.cd && p.cd.alarms.ejectorLost, 'bad', 'CONDENSER & VACUUM'],
  ['AIR BURDEN HIGH',     'cnd', p => p.cd && p.cd.alarms.airHigh, '', 'CONDENSER & VACUUM'],
  ['AIR IN-LEAKAGE HI',   'cnd', p => p.cd && p.cd.alarms.airInleakHi, '', 'CONDENSER & VACUUM'],
  ['OUTPUT LOSS ON VAC',  'cnd', p => p.cd && p.cd.alarms.outputLoss, '', 'CONDENSER & VACUUM'],
  ...per(AB, (L, i) => [
    [`AIR EJECTOR ${L} OFF`, 'cnd', p => p.cd && !p.cd.ejectorOn[i], '', 'CONDENSER & VACUUM']
  ]),

  ['CIRC WTR FLOW LOW',   'cnd', p => p.cd && p.cd.alarms.cwLoFlow, '', 'CIRCULATING WATER'],
  ['LOSS OF CIRC WTR',    'cnd', p => p.cd && p.cd.alarms.cwLost, 'bad', 'CIRCULATING WATER'],
  ['CW OUTLET TEMP HI',   'cnd', p => p.cd && p.cd.alarms.cwOutletHi, '', 'CIRCULATING WATER'],
  ['CW INLET TEMP HI',    'cnd', p => p.cd && p.cd.cwInletF > 88, '', 'CIRCULATING WATER'],
  ...per([0, 1, 2], i => [
    [`CIRC WTR PUMP ${i + 1} OFF`, 'cnd', p => p.cd && !p.cd.cwPumpOn[i], '', 'CIRCULATING WATER']
  ]),

  ['HOTWELL LEVEL LOW',   'cnd', p => p.cd && p.cd.alarms.hotwellLo, '', 'CONDENSATE'],
  ['HOTWELL LEVEL HIGH',  'cnd', p => p.cd && p.cd.alarms.hotwellHi, '', 'CONDENSATE'],
  ['HOTWELL EMPTY',       'cnd', p => p.cd && p.cd.alarms.hotwellEmpty, 'bad', 'CONDENSATE'],
  ['HOTWELL MAKEUP',      'cnd', p => p.cd && p.cd.alarms.makeup, '', 'CONDENSATE'],
  ['HOTWELL REJECT',      'cnd', p => p.cd && p.cd.alarms.reject, '', 'CONDENSATE'],
  ['CST LEVEL LOW',       'cnd', p => p.cd && p.cd.alarms.cstLo, '', 'CONDENSATE'],
  ['COND PUMP LOST',      'cnd', p => p.cd && p.cd.alarms.condPumpLost, '', 'CONDENSATE'],
  ['ALL COND PUMPS LOST', 'cnd', p => p.cd && p.cd.alarms.condLostAll, 'bad', 'CONDENSATE'],
  ...per([0, 1, 2], i => [
    [`COND PUMP ${i + 1} OFF`,  'cnd',
      p => p.cd && !p.cd.condPumpOn[i] && !p.cd.condPumpAuto[i], '', 'CONDENSATE'],
    [`COND PUMP ${i + 1} AUTO`, 'cnd', p => p.cd && p.cd.condPumpAuto[i], 'ok', 'CONDENSATE']
  ]),

  // ------------------------------------------- component cooling & service water
  //  The heat sink chain gets its own bay because it is diagnosed as a chain:
  //  a rising CCW temperature is a symptom, and which link failed is the
  //  question.  Loss of flow, loss of the exchangers, loss of service water
  //  and a fouled strainer all raise the same temperature and want different
  //  actions, so each gets its own window rather than sharing a summary one.
  ['CCW SUPPLY TEMP HI',  'ccw', p => p.cw && p.cw.alarms.ccwHi, '', 'COMPONENT COOLING'],
  ['CCW TEMP HI-HI',      'ccw', p => p.cw && p.cw.alarms.ccwHiHi, 'bad', 'COMPONENT COOLING'],
  ['CCW FLOW LOW',        'ccw', p => p.cw && p.cw.alarms.ccwLoFlow, '', 'COMPONENT COOLING'],
  ['CCW LOSS OF FLOW',    'ccw', p => p.cw && p.cw.alarms.ccwLost, 'bad', 'COMPONENT COOLING'],
  ['CCW SURGE TK LO',     'ccw', p => p.cw && p.cw.alarms.surgeLo, '', 'COMPONENT COOLING'],
  ['CCW SURGE TK HI',     'ccw', p => p.cw && p.cw.alarms.surgeHi, '', 'COMPONENT COOLING'],
  ['CCW SURGE TK EMPTY',  'ccw', p => p.cw && p.cw.alarms.surgeEmpty, 'bad', 'COMPONENT COOLING'],
  ['CCW LEAK',            'ccw', p => p.cw && p.cw.alarms.ccwLeak, 'bad', 'COMPONENT COOLING'],
  ['CCW ACTIVITY HIGH',   'ccw', p => p.cw && p.cw.alarms.ccwActivity, 'bad', 'COMPONENT COOLING'],
  ['CCW ISOLATED',        'ccw', p => p.cw && p.cw.isolated, 'bad', 'COMPONENT COOLING'],
  ['LETDOWN HX ISOLATED', 'ccw', p => p.cw && p.cw.alarms.letdownIsol, 'bad', 'COMPONENT COOLING'],
  ...per([0, 1, 2], i => [
    //  A stopped pump that is in AUTO is a standby train, which is the normal
    //  lineup -- annunciating it lit a window on a healthy plant AND
    //  double-annunciated the same fact as the AUTO status window beside it.
    [`CCW PUMP ${i + 1} OFF`,      'ccw',
      p => p.cw && !p.cw.pumpOn[i] && !p.cw.pumpAuto[i], '', 'COMPONENT COOLING'],
    [`CCW PUMP ${i + 1} AUTO`,     'ccw', p => p.cw && p.cw.pumpAuto[i], 'ok', 'COMPONENT COOLING']
  ]),
  ...per(AB, (L, i) => [
    [`CCW HX ${L} OUT OF SVC`, 'ccw', p => p.cw && !p.cw.hxInService[i], '', 'COMPONENT COOLING']
  ]),

  // ---- the reactor coolant pump thermal barriers, one window per pump ----
  //  "Which pump" is the whole question here: the seals go one pump at a time
  //  and the procedure trips them individually.
  ...per(LOOP, (L, i) => [
    [`RCP ${L} BARRIER CLG LOST`, 'ccw',
      p => p.cw && !p.cw.rcpBarrierOK[i] && p.S.pumpOn[i], 'bad', 'COMPONENT COOLING'],
    [`RCP ${L} SEAL DAMAGE`, 'ccw', p => p.cw && p.cw.sealDamaged[i], 'bad', 'COMPONENT COOLING']
  ]),

  ['SW SUPPLY TEMP HI',   'ccw', p => p.cw && p.cw.alarms.swHi, '', 'SERVICE WATER'],
  ['SW FLOW LOW',         'ccw', p => p.cw && p.cw.alarms.swLoFlow, '', 'SERVICE WATER'],
  ['LOSS OF SERVICE WTR', 'ccw', p => p.cw && p.cw.alarms.swLost, 'bad', 'SERVICE WATER'],
  ['SW STRAINER DP HI',   'ccw', p => p.cw && p.cw.alarms.strainerDP, '', 'SERVICE WATER'],
  ['SW RETURN TEMP HI',   'ccw', p => p.cw && p.cw.swReturnF > 115, '', 'SERVICE WATER'],
  ['UHS TEMP HIGH',       'ccw', p => p.cw && p.cw.swSupplyF > 88, '', 'SERVICE WATER'],
  ...per([0, 1, 2], i => [
    [`SW PUMP ${i + 1} OFF`,   'ccw',
      p => p.cw && !p.cw.swPumpOn[i] && !p.cw.swPumpAuto[i], '', 'SERVICE WATER'],
    [`SW PUMP ${i + 1} AUTO`,  'ccw', p => p.cw && p.cw.swPumpAuto[i], 'ok', 'SERVICE WATER']
  ]),
  ['DG COOLING LOST',     'ccw', p => p.cw && p.cw.alarms.swLost
      && p.E.edg.some(e => e.running), 'bad', 'SERVICE WATER'],
  ['FAN COOLER CLG LOST', 'ccw', p => p.cw && p.cw.alarms.swLost
      && p.cnmt && p.cnmt.fansOn.some(Boolean), 'bad', 'SERVICE WATER'],

  // ------------------------------------------------------------------ electrical
  ['LOSS OF OFFSITE',     'el',  p => !p.E.gridAvail, 'bad', 'ELECTRICAL'],
  ['GENERATOR TRIP',      'el',  p => p.E.tripped, 'bad', 'ELECTRICAL'],
  ['GEN BREAKER OPEN',    'el',  p => !p.E.genBkr, '', 'ELECTRICAL'],
  ['UAT BREAKER OPEN',    'el',  p => !p.E.uatBkr, '', 'ELECTRICAL'],
  ['SAT BREAKER OPEN',    'el',  p => !p.E.satBkr, '', 'ELECTRICAL'],
  //  This read `E.online`, which is never set -- the generator breaker is
  //  `E.genBkr`.  So the window sat lit through 916 MWe of full-power
  //  operation, which is the single worst thing an annunciator can do.
  ['GENERATOR OFF LINE',  'el',  p => !p.E.genBkr, '', 'ELECTRICAL'],
  ['POWER FACTOR LEAD',   'el',  p => p.E.lead, '', 'ELECTRICAL'],
  ...per(AB, (L, i) => [
    [`AUX BUS ${L} UNDERVOLT`,    'el', p => p.E.Vaux[i] < 0.9, 'bad', 'ELECTRICAL'],
    [`SAFETY BUS ${L} UNDERVOLT`, 'el', p => p.E.Vsafety[i] < 0.9, 'bad', 'ELECTRICAL'],
    [`SAFETY BUS ${L} ON DG`,     'el', p => p.E.safetyFrom[i] === 'edg', '', 'ELECTRICAL'],
    [`DG ${i + 1} RUNNING`,       'el', p => p.E.edg[i].running, 'ok', 'ELECTRICAL'],
    [`DG ${i + 1} READY`,         'el', p => p.E.edg[i].ready, 'ok', 'ELECTRICAL'],
    [`DG ${i + 1} BREAKER`,       'el', p => p.E.edg[i].bkr, '', 'ELECTRICAL'],
    [`DG ${i + 1} FAILED`,        'el', p => p.E.edg[i].tripped, 'bad', 'ELECTRICAL'],
    [`DG ${i + 1} AIR PRESS LOW`, 'el', p => p.E.edg[i].airPsi < 180, '', 'ELECTRICAL'],
    [`DG ${i + 1} OVERLOAD`,      'el', p => p.E.edg[i].loadFrac > 0.95, 'bad', 'ELECTRICAL'],
    [`DG ${i + 1} START SIGNAL`,  'el', p => p.E.edg[i].startSignal, '', 'ELECTRICAL']
  ])
];

/**
 * ISA sequence per point.  Most are A (self-clearing).  Anything that
 * represents a PROTECTIVE ACTION or an actuation is M or R, because a
 * safeguard that operated and reset itself must not vanish from the board.
 */
const SEQ = {
  // --- added with the expanded window count ---
  'PZR PRESS HI TRIP':'R', 'PZR PRESS LO TRIP':'R', 'PZR LEVEL HI TRIP':'R',
  'HEATERS UNCOVERED':'R', 'SOLID PLANT':'M', 'PRT PRESS HIGH':'R',
  'PORV 1 OPEN':'R', 'PORV 2 OPEN':'R', 'PORV 1 STUCK':'M', 'PORV 2 STUCK':'M',
  'SG A LEVEL LO-LO':'R', 'SG B LEVEL LO-LO':'R', 'SG C LEVEL LO-LO':'R',
  'SG A SAFETY OPEN':'M', 'SG B SAFETY OPEN':'M', 'SG C SAFETY OPEN':'M',
  'SG A MSIV CLOSED':'M', 'SG B MSIV CLOSED':'M', 'SG C MSIV CLOSED':'M',
  'SG A TUBES UNCOV':'M', 'SG B TUBES UNCOV':'M', 'SG C TUBES UNCOV':'M',
  'SG A DRYOUT':'M', 'SG B DRYOUT':'M', 'SG C DRYOUT':'M',
  'MAIN FEED PUMP A TRIP':'M', 'MAIN FEED PUMP B TRIP':'M',
  'MSIV CLOSURE SIGNAL':'M', 'SI INJECTING':'M', 'ACCUMULATOR EMPTY':'M',
  'RWST EMPTY':'M', 'CNMT PRESS HI-HI':'R', 'CNMT OVER DESIGN':'M',
  'CNMT SPRAY SIGNAL':'M', 'CNMT SPRAY A RUNNING':'M', 'CNMT SPRAY B RUNNING':'M',
  'CNMT SUMP HIGH':'R', 'RHR TRAIN A TRIPPED':'M', 'RHR TRAIN B TRIPPED':'M',
  'EMERGENCY BORATION':'M', 'STARTUP RATE TRIP':'M',
  'AUX BUS A UNDERVOLT':'M', 'AUX BUS B UNDERVOLT':'M',
  'SAFETY BUS A UNDERVOLT':'M', 'SAFETY BUS B UNDERVOLT':'M',
  'DG 1 FAILED':'M', 'DG 2 FAILED':'M',
  'OT dT MARGIN LOW':'R', 'OP dT MARGIN LOW':'R', 'DNBR AT LIMIT':'R',
  'ROD AT BOTTOM':'M', 'ROD STUCK':'M', 'URGENT ROD FAILURE':'M',
  'RODS NOT AT BOTTOM':'M', 'DRPI LOST':'M', 'BANK MISALIGNED':'M',
  'ROD DEVIATION':'R', 'DRPI DEGRADED':'R',
  'HH A DEADHEADED':'M', 'HH B DEADHEADED':'M', 'SI A DEADHEADED':'M',
  'SI B DEADHEADED':'M', 'LH A DEADHEADED':'M', 'LH B DEADHEADED':'M',
  'SEAL INJECTION LOST':'M', 'NO BORATION PATH':'M', 'CHARGING ISOLATED':'M',
  'RCS ACTIVITY > SPEC':'M', 'FUEL CLAD DAMAGE':'M', 'PRI-SEC LEAKAGE':'M',
  'CCW ACTIVITY':'M', 'BLOWDOWN ISOLATED':'M', 'CONTROL ROOM ISOLATED':'M',
  'CNMT HIGH RANGE':'M', 'GASEOUS RELEASE':'M', 'PLANT VENT HI-HI':'M',
  'OFF-GAS HI-HI':'M', 'CR INTAKE RAD HIGH':'M',
  'SG A BLOWDOWN HI-HI':'M', 'SG B BLOWDOWN HI-HI':'M', 'SG C BLOWDOWN HI-HI':'M',
  'MS LINE A HI-HI':'M', 'MS LINE B HI-HI':'M', 'MS LINE C HI-HI':'M',
  'OFF-GAS ACTIVITY HI':'R', 'RCS ACTIVITY HIGH':'R', 'PLANT VENT RAD HIGH':'R',
  'CONDENSER VAC TRIP':'M', 'LOSS OF CIRC WTR':'M', 'AIR REMOVAL LOST':'M',
  'COND TUBE LEAK':'M', 'HOTWELL EMPTY':'M', 'ALL COND PUMPS LOST':'M',
  'CONDENSER VAC LOW':'R', 'HOTWELL LEVEL LOW':'R', 'COND TTD HIGH':'R',
  'CCW TEMP HI-HI':'R', 'CCW LOSS OF FLOW':'M', 'CCW SURGE TK EMPTY':'M',
  'CCW LEAK':'M', 'CCW ACTIVITY HIGH':'M', 'CCW ISOLATED':'M',
  'LETDOWN HX ISOLATED':'R', 'CCW SUPPLY TEMP HI':'R',
  'RCP A BARRIER CLG LOST':'R', 'RCP B BARRIER CLG LOST':'R', 'RCP C BARRIER CLG LOST':'R',
  'RCP A SEAL DAMAGE':'M', 'RCP B SEAL DAMAGE':'M', 'RCP C SEAL DAMAGE':'M',
  'LOSS OF SERVICE WTR':'M', 'DG COOLING LOST':'M', 'FAN COOLER CLG LOST':'M',
  'SW SUPPLY TEMP HI':'R', 'SW FLOW LOW':'R',
  'FEEDWATER ISOLATION':'M',
  'REACTOR TRIP':'M', 'TURBINE TRIP':'M', 'OT dT':'R', 'OP dT':'R',
  'PZR SAFETY OPEN':'M', 'PRT RUPTURED':'M',
  'SAFETY INJECTION':'M', 'ACCUMULATORS FIRING':'M',
  'ON SUMP RECIRC':'M', 'RCS LEAK / BREAK':'M', 'CNMT ISOLATED':'M',
  'CNMT ISOLATION A':'M',
  'LOSS OF OFFSITE':'M', 'GENERATOR TRIP':'M',
  'CHANNEL FAILED':'M', 'AFW ACTUATED':'R',
  'LOW SUBCOOLING':'R', 'RCS VOID':'R',
  'CNMT PRESS HIGH':'R', 'RWST LEVEL LOW':'R', 'CNMT NEAR DESIGN':'M'
};

/**
 * Every key above must name a real window.  Six did not -- 'PZR PORV OPEN',
 * 'SG SAFETY OPEN', 'SG LEVEL LO-LO', 'CNMT SPRAY', 'MSIV CLOSURE' and
 * 'DG FAILED' were written before those windows were de-aggregated per unit,
 * and the de-aggregated windows silently fell back to sequence A.  A safety
 * valve that lifted and reseated then vanished from the board, which is the
 * exact failure the M sequence exists to prevent.  This assertion fails loudly
 * rather than letting the next rename go quiet the same way.
 */
export function seqTableOrphans() {
  const names = new Set(ALARMS.map(a => a[0]));
  return Object.keys(SEQ).filter(k => !names.has(k));
}

/** Point list in the shape the ISA-18.1 engine expects. */
export function annunPoints() {
  return ALARMS.map(a => ({
    name: a[0], group: a[1], cls: a[3],
    section: a[4] || a[1],
    seqType: SEQ[a[0]] || 'A',
    firstOut: true
  }));
}

/** Section labels, in board layout order. */
export function sections() {
  const out = [];
  for (const a of ALARMS) { const s = a[4] || a[1]; if (!out.includes(s)) out.push(s); }
  return out;
}
export function readPoint(PL, i) {
  try { return !!ALARMS[i][2](PL); } catch (e) { return false; }
}

export function makeAlarmState() {
  return { st: ALARMS.map(() => ({ on: false, ack: false })),
           first: -1, firstBySection: {}, anyNew: false };
}

export function updateAlarms(A, PL) {
  A.anyNew = false;
  for (let i = 0; i < ALARMS.length; i++) {
    let on = false;
    try { on = !!ALARMS[i][2](PL); } catch (e) { on = false; }
    const s = A.st[i];
    if (on && !s.on) {
      s.ack = false;
      if (A.first < 0) A.first = i;
      const sec = ALARMS[i][4] || ALARMS[i][1];
      if (A.firstBySection[sec] === undefined) A.firstBySection[sec] = i;
    }
    s.on = on;
    if (on && !s.ack) A.anyNew = true;
  }
  if (!A.st.some(s => s.on)) A.first = -1;
  // a section with nothing lit has no initiating window to remember
  for (const sec of Object.keys(A.firstBySection)) {
    const any = ALARMS.some((a, i) => (a[4] || a[1]) === sec && A.st[i].on);
    if (!any) delete A.firstBySection[sec];
  }
  return A;
}
export function ackAll(A) { A.st.forEach(s => s.ack = true); }

/**
 * Break a legend into the short stacked lines an engraved window actually
 * carries.  Real windows are about three characters wider than "LO-LO" and
 * fit three or four lines, so the legend is balanced across lines rather than
 * greedily filled -- "SG A / LEVEL / LO-LO", never "SG A LEVEL / LO-LO".
 */
export function legendLines(name, maxLines = 4) {
  const words = name.split(/\s+/);
  if (words.length <= 1) return words;
  // try increasing line counts until every line fits comfortably
  for (let n = 1; n <= maxLines; n++) {
    const longest = Math.max(...words.map(w => w.length));
    const target = Math.max(Math.ceil(name.length / n) + 2, longest);
    const lines = []; let cur = '';
    for (const w of words) {
      if (!cur) { cur = w; continue; }
      if ((cur + ' ' + w).length <= Math.min(target, 13)) cur += ' ' + w;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length <= n && lines.every(l => l.length <= 13)) return lines;
    if (n === maxLines) return lines;      // never drop a word to fit
  }
  return words;
}

/** Windows grouped by board section, in panel layout order. */
export function bySection(points) {
  const out = new Map();
  points.forEach((p, i) => {
    if (!out.has(p.section)) out.set(p.section, []);
    out.get(p.section).push(i);
  });
  return out;
}

/** Render tiles, optionally filtered to one board's group. */
export function tilesHTML(A, group) {
  return ALARMS.map((a, i) => {
    if (group && a[1] !== group && a[1] !== 'all') return '';
    const s = A.st[i];
    const c = 'tile' + (s.on ? ' on' : '') + (a[3] ? ' ' + a[3] : '')
            + (s.on && !s.ack ? ' new' : '') + (s.on && i === A.first ? ' first' : '');
    return `<div class="${c}">${a[0]}</div>`;
  }).join('');
}
export function activeCount(A) { return A.st.filter(s => s.on).length; }
export function firstOutName(A) { return A.first >= 0 ? ALARMS[A.first][0] : ''; }
