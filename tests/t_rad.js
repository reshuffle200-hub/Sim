// ======================================================================
//  t_rad.js — radiation monitoring
//
//  The reason this module exists is diagnosis, so that is what the tests are
//  about.  A steam generator tube leak is nearly invisible thermally: primary
//  inventory falls and secondary inventory rises, and for a small leak that
//  looks like charging flow error or level instrument drift for a very long
//  time.  What identifies it -- and identifies WHICH generator -- is activity
//  turning up where activity does not belong.
//
//  It also closes two stubs.  `cw.activityUCiMl` and `cd.tubeLeak` were read by
//  annunciator windows that nothing could ever light, because nothing wrote
//  them.  Section F checks they are driven now.
// ======================================================================

import * as PLANT from '../lib/plant.js';
import * as RD from '../lib/rad.js';

let bad = 0;
const ok = (name, cond, note = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name.padEnd(46)} ${note}`);
  if (!cond) bad++;
};
const run = (PL, sec, dt = 0.05) => { for (let i = 0; i < sec / dt; i++) PLANT.stepPlant(PL, dt); };
const fresh = (settle = 900) => {
  const PL = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(PL, 1.0, settle);
  return PL;
};

console.log('=== A. clean plant reads background ===\n');
const PL = fresh();
{
  const R = PL.rd, rp = PL.rdp;
  console.log(`  RCS ${R.primaryUCiG.toFixed(3)} uCi/g, noble gas ${R.gasUCiG.toFixed(1)} uCi/g`);
  console.log(`  off-gas ${R.offgas.r.toFixed(2)}x  blowdown ` +
              `${R.blowdown.map(m => m.r.toFixed(2)).join('/')}  vent ${R.vent.r.toFixed(2)}x\n`);
  ok('RCS activity is intact-fuel', R.primaryUCiG > 0.05 && R.primaryUCiG < 3,
     `${R.primaryUCiG.toFixed(3)} uCi/g`);
  ok('and it is the primed equilibrium, not a drift',
     Math.abs(R.primaryUCiG - R.baselineUCiG) / R.baselineUCiG < 0.02);
  ok('well under the Tech Spec limit', R.primaryUCiG < rp.primarySpec * 0.05);
  ok('no clad damage', R.cladDamage === 0);
  ok('every process monitor at background',
     [R.offgas, ...R.blowdown, ...R.steamline, R.letdown].every(m => m.r < 2));
  ok('no radiation alarms', !Object.values(R.alarms).some(v => v === true),
     Object.entries(R.alarms).filter(([, v]) => v).map(([k]) => k).join(', ') || 'clean');
  ok('nothing being released', R.releaseRateUCiS < 1 && R.releasedCi < 1e-3);
}

console.log('\n=== B. off-gas is the sensitive path, per-unit monitors the specific one ===\n');
{
  // This ordering is the single most important behaviour in the module.  The
  // air ejector concentrates non-condensables into a stream four orders of
  // magnitude smaller than the steam flow, so off-gas responds to a leak far
  // too small for anything else to see -- but it sees all three generators
  // mixed and cannot say which.  Blowdown and the steam lines are slower and
  // per-unit, so they are what tells you which generator to isolate.
  console.log('   leak      off-gas    blowdown     identifies');
  const rows = [];
  for (const leak of [0.02, 0.1, 1, 25]) {
    const p = fresh();
    RD.setTubeLeak(p.rd, 1, leak);
    let tOff = -1, tSpec = -1;
    for (let t = 0; t < 10800; t += 0.05) {
      PLANT.stepPlant(p, 0.05);
      if (tOff < 0 && p.rd.offgas.alarm) tOff = t;
      if (tSpec < 0 && (p.rd.blowdown[1].alarm || p.rd.steamline[1].alarm)) tSpec = t;
      if (tOff >= 0 && tSpec >= 0) break;
    }
    const f = v => v < 0 ? 'never' : (v / 60).toFixed(1) + ' min';
    console.log(`  ${String(leak).padStart(5)} gpm  ${f(tOff).padStart(9)}  ` +
                `${f(tSpec).padStart(10)}     SG ${RD.suspectGenerator(p.rd) >= 0
                  ? 'ABC'[RD.suspectGenerator(p.rd)] : '-'}`);
    rows.push({ leak, tOff, tSpec, p });
  }
  console.log('');
  ok('off-gas detects 0.02 gpm', rows[0].tOff >= 0 && rows[0].tOff < 120,
     'far below what a mass balance would show');
  ok('off-gas beats the per-unit monitors at every size',
     rows.every(r => r.tOff >= 0 && (r.tSpec < 0 || r.tOff <= r.tSpec)));
  ok('the per-unit monitors still identify the generator',
     rows.every(r => RD.suspectGenerator(r.p.rd) === 1));
  ok('larger leaks are found faster', rows[3].tSpec < rows[1].tSpec);
  ok('the two intact generators stay quiet',
     rows[3].p.rd.blowdown[0].r < 2 && rows[3].p.rd.blowdown[2].r < 2,
     'a monitor that lights on all three identifies nothing');
}

console.log('\n=== C. partitioning splits the two indications ===\n');
{
  const p = fresh();
  RD.setTubeLeak(p.rd, 0, 5);
  run(p, 3600);
  const R = p.rd;
  console.log(`  SG A liquid ${R.sgLiquidUCiG[0].toExponential(2)} uCi/g, ` +
              `steam ${R.sgSteamUCiG[0].toExponential(2)} uCi/g`);
  ok('iodine stays in the liquid',
     R.sgLiquidUCiG[0] > R.sgSteamUCiG[0] * 50,
     `ratio ${(R.sgLiquidUCiG[0] / Math.max(R.sgSteamUCiG[0], 1e-30)).toFixed(0)}:1`);
  ok('the partition coefficient is what sets it',
     Math.abs(R.sgLiquidUCiG[0] / R.sgSteamUCiG[0] - p.rdp.iodinePartition) < 1);
  ok('noble gas does not accumulate in the liquid',
     R.sgGasUCiG[0] > 0 && R.sgLiquidUCiG[0] < R.primaryUCiG,
     'it leaves with the steam as fast as it arrives');
}

console.log('\n=== D. isolating blowdown costs you the monitor ===\n');
{
  const p = fresh();
  RD.setTubeLeak(p.rd, 2, 25);
  run(p, 1800);
  ok('blowdown isolated itself on high activity', p.rd.blowdownIsolated);
  ok('steam line indication survives it', p.rd.steamline[2].alarm,
     'which is the only per-unit indication left');
  const liqBefore = p.rd.sgLiquidUCiG[2];
  run(p, 1800);
  ok('secondary activity now climbs faster', p.rd.sgLiquidUCiG[2] > liqBefore,
     'the removal path is gone as well as the sample path');
  RD.resetBlowdown(p.rd);
  run(p, 60);
  ok('reopening restores sampling', !p.rd.blowdownIsolated);
}

console.log('\n=== E. clad damage is a different event from a leak ===\n');
{
  // RCS activity has a time constant of about ten hours -- the letdown
  // demineralizer and an eight day half life are the only removal paths, and
  // neither is fast.  Half an hour of simulation showed a factor of twelve and
  // no Tech Spec exceedance, which reads like a weak model but is simply the
  // real buildup rate: iodine after a fuel failure takes hours to become the
  // number the procedure cares about.  So the test waits.
  const p = fresh();
  RD.setCladDamage(p.rd, 0.002);
  run(p, 1800);
  const early = p.rd.primaryUCiG;
  run(p, 28800);
  const R = p.rd;
  console.log(`  RCS ${early.toFixed(1)} uCi/g at 30 min -> ` +
              `${R.primaryUCiG.toFixed(0)} uCi/g at 8 h`);
  console.log(`  containment high range ${R.cnmtHighRange.toExponential(2)} R/hr`);
  ok('buildup is gradual, not a step', early < R.primaryUCiG * 0.25,
     'ten hour time constant');
  ok('RCS activity rises by orders of magnitude', R.primaryUCiG > R.baselineUCiG * 50,
     `${(R.primaryUCiG / R.baselineUCiG).toFixed(0)}x baseline`);
  ok('the Tech Spec limit is exceeded', R.alarms.primarySpec);
  ok('clad damage is annunciated', R.alarms.cladDamage);
  ok('the high range monitor is the one that reads it', R.cnmtHighRange > 1);
  ok('no primary-to-secondary leak is indicated', !R.alarms.tubeLeak,
     'a leak MOVES activity; clad damage CREATES it');
  ok('the SG monitors stay at background',
     R.blowdown.every(m => m.r < 2), 'nothing crossed the tube boundary');
}

console.log('\n=== F. the two stubbed windows are driven now ===\n');
{
  const p = fresh();
  ok('CCW activity starts at zero', (p.cw.activityUCiMl || 0) === 0);
  RD.setLetdownHxLeak(p.rd, 0.4);
  run(p, 300);
  console.log(`  CCW loop ${(p.cw.activityUCiMl * 1e3).toFixed(3)} nCi/ml`);
  ok('a letdown HX tube leak puts activity in CCW', p.cw.activityUCiMl > 0);
  ok('CCW ACTIVITY HIGH can now light', p.cw.alarms.ccwActivity,
     'the window has existed since 0.20 with nothing to light it');
  ok('the aux building monitor picks it up too', p.rd.auxBuilding.r > 1.5,
     'CCW runs all over the plant');
  RD.setLetdownHxLeak(p.rd, 0);
  run(p, 600);
  ok('it clears when the leak is stopped', p.cw.activityUCiMl < 1e-6);

  p.rd.condTubeLeak = true;
  run(p, 10);
  ok('condenser tube leak reaches cd.tubeLeak', p.cd.tubeLeak === true,
     'the other stub, also lit for the first time');
}

console.log('\n=== G. an RCS leak inside containment ===\n');
{
  const p = fresh();
  // breakIn2 is the input; S.breakArea is derived from it inside stepPlant, so
  // setting the derived field directly was silently overwritten every step.
  p.breakIn2 = 0.05;
  run(p, 600);
  console.log(`  break flow ${p.S.breakFlow.toFixed(0)} lb/hr, ` +
              `cnmt particulate ${p.rd.cnmtPart.r.toFixed(1)}x`);
  ok('containment monitors respond to the leak',
     p.rd.cnmtPart.r > 1.5 || p.rd.cnmtGas.r > 1.5,
     'before sump level moves enough to notice');
  ok('the SG monitors do not', p.rd.blowdown.every(m => m.r < 2),
     'inside containment is not across the tubes');
}

console.log('\n=== H. no runaway numbers ===\n');
{
  const cases = [
    ['400 gpm rupture', p => RD.setTubeLeak(p.rd, 0, 400)],
    ['all three leaking', p => { for (let i = 0; i < 3; i++) RD.setTubeLeak(p.rd, i, 50); }],
    ['total clad failure', p => RD.setCladDamage(p.rd, 1)],
    ['leak with turbine tripped', p => {
      RD.setTubeLeak(p.rd, 1, 25); p.sec.tripped = true; p.sec.online = false;
    }],
    // sec.msivOpen is the control; sgs[i].msivOpen is derived from it every
    // step, so setting only the derived field reopened the valves immediately
    // and this case was not testing isolation at all.
    ['leak with MSIVs shut', p => {
      RD.setTubeLeak(p.rd, 1, 25);
      p.sec.msivOpen = [false, false, false];
      p.sgs.forEach(g => { g.msivOpen = false; });
    }]
  ];
  for (const [name, setup] of cases) {
    const p = fresh(300);
    setup(p);
    run(p, 900);
    const R = p.rd;
    const vals = [R.primaryUCiG, R.gasUCiG, R.offgas.r, R.vent.r, R.cnmtHighRange,
                  R.releasedCi, p.cw.activityUCiMl, ...R.sgLiquidUCiG, ...R.blowdown.map(m => m.r)];
    ok(name, vals.every(v => Number.isFinite(v) && v >= 0)
             && R.offgas.r <= p.rdp.fullScale && R.primaryUCiG <= 1e5,
       `off-gas ${R.offgas.offScale ? 'off scale' : R.offgas.r.toFixed(0) + 'x'}`);
  }
}

console.log('\n=== I. isolation actually cuts the release path ===\n');
{
  const p = fresh();
  RD.setTubeLeak(p.rd, 1, 25);
  run(p, 600);
  ok('off-gas is responding with the unit on line', p.rd.offgas.alarm);
  const relBefore = p.rd.releasedCi;
  p.sec.msivOpen = [false, false, false];
  p.sgs.forEach(g => { g.msivOpen = false; });
  run(p, 900);
  ok('shutting the MSIVs clears the off-gas monitor', !p.rd.offgas.alarm,
     `${p.rd.offgas.r.toFixed(1)}x -- no steam path to the condenser`);
  ok('the release stops', p.rd.releasedCi - relBefore < 1e-4);
  ok('but the leak is still there', p.rd.sgLeakGpm[1] === 25,
     'isolation controls the release, it does not fix the tube');
  ok('and the affected generator still shows it', p.rd.blowdown[1].alarm
     || p.rd.steamline[1].alarm, 'the liquid inventory does not un-contaminate');
}

console.log(bad ? `\nRADIATION AUDIT: ${bad} FAILED` : '\nRADIATION AUDIT: ALL CHECKS PASSED');
process.exit(bad ? 1 : 0);
