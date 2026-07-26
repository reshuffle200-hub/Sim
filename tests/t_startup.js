import * as P from '../lib/plant.js';
import * as SU from '../lib/startup.js';
const F=(x,n=1)=>Number(x).toFixed(n);

console.log('=== hot standby ===');
let PL=P.makePlant({life:'MOL'});
P.initHotStandby(PL);
console.log(`  Tavg ${F(PL.S.Tavg,1)} F, ${F(PL.S.P-14.7,0)} psig, PZR ${F(PL.S.pzrLevel*100,1)}%`);
console.log(`  SG ${F(PL.sgs[0].Psec,0)} psia / ${F(PL.sgs[0].lvlNR,1)}%, dumps ${F(PL.sec.dumpPos*100,0)}%`);
console.log(`  boron ${F(PL.ppm,0)} ppm, rods all in, power ${PL.k.P.toExponential(2)}`);
console.log(`  source range ${F(PL.su.srCps,0)} cps, trip ${PL.trip}`);
const bal=PL.lastBalance;
console.log(`  reactivity ${F(bal.pcm,0)} pcm -> ${bal.pcm<0?'subcritical':'** CRITICAL'}`);

console.log('\n=== approach to criticality by dilution, with 1/M ===');
SU.takeBaseline(PL.su, PL.ppm, PL.banks.ctrlDemand);
PL.banks.ctrlDemand = 528;                    // control banks withdrawn first
for(let i=0;i<600/0.05;i++) P.stepPlant(PL,0.05);
SU.takePoint(PL.su, PL.ppm, PL.banks.ctrlDemand);
console.log(`  rods withdrawn, boron ${F(PL.ppm,0)} ppm, reactivity ${F(PL.lastBalance.pcm,0)} pcm`);
console.log('');
console.log('   ppm    cps       1/M     ECP(ppm)   R^2    rho(pcm)');
PL.diluteGpm = PL.cp.dilMaxGpm;
let t=0, lastPt=PL.ppm;
while(t<9000 && PL.lastBalance.pcm < -30){
  P.stepPlant(PL,0.2); t+=0.2;
  if(lastPt-PL.ppm > 12){
    lastPt=PL.ppm;
    const pt=SU.takePoint(PL.su, PL.ppm, PL.banks.ctrlDemand);
    console.log(`  ${F(PL.ppm,0).padStart(5)}  ${PL.su.srCps.toExponential(2)}  ${F(pt.invM,4)}   ${PL.su.ecpPpm?F(PL.su.ecpPpm,0).padStart(6):'   -  '}   ${F(PL.su.ecpR2,4)}  ${F(PL.lastBalance.pcm,0).padStart(6)}`);
  }
}
PL.diluteGpm=0;
console.log('');
console.log(`  actual criticality near ${F(PL.ppm,0)} ppm; last prediction ${PL.su.ecpPpm?F(PL.su.ecpPpm,0):'-'} ppm`);
console.log(`  prediction error ${PL.su.ecpPpm?F(PL.su.ecpPpm-PL.ppm,1):'-'} ppm`);
console.log(`  startup rate ${F(PL.su.surDpm,3)} dpm, period ${isFinite(PL.k.period)?F(PL.k.period,0)+' s':'inf'}`);
