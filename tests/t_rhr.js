import * as RH from '../lib/rhr.js';
const F=(x,n=1)=>Number(x).toFixed(n);
const P=RH.rhrParams();

console.log('=== entry interlock ===');
{
  let R=RH.makeRHR(P);
  console.log('  psig   interlocked   can place in service');
  for(const psig of [2235,800,450,410,395,300,100]){
    RH.stepRHR(P,R,psig+14.7,340,340,380000,0.5);
    const ok=RH.placeInService(P,R,0.5);
    console.log(`  ${String(psig).padStart(5)}      ${R.trains[0].interlocked?'YES':'no '}          ${ok?'yes':'NO'}`);
    if(!ok) RH.removeFromService(R);
  }
  console.log('  -> suction valves are interlocked shut above '+P.permissivePsig+' psig;');
  console.log('     opening them at pressure is an interfacing-systems LOCA.');
}

console.log('\n=== heat removal capability vs RCS temperature ===');
console.log('  Thot   flow(gpm)   Tout    Q per train   both trains   decay heat at');
for(const T of [350,300,250,200,150,120]){
  let R=RH.makeRHR(P);
  for(let i=0;i<300;i++) RH.stepRHR(P,R,300,T,T,380000,0.5);
  RH.placeInService(P,R,1.0);
  for(let i=0;i<600;i++) RH.stepRHR(P,R,300,T,T,380000,0.5);
  const t=R.trains[0];
  console.log(`  ${String(T).padStart(4)}   ${F(t.flowGpm,0).padStart(6)}     ${F(t.Tout,1).padStart(5)}   ${F(t.QMW,1).padStart(7)} MW    ${F(R.QtotalMW,1).padStart(6)} MW`);
}
console.log('  (decay heat 4 h after shutdown is about 33 MW, 24 h about 17 MW)');

console.log('\n=== cooldown rate control ===');
{
  let R=RH.makeRHR(P);
  for(let i=0;i<100;i++) RH.stepRHR(P,R,300,340,340,380000,0.5);
  RH.placeInService(P,R,0.3);
  R.mode='rate'; R.rateSetFperHr=50; R.decayMW=30;
  let T=340; const Mcp=380000*1.05;
  console.log('   t(min)   Tavg    rate(F/hr)   throttle   Q(MW)   CCW(F)');
  let t=0;
  for(const m of [0,10,30,60,120,240]){
    while(t<m*60){
      const decay=30e6;                                  // 30 MW decay heat
      const Q=RH.stepRHR(P,R,300,T,T,380000,1.0);
      T -= (Q-decay)*3.412142/Mcp*(1/3600);
      t+=1;
    }
    console.log(`  ${String(m).padStart(6)}   ${F(T,1)}   ${F(R.cooldownFperHr,1).padStart(8)}     ${F(R.trains[0].throttle,2)}     ${F(R.QtotalMW,1).padStart(5)}   ${F(R.ccwTempF,0)}`);
  }
  console.log(`  Tech Spec limit is ${P.cooldownLimitFperHr} F/hr; the controller held ${F(R.rateSetFperHr,0)}`);
}

console.log('\n=== unthrottled: how fast could it cool? ===');
{
  let R=RH.makeRHR(P);
  for(let i=0;i<100;i++) RH.stepRHR(P,R,300,340,340,380000,0.5);
  RH.placeInService(P,R,1.0);
  let T=340; const Mcp=380000*1.05; let peak=0;
  for(let i=0;i<3600;i++){
    const Q=RH.stepRHR(P,R,300,T,T,380000,1.0);
    T -= (Q-30e6)*3.412142/Mcp*(1/3600);
    peak=Math.max(peak,R.cooldownFperHr);
  }
  console.log(`  wide open: peak ${F(peak,0)} F/hr, reached ${F(T,0)} F in 1 h`);
  console.log(`  -> ${peak>P.cooldownLimitFperHr?'exceeds':'within'} the ${P.cooldownLimitFperHr} F/hr limit, so it must be throttled`);
}
