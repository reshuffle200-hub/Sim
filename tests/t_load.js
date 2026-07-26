import * as P from '../lib/plant.js';
const F=(x,n=1)=>Number(x).toFixed(n);
const hdr='   t(s)  power%   Tavg   Tref   Ppzr   pzr%   Psec   SGlvl   Wstm   MWe   dump%  rods  ppm';
const row=PL=>{const s=P.snapshot(PL);
  return `  ${F(s.t,0).padStart(5)}  ${F(s.power,2).padStart(6)}  ${F(s.Tavg,1)}  ${F(s.Tref,1)}  ${F(s.Ppzr,0).padStart(5)}  ${F(s.pzrLvl,1).padStart(5)}  ${F(s.Psec,0).padStart(5)}  ${F(s.sgLvl[0],1).padStart(5)}  ${F(s.Wsteam,2).padStart(5)}  ${F(s.MWe,0).padStart(4)}  ${F(PL.sec.dumpPos*100,1).padStart(5)}  ${F(PL.banks.ctrlDemand,0).padStart(4)}  ${F(s.ppm,0)}`;};

console.log('=== steady 100% with automatic rod control ===');
let PL=P.makePlant({life:'MOL'});
P.initPlant(PL,1.0,900);
PL.rodAuto=true;
console.log(hdr); console.log(row(PL));
let t=0;
for(const m of [120,300]){ while(t<m){P.stepPlant(PL,0.05);t+=0.05;} console.log(row(PL)); }

console.log('\n=== load reduction 100% -> 75% at 5%/min ===');
console.log('  (Tavg must follow the programme down; dumps should barely move)');
PL.sec.loadSet=0.75;
console.log(hdr);
const t0=t;
for(const m of [0,60,120,180,300,420,600,900]){
  while(t<t0+m){P.stepPlant(PL,0.05);t+=0.05;}
  console.log(row(PL));
}
const s=P.snapshot(PL);
console.log(`\n  at 75%: power ${F(s.power,1)}%  Tavg ${F(s.Tavg,1)} (prog ${F(s.Tref,1)})  MWe ${F(s.MWe,0)}  trip=${s.trip}`);
console.log(`  Tavg tracking error: ${F(s.Tavg-s.Tref,2)} F`);
