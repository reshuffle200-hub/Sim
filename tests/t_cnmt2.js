import * as CN from '../lib/cnmt.js';
const F=(x,n=1)=>Number(x).toFixed(n);
const P=CN.cnmtParams();
console.log('=== realistic blowdown: the RCS holds 380k lbm, and that is all ===');
console.log('  a break cannot release more coolant than the plant contains\n');
for(const [lbl,area,secs] of [['large 8 in2',8,45],['medium 4 in2',4,180],['small 2 in2',2,600]]){
  let C=CN.makeCnmt(P);
  let released=0; const total=380000;
  let t=0,dt=0.5;
  const rows=[];
  while(t<1800){
    // flow decays as the plant empties and depressurises
    const frac=Math.max(0,1-released/total);
    const W=area*62000*Math.pow(frac,0.6);          // lb/hr, decaying
    released+=W*dt/3600;
    CN.stepCnmt(P,C,W,1180,dt,{});
    t+=dt;
    if([30,60,120,300,900,1800].includes(Math.round(t))&&Math.abs(t-Math.round(t))<1e-9)
      rows.push([Math.round(t),C.psig,C.Tf,C.sprayGpm,released]);
  }
  console.log(`  ${lbl}:  peak ${F(C.peakPsig,1)} psig / ${F(C.peakTf,0)} F   released ${F(released/1000,0)}k lbm`);
  console.log('     t(s)   psig    Tf    spray   released(k)');
  for(const r of rows) console.log(`   ${String(r[0]).padStart(6)}   ${F(r[1],1).padStart(5)}  ${F(r[2],0).padStart(4)}   ${F(r[3],0).padStart(5)}   ${F(r[4]/1000,0)}`);
  console.log('');
}
console.log('=== what the passive heat sinks are worth now ===');
for(const ua of [4.5e6,1.0e6,0]){
  const p2=CN.cnmtParams(); p2.sinkUA=ua;
  let C=CN.makeCnmt(p2); let released=0;
  for(let t=0;t<600;t+=0.5){
    const W=8*62000*Math.pow(Math.max(0,1-released/380000),0.6);
    released+=W*0.5/3600; CN.stepCnmt(p2,C,W,1180,0.5,{});
  }
  console.log(`  sinkUA ${(ua/1e6).toFixed(1)}e6: peak ${F(C.peakPsig,1)} psig, ${F(C.peakTf,0)} F`);
}
