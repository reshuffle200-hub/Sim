import * as P from '../lib/plant.js';
import * as RP from '../lib/rps.js';
const F=(x,n=2)=>Number(x).toFixed(n);

function mk(){ const PL=P.makePlant({life:'MOL'}); P.initPlant(PL,1.0,600);
  for(let i=0;i<200;i++) P.stepPlant(PL,0.05); return PL; }

console.log('=== coincidence logic: one channel is not enough ===');
{
  const PL=mk(); const R=RP.makeRPS();
  const p='pzrHi';
  console.log('  channels tripped   coincidence   -> reactor trip');
  for(const n of [0,1,2,3,4]){
    RP.resetRPS(R);
    for(let i=0;i<4;i++) RP.setChannel(R,p,i,i<n?'failed':'normal', i<n?9999:null);
    RP.stepRPS(R,PL,0.05);
    console.log(`        ${n} of 4          ${R.params[p].coincidence?'MET':'not met'}        ${R.trip?'TRIP':'no trip'}`);
  }
  console.log('  -> a single failed-high channel does not scram the unit');
}

console.log('\n=== bypassing degrades 2/4 to 2/3, not to 1/3 ===');
{
  const PL=mk(); const R=RP.makeRPS(); const p='pzrHi';
  for(const nby of [0,1,2]){
    RP.resetRPS(R);
    for(let i=0;i<4;i++) RP.setChannel(R,p,i,'normal');
    for(let i=0;i<nby;i++) RP.setChannel(R,p,i,'bypassed');
    RP.setChannel(R,p,3,'failed',9999);            // one genuinely tripped
    RP.stepRPS(R,PL,0.05);
    const st=R.params[p];
    console.log(`  ${nby} bypassed: ${st.active} active, ${st.nTripped} tripped, need ${st.need} -> ${st.coincidence?'TRIP':'no trip'}`);
  }
}

console.log('\n=== a failed-CLEAR channel silently erodes margin ===');
{
  const PL=mk(); const R=RP.makeRPS(); const p='pzrHi';
  RP.resetRPS(R);
  for(let i=0;i<4;i++) RP.setChannel(R,p,i,'normal');
  RP.setChannel(R,p,0,'failed',0);                 // stuck low, will never trip
  // now drive real pressure up
  for(const psig of [2300,2380,2400,2500]){
    for(let i=0;i<4;i++) if(R.params[p].ch[i].state==='normal') R.params[p].ch[i].bias=0;
    PL.S.P=psig+14.7;
    RP.stepRPS(R,PL,0.05);
    const st=R.params[p];
    console.log(`  ${psig} psig: ${st.nTripped} of ${st.active} usable channels tripped -> ${st.coincidence?'TRIP':'no trip'}`);
  }
  console.log('  the failed channel can never contribute, so the other three carry the logic');
}

console.log('\n=== first-out latches the initiating parameter ===');
{
  const PL=mk(); const R=RP.makeRPS();
  PL.breakIn2=4;
  let t=0;
  for(let i=0;i<3000;i++){ P.stepPlant(PL,0.1); RP.stepRPS(R,PL,0.1); t+=0.1;
    if(R.trip) break; }
  console.log(`  LOCA: first-out = ${R.firstOut} at t=${F(t,1)}s`);
  const alsoIn=Object.entries(R.params).filter(([k,v])=>v.coincidence).map(([k])=>k);
  console.log(`  parameters in coincidence by then: ${alsoIn.join(', ')}`);
  console.log('  -> only the first one caused the trip; the rest are consequences');
}

console.log('\n=== ESFAS actuation ===');
{
  const PL=mk(); const R=RP.makeRPS();
  PL.breakIn2=8;
  for(let i=0;i<9000;i++){ P.stepPlant(PL,0.1); RP.stepRPS(R,PL,0.1); }
  console.log('  actuation           state       cause');
  for(const E of RP.ESFAS){
    const e=R.esf[E.id];
    console.log(`  ${E.name.padEnd(26)} ${(e.actuated?'ACTUATED':'standby').padEnd(10)} ${e.cause||'-'}`);
  }
  console.log(`  containment ${F(PL.cnmt.psig,1)} psig, RCS ${F(PL.S.P-14.7,0)} psig`);
}
