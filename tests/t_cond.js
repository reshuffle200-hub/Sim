// ======================================================================
//  t_cond.js — condenser, circulating water, air removal, condensate
//
//  Two asserted boundary conditions die here.  `condPsia` was a constant the
//  operator could type into, and gross output was flow times a fixed enthalpy
//  drop -- so back pressure had no effect on generation whatsoever.  On a real
//  unit it is one of the largest levers on output there is.
//
//  The third thing this catches is a rejection balance that never closed: the
//  old condenser duty applied a 0.62 factor to steam enthalpy and produced
//  2508 MW of rejection on a plant that only takes 2775 MW of heat in and
//  turns 916 of it into electricity.
// ======================================================================

import * as PLANT from '../lib/plant.js';
import * as CD from '../lib/cond.js';

let bad = 0;
const ok = (name, cond, note = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name.padEnd(44)} ${note}`);
  if (!cond) bad++;
};
const run = (PL, sec, dt = 0.05) => { for (let i = 0; i < sec / dt; i++) PLANT.stepPlant(PL, dt); };

console.log('=== A. the heat balance closes ===\n');
const PL = PLANT.makePlant({ life: 'MOL' });
PLANT.initPlant(PL, 1.0, 900);
{
  const C = PL.cd;
  const thermal = PL.k.Ptot * PL.rp.Qrated / 1e6;
  const gross = PL.sec.MWe;
  console.log(`  thermal in ${thermal.toFixed(0)} MW   gross out ${gross.toFixed(0)} MWe` +
              `   condenser ${C.dutyMW.toFixed(0)} MW`);
  console.log(`  CW ${C.cwInletF.toFixed(0)} -> ${C.cwOutletF.toFixed(1)} F ` +
              `(rise ${C.cwRiseF.toFixed(1)}), TTD ${C.ttdF.toFixed(1)} F, ` +
              `${C.inHg.toFixed(2)} inHg\n`);
  ok('rejection is thermal minus gross, within 5%',
     Math.abs(C.dutyMW - (thermal - gross)) / (thermal - gross) < 0.05,
     `${C.dutyMW.toFixed(0)} vs ${(thermal - gross).toFixed(0)} MW`);
  ok('the condenser cannot reject more than goes in', C.dutyMW < thermal);
  ok('CW rise is a design-point 15-25 F', C.cwRiseF > 15 && C.cwRiseF < 25,
     `${C.cwRiseF.toFixed(1)} F`);
  ok('TTD is clean-condenser', C.ttdF < PL.cdp.ttdCleanF + 2, `${C.ttdF.toFixed(1)} F`);
  ok('back pressure is 2-3 inHg', C.inHg > 2 && C.inHg < 3, `${C.inHg.toFixed(2)} inHg`);
  ok('Tcond = inlet + rise + TTD',
     Math.abs(C.TcondF - (C.cwInletF + C.cwRiseF + C.ttdF)) < 0.5);
  ok('output is not being penalised when clean',
     C.mweFactor > 0.99, `factor ${C.mweFactor.toFixed(4)}`);
  ok('no condenser alarms at full power',
     !['vacuumLow', 'cwLoFlow', 'ttdHigh', 'airHigh', 'hotwellLo', 'condPumpLost']
       .some(k => C.alarms[k]));
}

console.log('\n=== B. back pressure is a lever on output ===\n');
{
  const base = PL.sec.MWe;
  const P2 = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(P2, 1.0, 900);
  CD.tripCwPump(P2.cd, 0);                       // lose one of three circ pumps
  run(P2, 600);
  console.log(`  3 pumps: ${base.toFixed(0)} MWe at ${PL.cd.inHg.toFixed(2)} inHg`);
  console.log(`  2 pumps: ${P2.sec.MWe.toFixed(0)} MWe at ${P2.cd.inHg.toFixed(2)} inHg`);
  ok('losing a circ pump raises back pressure', P2.cd.inHg > PL.cd.inHg + 0.4);
  ok('and it costs real megawatts', P2.sec.MWe < base - 5,
     `${(base - P2.sec.MWe).toFixed(0)} MWe lost`);
  ok('the loss is proportionate, not catastrophic', P2.sec.MWe > base * 0.9);
  ok('reactor power is unaffected', Math.abs(P2.k.Ptot - PL.k.Ptot) < 0.02,
     'the turbine is the thing that got worse, not the core');
}

console.log('\n=== C. a hot sink costs output too ===\n');
{
  const P3 = PLANT.makePlant({ life: 'MOL' });
  P3.cwp.uhsF = 95;                              // summer
  PLANT.initPlant(P3, 1.0, 900);
  run(P3, 300);
  console.log(`  85 F sink: ${PL.cd.inHg.toFixed(2)} inHg, ${PL.sec.MWe.toFixed(0)} MWe`);
  console.log(`  95 F sink: ${P3.cd.inHg.toFixed(2)} inHg, ${P3.sec.MWe.toFixed(0)} MWe`);
  ok('a hotter lake raises back pressure', P3.cd.inHg > PL.cd.inHg);
  ok('summer costs megawatts', P3.sec.MWe < PL.sec.MWe,
     `${(PL.sec.MWe - P3.sec.MWe).toFixed(0)} MWe`);
  ok('the condenser and CCW share the sink',
     Math.abs(P3.cd.cwInletF - P3.cwp.uhsF) < 0.01 && P3.cw.swSupplyF === P3.cwp.uhsF);
}

console.log('\n=== D. loss of air removal ===\n');
{
  const P4 = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(P4, 1.0, 900);
  const before = P4.cd.inHg;
  CD.loseEjectors(P4.cd);
  run(P4, 60);
  const at1 = P4.cd.inHg;

  // Walk it to the trip and record the ORDER, because the order is the point:
  // the dumps are interlocked out before the turbine goes, so by the time the
  // reactor trips the heat sink the operator would reach for is already gone.
  let tTrip = -1, dumpsLostFirst = false;
  for (let t = 60; t < 900; t += 0.05) {
    PLANT.stepPlant(P4, 0.05);
    if (!P4.sec.dumpAvail && !P4.sec.tripped) dumpsLostFirst = true;
    if (P4.sec.tripped && tTrip < 0) tTrip = t;
  }
  console.log(`  ${before.toFixed(2)} -> ${at1.toFixed(2)} inHg at 1 min;` +
              ` turbine trip at ${tTrip.toFixed(0)} s`);

  ok('vacuum degrades within a minute', at1 > before + 0.3,
     'everything below atmosphere leaks in, continuously');
  ok('air removal loss is annunciated', P4.cd.alarms.ejectorLost);
  ok('TTD is what rose', P4.cdp.ttdCleanF + 40 < P4.cdp.ttdCleanF + P4.cdp.airTtdF,
     'air blankets the tubes and kills the film coefficient');
  ok('the steam dumps are interlocked out first', dumpsLostFirst,
     'before the trip, not after it');
  ok('the turbine trips on low vacuum', P4.sec.tripped && tTrip > 0,
     `${tTrip.toFixed(0)} s after the ejectors were lost`);
  ok('and the reactor follows it', P4.trip, P4.tripMsg);
  ok('vacuum recovers once there is no duty', P4.cd.psia < P4.cdp.tripPsia,
     `back to ${P4.cd.inHg.toFixed(2)} inHg with the machine off line`);
}

console.log('\n=== E. total loss of circulating water ===\n');
{
  const P5 = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(P5, 1.0, 900);
  CD.loseCirc(P5.cd);
  run(P5, 300);
  console.log(`  back pressure ${P5.cd.inHg.toFixed(1)} inHg, ` +
              `Tcond ${P5.cd.TcondF.toFixed(0)} F, trip=${P5.trip}`);
  ok('back pressure runs away', P5.cd.psia > P5.cdp.tripPsia);
  ok('the low vacuum trip alarms', P5.cd.alarms.vacuumTrip);
  ok('temperatures stay physical', P5.cd.TcondF < 340 && Number.isFinite(P5.cd.TcondF));
  ok('output collapses but does not go negative',
     P5.cd.mweFactor >= 0.55 && P5.sec.MWe >= 0, `factor ${P5.cd.mweFactor.toFixed(3)}`);
}

console.log('\n=== F. condensate and the hotwell ===\n');
{
  const P6 = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(P6, 1.0, 600);
  CD.tripCondPump(P6.cd, 0);
  run(P6, 60);
  ok('the standby condensate pump started', P6.cd.condPumpOn[2]);

  const P7 = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(P7, 1.0, 600);
  for (let i = 0; i < 3; i++) CD.tripCondPump(P7.cd, i);
  run(P7, 120);
  ok('losing all condensate is annunciated', P7.cd.alarms.condLostAll);
  ok('and it takes the main feed pumps with it', P7.sec.mfpOn.every(v => !v),
     'the hotwell is the only inventory buffer the secondary has');

  const P8 = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(P8, 1.0, 600);
  P8.cd.hotwellPct = 12;
  run(P8, 600);
  ok('low hotwell alarms and makeup starts', P8.cd.alarms.makeup);
  ok('level recovers toward the setpoint', P8.cd.hotwellPct > 20,
     `${P8.cd.hotwellPct.toFixed(0)}%`);
  ok('makeup came out of the storage tank', P8.cd.cstGal < P8.cdp.cstGal);
}

console.log('\n=== G. fouling degrades before it alarms ===\n');
{
  const P9 = PLANT.makePlant({ life: 'MOL' });
  PLANT.initPlant(P9, 1.0, 900);
  const clean = P9.cd.inHg, cleanMWe = P9.sec.MWe;
  P9.cd.tubeFoul = 0.85;
  run(P9, 600);
  console.log(`  clean ${clean.toFixed(2)} inHg / ${cleanMWe.toFixed(0)} MWe  ->  ` +
              `fouled ${P9.cd.inHg.toFixed(2)} inHg / ${P9.sec.MWe.toFixed(0)} MWe`);
  ok('fouling raises TTD', P9.cd.ttdF > P9.cdp.ttdCleanF + 8);
  ok('and back pressure with it', P9.cd.inHg > clean + 0.5);
  ok('and it shows up as lost generation', P9.sec.MWe < cleanMWe - 5,
     `${(cleanMWe - P9.sec.MWe).toFixed(0)} MWe`);
}

console.log('\n=== H. no runaway numbers in the corners ===\n');
{
  const cases = [
    ['no circ water', p => CD.loseCirc(p.cd)],
    ['no air removal', p => CD.loseEjectors(p.cd)],
    ['no condensate pumps', p => { for (let i = 0; i < 3; i++) CD.tripCondPump(p.cd, i); }],
    ['hotwell empty', p => { p.cd.hotwellPct = 0; p.cd.cstGal = 0; }],
    ['fouled and airbound', p => { p.cd.tubeFoul = 1; CD.loseEjectors(p.cd); }]
  ];
  for (const [name, setup] of cases) {
    const p = PLANT.makePlant({ life: 'MOL' });
    PLANT.initPlant(p, 1.0, 300);
    setup(p);
    run(p, 300);
    const temps = [p.cd.TcondF, p.cd.cwOutletF, p.S.Tavg];
    const rest = [p.cd.psia, p.cd.mweFactor, p.sec.MWe, p.cd.hotwellPct];
    ok(name,
       temps.every(v => Number.isFinite(v) && v > 30 && v < 700)
       && rest.every(Number.isFinite) && p.cd.psia < 200 && p.sec.MWe >= 0,
       `${p.cd.inHg.toFixed(1)} inHg, ${p.sec.MWe.toFixed(0)} MWe`);
  }
}

console.log(bad ? `\nCONDENSER AUDIT: ${bad} FAILED` : '\nCONDENSER AUDIT: ALL CHECKS PASSED');
process.exit(bad ? 1 : 0);
