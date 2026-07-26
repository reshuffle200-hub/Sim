import * as P from '../lib/plant.js';
import * as EL from '../lib/elec.js';
import * as IC from '../lib/ic.js';
const F=(x,n=3)=>Number(x).toFixed(n);
let FAIL=0; const chk=(ok,msg)=>{ if(!ok){FAIL++;console.log('  ** FAIL: '+msg);} };

console.log('=== P1. plant-level energy balance at steady state ===');
console.log('  core thermal must equal SG heat removal plus pump heat and losses');
{
  let PL=P.makePlant({life:'MOL'}); P.initPlant(PL,1.0,900);
  for(let i=0;i<600;i++) P.stepPlant(PL,0.05);
  const core=PL.k.Ptot*PL.rp.Qrated/1e6;
  const sg=PL.S.Qsg.reduce((a,b)=>a+b,0)/3.412142/1e6;
  const pump=3*PL.rp.pumpHeatMW, amb=PL.rp.ambientLossMW;
  const pzr=PL.z.heaterKW/1000;
  const bal=core+pump+pzr-amb-sg;
  console.log(`  core ${F(core,1)} MW + pumps ${F(pump,1)} + heaters ${F(pzr,2)} - ambient ${F(amb,1)} = ${F(core+pump+pzr-amb,1)}`);
  console.log(`  SG removal ${F(sg,1)} MW    imbalance ${F(bal,2)} MW (${F(bal/core*100,3)}%)`);
  chk(Math.abs(bal/core)<0.02,'plant energy imbalance at steady state');
}

console.log('\n=== P2. electrical power balance ===');
{
  let PL=P.makePlant({life:'MOL'}); P.initPlant(PL,1.0,900);
  for(let i=0;i<600;i++) P.stepPlant(PL,0.05);
  const E=PL.E, sec=PL.sec;
  console.log(`  turbine shaft ${F(sec.MWe,1)} MW -> generator ${F(E.MWe,1)} MWe   diff ${F(sec.MWe-E.MWe,2)} MW`);
  console.log(`  gross ${F(E.MWe,1)} - house ${F(E.houseMW,1)} = net ${F(E.netMWe,1)}   check ${F(E.MWe-E.houseMW-E.netMWe,4)}`);
  const thermalEff=E.MWe/(PL.k.Ptot*PL.rp.Qrated/1e6)*100;
  console.log(`  gross thermal efficiency ${F(thermalEff,1)}%   (PWR typical 32-34%)`);
  chk(Math.abs(E.MWe-E.houseMW-E.netMWe)<0.01,'net MWe accounting wrong');
  chk(thermalEff>30&&thermalEff<36,'thermal efficiency out of range');
  chk(Math.abs(sec.MWe-E.MWe)/Math.max(sec.MWe,1)<0.05,'shaft to generator mismatch');
}

console.log('\n=== P3. integrated time-step independence ===');
{
  const res=[];
  for(const dt of [0.02,0.05,0.1,0.2]){
    let PL=P.makePlant({life:'MOL'}); P.initPlant(PL,1.0,900);
    PL.sec.loadSet=0.8;
    for(let i=0;i<300/dt;i++) P.stepPlant(PL,dt);
    res.push([dt,PL.k.Ptot*100,PL.S.Tavg,PL.S.P-14.7,PL.sgs[0].lvlNR,PL.E.MWe]);
  }
  console.log('    dt     power%    Tavg     psig    SGlvl    MWe');
  for(const r of res) console.log(`  ${String(r[0]).padStart(5)}  ${F(r[1],2).padStart(7)}  ${F(r[2],2)}  ${F(r[3],0).padStart(5)}  ${F(r[4],2).padStart(6)}  ${F(r[5],0)}`);
  const sp=k=>Math.max(...res.map(r=>r[k]))-Math.min(...res.map(r=>r[k]));
  console.log(`  spread: power ${F(sp(1),3)}%  Tavg ${F(sp(2),3)} F  press ${F(sp(3),1)} psi  SG ${F(sp(4),3)}%`);
  chk(sp(1)<1.5,'integrated power is time-step dependent');
  chk(sp(2)<1.5,'integrated Tavg is time-step dependent');
  chk(sp(3)<40,'integrated pressure is time-step dependent');
}

console.log('\n=== P4. one hour at steady full power ===');
{
  let PL=P.makePlant({life:'MOL'}); P.initPlant(PL,1.0,900);
  const snap=[];
  for(let i=0;i<3600/0.05;i++){ P.stepPlant(PL,0.05);
    if(i%(900/0.05)===0) snap.push([i*0.05,PL.k.Ptot*100,PL.S.Tavg,PL.S.P-14.7,PL.S.pzrLevel*100,PL.sgs[0].lvlNR,PL.ppm]); }
  snap.push([3600,PL.k.Ptot*100,PL.S.Tavg,PL.S.P-14.7,PL.S.pzrLevel*100,PL.sgs[0].lvlNR,PL.ppm]);
  console.log('     t(s)   power%    Tavg     psig    PZR%    SG%     ppm');
  for(const s of snap) console.log(`  ${String(F(s[0],0)).padStart(6)}  ${F(s[1],2).padStart(7)}  ${F(s[2],2)}  ${F(s[3],0).padStart(5)}  ${F(s[4],1).padStart(5)}  ${F(s[5],1).padStart(5)}  ${F(s[6],0)}`);
  const d=(a,b)=>Math.abs(snap[snap.length-1][a]-snap[0][a]);
  console.log(`  drift over 1 h: power ${F(d(1),3)}%  Tavg ${F(d(2),2)} F  press ${F(d(3),0)} psi  PZR ${F(d(4),1)}%  SG ${F(d(5),2)}%`);
  chk(d(1)<3,'power drifts over an hour');
  chk(d(2)<4,'Tavg drifts over an hour');
  chk(d(5)<5,'SG level drifts over an hour');
  chk(!PL.trip,'plant tripped during an undisturbed hour');
}

