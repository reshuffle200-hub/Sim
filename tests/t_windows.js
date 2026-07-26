// ======================================================================
//  t_windows.js — audit for DEAD annunciator windows.
//
//  A window that can never light is worse than a missing one: it reads as
//  "this condition is not present" forever.  Two failure modes are silent,
//  because readPoint() swallows exceptions and NaN comparisons are false:
//
//    1. a mistyped property path       -> undefined -> comparison false
//    2. an ARRAY compared to a NUMBER  -> coerced to NaN -> always false
//
//  The second one bit twice: sec.frvPos and sec.Wafw are per-generator arrays,
//  and `p.sec.frvPos > 0.95` is false at every power because [1,1,1] stringifies
//  to "1,1,1" and then to NaN.  Both windows looked correct in review.
//
//  This audit also proves the protection-channel windows are REACHABLE, by
//  driving them through the real setChannel() API rather than poking state.
// ======================================================================
import * as PLANT from '../lib/plant.js';
import * as RPS from '../lib/rps.js';
import * as AL from '../ui/alarms.js';

let fail = 0;
const check = (name, cond, detail = '') => {
  if (!cond) { fail++; console.log(`  FAIL  ${name} ${detail}`); }
  else console.log(`  ok    ${name} ${detail}`);
};

// The RPS only evaluates inside checkTrips(), which initPlant() skips via
// noTrip -- so derived channel state does not exist until the plant is stepped
// normally.  Step first or every channel window reads undefined.
const PL = PLANT.makePlant({ life: 'MOL' });
PLANT.initPlant(PL, 1.0, 600);
for (let i = 0; i < 50; i++) PLANT.stepPlant(PL, 0.1);

// ---------------------------------------------- 1. static path audit
const resolve = (root, path) => {
  let v = root;
  for (const k of path) { if (v == null) return undefined; v = v[k]; }
  return v;
};
const missing = [], arrayCmp = [];
AL.ALARMS.forEach(a => {
  const name = a[0], src = a[2].toString();
  const pm = src.match(/^\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/);
  if (!pm) return;
  const P = pm[1];
  const re = new RegExp('\\b' + P + '((?:\\.[A-Za-z_$][\\w$]*)+)', 'g');
  const seen = new Set();
  let m;
  while ((m = re.exec(src))) {
    const path = m[1].slice(1).split('.');
    const key = path.join('.');
    if (seen.has(key)) continue;
    seen.add(key);
    const v = resolve(PL, path);
    if (v === undefined) missing.push(`${name}: ${P}.${key}`);
    if (Array.isArray(v)) {
      const esc = (P + '.' + key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(esc + '\\s*(<=|>=|<|>|===|!==|==|!=)\\s*[\\d.]').test(src) ||
          new RegExp('[\\d.]\\s*(<=|>=|<|>)\\s*' + esc).test(src))
        arrayCmp.push(`${name}: ${P}.${key} is ${JSON.stringify(v).slice(0, 24)}`);
    }
  }
});
check('every property path resolves', missing.length === 0,
      missing.length ? '\n         ' + missing.join('\n         ') : `(${AL.ALARMS.length} windows)`);
check('no array compared to a number', arrayCmp.length === 0,
      arrayCmp.length ? '\n         ' + arrayCmp.join('\n         ') : '');

// ---------------------------------------------- 2. predicates are total
let threw = 0;
AL.ALARMS.forEach((a, i) => {
  try { const r = a[2](PL); if (typeof r !== 'boolean') threw++; }
  catch (e) { threw++; }
});
check('every predicate returns a boolean', threw === 0, `(${threw} did not)`);

// ---------------------------------------------- 3. channel windows reachable
const SHORT = { pwrHi:'PWR RANGE FLUX', otdt:'OVERTEMP dT', opdt:'OVERPOWER dT',
  pzrHi:'PZR PRESS HI', pzrLo:'PZR PRESS LO', pzrLvl:'PZR LEVEL HI',
  sgLoLo:'SG LEVEL LO-LO', flowLo:'RCS FLOW LO', cnmtHi:'CNMT PRESS HI',
  slLo:'STM LINE PRESS LO', turbTrip:'TURBINE TRIP', uv:'BUS UNDERVOLT' };
const idx = {}; AL.ALARMS.forEach((a, i) => idx[a[0]] = i);

let inopOk = 0, partOk = 0;
for (const spec of RPS.RPS_PARAMS) {
  const nm = SHORT[spec.id];
  if (!nm) continue;

  // one channel bypassed -> CH INOP
  const A = PLANT.makePlant({ life:'MOL' });
  PLANT.initPlant(A, 1.0, 600); A.rps.tripBypassed = true;
  for (let i = 0; i < 10; i++) PLANT.stepPlant(A, 0.1);
  RPS.setChannel(A.rps, spec.id, 0, 'bypassed');
  for (let i = 0; i < 10; i++) PLANT.stepPlant(A, 0.1);
  if (AL.readPoint(A, idx[nm + ' CH INOP'])) inopOk++;

  // one channel failed past setpoint, the rest normal -> PARTIAL TRIP.
  // A 2-of-2 function only sits in partial trip if the degradation rule does
  // not cut its requirement to one when nothing has been removed.
  const B = PLANT.makePlant({ life:'MOL' });
  PLANT.initPlant(B, 1.0, 600); B.rps.tripBypassed = true;
  for (let i = 0; i < 10; i++) PLANT.stepPlant(B, 0.1);
  const sp = B.rps.params[spec.id].sp ?? spec.sp ?? 0;
  RPS.setChannel(B.rps, spec.id, 0, 'failed',
                 spec.dir === 'hi' ? Math.abs(sp) * 2 + 1e5 : -1e6);
  for (let i = 0; i < 10; i++) PLANT.stepPlant(B, 0.1);
  if (AL.readPoint(B, idx[nm + ' PART TRIP'])) partOk++;
}
const nFn = RPS.RPS_PARAMS.filter(s => SHORT[s.id]).length;
check('every CH INOP window reachable',   inopOk === nFn, `(${inopOk}/${nFn})`);
check('every PART TRIP window reachable', partOk === nFn, `(${partOk}/${nFn})`);

// a healthy function must require its DESIGNED coincidence, not fewer
const healthy = RPS.RPS_PARAMS.filter(s => {
  const st = PL.rps.params[s.id];
  return st && st.active === s.ch && st.need !== s.coin;
});
check('healthy channels require designed coincidence', healthy.length === 0,
      healthy.length ? '(' + healthy.map(s => s.id).join(', ') + ' degraded with nothing removed)' : '');

// ---------------------------------------------- 4. names are unique
const names = AL.ALARMS.map(a => a[0]);
const dup = names.filter((n, i) => names.indexOf(n) !== i);
check('window names unique', dup.length === 0, dup.length ? '(' + [...new Set(dup)].join(', ') + ')' : `(${names.length})`);

console.log(fail ? `\n  *** ${fail} CHECKS FAILED ***` : '\n  WINDOW AUDIT: ALL CHECKS PASSED');
process.exit(fail ? 1 : 0);
