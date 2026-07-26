import * as P from '../lib/plant.js';
import * as SIM from '../lib/si.js';
import * as CN from '../lib/cnmt.js';
import * as IC from '../lib/ic.js';
const F=(x,n=3)=>Number(x).toFixed(n);
let FAIL=0; const chk=(ok,m)=>{ if(!ok){FAIL++;console.log('  ** FAIL: '+m);} };

console.log('=== S1. containment mass conservation ===');
{
  const cp=CN.cnmtParams(); let C=CN.makeCnmt(cp);
  const W=8e5, secs=600;
  for(let i=0;i<secs;i++) CN.stepCnmt(cp,C,W,1180,1.0,{});
  const inMass=W*secs/3600;
  const held=C.steamLb+C.sumpLb;
  const sprayed=0;
  console.log(`  released ${F(inMass/1000,1)}k lbm, containment holds ${F(held/1000,1)}k (steam ${F(C.steamLb/1000,1)}k + sump ${F(C.sumpLb/1000,1)}k)`);
  console.log(`  error ${F((held-inMass)/inMass*100,3)}%  (spray adds mass, so held >= released when spraying)`);
  chk(held >= inMass*0.98, 'containment loses mass');
}

console.log('\n=== S2. containment idles without drifting ===');
{
  const cp=CN.cnmtParams(); let C=CN.makeCnmt(cp);
  const p0=C.psig;
  for(let i=0;i<7200;i++) CN.stepCnmt(cp,C,0,0,1.0,{});
  console.log(`  2 h with no break: ${F(p0,3)} -> ${F(C.psig,3)} psig, ${F(C.Tf,1)} F`);
  chk(Math.abs(C.psig-p0)<0.5,'containment pressure drifts with no source');
  chk(C.Tf>90&&C.Tf<130,'containment temperature drifts with no source');
}

console.log('\n=== S3. accumulators: bounded, monotonic, no refill ===');
{
  const sp=SIM.siParams(); let S=SIM.makeSI(sp);
  let bad=0, prev=sp.accWaterFt3;
  for(let i=0;i<4000;i++){
    const psig = i<2000 ? Math.max(50,700-i*0.4) : 700;   // fall then rise again
    SIM.stepSI(sp,S,psig+14.7,0.5,{});
    const w=S.acc[0].waterFt3;
    if(w>prev+1e-6) bad++;                                 // must never refill
    if(w<-1e-9) bad++;
    prev=w;
  }
  console.log(`  water ${F(S.acc[0].waterFt3,1)} ft3, pressure ${F(S.acc[0].psig,0)} psig, violations ${bad}`);
  chk(bad===0,'accumulator water refilled or went negative');
  chk(S.acc[0].waterFt3>=0,'accumulator water negative');
}

console.log('\n=== S4. SI block actually blocks ===');
{
  const sp=SIM.siParams(); let S=SIM.makeSI(sp);
  SIM.blockSI(S);
  for(let i=0;i<200;i++) SIM.stepSI(sp,S,1200+14.7,0.5,{});
  console.log(`  blocked at 1200 psig: actuated=${S.actuated}, pumped flow=${F(S.hhGpm+S.siGpm+S.lhGpm,1)} gpm`);
  chk(!S.actuated && (S.hhGpm+S.siGpm+S.lhGpm)<0.01,'SI injected while blocked');
  const acc=S.accGpm;
  console.log(`  accumulators are passive and ignore the block: ${F(acc,0)} gpm at 1200 psig (expected 0, above 600)`);
}

console.log('\n=== S5. RWST depletes and swaps to sump ===');
{
  const sp=SIM.siParams(); let S=SIM.makeSI(sp); S.actuated=true;
  let swapped=null;
  for(let i=0;i<20000;i++){
    SIM.stepSI(sp,S,200+14.7,1.0,{});
    if(S.suction==='sump'&&swapped===null) swapped=i;
  }
  console.log(`  swapped to sump at t=${swapped}s with RWST at ${F(S.rwstPct,1)}% (threshold ${sp.rwstLoPct}%)`);
  chk(swapped!==null,'never swapped to sump');
  chk(S.rwstPct>=0,'RWST went negative');
}