console.log('\n=== P5. integrated envelope: loads and events, no NaN ===');
{
  let bad=0,tested=0,notes=[];
  for(const load of [0.4,0.55,0.7,0.85,1.0]){
    let PL=P.makePlant({life:'MOL'});
    try{
      P.initPlant(PL,load,600);
      for(let i=0;i<120/0.05;i++) P.stepPlant(PL,0.05);
      tested++;
      const bad1=!isFinite(PL.S.P)||!isFinite(PL.S.Tavg)||!isFinite(PL.k.Ptot)
        ||PL.sgs.some(s=>!isFinite(s.Psec)||!isFinite(s.lvlNR))||!isFinite(PL.E.MWe);
      if(bad1){bad++;notes.push('non-finite at load '+load);}
      if(PL.trip) notes.push('tripped at load '+load+': '+PL.tripMsg);
    }catch(e){ bad++; notes.push('threw at load '+load+': '+e.message); }
  }
  // events from full power
  const events={
    'turbine trip':PL=>{PL.sec.tripped=true;},
    'LOOP':PL=>{EL.loseOffsite(PL.E);EL.tripGenerator(PL.E,'LOOP');},
    'loss of feedwater':PL=>{PL.sec.mfpOn=[false,false];},
    'one RCP':PL=>{PL.E.rcpOn[1]=false;PL.S.pumpOn[1]=false;},
    'stuck PORV':PL=>{PL.z.porvStuck[0]=true;},
    'all events at once':PL=>{PL.sec.tripped=true;EL.loseOffsite(PL.E);EL.tripGenerator(PL.E,'x');
      PL.sec.mfpOn=[false,false];PL.z.porvStuck[0]=true;PL.E.rcpOn=[false,false,false];PL.S.pumpOn=[false,false,false];}
  };
  for(const [name,fn] of Object.entries(events)){
    let PL=P.makePlant({life:'MOL'});
    try{
      P.initPlant(PL,1.0,600); fn(PL);
      for(let i=0;i<900/0.05;i++) P.stepPlant(PL,0.05);
      tested++;
      const b2=!isFinite(PL.S.P)||!isFinite(PL.S.Tavg)||!isFinite(PL.k.Ptot)||!isFinite(PL.E.MWe)
        ||PL.sgs.some(s=>!isFinite(s.Psec)||!isFinite(s.lvlNR));
      if(b2){bad++;notes.push('non-finite after '+name);}
      else notes.push(`  ${name.padEnd(20)} -> ${F(PL.k.Ptot*100,2)}% ${F(PL.S.Tavg,0)}F ${F(PL.S.P-14.7,0)}psig  ${PL.tripMsg||'no trip'}`);
    }catch(e){ bad++; notes.push('threw on '+name+': '+e.message); }
  }
  console.log(notes.join('\n'));
  console.log(`  ${tested} cases exercised, ${bad} bad`);
  chk(bad===0,'integrated envelope produced non-finite values');
}

console.log('\n=== P6. snapshot fidelity from arbitrary states ===');
{
  let ok=true;
  for(const setup of ['steady','mid-ramp','post-trip','LOOP']){
    let A=P.makePlant({life:'MOL'}); P.initPlant(A,1.0,600);
    if(setup==='mid-ramp'){ A.sec.loadSet=0.6; for(let i=0;i<1200;i++) P.stepPlant(A,0.05); }
    if(setup==='post-trip'){ A.sec.tripped=true; for(let i=0;i<2000;i++) P.stepPlant(A,0.05); }
    if(setup==='LOOP'){ EL.loseOffsite(A.E); EL.tripGenerator(A.E,'x'); for(let i=0;i<3000;i++) P.stepPlant(A,0.05); }
    const ic=IC.snapshot(A);
    let B=P.makePlant({life:'MOL'}); IC.restore(B,ic);
    for(let i=0;i<2000;i++){ P.stepPlant(A,0.05); P.stepPlant(B,0.05); }
    const same=A.k.Ptot===B.k.Ptot&&A.S.Tavg===B.S.Tavg&&A.S.P===B.S.P
              &&A.sgs[0].lvlNR===B.sgs[0].lvlNR&&A.E.MWe===B.E.MWe;
    console.log(`  ${setup.padEnd(10)} -> ${same?'bit-identical after 2000 further steps':'** DIVERGED'}`);
    if(!same) ok=false;
  }
  chk(ok,'snapshot does not restore exactly from every state');
}

console.log('\n'+(FAIL===0?'PLANT AUDIT: ALL CHECKS PASSED':'PLANT AUDIT: '+FAIL+' CHECK(S) FAILED'));
