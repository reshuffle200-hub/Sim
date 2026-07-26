import * as CN from '../lib/cnmt.js';
const F=(x,n=1)=>Number(x).toFixed(n);
const P=CN.cnmtParams();

console.log('=== initial state ===');
{
  let C=CN.makeCnmt(P);
  CN.stepCnmt(P,C,0,0,1.0,{});
  console.log(`  ${F(C.psig,2)} psig, ${F(C.Tf,0)} F, air ${F(P.airLbm/1000,0)}k lbm in ${F(P.freeVolFt3/1e6,2)}e6 ft3`);
}

console.log('\n=== small break: 2 in2, about 500k lb/hr ===');
{
  let C=CN.makeCnmt(P);
  console.log('   t(min)   psig    Tf     steam(k)  sump(ft3)   spray   sinks(MW)  fans(MW)');
  let t=0;
  for(const m of [0,1,5,15,30,60]){
    while(t<m*60){ CN.stepCnmt(P,C,500000,1180,1.0,{}); t+=1; }
    console.log(`  ${String(m).padStart(6)}   ${F(C.psig,1).padStart(5)}  ${F(C.Tf,0).padStart(4)}   ${F(C.steamLb/1000,1).padStart(6)}   ${F(C.sumpFt3,0).padStart(7)}    ${C.sprayGpm>0?'ON ':'off'}   ${F(C.QsinkMW,1).padStart(6)}   ${F(C.QfanMW,1)}`);
  }
  console.log(`  peak ${F(C.peakPsig,1)} psig (design ${P.designPsig}), isolation at ${P.isolPsig} psig: ${C.isolated?'YES':'no'}`);
}

console.log('\n=== large break: 8 in2, about 2M lb/hr ===');
{
  let C=CN.makeCnmt(P);
  console.log('   t(s)    psig    Tf     spray(gpm)   removal(MW)');
  let t=0;
  for(const m of [0,10,30,60,120,300,900]){
    while(t<m){ CN.stepCnmt(P,C,2.0e6,1180,0.5,{}); t+=0.5; }
    console.log(`  ${String(m).padStart(5)}   ${F(C.psig,1).padStart(5)}  ${F(C.Tf,0).padStart(4)}    ${F(C.sprayGpm,0).padStart(6)}       ${F(C.QsinkMW+C.QfanMW+C.QsprayMW,0)}`);
  }
  console.log(`  peak ${F(C.peakPsig,1)} psig / ${F(C.peakTf,0)} F against a ${P.designPsig} psig design`);
}

console.log('\n=== what the passive heat sinks are worth ===');
for(const sink of [true,false]){
  const p2=CN.cnmtParams(); if(!sink) p2.sinkUA=0;
  let C=CN.makeCnmt(p2);
  for(let i=0;i<120/0.5;i++) CN.stepCnmt(p2,C,2.0e6,1180,0.5,{});
  console.log(`  heat sinks ${sink?'modelled':'ignored '}: peak ${F(C.peakPsig,1)} psig, ${F(C.peakTf,0)} F`);
}

console.log('\n=== sprays knock it back down ===');
{
  let C=CN.makeCnmt(P);
  for(let i=0;i<60/0.5;i++) CN.stepCnmt(P,C,2.0e6,1180,0.5,{});
  const before=C.psig;
  for(let i=0;i<600/0.5;i++) CN.stepCnmt(P,C,0,0,0.5,{});     // break isolated
  console.log(`  ${F(before,1)} psig at 60 s -> ${F(C.psig,1)} psig 10 min after isolating the break`);
  console.log(`  sump now ${F(C.sumpFt3,0)} ft3`);
}