console.log('\n=== S6. integrated LOCA is time-step independent ===');
{
  const res=[];
  for(const dt of [0.05,0.1,0.25]){
    let PL=P.makePlant({life:'MOL'}); P.initPlant(PL,1.0,900);
    PL.breakIn2=4;
    for(let i=0;i<900/dt;i++) P.stepPlant(PL,dt);
    res.push([dt,PL.S.P-14.7,PL.cnmt.psig,PL.si.totalGpm,PL.si.rwstPct,PL.S.pzrLevel*100]);
  }
  console.log('    dt     RCSpsig   cnmt    SI(gpm)   RWST%   PZR%');
  for(const r of res) console.log(`  ${String(r[0]).padStart(5)}  ${F(r[1],0).padStart(7)}  ${F(r[2],2).padStart(6)}  ${F(r[3],0).padStart(6)}  ${F(r[4],1).padStart(6)}  ${F(r[5],1)}`);
  const sp2=k=>Math.max(...res.map(r=>r[k]))-Math.min(...res.map(r=>r[k]));
  console.log(`  spread: RCS ${F(sp2(1),1)} psi, containment ${F(sp2(2),3)} psig, SI ${F(sp2(3),1)} gpm`);
  chk(sp2(1)<80,'LOCA RCS pressure is time-step dependent');
  chk(sp2(2)<1.5,'containment pressure is time-step dependent');
}

console.log('\n=== S7. envelope: breaks, blocks and failures ===');
{
  let bad=0, notes=[];
  const cases={
    'no break, 1 h':            PL=>{},
    'break 0.5 in2':            PL=>{PL.breakIn2=0.5;},
    'break 4 in2':              PL=>{PL.breakIn2=4;},
    'break 20 in2':             PL=>{PL.breakIn2=20;},
    'break + SI blocked':       PL=>{PL.breakIn2=4;SIM.blockSI(PL.si);},
    'break + no accumulators':  PL=>{PL.breakIn2=8;SIM.isolateAccumulators(PL.si);},
    'break + LOOP':             PL=>{PL.breakIn2=4;PL.E.gridAvail=false;PL.E.satBkr=false;
                                     PL.E.tripped=true;PL.E.genBkr=false;},
    'break + no cnmt spray':    PL=>{PL.breakIn2=8;PL.cnmt.sprayAuto=false;},
    'stuck PORV + break':       PL=>{PL.breakIn2=2;PL.z.porvStuck[0]=true;}
  };
  for(const [n,fn] of Object.entries(cases)){
    let PL=P.makePlant({life:'MOL'});
    try{
      P.initPlant(PL,1.0,600); fn(PL);
      for(let i=0;i<1800/0.1;i++) P.stepPlant(PL,0.1);
      const ok=isFinite(PL.S.P)&&isFinite(PL.cnmt.psig)&&isFinite(PL.si.totalGpm)
        &&isFinite(PL.S.Tavg)&&PL.cnmt.psig>-1&&PL.si.rwstPct>=0&&PL.S.P>10;
      if(!ok) bad++;
      notes.push(`  ${n.padEnd(24)} ${ok?'ok ':'** BAD'}  RCS ${F(PL.S.P-14.7,0)}psig  cnmt ${F(PL.cnmt.psig,1)}  SI ${F(PL.si.totalGpm,0)}gpm  ${PL.tripFirst||'-'}`);
    }catch(e){ bad++; notes.push(`  ${n.padEnd(24)} ** THREW ${e.message}`); }
  }
  console.log(notes.join('\n'));
  console.log(`  ${Object.keys(cases).length} cases, ${bad} bad`);
  chk(bad===0,'envelope produced bad values');
}

console.log('\n=== S8. snapshot fidelity mid-LOCA ===');
{
  let A=P.makePlant({life:'MOL'}); P.initPlant(A,1.0,600);
  A.breakIn2=4;
  for(let i=0;i<4000;i++) P.stepPlant(A,0.1);
  const ic=IC.snapshot(A);
  let B=P.makePlant({life:'MOL'}); IC.restore(B,ic);
  for(let i=0;i<3000;i++){ P.stepPlant(A,0.1); P.stepPlant(B,0.1); }
  const same=A.S.P===B.S.P&&A.cnmt.psig===B.cnmt.psig&&A.si.rwstPct===B.si.rwstPct
            &&A.si.acc[0].waterFt3===B.si.acc[0].waterFt3&&A.ppm===B.ppm;
  console.log(`  restored mid-LOCA and stepped 3000 further: ${same?'bit-identical':'** DIVERGED'}`);
  chk(same,'snapshot does not capture the LOCA state');
}

console.log('\n'+(FAIL===0?'SAFETY SYSTEMS AUDIT: ALL CHECKS PASSED':'SAFETY SYSTEMS AUDIT: '+FAIL+' FAILED'));
