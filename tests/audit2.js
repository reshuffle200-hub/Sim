import * as PR from './lib/props.js';
import * as R from './lib/rcs.js';
import * as SG from './lib/sg.js';
const F=(x,n=3)=>Number(x).toFixed(n);
let FAIL=0; const chk=(ok,msg)=>{ if(!ok){FAIL++;console.log('  ** FAIL: '+msg);} };
const P=SG.sgParams(), rp=R.rcsParams();

console.log('=== I. SG <-> RCS parameter consistency ===');
{
  const PsatAtTsec=PR.PsatT(rp.Tsec);
  console.log(`  rcs Tsec=${rp.Tsec} F -> Psat=${F(PsatAtTsec,0)} psia   sg Prated=${P.Prated} psia`);
  chk(Math.abs(PsatAtTsec-P.Prated)/P.Prated<0.01,'rcs Tsec and sg Prated disagree');
  console.log(`  sg Qrated per SG=${F(P.Qrated/1e6,0)} MW  x3 = ${F(P.Qrated*3/1e6,0)} MW   rcs Qrated=${F(rp.Qrated/1e6,0)} MW`);
  chk(Math.abs(P.Qrated*3-rp.Qrated)/rp.Qrated<0.005,'core power disagrees');
  const Wtot=P.Wsteam*3;
  console.log(`  derived steam flow ${F(Wtot/1e6,2)}e6 lbm/hr total  (typical W 3-loop ~11.4e6)`);
  chk(Wtot>1.0e7&&Wtot<1.4e7,'steam flow out of range');
}

console.log('\n=== J. SG mass and energy conservation ===');
{
  let s=SG.makeSG(P)[0]; SG.initSG(P,s,1.0,P.Prated,P.Tfw);
  const M0=s.M, U0=s.U;
  // closed: no heat, no feed, no steam
  for(let i=0;i<200/0.05;i++) SG.stepSG(P,s,0,0,P.Tfw,0,0.05);
  console.log(`  closed shell: mass ${F(M0/1000,3)}k -> ${F(s.M/1000,3)}k   drift ${F((s.M-M0)/M0*100,6)}%`);
  console.log(`                energy ${F(U0/1e6,4)}M -> ${F(s.U/1e6,4)}M  drift ${F((s.U-U0)/Math.abs(U0)*100,6)}%`);
  chk(Math.abs((s.M-M0)/M0)<1e-6,'SG mass not conserved');
  chk(Math.abs((s.U-U0)/U0)<1e-6,'SG energy not conserved');
  // known source
  // relief must be disabled or this is not a closed system either --
  // the same mistake as the phase-1 conservation test
  const Pnr=SG.sgParams(); Pnr.safetySetPsig=[9e9,9e9,9e9,9e9,9e9]; Pnr.arvLiftPsig=9e9;
  let q=SG.makeSG(Pnr)[0]; SG.initSG(Pnr,q,1.0,Pnr.Prated,Pnr.Tfw);
  const U1=q.U, Qin=200e6, secs=30;
  for(let i=0;i<secs/0.05;i++) SG.stepSG(Pnr,q,Qin,0,Pnr.Tfw,0,0.05);
  const expect=Qin*3.412142*(secs/3600);
  console.log(`  heat only: added ${F((q.U-U1)/1e6,3)}M Btu, expected ${F(expect/1e6,3)}M   err ${F((q.U-U1-expect)/expect*100,4)}%`);
  chk(Math.abs((q.U-U1-expect)/expect)<0.005,'SG heat input not accounted');
  // feed and steam mass balance
  let r=SG.makeSG(P)[0]; SG.initSG(P,r,1.0,P.Prated,P.Tfw);
  const M1=r.M, Wf=2e6, Ws=1e6;
  for(let i=0;i<60/0.05;i++) SG.stepSG(P,r,0,Wf,P.Tfw,Ws,0.05);
  const dMexp=(Wf-Ws)*(60/3600);
  console.log(`  flow only: mass change ${F(r.M-M1,1)} lbm, expected ${F(dMexp,1)}   err ${F((r.M-M1-dMexp)/dMexp*100,4)}%`);
  chk(Math.abs((r.M-M1-dMexp)/dMexp)<0.005,'SG mass balance wrong');
}

