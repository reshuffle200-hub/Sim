import * as P from './lib/plant.js';
import * as EL from './lib/elec.js';
const F=(x,n=1)=>Number(x).toFixed(n);
const hdr='   t(s)  power%  Tavg   RCPs  Vaux  Vsafe  flow%  genMWe  net   EDG rdy/bkr  trip';
const row=PL=>{const s=P.snapshot(PL);
  return `  ${F(s.t,0).padStart(5)}  ${F(s.power,2).padStart(6)}  ${F(s.Tavg,1)}  ${s.rcps}     ${F(s.Vaux,2)}  ${F(s.Vsafety,2)}   ${F(PL.S.W[0]/PL.rp.Wrated*100,1).padStart(5)}  ${F(s.genMWe,0).padStart(5)}  ${F(s.netMWe,0).padStart(4)}   ${s.edgReady.map(x=>x?'Y':'n').join('')}/${s.edgBkr.map(x=>x?'Y':'n').join('')}      ${s.trip?s.tripMsg:'-'}`;};

console.log('=== steady 100% with the electrical plant wired in ===');
let PL=P.makePlant({life:'MOL'});
P.initPlant(PL,1.0,900);
let t=0; for(let i=0;i<60/0.05;i++){P.stepPlant(PL,0.05);t+=0.05;}
console.log(hdr); console.log(row(PL));
console.log(`  gross ${F(PL.E.MWe,0)} MWe  house ${F(PL.E.houseMW,1)} MW  net ${F(PL.E.netMWe,0)} MWe  pf ${F(PL.E.pf,3)}  aux from ${PL.E.auxSource.toUpperCase()}`);

console.log('\n=== LOSS OF OFFSITE POWER from 100% ===');
console.log('  expect: RCPs trip -> natural circulation, EDGs auto-start, safety buses re-energise');
EL.loseOffsite(PL.E);
EL.tripGenerator(PL.E,'LOOP');
console.log(hdr);
const t0=t;
for(const m of [0,2,5,10,20,40,90,180,400,900]){
  while(t<t0+m){P.stepPlant(PL,0.05);t+=0.05;}
  console.log(row(PL));
}
const s=P.snapshot(PL);
console.log(`\n  natural circulation flow: ${F(PL.S.W[0]/PL.rp.Wrated*100,2)}% of rated`);
console.log(`  EDG 1A: ready in ${PL.E.edg[0].readyT?F(PL.E.edg[0].readyT,2)+'s':'not ready'}, breaker ${PL.E.edg[0].bkr?'CLOSED':'open'}, ${F(PL.E.edg[0].loadFrac*100,0)}% loaded`);
console.log(`  safety bus 1A: ${F(PL.E.Vsafety[0],3)} pu from ${PL.E.safetyFrom[0].toUpperCase()}`);
console.log(`  core: power ${F(s.power,2)}%  Tavg ${F(s.Tavg,1)}  subcooling ${F(PL.S.subcooling,0)} F  void ${F(PL.S.voidMax,4)}`);
console.log(`  first-out: ${PL.tripFirst}`);
