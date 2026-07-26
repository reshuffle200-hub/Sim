import * as ST from '../lib/steam.js';
import * as K from '../lib/kinetics.js';
import * as RX from '../lib/reactivity.js';
import * as FU from '../lib/fuel.js';
import * as R from '../lib/rcs.js';
import * as Z from '../lib/pzr.js';
const F=(x,n=3)=>Number(x).toFixed(n);
let FAIL=0; const chk=(ok,msg)=>{ if(!ok){FAIL++;console.log('  ** FAIL: '+msg);} };

console.log('=== A. cross-module parameter consistency ===');
const rp=R.rcsParams(), fp=FU.fuelParams(), cp=RX.coreParams('MOL');
const pairs=[
 ['core power',        rp.Qrated,      fp.Qrated],
 ['core flow (total)', rp.Wrated*3,    fp.WrattedLbHr],
 ['core dT',           rp.dTcore,      fp.dT0],
 ['Tavg at HFP',       rp.TavgRef,     fp.Tref],
 ['Tavg at HFP (rx)',  rp.TavgRef,     cp.TmodRefF],
 ['Tcold at HFP',      rp.TcoldRef,    fp.TcoldRefF],
 ['Thot at HFP',       rp.ThotRef,     fp.ThotRefF],
 ['fuel T at 100%',    fp.TfuelRefF,   cp.TfuelRefF],
 ['fuel T at HZP',     547,            cp.TfuelHZPF]
];
for(const [n,a,b] of pairs){
  const rel=Math.abs(a-b)/Math.max(Math.abs(b),1e-9)*100;
  console.log(`  ${n.padEnd(20)} ${F(a,1).padStart(12)}  vs ${F(b,1).padStart(12)}   ${rel<0.5?'ok':'MISMATCH '+F(rel,2)+'%'}`);
  chk(rel<0.5,n+' mismatch');
}

console.log('\n=== B. RCS mass and energy conservation (closed system, no sources) ===');
{
  // a genuinely closed system: no core power, no SG sink, no pump heat,
  // no ambient loss.  (The first version of this test left the SG removing
  // heat and then complained that energy was not conserved.)
  const rp0=R.rcsParams(); rp0.UAsg=0; rp0.pumpHeatMW=0; rp0.ambientLossMW=0;
  let S=R.makeRCS(rp0); R.initSteady(rp0,S,577,2250,0.60);
  const M0=R.totalMass(S);
  let U0=0; for(const n of S.nodes) U0+=n.U;
  for(let i=0;i<200/0.05;i++) R.stepRCS(rp0,S,0,0.05,{});
  const M1=R.totalMass(S); let U1=0; for(const n of S.nodes) U1+=n.U;
  console.log(`  mass   ${F(M0/1000,2)}k -> ${F(M1/1000,2)}k lbm   drift ${F((M1-M0)/M0*100,5)}%`);
  console.log(`  energy ${F(U0/1e6,3)}M -> ${F(U1/1e6,3)}M Btu     drift ${F((U1-U0)/Math.abs(U0)*100,5)}%`);
  chk(Math.abs((M1-M0)/M0)<1e-4,'RCS mass not conserved');
  chk(Math.abs((U1-U0)/U0)<1e-3,'RCS energy not conserved');
}

console.log('\n=== C. energy balance with a known source ===');
{
  let S=R.makeRCS(rp); R.initSteady(rp,S,577,2250,0.60);
  let U0=0; for(const n of S.nodes) U0+=n.U;
  const Qw=100e6;                          // 100 MW in, no SG removal
  const rp2=R.rcsParams(); rp2.UAsg=0;                 // disable the SG properly
  const secs=60;
  for(let i=0;i<secs/0.05;i++) R.stepRCS(rp2,S,Qw,0.05,{});
  let U1=0; for(const n of S.nodes) U1+=n.U;
  // expected = core heat + pump heat - ambient loss, over the interval
  const expect=(Qw + 3*rp2.pumpHeatMW*1e6 - rp2.ambientLossMW*1e6)*3.412142*(secs/3600);
  console.log(`  added ${F((U1-U0)/1e6,2)}M Btu, expected ${F(expect/1e6,2)}M Btu   error ${F((U1-U0-expect)/expect*100,3)}%`);
  chk(Math.abs((U1-U0-expect)/expect)<0.02,'energy source not accounted correctly');
}

