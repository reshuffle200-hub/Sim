import * as P from '../lib/plant.js';
import * as IC from '../lib/ic.js';
const F=(x,n=6)=>Number(x).toFixed(n);

console.log('=== snapshot round-trip fidelity ===');
console.log('  a restored IC must produce a BIT-IDENTICAL continuation\n');
let A=P.makePlant({life:'MOL'});
P.initPlant(A,1.0,900);
for(let i=0;i<400;i++) P.stepPlant(A,0.05);      // get somewhere non-trivial
A.sec.loadSet=0.8; A.sc.rampPctPerMin=9;          // operator-changed params too
for(let i=0;i<600;i++) P.stepPlant(A,0.05);

const ic=IC.snapshot(A,{name:'test'});
console.log('  snapshot size: '+IC.sizeKB(ic).toFixed(1)+' KB');
console.log('  describe: '+IC.describe(ic));

// restore into a FRESH plant object that has never seen this state
let B=P.makePlant({life:'MOL'});
IC.restore(B,ic);

// compare immediately
const cmp=(a,b,path,out)=>{
  if(typeof a==='number'){ if(a!==b&&!(Number.isNaN(a)&&Number.isNaN(b))) out.push(path+': '+a+' vs '+b); return; }
  if(a===null||b===null||typeof a!=='object'){ if(a!==b) out.push(path+': '+a+' vs '+b); return; }
  if(Array.isArray(a)){ if(a.length!==b.length){out.push(path+' length');return;}
    for(let i=0;i<a.length;i++) cmp(a[i],b[i],path+'['+i+']',out); return; }
  for(const k of Object.keys(a)) cmp(a[k],b?b[k]:undefined,path+'.'+k,out);
};
let d=[];
for(const k of ['k','fp','f','S','sgs','z','sec','E','banks']) cmp(A[k],B[k],k,d);
console.log('  state differences after restore: '+d.length+(d.length?'\n    '+d.slice(0,5).join('\n    '):' (exact)'));
console.log('  operator params carried: rampPctPerMin '+B.sc.rampPctPerMin+', loadSet '+B.sec.loadSet);

// step both in parallel and compare divergence
console.log('\n=== parallel continuation ===');
console.log('    steps    |dPower|      |dTavg|       |dP|        |dSGlvl|');
for(const n of [1,10,100,1000,6000]){
  for(let i=0;i<(n===1?1:n-(n===10?1:(n===100?10:(n===1000?100:1000))));i++){
    P.stepPlant(A,0.05); P.stepPlant(B,0.05);
  }
  const dp=Math.abs(A.k.Ptot-B.k.Ptot), dt=Math.abs(A.S.Tavg-B.S.Tavg);
  const dpr=Math.abs(A.S.P-B.S.P), dsg=Math.abs(A.sgs[0].lvlNR-B.sgs[0].lvlNR);
  console.log(`  ${String(n).padStart(7)}   ${dp.toExponential(2)}   ${dt.toExponential(2)}   ${dpr.toExponential(2)}   ${dsg.toExponential(2)}`);
}
const exact = A.k.Ptot===B.k.Ptot && A.S.Tavg===B.S.Tavg && A.S.P===B.S.P;
console.log('\n  '+(exact?'BIT-IDENTICAL after 6000 steps (5 minutes of simulated time)'
                     :'** DIVERGED — the snapshot is incomplete'));

console.log('\n=== JSON file transfer ===');
// compare against a DIRECT restore of the same snapshot, not against a plant
// that has since been stepped 6000 times (that was the first version of this
// test, and it reported a mismatch that was entirely my own bookkeeping)
const txt=IC.toJSON(ic);
let C=P.makePlant({life:'MOL'}); IC.restore(C,IC.fromJSON(txt));
let D0=P.makePlant({life:'MOL'}); IC.restore(D0,ic);
console.log('  through JSON string ('+(txt.length/1024).toFixed(1)+' KB)');
console.log('  direct restore  '+F(D0.k.Ptot*100,8)+'%   via JSON  '+F(C.k.Ptot*100,8)+'%');
console.log('  '+(C.k.Ptot===D0.k.Ptot&&C.S.P===D0.S.P?'exact':'** MISMATCH'));

console.log('\n=== library ===');
const lib=IC.makeLibrary();
lib.slots['at 98%']=ic; lib.order.push('at 98%');       // the earlier snapshot
IC.save(lib,'5 min later',A,{note:'after the ramp'});   // A is where it is NOW
console.log('  slots: '+lib.order.map(n=>n+' ('+IC.describe(lib.slots[n])+')').join('  |  '));
console.log('  persistence available here: '+IC.persistAvailable+' (falls back to memory)');
let D=P.makePlant({life:'MOL'});
IC.load(lib,'at 98%',D);
console.log('  reloaded "at 98%" -> '+IC.describe(IC.snapshot(D))+'   '+
  (D.k.Ptot===D0.k.Ptot?'exact':'** MISMATCH'));
