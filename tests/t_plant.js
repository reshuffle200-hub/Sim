import * as P from '../lib/plant.js';
const F=(x,n=1)=>Number(x).toFixed(n);
const row=s=>`  ${F(s.t,0).padStart(5)}  ${F(s.power,2).padStart(6)}  ${F(s.Tavg,1)}  ${F(s.Ppzr,0).padStart(5)}  ${F(s.pzrLvl,1).padStart(5)}  ${F(s.Psec,0).padStart(5)}  ${F(s.sgLvl[0],1).padStart(5)}  ${F(s.Wsteam,2)}  ${F(s.MWe,0).padStart(4)}  ${F(s.Tfw,0)}  ${F(s.ppm,0).padStart(5)}`;
const hdr='   t(s)  power%   Tavg   Ppzr   lvl%   Psec   SGlvl  Wstm  MWe  Tfw   ppm';

console.log('=== integrated plant: settle at 100% ===');
console.log('  (this is the first time all nine modules have run coupled)');
let PL=P.makePlant({life:'MOL'});
P.initPlant(PL,1.0,600);
console.log(hdr);
console.log(row(P.snapshot(PL)));
let t=0;
for(const mark of [60,180,300]){
  while(t<mark){ P.stepPlant(PL,0.05); t+=0.05; }
  console.log(row(P.snapshot(PL)));
}
const s=P.snapshot(PL);
console.log(`\n  design targets: power 100%, Tavg 577, Ppzr 2235, Psec 812, MWe 916`);
console.log(`  achieved:       power ${F(s.power,2)}%, Tavg ${F(s.Tavg,1)}, Ppzr ${F(s.Ppzr,0)}, Psec ${F(s.Psec,0)}, MWe ${F(s.MWe,0)}`);
console.log(`  trip=${s.trip} ${s.tripMsg}`);