console.log('\n=== D. time-step sensitivity (same transient, different dt) ===');
{
  const res=[];
  for(const dt of [0.01,0.025,0.05,0.1,0.25]){
    let S=R.makeRCS(rp); R.initSteady(rp,S,577,2250,0.60);
    for(let i=0;i<150/dt;i++) R.stepRCS(rp,S,rp.Qrated,dt,{});
    res.push([dt,S.P,S.Tavg,S.W[0]/rp.Wrated,S.pzrLevel*100]);
  }
  console.log('    dt      P(psia)   Tavg     flow    pzr%');
  for(const r of res) console.log(`  ${String(r[0]).padStart(6)}  ${F(r[1],1).padStart(8)}  ${F(r[2],2)}  ${F(r[3],4)}  ${F(r[4],2)}`);
  const spreadP=Math.max(...res.map(r=>r[1]))-Math.min(...res.map(r=>r[1]));
  const spreadT=Math.max(...res.map(r=>r[2]))-Math.min(...res.map(r=>r[2]));
  console.log(`  spread: P ${F(spreadP,2)} psia, Tavg ${F(spreadT,3)} F`);
  chk(spreadP<25,'pressure is time-step dependent');
  chk(spreadT<1.0,'Tavg is time-step dependent');
}

console.log('\n=== E. cold conditions with the real control loop attached ===');
// The first version of this test drove the RCS bare -- no pressurizer control,
// no relief -- and heated a cold plant with the steam generators, which are not
// the heat sink in cold shutdown.  It railed at 3100 psia every time.  That was
// a bad test, but it did expose a genuine gap: there was no cold overpressure
// protection.  LTOP now exists, and this exercises it.
for(const [T,p,lvl,lbl] of [[557,2250,0.55,'hot standby'],[400,450,0.60,'above LTOP enable'],
                            [300,400,0.60,'heatup, LTOP armed'],[200,350,0.50,'cold, bubble drawn'],
                            [200,350,0.95,'cold, near solid']]){
  const rpc=R.rcsParams(); rpc.UAsg=(T>500?rpc.UAsg:0); rpc.pumpHeatMW=0.5;
  let S=R.makeRCS(rpc); R.initSteady(rpc,S,T,p,lvl);
  let z=Z.makePZR(Z.pzrParams()); const zp=Z.pzrParams();
  let ok=true, P0=S.P, peak=0;
  for(let i=0;i<180/0.05;i++){
    Z.stepPZR(zp,z,S.P,S.pzrLevel*100,S.Tavg,S.Tcold[0],0.05);
    R.stepRCS(rpc,S,T>500?rpc.Qrated*0.02:8e6,0.05,{Qpzr:z.Qpzr,Wspray:z.sprayLbHr,
      Wrelief:z.Wrelief,chargeLbHr:z.chargeLbHr,letdownLbHr:z.letdownLbHr});
    peak=Math.max(peak,S.P);
    if(!S.ok||S.railed) ok=false;
  }
  console.log(`  ${lbl.padEnd(22)} ${F(P0,0).padStart(5)} -> ${F(S.P,0).padStart(5)} psia (peak ${F(peak,0).padStart(5)})  Tavg ${F(S.Tavg,1).padStart(6)}  lvl ${F(S.pzrLevel*100,1).padStart(5)}%  LTOP ${z.ltopArmed?'ARMED':'off  '}  ${ok?'ok':'** RAILED'}`);
  chk(ok,'railed or unstable at '+lbl);
  chk(isFinite(S.P)&&S.P>10,'bad pressure at '+lbl);
}

