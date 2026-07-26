import * as P from '../lib/plant.js';
const F=(x,n=1)=>Number(x).toFixed(n);
console.log('=== turbine trip from 100% ===');
let PL=P.makePlant({life:'MOL'});
P.initPlant(PL,1.0,900);
let t=0;
for(let i=0;i<60/0.05;i++){P.stepPlant(PL,0.05);t+=0.05;}
console.log('  before: power '+F(P.snapshot(PL).power,1)+'%  Tavg '+F(PL.S.Tavg,1)+'  MWe '+F(PL.sec.MWe,0));
PL.sec.tripped=true;
console.log('\n   t(s)  power%   Tavg   Ppzr  pzr%  Psec  SGlvl  dump%  trip');
const t0=t;
for(const m of [0,2,5,10,20,40,90,180,400]){
  while(t<t0+m){P.stepPlant(PL,0.05);t+=0.05;}
  const s=P.snapshot(PL);
  console.log(`  ${String(m).padStart(5)}  ${F(s.power,2).padStart(6)}  ${F(s.Tavg,1)}  ${F(s.Ppzr,0).padStart(4)}  ${F(s.pzrLvl,1).padStart(4)}  ${F(s.Psec,0).padStart(4)}  ${F(s.sgLvl[0],1).padStart(5)}  ${F(PL.sec.dumpPos*100,0).padStart(5)}  ${s.trip?s.tripMsg:'-'}`);
}
console.log(`\n  first-out: ${PL.tripFirst||'none'}`);
console.log(`  decay heat now ${F(PL.k.Pdecay*100,2)}% of rated`);
console.log(`  SG safeties lifted: ${PL.sgs.some(s=>s.nSafetyOpen>0)}   ARV: ${PL.sgs.some(s=>s.arvOpen)}`);
console.log(`  pzr PORV: ${PL.z.porvOpen.some(Boolean)}   RCS void ${F(PL.S.voidMax,4)}  subcooling ${F(PL.S.subcooling,0)} F`);
