// ======================================================================
//  t_firstout.js — the two annunciator defects found in the 0.18 review
//
//  1. First-out latched per GROUP.  There are five groups and fourteen board
//     sections, so steam generators A, B and C shared one latch with steam
//     and feedwater.  De-aggregating the windows and then collapsing their
//     first-out relays throws away the answer to "which one", which is the
//     only reason the windows were de-aggregated.
//
//  2. Six SEQ keys named windows that no longer existed.  Those windows fell
//     back to sequence A and reset themselves silently, so a safety valve
//     that lifted and reseated left no trace on the board.
// ======================================================================

import * as AN from '../ui/annun.js';
import * as AL from '../ui/alarms.js';

let bad = 0;
const ok = (name, cond, note = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name.padEnd(46)} ${note}`);
  if (!cond) bad++;
};

console.log('=== A. first-out is latched per board section ===\n');
{
  const pts = AL.annunPoints();
  const E = AN.makeEngine(pts);
  const idx = n => pts.findIndex(p => p.name === n);

  const sgA = idx('SG A LEVEL LOW');
  const sgB = idx('SG B LEVEL LOW');
  const fw  = idx('FEED / STEAM MISMATCH');
  const el  = idx('GEN BREAKER OPEN');
  ok('the four probe windows exist', sgA >= 0 && sgB >= 0 && fw >= 0 && el >= 0);
  ok('SG A and SG B are different sections', pts[sgA].section !== pts[sgB].section,
     `${pts[sgA].section} / ${pts[sgB].section}`);
  ok('SG A and feedwater share a GROUP', pts[sgA].group === pts[fw].group, pts[sgA].group);

  // alarm SG A first, then SG B, then feedwater, then electrical
  const on = new Set();
  const step = () => AN.step(E, i => on.has(i), 0.1);
  step();
  on.add(sgA); step();
  on.add(sgB); step();
  on.add(fw);  step();
  on.add(el);  step();

  const first = i => AN.render(E, i, 0).first;
  ok('SG A holds its own first-out', first(sgA));
  ok('SG B holds its own first-out', first(sgB),
     'it initiated its bay, and is not a consequence of SG A');
  ok('feedwater holds its own first-out', first(fw));
  ok('electrical holds its own first-out', first(el));
  ok('four distinct latches, not one',
     Object.keys(E.firstOutGroup).length === 4, Object.keys(E.firstOutGroup).join(', '));

  // and within a bay, the second window in is NOT first-out
  const sgAhi = idx('SG A LEVEL HIGH');
  on.add(sgAhi); step();
  ok('a consequence in the same bay is not first-out', !first(sgAhi));
  ok('the initiating window keeps the latch', first(sgA));
}

console.log('\n=== B. every SEQ key names a real window ===\n');
{
  const orphans = AL.seqTableOrphans();
  ok('no orphaned sequence assignments', orphans.length === 0, orphans.join(', '));

  // anything that represents a protective ACTION must not self-reset
  const pts = AL.annunPoints();
  const mustLatch = [
    'SG A SAFETY OPEN', 'SG B SAFETY OPEN', 'SG C SAFETY OPEN',
    'PORV 1 OPEN', 'PORV 2 OPEN', 'SAFETY INJECTION',
    'CNMT SPRAY A RUNNING', 'CNMT SPRAY B RUNNING',
    'MSIV CLOSURE SIGNAL', 'DG 1 FAILED', 'DG 2 FAILED',
    'SG A LEVEL LO-LO', 'SG B LEVEL LO-LO', 'SG C LEVEL LO-LO'
  ];
  for (const n of mustLatch) {
    const p = pts.find(q => q.name === n);
    ok(`${n} does not self-reset`, !!p && p.seqType !== 'A', p ? p.seqType : 'MISSING');
  }
}

console.log('\n=== C. a latching window survives a transient ===\n');
{
  const pts = [{ name: 'SG A SAFETY OPEN', group: 'sec', section: 'STEAM GENERATOR A',
                 seqType: 'M', firstOut: true, cls: 'bad' }];
  const E = AN.makeEngine(pts);
  let v = false;
  const step = () => AN.step(E, () => v, 0.1);
  step();
  v = true;  step();                       // valve lifts
  AN.acknowledge(E);
  v = false; step();                       // valve reseats
  ok('window stays lit after the process returns',
     AN.render(E, 0, 0).lit, E.st[0].state);
  AN.reset(E); step();
  ok('window clears only when reset', !AN.render(E, 0, 0).lit, E.st[0].state);
}

console.log(bad ? `\nFIRST-OUT AUDIT: ${bad} FAILED` : '\nFIRST-OUT AUDIT: ALL CHECKS PASSED');
process.exit(bad ? 1 : 0);
