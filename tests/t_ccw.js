// ======================================================================
//  t_ccw.js — component cooling water and service water
//
//  The point of this module is that it removes an ASSERTED boundary
//  condition: RHR used to compute its own heat sink from a constant 85 F
//  service water supply, and the reactor coolant pump thermal barriers did not
//  exist at all.  So the tests here are mostly about coupling -- does heat
//  actually travel the chain, and does losing a link produce the consequence a
//  real plant has rather than just an alarm.
// ======================================================================

import * as PLANT from '../lib/plant.js';
import * as CW from '../lib/ccw.js';

let bad = 0;
const ok = (name, cond, note = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name.padEnd(44)} ${note}`);
  if (!cond) bad++;
};
const run = (PL, sec, dt = 0.05) => { for (let i = 0; i < sec / dt; i++) PLANT.stepPlant(PL, dt); };

console.log('=== A. steady state at full power ===\n');
const PL = PLANT.makePlant({ life: 'MOL' });
PLANT.initPlant(PL, 1.0, 600);
{
  const C = PL.cw, cp = PL.cwp;
  console.log(`  supply ${C.supplyF.toFixed(1)} F   return ${C.returnF.toFixed(1)} F` +
              `   load ${C.QloadMW.toFixed(1)} MW   flow ${(C.flowGpm / 1000).toFixed(0)}k gpm`);
  console.log(`  service water ${C.swSupplyF.toFixed(0)} -> ${C.swReturnF.toFixed(1)} F\n`);
  ok('CCW supply above the heat sink', C.supplyF > C.swSupplyF);
  ok('CCW supply in the operating band', C.supplyF > 88 && C.supplyF < cp.ccwHiF,
     `${C.supplyF.toFixed(1)} F, alarm at ${cp.ccwHiF}`);
  ok('return is hotter than supply', C.returnF > C.supplyF,
     `rise ${(C.returnF - C.supplyF).toFixed(1)} F`);
  ok('heat load is plausible', C.QloadMW > 8 && C.QloadMW < 30, `${C.QloadMW.toFixed(1)} MW`);
  ok('rejected duty matches the load in steady state',
     Math.abs(C.QhxBtuHr - C.QloadBtuHr) / C.QloadBtuHr < 0.05,
     `${((C.QhxBtuHr / C.QloadBtuHr - 1) * 100).toFixed(1)}% off`);
  ok('service water carries it away', C.swReturnF > C.swSupplyF);
  ok('no cooling alarms at full power',
     !Object.entries(C.alarms).some(([k, v]) => v === true && k !== 'pumpsRunning'),
     Object.entries(C.alarms).filter(([k, v]) => v === true && k !== 'pumpsRunning')
       .map(([k]) => k).join(', ') || 'clean');
  ok('RHR reads the real loop, not its own guess',
     Math.abs(PL.rhr.ccwTempF - C.supplyF) < 0.01,
     `rhr ${PL.rhr.ccwTempF.toFixed(2)} vs ccw ${C.supplyF.toFixed(2)}`);
}

console.log('\n=== B. the ultimate heat sink sets the floor ===\n');
{
  // Summer.  This is why plants have hot-weather power limits: every link in
  // the chain rides on the sink temperature and nothing upstream can be colder.
  const P2 = PLANT.makePlant({ life: 'MOL' });
  P2.cwp.uhsF = 95;
  PLANT.initPlant(P2, 1.0, 600);
  const cold = PL.cw.supplyF, hot = P2.cw.supplyF;
  console.log(`  85 F sink -> CCW ${cold.toFixed(1)} F` +
              `   |   95 F sink -> CCW ${hot.toFixed(1)} F`);
  ok('a 10 F hotter sink raises CCW', hot > cold + 8, `+${(hot - cold).toFixed(1)} F`);
  ok('the rise tracks the sink nearly one for one', Math.abs((hot - cold) - 10) < 2.5);
}

console.log('\n=== C. loss of component cooling -> seal damage -> trip ===\n');
{
  const P3 = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(P3, 1.0, 600);
  CW.loseCCW(P3.cw);

  run(P3, 60);
  ok('barrier cooling is lost immediately', P3.cw.alarms.barrierLost);
  ok('seals are not damaged yet', !P3.cw.sealDamaged.some(Boolean),
     `${P3.cw.sealTimerSec[0].toFixed(0)} s elapsed`);
  ok('pumps are still running', P3.S.pumpOn.filter(Boolean).length === 3,
     'the operator still has time to act');
  ok('reactor has not tripped', !P3.trip);

  run(P3, 300);
  ok('still intact at 6 minutes', !P3.cw.sealDamaged.some(Boolean),
     `${(P3.cwp.sealDamageSec - P3.cw.sealTimerSec[0]).toFixed(0)} s of margin left`);

  run(P3, 360);
  ok('seals damaged past the limit', P3.cw.sealDamaged.every(Boolean));
  ok('damaged pumps are lost', P3.S.pumpOn.filter(Boolean).length === 0);
  ok('and that trips the reactor on flow', P3.trip, P3.tripMsg);
  console.log(`\n  -> loss of CCW is a ${(P3.cwp.sealDamageSec / 60).toFixed(0)}-minute clock, ` +
              `not an alarm; the procedure is to trip the pumps first`);
}

console.log('\n=== D. tripping the pumps in time saves the seals ===\n');
{
  const P4 = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(P4, 1.0, 600);
  CW.loseCCW(P4.cw);
  run(P4, 120);
  for (let i = 0; i < 3; i++) { P4.E.rcpOn[i] = false; P4.S.pumpOn[i] = false; }
  run(P4, 900);
  ok('seals survive', !P4.cw.sealDamaged.some(Boolean));
  ok('the timer reset when the pumps stopped', P4.cw.sealTimerSec.every(t => t === 0));
  ok('natural circulation is established', P4.S.W[0] > 0,
     `${(P4.S.W[0] / P4.rp.Wrated * 100).toFixed(2)}% of rated flow`);
}

console.log('\n=== E. loss of service water ===\n');
{
  const P5 = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(P5, 1.0, 600);
  const before = P5.cw.supplyF;
  CW.loseSW(P5.cw);
  run(P5, 1800);
  console.log(`  CCW ${before.toFixed(1)} -> ${P5.cw.supplyF.toFixed(1)} F over 30 min`);
  ok('CCW heats up with nowhere to reject', P5.cw.supplyF > before + 15);
  ok('service water loss is annunciated', P5.cw.alarms.swLost);
  ok('CCW high temperature follows', P5.cw.alarms.ccwHi);
  ok('letdown sheds itself to buy margin', P5.cw.letdownIsolated,
     'the largest single load, dropped first');
  ok('CCW pumps keep running', P5.cw.flowGpm > 1,
     'a hot loop is not the same failure as a stopped one');
}

console.log('\n=== F. standby pumps and degradation ===\n');
{
  const P6 = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(P6, 1.0, 300);
  CW.tripPump(P6.cw, 0);
  run(P6, 60);
  ok('the standby pump started on low flow', P6.cw.pumpOn[2]);
  ok('two pumps are running again',
     P6.cw.pumpSpeed.filter(s => s > 0.5).length === 2);

  const clean = P6.cw.supplyF;
  P6.cw.strainerFoul = 0.9;
  run(P6, 600);
  console.log(`  fouled strainers: CCW ${clean.toFixed(1)} -> ${P6.cw.supplyF.toFixed(1)} F,` +
              ` ${P6.cw.strainerDP.toFixed(2)} psid`);
  ok('fouling degrades before it alarms', P6.cw.supplyF > clean + 2);
  ok('strainer differential pressure alarms', P6.cw.alarms.strainerDP);
}

console.log('\n=== G. no NaN anywhere in the awkward corners ===\n');
{
  const P7 = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(P7, 1.0, 300);
  const cases = [
    ['all CCW pumps stopped', p => CW.loseCCW(p.cw)],
    ['all SW pumps stopped', p => CW.loseSW(p.cw)],
    ['both exchangers out', p => { p.cw.hxInService = [false, false]; }],
    ['surge tank drained', p => { p.cw.leakGpm = 400; }],
    ['CCW and SW flows equal', p => {
      p.cw.swPumpOn = [true, false, false];
      p.cwp.swPumpGpm = p.cwp.pumpGpm * 2;
    }]
  ];
  for (const [name, setup] of cases) {
    const p = PLANT.makePlant({ life: 'MOL' });
    PLANT.initPlant(p, 1.0, 200);
    setup(p);
    run(p, 300);
    // Number.isFinite() is not enough on its own: a service water return
    // header at 36,000,085 F is perfectly finite and completely wrong, which
    // is exactly how the zero-flow division survived the first sweep.  Every
    // temperature here has to be physically possible as well as a number.
    const temps = [p.cw.supplyF, p.cw.returnF, p.cw.bulkF, p.cw.swReturnF, p.rhr.ccwTempF];
    const rates = [p.cw.QhxBtuHr, p.cw.flowGpm];
    ok(name, temps.every(v => Number.isFinite(v) && v > 30 && v < 400)
             && rates.every(v => Number.isFinite(v) && v >= 0),
       temps.map(v => v.toFixed(0)).join(' '));
  }
}

console.log(bad ? `\nCCW AUDIT: ${bad} FAILED` : '\nCCW AUDIT: ALL CHECKS PASSED');
process.exit(bad ? 1 : 0);
