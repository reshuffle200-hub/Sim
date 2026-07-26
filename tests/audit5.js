import * as P from '../lib/plant.js';
import * as SU from '../lib/startup.js';
import * as AN from '../ui/annun.js';
import * as IC from '../lib/ic.js';
const F=(x,n=3)=>Number(x).toFixed(n);
let FAIL=0; const chk=(ok,m)=>{ if(!ok){FAIL++;console.log('  ** FAIL: '+m);} };

console.log('=== U1. hot standby holds for two hours ===');
{
  let PL=P.makePlant({life:'MOL'}); P.initHotStandby(PL);
  const T0=PL.S.Tavg,p0=PL.S.P,b0=PL.ppm;
  let minP=9999,maxT=-9999,minT=9999;
  for(let i=0;i<7200/0.2;i++){ P.stepPlant(PL,0.2);
    minP=Math.min(minP,PL.S.P-14.7); maxT=Math.max(maxT,PL.S.Tavg); minT=Math.min(minT,PL.S.Tavg); }
  console.log(`  Tavg ${F(T0,1)} -> ${F(PL.S.Tavg,1)} (range ${F(minT,1)}..${F(maxT,1)})`);
  console.log(`  psig ${F(p0-14.7,0)} -> ${F(PL.S.P-14.7,0)} (min ${F(minP,0)})   boron drift ${F(PL.ppm-b0,2)} ppm`);
  console.log(`  SI ${PL.si.actuated?'ACTUATED':'armed'}   trip ${PL.trip?PL.tripFirst:'none'}`);
  chk(Math.abs(PL.S.Tavg-547)<4,'hot standby Tavg off programme');
  chk(!PL.si.actuated,'SI actuated at hot standby');
  chk(!PL.trip,'tripped at hot standby');
  chk(Math.abs(PL.ppm-b0)<5,'boron drifts at hot standby');
}

console.log('\n=== U2. source range is monotonic in reactivity ===');
{
  const sp=SU.startupParams(); let S=SU.makeStartup(sp); sp.poisson=false;
  let prev=-1,bad=0;
  console.log('   rho(pcm)    count rate');
  for(const pcm of [-8000,-5000,-3000,-2000,-1000,-500,-200,-100]){
    const n=-1e-8*2e-5/(pcm*1e-5);
    SU.stepStartup(sp,S,n,Infinity,1);
    if(S.srCps<prev) bad++;
    prev=S.srCps;
    console.log(`   ${String(pcm).padStart(7)}    ${S.srCps.toExponential(3)}`);
  }
  chk(bad===0,'count rate not monotonic as reactivity rises');
}

console.log('\n=== U3. 1/M is bounded and reaches zero at criticality ===');
{
  const sp=SU.startupParams(); sp.poisson=false;
  let S=SU.makeStartup(sp);
  const n=pcm=>-1e-8*2e-5/(pcm*1e-5);
  SU.stepStartup(sp,S,n(-4000),Infinity,1); SU.takeBaseline(S,1400+4000/8,528);
  let bad=0;
  for(const pcm of [-3000,-2000,-1000,-500,-100,-20]){
    SU.stepStartup(sp,S,n(pcm),Infinity,1);
    const pt=SU.takePoint(S,1400-pcm/8,528);
    if(pt.invM<0||pt.invM>1.01) bad++;
  }
  console.log(`  1/M at 20 pcm subcritical: ${F(S.points[S.points.length-1].invM,4)}`);
  console.log(`  predicted critical ${S.ecpPpm?F(S.ecpPpm,1):'-'} ppm (true 1400), R2 ${F(S.ecpR2,5)}`);
  chk(bad===0,'1/M went out of bounds');
  chk(S.ecpR2>0.99,'1/M fit is poor for noiseless data');
}

