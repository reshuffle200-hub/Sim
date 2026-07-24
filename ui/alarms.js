// ======================================================================
//  alarms.js — annunciator engine, shared by every board
//
//  Sequence: a new alarm flashes until acknowledged, then goes steady.
//  The FIRST alarm of a group latches separately and stays marked, because
//  after a trip the initiating window is the only one worth reading -- the
//  other twenty are consequences.
// ======================================================================
export const ALARMS = [
  ['REACTOR TRIP',     'all', p => p.trip, 'bad'],
  ['TURBINE TRIP',     'all', p => p.sec.tripped, 'bad'],
  ['HIGH FLUX',        'rx',  p => p.k.P > 1.08, ''],
  ['OT dT',            'rx',  p => p.f.otdtTrip, 'bad'],
  ['OP dT',            'rx',  p => p.f.opdtTrip, 'bad'],
  ['LOW DNBR',         'rx',  p => (p.dnbr ?? 9) < 1.5, 'bad'],
  ['Tavg DEVIATION',   'rx',  p => Math.abs(p.S.Tavg - p.Tref) > 4, ''],
  ['ROD BOTTOM',       'rx',  p => p.banks.ctrlDemand < 5, ''],
  ['PZR PRESS HIGH',   'rcs', p => p.S.P - 14.7 > p.zp.pHiAlarm, ''],
  ['PZR PRESS LOW',    'rcs', p => p.S.P - 14.7 < p.zp.pLoAlarm, ''],
  ['PZR LEVEL HIGH',   'rcs', p => p.S.pzrLevel * 100 > 70, ''],
  ['PZR LEVEL LOW',    'rcs', p => p.S.pzrLevel * 100 < 25, ''],
  ['PZR PORV OPEN',    'rcs', p => p.z.porvOpen.some(Boolean), 'bad'],
  ['PZR SAFETY OPEN',  'rcs', p => p.z.safetyOpen.some(Boolean), 'bad'],
  ['LOW SUBCOOLING',   'rcs', p => p.S.subcooling < 25, 'bad'],
  ['RCS VOID',         'rcs', p => p.S.voidMax > 0.01, 'bad'],
  ['LOW RCS FLOW',     'rcs', p => p.S.W.some(w => w < 0.9 * p.rp.Wrated), ''],
  ['RCP TRIPPED',      'rcs', p => p.E.rcpOn.some(x => !x), ''],
  ['PRT RUPTURED',     'rcs', p => p.z.prtRuptured, 'bad'],
  ['SG LEVEL LO-LO',   'sec', p => p.sgs.some(s => s.lvlNR < p.sp.lvlLoLo), 'bad'],
  ['SG LEVEL LOW',     'sec', p => p.sgs.some(s => s.lvlNR < p.sp.lvlLo), ''],
  ['SG LEVEL HIGH',    'sec', p => p.sgs.some(s => s.lvlNR > p.sp.lvlHi), ''],
  ['SG SAFETY OPEN',   'sec', p => p.sgs.some(s => s.nSafetyOpen > 0), 'bad'],
  ['SG ARV OPEN',      'sec', p => p.sgs.some(s => s.arvOpen), ''],
  ['STEAM DUMPS OPEN', 'sec', p => p.sec.dumpPos > 0.02, ''],
  ['FEED PUMP TRIP',   'sec', p => p.sec.mfpOn.some(x => !x), ''],
  ['AFW ACTUATED',     'sec', p => p.sec.afwOn, ''],
  ['SG TUBES UNCOVERED','sec',p => p.sgs.some(s => s.tubeUncovered), 'bad'],
  ['SAFETY INJECTION', 'rcs', p => p.si && p.si.actuated, 'bad'],
  ['ACCUMULATORS FIRING','rcs',p => p.si && p.si.acc.some(a => a.discharging), 'bad'],
  ['RWST LEVEL LOW',   'rcs', p => p.si && p.si.rwstPct < p.sip.rwstLoPct, 'bad'],
  ['ON SUMP RECIRC',   'rcs', p => p.si && p.si.suction === 'sump', ''],
  ['RCS LEAK / BREAK', 'rcs', p => (p.breakIn2 || 0) > 0, 'bad'],
  ['RHR IN SERVICE',   'rcs', p => p.rhr && p.rhr.inService, 'ok'],
  ['BORATING',         'rx',  p => p.borateGpm > 0, ''],
  ['DILUTING',         'rx',  p => p.diluteGpm > 0, ''],
  ['CNMT PRESS HIGH',  'rcs', p => p.cnmt && p.cnmt.psig > p.cnp.isolPsig, 'bad'],
  ['CNMT ISOLATED',    'rcs', p => p.cnmt && p.cnmt.isolated, 'bad'],
  ['CNMT SPRAY',       'rcs', p => p.cnmt && p.cnmt.sprayGpm > 0, 'bad'],
  ['CNMT NEAR DESIGN', 'rcs', p => p.cnmt && p.cnmt.psig > p.cnp.designPsig * 0.85, 'bad'],
  ['PARTIAL TRIP',     'rx',  p => p.rps && p.rps.alarms.partialTrip, ''],
  ['CHANNEL BYPASSED',  'rx',  p => p.rps && p.rps.alarms.anyBypassed, ''],
  ['CHANNEL FAILED',    'rx',  p => p.rps && p.rps.alarms.anyFailed, 'bad'],
  ['P-11 BLOCK',        'rcs', p => p.rps && p.rps.p11Block, ''],
  ['CNMT ISOLATION A',  'rcs', p => p.rps && p.rps.esf.isolA.actuated, 'bad'],
  ['MSIV CLOSURE',      'sec', p => p.rps && p.rps.esf.msiv.actuated, 'bad'],
  ['FEEDWATER ISOLATION','sec',p => p.rps && p.rps.esf.fwIsol.actuated, 'bad'],
  ['LOSS OF OFFSITE',  'el',  p => !p.E.gridAvail, 'bad'],
  ['GENERATOR TRIP',   'el',  p => p.E.tripped, 'bad'],
  ['AUX BUS UNDERVOLT','el',  p => p.E.Vaux[0] < 0.9, 'bad'],
  ['SAFETY BUS ON DG', 'el',  p => p.E.safetyFrom.some(s => s === 'edg'), ''],
  ['DG RUNNING',       'el',  p => p.E.edg.some(e => e.running), 'ok'],
  ['DG FAILED',        'el',  p => p.E.edg.some(e => e.tripped), 'bad']
];

