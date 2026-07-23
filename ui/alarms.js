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
  ['LOSS OF OFFSITE',  'el',  p => !p.E.gridAvail, 'bad'],
  ['GENERATOR TRIP',   'el',  p => p.E.tripped, 'bad'],
  ['AUX BUS UNDERVOLT','el',  p => p.E.Vaux[0] < 0.9, 'bad'],
  ['SAFETY BUS ON DG', 'el',  p => p.E.safetyFrom.some(s => s === 'edg'), ''],
  ['DG RUNNING',       'el',  p => p.E.edg.some(e => e.running), 'ok'],
  ['DG FAILED',        'el',  p => p.E.edg.some(e => e.tripped), 'bad']
];

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
