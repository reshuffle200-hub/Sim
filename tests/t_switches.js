// ======================================================================
//  t_switches.js — every handle on the board does what it says
//
//  A switch whose write does nothing, or whose read disagrees with what its
//  write just did, is worse than no switch: it is a handle an operator will
//  pull and believe. Two ways that happened here, both silent:
//
//    * Four wired singletons -- CCWAPI, RADAPI, SIAPI, RODAPI -- that
//      index.html populated at startup. Unwired they were no-op stubs, so nine
//      switches did nothing in any host that had not called the matching wire
//      function, and did it without erroring.
//    * actuate() caught every exception from write() and returned false, and
//      nothing checked the return value. A switch whose write threw looked
//      exactly like one that worked.
//
//  So this walks every switch through every position with the real api and
//  asserts both halves: the write succeeded, and the read agrees.
// ======================================================================

import * as PLANT from '../lib/plant.js';
import * as CT from '../ui/controls.js';

let bad = 0;
const ok = (name, cond, note = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name.padEnd(44)} ${note}`);
  if (!cond) bad++;
};

const api = CT.switchApi();

console.log('=== A. the api is complete ===\n');
{
  // Assembled in controls.js and exported, so the shell and the tests use the
  // same one. When it lived only in index.html an audit built its own, missed
  // setChannel, and reported eight working switches as broken.
  const needed = new Set();
  for (const sw of CT.SWITCHES) {
    const src = sw.write.toString();
    for (const m of src.matchAll(/api\.(\w+)/g)) needed.add(m[1]);
  }
  const missing = [...needed].filter(k => typeof api[k] !== 'function');
  ok('every api function a switch calls is provided', missing.length === 0,
     missing.join(', ') || [...needed].sort().join(', '));
}

console.log('\n=== B. every switch writes and reads back ===\n');
{
  const PL = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(PL, 1.0, 200);

  const failedWrite = [], mismatched = [], threwRead = [];
  for (let i = 0; i < CT.SWITCHES.length; i++) {
    const sw = CT.SWITCHES[i];
    for (let pos = 0; pos < sw.pos.length; pos++) {
      if (!CT.actuate(PL, i, pos, api)) failedWrite.push(`${sw.label}[${sw.pos[pos]}]`);
      let r;
      try { r = sw.read(PL); } catch (e) { threwRead.push(sw.label); continue; }
      // Momentary switches are spring-return: they report NORMAL however they
      // were just thrown, which is the point of a trip pushbutton.
      if (!sw.momentary && r !== pos) mismatched.push(`${sw.label}[${sw.pos[pos]}]->${r}`);
    }
  }
  console.log(`  ${CT.SWITCHES.length} switches, ` +
              `${CT.SWITCHES.reduce((a, s) => a + s.pos.length, 0)} positions\n`);
  ok('no write failed', failedWrite.length === 0, failedWrite.slice(0, 6).join(', '));
  ok('no read threw', threwRead.length === 0, threwRead.slice(0, 6).join(', '));
  ok('every non-momentary switch reads back what was written',
     mismatched.length === 0, mismatched.slice(0, 6).join(', '));
  ok('momentary switches are declared, not discovered',
     CT.SWITCHES.filter(s => s.momentary).length >= 4,
     CT.SWITCHES.filter(s => s.momentary).map(s => s.label).join(', '));
}

console.log('\n=== C. the plant survives every handle being thrown ===\n');
{
  const PL = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(PL, 1.0, 200);
  for (let i = 0; i < CT.SWITCHES.length; i++)
    for (let pos = 0; pos < CT.SWITCHES[i].pos.length; pos++)
      CT.actuate(PL, i, pos, api);
  for (let k = 0; k < 1200; k++) PLANT.stepPlant(PL, 0.05);

  // It is entirely reasonable for the plant to have tripped -- most of those
  // handles are meant to break something. What it must not do is go unphysical.
  const vals = [PL.S.Tavg, PL.S.P, PL.sec.MWe, PL.cw.supplyF, PL.cd.psia,
                PL.rd.primaryUCiG, ...PL.ro.rods.map(r => r.actual)];
  ok('no NaN or infinity anywhere', vals.every(Number.isFinite));
  ok('temperatures stay physical', PL.S.Tavg > 60 && PL.S.Tavg < 800,
     `Tavg ${PL.S.Tavg.toFixed(0)} F${PL.trip ? ', tripped' : ''}`);
  ok('pressure stays positive', PL.S.P > 0, `${PL.S.P.toFixed(0)} psia`);
  ok('rod positions stay in range',
     PL.ro.rods.every(r => r.actual >= 0 && r.actual <= PL.ro.stepsPerBank));
}

console.log('\n=== D. no switch is a duplicate of another ===\n');
{
  const keys = CT.SWITCHES.map(s => `${s.board}/${s.section}/${s.label}`);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  ok('every switch is uniquely addressed', dupes.length === 0, dupes.join(', '));
  ok('every switch has at least two positions',
     CT.SWITCHES.every(s => s.pos.length >= 2));
  ok('every switch declares a board that exists',
     CT.SWITCHES.every(s => ['rcs', 'secondary', 'safeguards', 'cooling',
                             'electrical', 'reactor'].includes(s.board)),
     [...new Set(CT.SWITCHES.map(s => s.board))].join(', '));
}

console.log(bad ? `\nSWITCH AUDIT: ${bad} FAILED` : '\nSWITCH AUDIT: ALL CHECKS PASSED');
process.exit(bad ? 1 : 0);