/**
 * ISA sequence per point.  Most are A (self-clearing).  Anything that
 * represents a PROTECTIVE ACTION or an actuation is M or R, because a
 * safeguard that operated and reset itself must not vanish from the board.
 */
const SEQ = {
  'REACTOR TRIP':'M', 'TURBINE TRIP':'M', 'OT dT':'R', 'OP dT':'R',
  'PZR PORV OPEN':'R', 'PZR SAFETY OPEN':'M', 'PRT RUPTURED':'M',
  'SG SAFETY OPEN':'M', 'SAFETY INJECTION':'M', 'ACCUMULATORS FIRING':'M',
  'ON SUMP RECIRC':'M', 'RCS LEAK / BREAK':'M', 'CNMT ISOLATED':'M',
  'CNMT SPRAY':'M', 'CNMT ISOLATION A':'M', 'MSIV CLOSURE':'M',
  'FEEDWATER ISOLATION':'M', 'LOSS OF OFFSITE':'M', 'GENERATOR TRIP':'M',
  'DG FAILED':'M', 'CHANNEL FAILED':'M', 'AFW ACTUATED':'R',
  'LOW SUBCOOLING':'R', 'RCS VOID':'R', 'SG LEVEL LO-LO':'R',
  'CNMT PRESS HIGH':'R', 'RWST LEVEL LOW':'R', 'CNMT NEAR DESIGN':'M'
};

/** Point list in the shape the ISA-18.1 engine expects. */
export function annunPoints() {
  return ALARMS.map(a => ({
    name: a[0], group: a[1], cls: a[3],
    seqType: SEQ[a[0]] || 'A',
    firstOut: true
  }));
}
export function readPoint(PL, i) {
  try { return !!ALARMS[i][2](PL); } catch (e) { return false; }
}

export function makeAlarmState() {
  return { st: ALARMS.map(() => ({ on: false, ack: false })), first: -1, anyNew: false };
}

export function updateAlarms(A, PL) {
  A.anyNew = false;
  for (let i = 0; i < ALARMS.length; i++) {
    let on = false;
    try { on = !!ALARMS[i][2](PL); } catch (e) { on = false; }
    const s = A.st[i];
    if (on && !s.on) { s.ack = false; if (A.first < 0) A.first = i; }
    s.on = on;
    if (on && !s.ack) A.anyNew = true;
  }
  if (!A.st.some(s => s.on)) A.first = -1;
  return A;
}
export function ackAll(A) { A.st.forEach(s => s.ack = true); }

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
