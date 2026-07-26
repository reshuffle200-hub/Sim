// ======================================================================
//  t_nuisance.js — a healthy plant must not light the board
//
//  Seventeen windows were lit at steady full power on a plant with nothing
//  wrong with it.  That is the single most damaging thing an annunciator can
//  do, and it is not a cosmetic complaint: a board with permanently lit windows
//  teaches an operator that lit windows are background, and the next real alarm
//  arrives into a wall that already looks like this one.  It is close to the
//  literal finding of the TMI-2 human factors reviews.
//
//  The defects were all the same shape -- a window annunciating the NORMAL
//  configuration:
//
//    GENERATOR OFF LINE     read E.online, a field never set, so it was lit
//                           through 916 MWe of full power operation
//    SUBCOOLING MARGIN      set at 50 F against a normal value of 43 F
//    FEED REG VALVES OPEN   they are full open at full power by design
//    RHR x6                 RHR cannot be in service at operating pressure
//    SR HIGH FLUX/OFF SCALE source range is blocked above P-6 on purpose
//    standby pumps x3       a stopped pump in AUTO is a standby train
//
//  So this test asserts the property directly, at several plant states, rather
//  than trusting that nobody adds another one.
// ======================================================================

import * as PLANT from '../lib/plant.js';
import * as AL from '../ui/alarms.js';
import * as AN from '../ui/annun.js';

let bad = 0;
const ok = (name, cond, note = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name.padEnd(44)} ${note}`);
  if (!cond) bad++;
};

/** Windows lit after letting the engine settle, split by class. */
function litOn(PL) {
  const E = AN.makeEngine(AL.annunPoints());
  for (let i = 0; i < 60; i++) AN.step(E, j => AL.readPoint(PL, j), 0.05);
  const alarms = [], status = [];
  for (let i = 0; i < E.points.length; i++) {
    if (!AN.render(E, i, 0).lit) continue;
    (E.points[i].cls === 'ok' ? status : alarms).push(E.points[i].name);
  }
  return { alarms, status, total: alarms.length + status.length };
}

console.log('=== A. steady full power ===\n');
{
  const PL = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(PL, 1.0, 900);
  const { alarms, status } = litOn(PL);
  console.log(`  ${alarms.length} alarm windows, ${status.length} status windows`);
  if (alarms.length) console.log(`  alarms: ${alarms.join(', ')}`);
  console.log(`  status: ${status.join(', ') || 'none'}\n`);

  ok('no alarm window lit on a healthy plant', alarms.length === 0, alarms.join(', '));
  ok('status windows are few and deliberate', status.length <= 4,
     'standby trains armed, which a board does show');
  ok('the generator is not reported off line',
     !alarms.includes('GENERATOR OFF LINE') && PL.E.genBkr,
     `${PL.sec.MWe.toFixed(0)} MWe through a closed breaker`);
  ok('subcooling margin is not in alarm', !alarms.includes('SUBCOOLING MARGIN'),
     `${PL.S.subcooling.toFixed(1)} F actual`);
  ok('RHR being out of service is not annunciated',
     !alarms.some(n => n.startsWith('RHR')),
     'it cannot be in service at operating pressure');
}

console.log('=== B. it still lights when something IS wrong ===\n');
{
  // The cure for a noisy board must not be a board that says nothing. Each of
  // the loosened predicates is checked to still fire in the condition it was
  // actually written for.
  const cases = [
    ['generator trips', p => { p.sec.tripped = true; p.E.genBkr = false; },
      'GENERATOR OFF LINE'],
    ['subcooling lost', p => { p.S.subcooling = 12; }, 'SUBCOOLING MARGIN'],
    ['CCW standby pump taken out of auto',
      p => { p.cw.pumpOn[2] = false; p.cw.pumpAuto[2] = false; }, 'CCW PUMP 3 OFF'],
    ['service water standby out of auto',
      p => { p.cw.swPumpOn[2] = false; p.cw.swPumpAuto[2] = false; }, 'SW PUMP 3 OFF'],
    ['condensate standby out of auto',
      p => { p.cd.condPumpOn[2] = false; p.cd.condPumpAuto[2] = false; },
      'COND PUMP 3 OFF']
  ];
  for (const [name, setup, expect] of cases) {
    const p = PLANT.makePlant({ life: 'MOL' });
    PLANT.initPlant(p, 1.0, 300);
    setup(p);
    // Deliberately NOT stepped: subcooling and pressure are derived every step,
    // so stepping would recompute the very values the case just set and the
    // test would be checking the plant solver rather than the predicate.
    ok(name, litOn(p).alarms.includes(expect), expect);
  }
}

console.log('\n=== C. RHR annunciates once it is relevant ===\n');
{
  // Below the entry permissive RHR is something you might actually want, so its
  // windows become conditions again rather than descriptions of physics.
  const p = PLANT.makePlant({ life: 'MOL' });
  PLANT.initHotStandby(p);
  p.S.P = 200;                                   // well below the permissive
  const lit = litOn(p).alarms;
  ok('below the permissive, RHR out of service is a condition',
     lit.some(n => n.startsWith('RHR')),
     `RCS ${(p.S.P - 14.7).toFixed(0)} psig vs permissive ${p.rh.permissivePsig}`);
}

console.log('\n=== D. hot standby lights only true things ===\n');
{
  const p = PLANT.makePlant({ life: 'MOL' });
  PLANT.initHotStandby(p);
  PLANT.stepPlant(p, 0.05);
  const { alarms } = litOn(p);
  console.log(`  ${alarms.length} lit: ${alarms.join(', ')}\n`);
  // Every one of these is a correct description of hot standby, so the test is
  // that nothing OUTSIDE that set appears -- not that the board is dark.
  const expected = /ROD|TURBINE OFF|SI BLOCKED|PR BELOW|GEN|UAT|BREAKER|C[ABCD] FULLY/;
  const unexpected = alarms.filter(n => !expected.test(n));
  ok('nothing lit that is not true of hot standby', unexpected.length === 0,
     unexpected.join(', ') || 'all consistent with the state');
  ok('rods are reported bottomed', alarms.some(n => /ROD BOTTOM|FULLY INSERTED/.test(n)));
}

console.log(bad ? `\nNUISANCE AUDIT: ${bad} FAILED` : '\nNUISANCE AUDIT: ALL CHECKS PASSED');
process.exit(bad ? 1 : 0);
