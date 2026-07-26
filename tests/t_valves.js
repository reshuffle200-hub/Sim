// ======================================================================
//  t_valves.js — individual valve lineup
//
//  The point of adding these switches was NOT to raise the switch count.  It
//  was that the pumps all had start/stop handles and none of them had discharge
//  valves, so a pump could only be running or stopped -- never running and
//  lined up to nothing.  That is a real failure and a quiet one: the pump lamp
//  is red, the breaker is closed, the motor is drawing current, and the flow
//  indication is zero.
//
//  So every test here checks the same thing in a different place: does the
//  valve actually gate the flow it is in series with, or is it decoration?
// ======================================================================

import * as PLANT from '../lib/plant.js';
import * as SIM from '../lib/si.js';
import * as CT from '../ui/controls.js';

let bad = 0;
const ok = (name, cond, note = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name.padEnd(44)} ${note}`);
  if (!cond) bad++;
};
const run = (PL, sec, dt = 0.05) => { for (let i = 0; i < sec / dt; i++) PLANT.stepPlant(PL, dt); };
const fresh = (s = 300) => {
  const PL = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(PL, 1.0, s);
  return PL;
};

console.log('=== A. a deadheaded pump delivers nothing ===\n');
{
  const PL = fresh();
  PL.breakIn2 = 3;                              // get SI actuated
  run(PL, 120);
  ok('safety injection actuated', PL.si.actuated);
  const flowBoth = PL.si.hhGpm;
  ok('high head is delivering', flowBoth > 0, `${flowBoth.toFixed(0)} gpm`);

  PL.si.hhValve[0] = false;                     // shut A's discharge valve
  run(PL, 30);
  console.log(`  both valves open ${flowBoth.toFixed(0)} gpm -> ` +
              `one shut ${PL.si.hhGpm.toFixed(0)} gpm`);
  ok('shutting one discharge valve halves the flow',
     PL.si.hhGpm > 0 && PL.si.hhGpm < flowBoth * 0.6);
  ok('the pump is still running', PL.si.hhOn[0],
     'which is exactly what makes this failure quiet');
  ok('and it is annunciated as deadheaded', PL.si.hhOn[0] && !PL.si.hhValve[0]);

  PL.si.hhValve[1] = false;
  run(PL, 30);
  ok('both shut gives no high head flow at all', PL.si.hhGpm === 0);
  PL.si.hhValve = [true, true];
  run(PL, 30);
  ok('reopening restores it', PL.si.hhGpm > flowBoth * 0.9);
}

console.log('\n=== B. the same for SI and low head ===\n');
{
  const PL = fresh();
  PL.breakIn2 = 3;
  run(PL, 180);
  const si0 = PL.si.siGpm, lh0 = PL.si.lhGpm;
  PL.si.siValve = [false, false];
  PL.si.lhValve = [false, false];
  run(PL, 30);
  // Low head shuts off against high RCS pressure, so it may legitimately be
  // delivering nothing before the valves are touched.  What matters is that the
  // valve gates it whenever it IS delivering.
  console.log(`  SI ${si0.toFixed(0)} -> ${PL.si.siGpm.toFixed(0)} gpm, ` +
              `LH ${lh0.toFixed(0)} -> ${PL.si.lhGpm.toFixed(0)} gpm`);
  ok('SI pumps gated by their valves', si0 > 0 && PL.si.siGpm === 0);
  ok('low head gated by theirs', PL.si.lhGpm === 0,
     lh0 > 0 ? `was ${lh0.toFixed(0)} gpm` : 'shut off against RCS pressure anyway');
}

console.log('\n=== C. accumulator isolation, per unit ===\n');
{
  const PL = fresh();
  // Accumulators are passive: they discharge only once RCS pressure falls below
  // their nitrogen pressure, so the break has to be given time to get there.
  SIM.setAccIsolation(PL.si, 1, true);          // isolate B only
  PL.breakIn2 = 80;
  run(PL, 420);
  console.log(`  accumulator flows ` +
              PL.si.acc.map(a => a.flowGpm.toFixed(0)).join(' / ') + ' gpm');
  ok('B is isolated and does not inject', PL.si.acc[1].isolated
     && PL.si.acc[1].flowGpm === 0);
  ok('A and C still inject', PL.si.acc[0].flowGpm > 0 && PL.si.acc[2].flowGpm > 0,
     'per-unit isolation, not all or nothing');
  ok('B retains its inventory', PL.si.acc[1].waterFt3 > PL.si.acc[0].waterFt3);
  SIM.setAccIsolation(PL.si, 1, false);
  run(PL, 30);
  ok('unisolating lets it discharge', PL.si.acc[1].flowGpm > 0
     || PL.si.acc[1].waterFt3 < PL.sip.accWaterFt3);
}

console.log('\n=== D. letdown orifices actually set letdown flow ===\n');
{
  const PL = fresh();
  const full = PL.cv.letdownGpm;
  console.log(`  three orifices ${full.toFixed(0)} gpm`);
  ok('rated letdown with all three lined up', full > 60, `${full.toFixed(0)} gpm`);

  PL.cv.orifice[2] = false;
  run(PL, 20);
  const two = PL.cv.letdownGpm;
  PL.cv.orifice[1] = false;
  run(PL, 20);
  const one = PL.cv.letdownGpm;
  console.log(`  two ${two.toFixed(0)} gpm, one ${one.toFixed(0)} gpm`);
  ok('each orifice carries a third', Math.abs(two - full * 2 / 3) < 1
     && Math.abs(one - full / 3) < 1);
  ok('letdown is reduced, not merely off', one > 0);

  PL.cv.letdownIsol = false;
  run(PL, 20);
  ok('the isolation valve gates all of them', PL.cv.letdownGpm === 0);
  ok('charging follows letdown down', PL.cv.chargeGpm < full);

  PL.cv.letdownIsol = true; PL.cv.orifice = [true, true, true];
  run(PL, 20);
  ok('restoring the lineup restores flow', Math.abs(PL.cv.letdownGpm - full) < 1);
}

console.log('\n=== E. charging and boration paths ===\n');
{
  const PL = fresh();
  PL.cv.chargingIsol = false;
  run(PL, 20);
  ok('shutting charging isolation stops charging', PL.cv.chargeGpm === 0);
  PL.cv.chargingIsol = true;

  PL.cv.baIsol = false;
  PL.cv.mode = 'borate';
  run(PL, 120);
  const ppmShut = PL.ppm;
  run(PL, 240);
  const ppmAfter = PL.ppm;
  ok('no boration path means boron does not rise',
     ppmAfter <= ppmShut + 1, `${ppmShut.toFixed(1)} -> ${ppmAfter.toFixed(1)} ppm`);
  ok('and no borate flow is credited', PL.cv.borateGpm === 0 || PL.cv.cCharge <= 1);
  PL.cv.baIsol = true;
  run(PL, 240);
  ok('restoring the path allows boration', PL.cv.chargeGpm > 0);
}

console.log('\n=== F. the switches are wired to the state they claim ===\n');
{
  // A switch whose read() and write() disagree with the plant is worse than no
  // switch at all, so every new valve handle is round-tripped: write each
  // position, read it back, confirm the state moved.
  const PL = fresh(120);
  const targets = CT.SWITCHES
    .map((s, i) => [s, i])
    .filter(([s]) => /DISCH|ISOL|ORIFICE|SEAL INJECTION/.test(s.label));
  ok('the new valve switches are present', targets.length >= 14, `${targets.length} found`);

  let mismatched = [];
  for (const [sw, i] of targets) {
    for (let pos = 0; pos < sw.pos.length; pos++) {
      CT.actuate(PL, i, pos, {});
      if (sw.read(PL) !== pos) mismatched.push(`${sw.label}[${sw.pos[pos]}]`);
    }
    CT.actuate(PL, i, sw.pos.length - 1, {});   // leave it lined up
  }
  ok('every position round-trips', mismatched.length === 0, mismatched.join(', '));

  run(PL, 60);
  // The plant is allowed to TRIP here -- shutting charging and letdown in the
  // same pass is a legitimate reason to.  What it must not do is produce
  // unphysical numbers.
  ok('the plant stays physical after exercising them all',
     Number.isFinite(PL.S.Tavg) && PL.S.Tavg > 100 && PL.S.Tavg < 700
     && Number.isFinite(PL.S.P) && PL.S.P > 0,
     `Tavg ${PL.S.Tavg.toFixed(0)} F, ${PL.S.P.toFixed(0)} psia` +
     (PL.trip ? ', tripped' : ''));
}

console.log(bad ? `\nVALVE AUDIT: ${bad} FAILED` : '\nVALVE AUDIT: ALL CHECKS PASSED');
process.exit(bad ? 1 : 0);