console.log('\n=== F. long-run drift at steady full power (30 min) ===');
{
  let S=R.makeRCS(rp); R.initSteady(rp,S,577,2250,0.60);
  let z=Z.makePZR(Z.pzrParams()); const zp=Z.pzrParams();
  const snap=[];
  for(let i=0;i<1800/0.05;i++){
    Z.stepPZR(zp,z,S.P,S.pzrLevel*100,S.Tavg,S.Tcold[0],0.05);
    R.stepRCS(rp,S,rp.Qrated,0.05,{Qpzr:z.Qpzr,Wspray:z.sprayLbHr,Wrelief:z.Wrelief,
      chargeLbHr:z.chargeLbHr,letdownLbHr:z.letdownLbHr});
    if(i%(600/0.05)===0) snap.push([i*0.05,S.P-14.7,S.Tavg,S.pzrLevel*100,R.totalMass(S)/1000]);
  }
  snap.push([1800,S.P-14.7,S.Tavg,S.pzrLevel*100,R.totalMass(S)/1000]);
  console.log('    t(s)   psig    Tavg     pzr%    mass(k)');
  for(const s of snap) console.log(`  ${String(F(s[0],0)).padStart(6)}  ${F(s[1],0).padStart(5)}  ${F(s[2],2)}  ${F(s[3],2).padStart(6)}  ${F(s[4],2)}`);
  chk(Math.abs(snap[snap.length-1][2]-snap[0][2])<3,'Tavg drifts over 30 min');
}

console.log('\n=== G. NaN / non-finite sweep across the operating envelope ===');
{
  let bad=0,tested=0;
  for(const T of [120,250,400,500,557,577,600]){
    for(const p of [300,600,1200,1800,2250,2400]){
      for(const lvl of [0.15,0.5,0.9]){
        let S=R.makeRCS(rp);
        try{
          R.initSteady(rp,S,T,p,lvl);
          for(let i=0;i<10/0.05;i++) R.stepRCS(rp,S,rp.Qrated*0.3,0.05,{});
          tested++;
          for(const n of S.nodes) if(!isFinite(n.M)||!isFinite(n.U)||!isFinite(n.T)) bad++;
          if(!isFinite(S.P)) bad++;
        }catch(e){ bad++; console.log('    threw at T='+T+' P='+p+' lvl='+lvl+': '+e.message); }
      }
    }
  }
  console.log(`  ${tested} states exercised, ${bad} non-finite`);
  chk(bad===0,'non-finite values in the envelope sweep');
}

console.log('\n=== H. kinetics + reactivity + fuel closed loop (self-regulation) ===');
{
  const P=RX.coreParams('MOL'); const fpar=FU.fuelParams();
  let k=K.equilibrate(K.makeKinetics(),1.0);
  let fp=RX.equilibrateFP(P,RX.makeFP(),1.0);
  let f=FU.makeFuel(fpar); const st0=FU.steadyFuel(fpar,1.0,577); f.Tf=st0.Tf; f.Tc=st0.Tc;
  const banks=RX.fullOutBanks(P); banks.ctrlDemand=520;
  let ppm=P.critBoronRef;
  // find the boron that holds it critical here
  ppm=RX.criticalBoron(P,{TmodF:577,psia:2250,TfuelF:f.Tf,ppm,banks,X:fp.X,Sm:fp.Sm});
  let pw=1.0;
  const hist=[];
  for(let i=0;i<300/0.05;i++){
    const rho=RX.total(P,{TmodF:577,psia:2250,TfuelF:f.Tf,ppm,banks,X:fp.X,Sm:fp.Sm}).total;
    K.stepKinetics(k,rho,0.05);
    FU.stepFuel(fpar,f,k.Ptot,577,0.05);
    RX.stepFP(P,fp,k.P,0.05);
    pw=k.Ptot;
    if(i%(60/0.05)===0) hist.push([i*0.05,pw*100,f.Tf,rho*1e5]);
  }
  console.log('    t(s)   power%    Tfuel    rho(pcm)');
  for(const h of hist) console.log(`  ${String(F(h[0],0)).padStart(6)}  ${F(h[1],3).padStart(8)}  ${F(h[2],1)}  ${F(h[3],2).padStart(8)}`);
  chk(Math.abs(pw-1)<0.05,'closed loop does not hold power');
  console.log(`  -> Doppler self-regulation holds power at ${F(pw*100,2)}%`);
}

console.log('\n'+(FAIL===0?'ALL CHECKS PASSED':FAIL+' CHECK(S) FAILED'));