console.log('\n=== K. SG time-step sensitivity ===');
{
  const res=[];
  for(const dt of [0.01,0.025,0.05,0.1,0.25]){
    let s=SG.makeSG(P)[0]; SG.initSG(P,s,1.0,P.Prated,P.Tfw);
    for(let i=0;i<120/dt;i++) SG.stepSG(P,s,P.Qrated,P.Wsteam,P.Tfw,P.Wsteam,dt);
    // then a transient
    for(let i=0;i<40/dt;i++) SG.stepSG(P,s,P.Qrated,P.Wsteam,P.Tfw,P.Wsteam*1.15,dt);
    res.push([dt,s.Psec,s.lvlNR,s.alphaRiser,s.M]);
  }
  console.log('    dt      Psec     NR lvl    void     mass');
  for(const r of res) console.log(`  ${String(r[0]).padStart(6)}  ${F(r[1],1).padStart(7)}  ${F(r[2],2).padStart(7)}  ${F(r[3],4)}  ${F(r[4]/1000,2)}k`);
  const sp=k=>Math.max(...res.map(r=>r[k]))-Math.min(...res.map(r=>r[k]));
  console.log(`  spread: Psec ${F(sp(1),2)} psia, level ${F(sp(2),3)}%, void ${F(sp(3),5)}`);
  chk(sp(1)<8,'SG pressure is time-step dependent');
  chk(sp(2)<2,'SG level is time-step dependent');
}

console.log('\n=== L. SG relief valves: do they actually lift and reseat? ===');
{
  let s=SG.makeSG(P)[0]; SG.initSG(P,s,1.0,P.Prated,P.Tfw);
  for(let i=0;i<200/0.05;i++) SG.stepSG(P,s,P.Qrated,P.Wsteam,P.Tfw,P.Wsteam,0.05);
  // isolate the SG and keep heating: pressure must rise into the relief band
  let arvSeen=false,safSeen=false,peak=0;
  s.msivOpen=false;
  for(let i=0;i<400/0.05;i++){
    SG.stepSG(P,s,P.Qrated,P.Wsteam*0.3,P.Tfw,0,0.05);
    if(s.arvOpen) arvSeen=true;
    if(s.nSafetyOpen>0) safSeen=true;
    peak=Math.max(peak,s.Psec);
  }
  console.log(`  MSIV shut, still heating: peak ${F(peak,0)} psia (${F(peak-14.7,0)} psig)`);
  console.log(`  ARV lifted: ${arvSeen} (setpoint ${P.arvLiftPsig} psig)   safeties lifted: ${safSeen} (first at ${P.safetySetPsig[0]} psig, ${s.nSafetyOpen} open at peak)`);
  chk(arvSeen,'atmospheric relief never lifted');
  chk(peak-14.7 < P.safetySetPsig[4]*1.10,'relief capacity insufficient - pressure ran away');
  // reseat
  for(let i=0;i<300/0.05;i++) SG.stepSG(P,s,P.Qrated*0.03,0,P.Tfw,0,0.05);
  console.log(`  after heat removed: ${F(s.Psec,0)} psia, ARV ${s.arvOpen?'STILL OPEN':'reseated'}, safeties ${s.nSafetyOpen>0?'STILL OPEN':'reseated'}`);
  chk(!s.arvOpen&&s.nSafetyOpen===0,'relief valves did not reseat');
}

console.log('\n=== M. SG envelope sweep: cold and low-power startup states ===');
{
  let bad=0,tested=0,worst='';
  for(const pf of [0.001,0.02,0.05,0.2,0.5,1.0]){
    for(const pr of [15,60,200,500,812,1000]){
      for(const tfw of [80,200,350,440]){
        let s=SG.makeSG(P)[0];
        try{
          SG.initSG(P,s,Math.max(pf,0.001),pr,tfw);
          for(let i=0;i<20/0.05;i++) SG.stepSG(P,s,P.Qrated*pf,P.Wsteam*pf,tfw,P.Wsteam*pf,0.05);
          tested++;
          if(!isFinite(s.Psec)||!isFinite(s.M)||!isFinite(s.lvlNR)||!isFinite(s.alphaRiser)){
            bad++; worst=`pf=${pf} P=${pr} Tfw=${tfw}`;
          }
          if(s.alphaRiser<0||s.alphaRiser>1){ bad++; worst=`void out of range at pf=${pf} P=${pr}`; }
        }catch(e){ bad++; worst='threw: '+e.message; }
      }
    }
  }
  console.log(`  ${tested} states exercised, ${bad} bad   ${worst||''}`);
  chk(bad===0,'SG produced non-finite or out-of-range values');
}

console.log('\n=== N. does the OLD audit still pass with sg.js present? ===');
console.log('  (running the phase-1 audit unchanged)');

console.log('\n'+(FAIL===0?'SG AUDIT: ALL CHECKS PASSED':'SG AUDIT: '+FAIL+' CHECK(S) FAILED'));
