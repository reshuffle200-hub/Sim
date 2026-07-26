// Validate BOTH 1/M extrapolations against true criticality.
//   Phase A: pure dilution, rods parked  -> boron fit must predict; rod fit must decline
//   Phase B: pure rod withdrawal, boron parked -> rod fit must predict
import * as PLANT from '../lib/plant.js';
import * as SU from '../lib/startup.js';
import * as B from '../ui/boards.js';
const F = (x, n = 1) => Number.isFinite(x) ? x.toFixed(n) : '—';

const settle = (PL, s) => { for (let i = 0; i < s / 0.05; i++) PLANT.stepPlant(PL, 0.05, { noTrip: true }); };
const rho = PL => PL.lastBalance?.pcm ?? -1e9;

// ---------------------------------------------------------------- Phase A
console.log('=== A. approach on DILUTION, rods parked ===');
let PL = PLANT.makePlant({ life: 'MOL' });
PLANT.initHotStandby(PL);
PL.rodAuto = false;
settle(PL, 90);
SU.takeBaseline(PL.su, PL.ppm, PL.banks.ctrlDemand);
console.log(`  CR0 ${F(PL.su.baseCps,1)} cps at ${F(PL.ppm,0)} ppm, rods ${F(PL.banks.ctrlDemand,0)}`);
console.log('   ppm    int(s)   cps      1/M     ECP ppm    R2     rho(pcm)');

for (let i = 0; i < 12 && rho(PL) < -80; i++) {
  PL.diluteGpm = 250; settle(PL, 300); PL.diluteGpm = 0;
  settle(PL, 75);
  const pt = SU.takePoint(PL.su, PL.ppm, PL.banks.ctrlDemand);
  console.log(`  ${F(PL.ppm,0).padStart(5)}${F(pt.intS,0).padStart(8)}${F(pt.cps,1).padStart(9)}` +
    `${F(pt.invM,4).padStart(9)}${(PL.su.ecpPpm!=null?F(PL.su.ecpPpm,0):'—').padStart(10)}` +
    `${(PL.su.ecpPpm!=null?F(PL.su.ecpR2,4):'—').padStart(9)}${F(rho(PL),0).padStart(11)}`);
}
const predPpm = PL.su.ecpPpm, predR2 = PL.su.ecpR2;
const rodDeclined = PL.su.ecpRods === null;
PL.diluteGpm = 60;
let truePpm = null;
for (let i = 0; i < 600 && truePpm === null; i++) { settle(PL, 20); if (rho(PL) >= 0) truePpm = PL.ppm; }
PL.diluteGpm = 0;
console.log(`  predicted ${F(predPpm,0)} ppm (R² ${F(predR2,4)}) | true ${F(truePpm,0)} ppm | ` +
            `error ${predPpm!=null&&truePpm!=null?F(predPpm-truePpm,1):'—'} ppm`);
console.log(`  rod fit with rods parked: ${rodDeclined ? 'declined (correct)' : '*** returned a value (WRONG) ***'}`);

// ---------------------------------------------------------------- Phase B
console.log('\n=== B. approach on ROD WITHDRAWAL, boron parked ===');
PL = PLANT.makePlant({ life: 'MOL' });
PLANT.initHotStandby(PL, { marginPpm: 90 });
PL.rodAuto = false;
settle(PL, 90);
SU.takeBaseline(PL.su, PL.ppm, PL.banks.ctrlDemand);
console.log(`  CR0 ${F(PL.su.baseCps,1)} cps at ${F(PL.ppm,0)} ppm`);
console.log('   rods   int(s)   cps      1/M     ECP rods   R2     rho(pcm)');
for (let i = 0; i < 12 && rho(PL) < -60; i++) {
  PL.banks.ctrlDemand = Math.min(528, PL.banks.ctrlDemand + 34);
  settle(PL, 130);
  const pt = SU.takePoint(PL.su, PL.ppm, PL.banks.ctrlDemand);
  console.log(`  ${F(PL.banks.ctrlDemand,0).padStart(5)}${F(pt.intS,0).padStart(8)}${F(pt.cps,1).padStart(9)}` +
    `${F(pt.invM,4).padStart(9)}${(PL.su.ecpRods!=null?F(PL.su.ecpRods,0):'—').padStart(10)}` +
    `${(PL.su.ecpRods!=null?F(PL.su.ecpRodsR2,4):'—').padStart(9)}${F(rho(PL),0).padStart(11)}`);
}
const predRods = PL.su.ecpRods, predRodsR2 = PL.su.ecpRodsR2;
let trueRods = null;
for (let i = 0; i < 200 && trueRods === null; i++) {
  PL.banks.ctrlDemand = Math.min(528, PL.banks.ctrlDemand + 3);
  settle(PL, 40);
  if (rho(PL) >= 0) trueRods = PL.banks.ctrlDemand;
}
console.log(`  predicted ${predRods!=null?F(predRods,0):'—'} steps (R² ${F(predRodsR2,4)}) | ` +
            `true ${trueRods!=null?F(trueRods,0):'not reached'} | ` +
            `error ${predRods!=null&&trueRods!=null?F(predRods-trueRods,1):'—'} steps`);

// ---------------------------------------------------------------- board
const html = B.startup(PL);
console.log(`\n=== C. board ===`);
console.log(`  renders ${html.length} chars, ${(html.match(/data-su=/g)||[]).length} controls, ` +
  `${(html.match(/<canvas/g)||[]).length} canvases`);
console.log(`  no undefined/NaN: ${/undefined|NaN|\[object/.test(html) ? '*** FAIL ***' : 'ok'}`);
const P2 = PLANT.makePlant(); PLANT.initHotStandby(P2);
console.log(`  empty state:      ${/undefined|NaN|\[object/.test(B.startup(P2)) ? '*** FAIL ***' : 'ok'}`);
