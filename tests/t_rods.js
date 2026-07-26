// ======================================================================
//  t_rods.js — rod drive mechanism and digital rod position indication
//
//  The whole reason for this module is that DRPI must be a MEASUREMENT and not
//  a readout.  A simulator that prints the step counter under a heading marked
//  DRPI looks identical to this one on a healthy core and hides every fault the
//  instrument exists to reveal.  So most of these tests are about the two
//  disagreeing, and about the indication being coarse, two-channel and
//  fallible in the ways the real one is.
// ======================================================================

import * as PLANT from '../lib/plant.js';
import * as RO from '../lib/rods.js';
import * as RX from '../lib/reactivity.js';

let bad = 0;
const ok = (name, cond, note = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name.padEnd(46)} ${note}`);
  if (!cond) bad++;
};
const run = (PL, sec, dt = 0.05) => { for (let i = 0; i < sec / dt; i++) PLANT.stepPlant(PL, dt); };
const fresh = (s = 300) => {
  const PL = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(PL, 1.0, s);
  return PL;
};
const rodOf = (PL, id) => PL.ro.rods.findIndex(r => r.id === id);

console.log('=== A. the new formula reduces exactly to the old one ===\n');
{
  // This is the load-bearing claim. Bank worth is split equally among the rods
  // in the bank, so on a core where every rod tracks its demand the per-rod sum
  // must return EXACTLY what the bank-level formula returned. If it does not,
  // adding rod detail has quietly changed the reactivity of a healthy plant.
  const PL = fresh();
  for (const demand of [528, 500, 400, 220, 100, 0]) {
    PL.banks.ctrlDemand = demand;
    RO.alignRods(PL.ro, {
      ctrl: RX.bankPositions(PL.rx, demand), sd: PL.banks.sd
    });
    const bankW = RX.rodWorth(PL.rx, PL.banks);
    const rodW = RO.rodWorthActual(PL.rx, PL.ro, RX.bankIntegral);
    ok(`identical at ${String(demand).padStart(3)} steps`,
       Math.abs(rodW - bankW) < 1e-9, `${bankW.toFixed(2)} pcm`);
  }
}

console.log('\n=== B. indication is coarse, because the coils are ===\n');
{
  const PL = fresh();
  const i = rodOf(PL, 'CD-1');
  const rod = PL.ro.rods[i];
  const sp = PL.rop.coilSpacing;

  let worst = 0;
  for (let pos = 0; pos <= PL.ro.stepsPerBank; pos += 1) {
    rod.actual = pos;
    const d = RO.readDRPI(PL.rop, rod, PL.ro.stepsPerBank);
    worst = Math.max(worst, Math.abs(d - pos));
    if (d % sp !== 0 && d !== PL.ro.stepsPerBank) { worst = 999; break; }
  }
  ok('every reading lands on a coil', worst < 999);
  ok(`accurate to ±${sp / 2} steps with both channels`, worst <= sp / 2,
     `worst ${worst} steps`);

  rod.drpiA = false;
  let worst1 = 0;
  for (let pos = 0; pos <= PL.ro.stepsPerBank; pos += 1) {
    rod.actual = pos;
    worst1 = Math.max(worst1, Math.abs(RO.readDRPI(PL.rop, rod, PL.ro.stepsPerBank) - pos));
  }
  ok('one channel halves the resolution', worst1 > sp / 2 && worst1 <= sp,
     `worst ${worst1} steps -- degraded, not failed`);

  rod.drpiB = false;
  ok('no channels means NO INDICATION, not zero',
     RO.readDRPI(PL.rop, rod, PL.ro.stepsPerBank) === null,
     'a rod with no indication is not a rod on the bottom');
  rod.drpiA = true; rod.drpiB = true;
}

console.log('\n=== C. a small slip is genuinely invisible ===\n');
{
  const PL = fresh();
  const i = rodOf(PL, 'CC-1');
  const before = PL.ro.drpi[i];
  PL.ro.rods[i].actual -= 3;                  // half the coil spacing
  RO.stepRods(PL.rop, PL.ro, {
    ctrl: RX.bankPositions(PL.rx, PL.banks.ctrlDemand), sd: PL.banks.sd
  }, 0.05, {});
  ok('a 3-step slip does not move the indication', PL.ro.drpi[i] === before,
     'below the coil spacing, so the instrument cannot see it');
  ok('and no deviation alarm fires', !PL.ro.alarms.rodDeviation,
     'the alarm sits outside the resolution on purpose');
}

console.log('\n=== D. a dropped rod ===\n');
{
  const PL = fresh(600);
  const i = rodOf(PL, 'CD-3');
  const p0 = PL.k.Ptot;
  RO.dropRod(PL.ro, 'CD-3');

  run(PL, 5);
  ok('the rod is on the bottom within seconds', PL.ro.drpi[i] <= PL.rop.rodBottomSteps,
     `${PL.rop.dropSec} s gravity insertion`);
  ok('DRPI says bottom while the counter does not',
     PL.ro.drpi[i] <= PL.rop.rodBottomSteps
     && PL.ro.rods[i].demand > PL.rop.rodBottomSteps,
     'which is the entire diagnostic');
  ok('rod deviation alarms', PL.ro.alarms.rodDeviation);
  ok('rod bottom alarms', PL.ro.alarms.rodBottom);
  ok('its bank reads misaligned', PL.ro.alarms.bankMisaligned);
  ok('the other 47 rods are unaffected',
     PL.ro.deviation.filter((d, j) => j !== i && Math.abs(d) > PL.rop.deviationSteps)
       .length === 0);

  run(PL, 240);
  console.log(`  power ${(p0 * 100).toFixed(1)}% -> ${(PL.k.Ptot * 100).toFixed(1)}%, ` +
              `demand counter ${PL.banks.ctrlDemand.toFixed(0)} steps`);
  ok('power dipped and was recovered by the controller',
     PL.k.Ptot > p0 * 0.97, 'the bank withdraws to compensate');
  ok('the deviation persists through the recovery', PL.ro.alarms.rodBottom,
     'compensating for a dropped rod does not un-drop it');
}

console.log('\n=== E. a stuck rod is the opposite failure ===\n');
{
  const PL = fresh();
  // Bank D is the one that moves: with 128-step overlap, banks A to C are
  // fully withdrawn and stay there until the demand counter drops a long way,
  // so sticking a bank C rod and reducing demand by 60 steps moved nothing at
  // all and the test was asserting against a rod that was never commanded.
  const i = rodOf(PL, 'CD-1');
  RO.stickRod(PL.ro, 'CD-1');
  const held = PL.ro.rods[i].actual;
  PL.rodAuto = false;
  PL.banks.ctrlDemand -= 60;                  // drive the bank in
  run(PL, 90);
  console.log(`  demand ${PL.ro.rods[i].demand} steps, actual ${PL.ro.rods[i].actual.toFixed(0)}`);
  ok('the stuck rod did not move', Math.abs(PL.ro.rods[i].actual - held) < 1);
  ok('but its counter kept counting', PL.ro.rods[i].demand < held - 10,
     'the counter counts pulses sent, not motion achieved');
  ok('deviation alarms on the disagreement', PL.ro.alarms.rodDeviation);
  ok('rod bottom does NOT alarm', !PL.ro.alarms.rodBottom,
     'stuck out is not the same failure as dropped in');
  ok('rod motion is inhibited', PL.rodInhibit,
     'a system that has lost track of a rod should stop moving them');
}

console.log('\n=== F. a trip puts every rod on the bottom ===\n');
{
  const PL = fresh();
  PL.trip = true; PL.tripMsg = 'MANUAL TRIP';
  run(PL, 5);
  ok('all 48 rods bottomed', PL.ro.rods.every(r => r.actual <= PL.rop.rodBottomSteps),
     `within ${PL.rop.dropSec} s`);
  ok('RODS NOT AT BOTTOM has cleared', !PL.ro.alarms.notAtBottom);

  const PL2 = fresh();
  RO.stickRod(PL2.ro, 'SA-1');
  PL2.trip = true;
  run(PL2, 10);
  ok('a stuck rod fails to insert on a trip',
     PL2.ro.rods[rodOf(PL2, 'SA-1')].actual > PL2.rop.rodBottomSteps);
  ok('and that is annunciated', PL2.ro.alarms.notAtBottom,
     'the one thing you must know after a trip');
}

console.log('\n=== G. reactivity follows actual position ===\n');
{
  const PL = fresh();
  const clean = RO.rodWorthActual(PL.rx, PL.ro, RX.bankIntegral);
  RO.dropRod(PL.ro, 'CD-3');
  run(PL, 10);
  const dropped = RO.rodWorthActual(PL.rx, PL.ro, RX.bankIntegral);
  console.log(`  rod worth ${clean.toFixed(0)} -> ${dropped.toFixed(0)} pcm`);
  ok('a dropped rod inserts negative reactivity', dropped < clean - 5);
  ok('and it is a fraction of its bank', clean - dropped < PL.rx.ctrlBankWorth[3],
     'one rod of eight, not the whole bank');
}

console.log('\n=== H. no runaway numbers ===\n');
{
  const cases = [
    ['every rod dropped', p => p.ro.rods.forEach(r => { r.dropped = true; })],
    ['every rod stuck', p => p.ro.rods.forEach(r => { r.stuck = true; })],
    ['all indication lost', p => p.ro.rods.forEach(r => { r.drpiA = false; r.drpiB = false; })],
    ['half a bank dropped', p => p.ro.rods.filter(r => r.group === 'CD')
      .slice(0, 4).forEach(r => { r.dropped = true; })],
    ['slipping rods', p => p.ro.rods.forEach(r => { r.slip = 30; })]
  ];
  for (const [name, setup] of cases) {
    const p = fresh(200);
    setup(p);
    run(p, 300);
    const positions = p.ro.rods.map(r => r.actual);
    ok(name,
       positions.every(v => Number.isFinite(v) && v >= 0 && v <= p.ro.stepsPerBank)
       && Number.isFinite(p.S.Tavg) && p.S.Tavg > 100 && p.S.Tavg < 700,
       `Tavg ${p.S.Tavg.toFixed(0)} F${p.trip ? ', tripped' : ''}`);
  }
}

console.log('\n=== I. the core map ===\n');
{
  const loc = RO.rccaLocations();
  ok('157 assemblies in the lattice',
     RO.ROW_WIDTHS.reduce((a, b) => a + b, 0) === 157,
     '13x13 with three cut from each corner');
  ok('48 rod cluster locations', loc.length === 48);
  ok('every location is inside the core',
     loc.every(l => RO.inCore(l.row, l.col)));
  ok('no location used twice',
     new Set(loc.map(l => l.row + ',' + l.col)).size === 48);
  ok('no rod at the core centre',
     !loc.some(l => l.row === 6 && l.col === 6),
     'the centre assembly carries instrumentation, not a cluster');

  // Symmetry is the property worth asserting: the pattern is generated, so a
  // change to the generator that broke symmetry would otherwise go unnoticed.
  const set = new Set(loc.map(l => l.row + ',' + l.col));
  ok('symmetric under 180 degrees',
     loc.every(l => set.has((12 - l.row) + ',' + (12 - l.col))));
  ok('symmetric under transpose',
     loc.every(l => set.has(l.col + ',' + l.row)));

  const PL = fresh(120);
  ok('every rod carries a core address',
     PL.ro.rods.every(r => /^[A-N]\d{1,2}$/.test(r.core)),
     PL.ro.rods.slice(0, 3).map(r => r.core).join(' '));
  ok('core addresses are unique',
     new Set(PL.ro.rods.map(r => r.core)).size === 48);
  ok('rows are lettered without I', !RO.CORE_ROWS.includes('I'),
     'I reads as a 1 on a core map');
}

console.log('\n=== J. rod insertion limits ===\n');
{
  const PL = fresh();
  const rp = PL.rop;
  const atPower = RO.insertionLimit(rp, 1.0, PL.banks.ctrlDemand);
  console.log(`  full power: banks at ${PL.banks.ctrlDemand.toFixed(0)}, ` +
              `limit ${atPower.limit.toFixed(0)}, margin ${atPower.margin.toFixed(0)} steps`);
  ok('banks are above the limit at full power', !atPower.lo,
     `${atPower.margin.toFixed(0)} steps of margin`);
  ok('the limit rises with power',
     RO.insertionLimit(rp, 1.0, 0).limit > RO.insertionLimit(rp, 0, 0).limit,
     'a larger trip needs more margin from the banks left out');
  const deep = RO.insertionLimit(rp, 1.0, rp.rilBase + rp.rilSlope - 5);
  ok('driving the banks in violates it', deep.loLo);
  const near = RO.insertionLimit(rp, 1.0, rp.rilBase + rp.rilSlope + 10);
  ok('and warns before it does', near.lo && !near.loLo,
     'low is the warning, low-low is the action');
}

console.log('\n=== K. DADS — the advanced display system ===\n');
{
  // Modelled against the Westinghouse data sheet, so these check the documented
  // behaviour rather than a guess at it.
  const PL = fresh(200);

  // half accuracy: a CHOICE as well as a failure
  RO.setHalfAccuracy(PL.ro, 'CD-1', true);
  run(PL, 2);
  const i = rodOf(PL, 'CD-1');
  ok('a rod can be forced to half accuracy', PL.ro.rods[i].halfAccuracy);
  ok('and it is annunciated separately from a failure', PL.ro.alarms.halfAccuracy,
     'the operator has to know it is on 12-step resolution');
  ok('it still indicates', PL.ro.drpi[i] !== null, 'degraded, not lost');
  RO.setHalfAccuracy(PL.ro, 'CD-1', false);

  // data cabinets: a fault takes a GROUP
  const p2 = fresh(200);
  RO.failCabinet(p2.ro, 2);
  run(p2, 2);
  const dark = p2.ro.drpi.filter(d => d === null).length;
  ok('a cabinet fault darkens its whole group', dark === 12,
     `${dark} rods, which is why diagnostics identify WHICH cabinet`);
  ok('it is annunciated', p2.ro.alarms.cabinetFault);
  ok('the other three cabinets keep indicating',
     p2.ro.drpi.filter(d => d !== null).length === 36);

  // Gray code: one bit changes per transition
  let multibit = 0;
  for (let n = 0; n < 37; n++) {
    const a = RO.grayCode(n * 6, 6), b = RO.grayCode((n + 1) * 6, 6);
    const diff = [...a].filter((c, k) => c !== b[k]).length;
    if (diff !== 1) multibit++;
  }
  ok('Gray code changes one bit per step', multibit === 0,
     'a read caught mid-transition is off by one step, not by half the core');

  // redundant display trains
  const p3 = fresh(200);
  p3.ro.trainA = false;
  run(p3, 2);
  ok('losing one display train is a fault, not a loss',
     p3.ro.alarms.trainFault && !p3.ro.alarms.displayLost);
  ok('every rod still indicates on the surviving train',
     p3.ro.drpi.every(d => d !== null),
     'either train alone shows all rod positions');
  p3.ro.trainB = false;
  run(p3, 2);
  ok('losing both is annunciated as lost', p3.ro.alarms.displayLost);
}

console.log('\n=== L. integrated rod drop testing ===\n');
{
  const PL = fresh(200);
  RO.startDropTest(PL.ro);
  PL.trip = true;                                // the test is timed off the breaker
  run(PL, 8, 0.02);
  const T = PL.ro.dropTest;
  const times = T.times.filter(t => t !== null);
  console.log(`  ${times.length} of 48 rods timed, ` +
              `${Math.min(...times).toFixed(2)}–${Math.max(...times).toFixed(2)} s ` +
              `against a ${PL.rop.dropTestLimitSec} s limit`);
  ok('the test completes', T.done);
  ok('every rod was timed', times.length === 48);
  ok('all within the acceptance criterion',
     times.every(t => t <= PL.rop.dropTestLimitSec) && !PL.ro.alarms.dropTestFail);
  ok('timed to dashpot entry, not to zero',
     PL.ro.rods.every(r => r.actual <= PL.rop.dashpotSteps),
     'the dashpot decelerates the last stretch');

  // a stuck rod fails the test rather than quietly never finishing
  const p2 = fresh(200);
  RO.stickRod(p2.ro, 'SB-1');
  RO.startDropTest(p2.ro);
  p2.trip = true;
  run(p2, 20, 0.02);
  ok('a stuck rod fails the drop test', p2.ro.alarms.dropTestFail);
  ok('and the test still terminates', p2.ro.dropTest.done,
     'it times out rather than waiting forever');
}

console.log(bad ? `\nROD AUDIT: ${bad} FAILED` : '\nROD AUDIT: ALL CHECKS PASSED');
process.exit(bad ? 1 : 0);