console.log('\n=== U4. annunciator engine has no stuck states ===');
{
  const pts=[{name:'A',group:'g',seqType:'A',firstOut:true},
             {name:'M',group:'g',seqType:'M',firstOut:true},
             {name:'R',group:'g',seqType:'R',firstOut:true}];
  const E=AN.makeEngine(pts);
  let v=[false,false,false], bad=0, seen=new Set();
  for(let i=0;i<4000;i++){
    if(i%7===0) v[i%3]=!v[i%3];
    if(i%53===0) AN.acknowledge(E);
    if(i%97===0) AN.silence(E);
    if(i%131===0) AN.reset(E);
    AN.step(E,j=>v[j],0.1);
    for(const s of E.st){ seen.add(s.state);
      if(!['normal','alarm','ack','ringback','cleared'].includes(s.state)) bad++; }
  }
  // with everything clear and reset, all must return to normal
  v=[false,false,false];
  for(let i=0;i<50;i++) AN.step(E,j=>v[j],0.1);
  AN.acknowledge(E); AN.step(E,j=>v[j],0.1); AN.reset(E); AN.step(E,j=>v[j],0.1);
  const stuck=E.st.filter(s=>s.state!=='normal').length;
  console.log(`  4000 random operations, states seen: ${[...seen].join(', ')}`);
  console.log(`  after clearing and resetting, windows not normal: ${stuck}`);
  chk(bad===0,'invalid annunciator state');
  chk(stuck===0,'annunciator window stuck after clear and reset');
}

console.log('\n=== U5. snapshot captures the startup state ===');
{
  let A=P.makePlant({life:'MOL'}); P.initHotStandby(A);
  A.banks.ctrlDemand=528;
  for(let i=0;i<3000;i++) P.stepPlant(A,0.1);
  SU.takeBaseline(A.su,A.ppm,528);
  A.diluteGpm=A.cp.dilMaxGpm;
  for(let i=0;i<6000;i++) P.stepPlant(A,0.1);
  SU.takePoint(A.su,A.ppm,528);
  const ic=IC.snapshot(A);
  let B=P.makePlant({life:'MOL'}); IC.restore(B,ic);
  const ptsOK = B.su && B.su.points && B.su.points.length===A.su.points.length;
  console.log(`  1/M points in the original ${A.su.points.length}, in the restored ${B.su?B.su.points.length:'MISSING'}`);
  for(let i=0;i<2000;i++){ P.stepPlant(A,0.1); P.stepPlant(B,0.1); }
  const same=A.S.P===B.S.P&&A.ppm===B.ppm&&A.k.P===B.k.P;
  console.log(`  stepped 2000 further: ${same?'bit-identical':'** DIVERGED'}`);
  chk(ptsOK,'snapshot does not capture the startup instrumentation');
  chk(same,'snapshot diverges from a startup state');
}

console.log('\n=== U6. hot standby -> critical -> low power ===');
{
  let PL=P.makePlant({life:'MOL'}); P.initHotStandby(PL);
  PL.banks.ctrlDemand=528;
  for(let i=0;i<3000;i++) P.stepPlant(PL,0.1);
  let t=0,crit=null;
  while(t<60000 && PL.k.P<1e-4){
    // throttle the dilution as criticality approaches, as procedure requires
    const pcm=PL.lastBalance.pcm;
    PL.diluteGpm = pcm<-800 ? PL.cp.dilMaxGpm : (pcm<-200 ? 30 : 8);
    P.stepPlant(PL,0.2); t+=0.2;
    if(!crit&&pcm>-10) crit=t; }
  PL.diluteGpm=0;
  console.log(`  critical at t=${F(crit/60,1)} min, ${F(PL.ppm,0)} ppm, power ${PL.k.P.toExponential(2)}`);
  console.log(`  Tavg ${F(PL.S.Tavg,1)} F, psig ${F(PL.S.P-14.7,0)}, SUR ${F(PL.su.surDpm,3)} dpm`);
  console.log(`  trip ${PL.trip?PL.tripFirst:'none'}   SI ${PL.si.actuated?'ACTUATED':'armed'}`);
  chk(!PL.trip,'tripped during the approach to criticality');
  chk(PL.k.P>1e-6,'never went critical');
  chk(PL.su.surDpm<1.5,'startup rate exceeded the technical specification');
}

console.log('\n'+(FAIL===0?'STARTUP AUDIT: ALL CHECKS PASSED':'STARTUP AUDIT: '+FAIL+' FAILED'));
