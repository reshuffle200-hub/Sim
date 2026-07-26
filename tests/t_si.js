import * as SI from '../lib/si.js';
const F=(x,n=1)=>Number(x).toFixed(n);
const P=SI.siParams();

console.log('=== injection flow vs RCS pressure ===');
console.log('  the whole point of ECCS: each path covers a different band\n');
console.log('  psig    HH     SI     LH     ACC     total   note');
for(const psig of [2200,1900,1600,1400,1000,700,590,400,200,50]){
  let S=SI.makeSI(P); S.actuated=true;
  const r=SI.stepSI(P,S,psig+14.7,1.0,{});
  const note = psig>P.siShutoffPsig ? 'high head only'
    : (psig>P.accPsig ? 'HH + SI pumps'
    : (psig>P.lhShutoffPsig ? 'accumulators dumping' : 'all paths'));
  console.log(`  ${String(psig).padStart(4)}  ${F(S.hhGpm,0).padStart(5)}  ${F(S.siGpm,0).padStart(5)}  ${F(S.lhGpm,0).padStart(5)}  ${F(S.accGpm,0).padStart(6)}   ${F(S.totalGpm,0).padStart(5)}   ${note}`);
}

console.log('\n=== automatic actuation on low pressurizer pressure ===');
{
  let S=SI.makeSI(P);
  for(const psig of [2235,2000,1900,1860,1840,1700]){
    SI.stepSI(P,S,psig+14.7,0.5,{});
    console.log(`  ${String(psig).padStart(4)} psig -> SI ${S.actuated?'ACTUATED':'armed'}   (setpoint ${P.pzrLoPsig})`);
  }
}

console.log('\n=== accumulator blowdown, passive ===');
{
  let S=SI.makeSI(P); S.actuated=false;
  console.log('   t(s)   RCS psig   acc psig   water(ft3)   flow(gpm)');
  let t=0, psig=650;
  for(const m of [0,5,15,30,60,120]){
    while(t<m){ psig=Math.max(60,650-t*6); SI.stepSI(P,S,psig+14.7,0.5,{}); t+=0.5; }
    const a=S.acc[0];
    console.log(`  ${String(m).padStart(5)}   ${F(psig,0).padStart(7)}   ${F(a.psig,0).padStart(7)}   ${F(a.waterFt3,0).padStart(8)}   ${F(S.accGpm,0).padStart(7)}`);
  }
  console.log('  check valves opened on their own once RCS fell below '+P.accPsig+' psig');
}

console.log('\n=== RWST depletion and swap to sump recirculation ===');
{
  let S=SI.makeSI(P); S.actuated=true;
  let t=0;
  console.log('   t(min)   RWST%    injected(gal)   suction');
  for(const m of [0,10,30,60,120]){
    while(t<m*60){ SI.stepSI(P,S,300+14.7,1.0,{}); t+=1; }
    console.log(`  ${String(m).padStart(6)}   ${F(S.rwstPct,1).padStart(5)}   ${F(S.injectedGal,0).padStart(10)}    ${S.suction.toUpperCase()}`);
  }
  console.log(`  swap threshold ${P.rwstLoPct}% -- operators must align sump suction here`);
}
