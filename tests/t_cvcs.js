import * as CV from '../lib/cvcs.js';
const F=(x,n=1)=>Number(x).toFixed(n);
const P=CV.cvcsParams();
const M=380000;

console.log('=== boration and dilution rates ===');
console.log('  boric acid tank '+P.baPpm+' ppm, RCS '+F(M/1000,0)+' klbm\n');
console.log('  action              flow    from    after 10 min   rate(ppm/hr)');
for(const [lbl,dem,start] of [
  ['borate max',   {borateGpm:30},  750],
  ['borate half',  {borateGpm:15},  750],
  ['dilute max',   {diluteGpm:120}, 750],
  ['dilute half',  {diluteGpm:60},  750],
  ['dilute at low',{diluteGpm:120}, 100],
  ['hold',         {},              750]]){
  let C=CV.makeCVCS(P); let ppm=start;
  for(let i=0;i<600/0.5;i++) ppm=CV.stepCVCS(P,C,ppm,M,0.5,dem);
  const fl=(dem.borateGpm||dem.diluteGpm||0);
  console.log(`  ${lbl.padEnd(16)} ${String(fl).padStart(4)} gpm  ${String(start).padStart(4)}   ${F(ppm,1).padStart(8)} ppm   ${F(C.ppmRate,0).padStart(7)}`);
}
console.log('\n  note: dilution is slower than boration at the same rate, because');
console.log('  borating drives against 7000-C while diluting drives only against C.');

console.log('\n=== mixing lag: boron does not appear at the core instantly ===');
{
  let C=CV.makeCVCS(P); let ppm=750;
  console.log('   t(s)   delivered ppm   RCS ppm');
  let t=0;
  for(const m of [0,10,30,60,120,300]){
    while(t<m){ ppm=CV.stepCVCS(P,C,ppm,M,0.5,{diluteGpm:120}); t+=0.5; }
    console.log(`  ${String(m).padStart(5)}   ${F(C.cDelivered,0).padStart(9)}     ${F(ppm,1)}`);
  }
}

console.log('\n=== how long to change boron by a useful amount ===');
for(const [from,to] of [[750,700],[750,650],[750,900],[1200,750],[100,0]]){
  const dil=to<from, gal=dil?CV.galToDilute(P,from,to,M):CV.galToBorate(P,from,to,M);
  const gpm=dil?P.dilMaxGpm:P.boricMaxGpm;
  console.log(`  ${from} -> ${to} ppm: ${dil?'dilute':'borate'} ${F(gal,0)} gal at ${gpm} gpm = ${F(gal/gpm,1)} min`);
}

console.log('\n=== inventories and alarms ===');
{
  let C=CV.makeCVCS(P); let ppm=750;
  for(let i=0;i<3600/0.5;i++) ppm=CV.stepCVCS(P,C,ppm,M,0.5,{borateGpm:30});
  console.log(`  1 h of max boration: ppm ${F(ppm,0)}  BA tank ${F(C.baTankGal/1000,1)}k gal used ${F(C.borated,0)}`);
  console.log(`  VCT ${F(C.vctPct,1)}%   alarms: ${Object.entries(C.alarms).filter(([k,v])=>v).map(([k])=>k).join(', ')||'none'}`);
}

console.log('\n=== emergency boration ===');
{
  let C=CV.makeCVCS(P); C.emergency=true; let ppm=750;
  let t=0; const marks=[60,300,900];
  for(const m of marks){
    while(t<m){ ppm=CV.stepCVCS(P,C,ppm,M,0.5,{}); t+=0.5; }
    console.log(`  after ${String(m).padStart(3)} s: ${F(ppm,0)} ppm  (+${F(ppm-750,0)})`);
  }
}
