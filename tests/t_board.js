// Boards, switches and the expanded annunciator, exercised together.
import * as PLANT from '../lib/plant.js';
import * as EL from '../lib/elec.js';
import * as RPS from '../lib/rps.js';
import * as SIM from '../lib/si.js';
import * as RH from '../lib/rhr.js';
import * as AL from '../ui/alarms.js';
import * as AN from '../ui/annun.js';
import * as B from '../ui/boards.js';
import { SWITCHES, actuate, switchBank } from '../ui/controls.js';
const F=(x,n=1)=>Number.isFinite(x)?x.toFixed(n):'—';
const api={closeGenBreaker:EL.closeGenBreaker,loseOffsite:EL.loseOffsite,
  restoreOffsite:EL.restoreOffsite,setChannel:RPS.setChannel,blockSI:SIM.blockSI,
  placeInService:RH.placeInService};
let fail=0; const ck=(c,m)=>{ if(!c){console.log('  FAIL: '+m); fail++;} };

console.log(`annunciator windows: ${AL.ALARMS.length} in ${AL.sections().length} sections`);
console.log(`control switches:    ${SWITCHES.length}`);
ck(AL.ALARMS.length>150,'window count');
ck(SWITCHES.length>=45,'switch count');

// no duplicate window names -- two windows with one legend is a real defect
const names=AL.ALARMS.map(a=>a[0]); const dup=names.filter((n,i)=>names.indexOf(n)!==i);
ck(dup.length===0,'duplicate window names: '+dup.join(', '));

const PL=PLANT.makePlant({life:'MOL'}); PLANT.initPlant(PL,1.0,900);
const A=AL.makeAlarmState(); const ANN=AN.makeEngine(AL.annunPoints());
ck(ANN.points.every(p=>p.section),'every point carries a section');

// --- switches drive the annunciator: close a PORV block, window must light
const bi=SWITCHES.findIndex(s=>s.label==='PORV 1 BLOCK');
actuate(PL,bi,0,api);
AL.updateAlarms(A,PL); AN.step(ANN,i=>AL.readPoint(PL,i),1/60);
const wi=AL.ALARMS.findIndex(a=>a[0]==='PORV 1 BLOCKED');
ck(A.st[wi].on,'closing PORV 1 block lights its window');
actuate(PL,bi,1,api);

// --- stopping a containment fan must light its window AND cut real heat removal
const fi=SWITCHES.findIndex(s=>s.label==='FAN 1');
const q0=PL.cnmt.QfanMW ?? 0;
actuate(PL,fi,0,api);
for(let i=0;i<400;i++) PLANT.stepPlant(PL,0.05,{noTrip:true});
AL.updateAlarms(A,PL);
const fw=AL.ALARMS.findIndex(a=>a[0]==='CNMT FAN 1 OFF');
ck(A.st[fw].on,'stopping fan 1 lights its window');
ck(!PL.cnmt.fansOn[0],'fan 1 actually stopped');
actuate(PL,fi,1,api);

// --- degrading condenser vacuum must actually take the steam dumps away
const ci=SWITCHES.findIndex(s=>s.label==='CONDENSER VACUUM');
ck(PL.sec.dumpAvail,'dumps available at normal vacuum');
actuate(PL,ci,1,api);
for(let i=0;i<100;i++) PLANT.stepPlant(PL,0.05,{noTrip:true});
ck(!PL.sec.dumpAvail,'degraded vacuum removes the dumps (real interlock)');
actuate(PL,ci,0,api);
for(let i=0;i<100;i++) PLANT.stepPlant(PL,0.05,{noTrip:true});
ck(PL.sec.dumpAvail,'dumps return when vacuum is restored');

// --- channel bypass keylock must bypass every protection parameter
const ki=SWITCHES.findIndex(s=>s.label==='CHANNEL II');
actuate(PL,ki,1,api);
const nby=Object.keys(PL.rps.params).filter(id=>PL.rps.params[id].ch[1].state==='bypass').length;
ck(nby===Object.keys(PL.rps.params).length,`channel II bypass covers all params (got ${nby})`);
actuate(PL,ki,0,api);

// --- per-section first-out
const P2=PLANT.makePlant({life:'MOL'}); PLANT.initPlant(P2,1.0,900);
const A2=AL.makeAlarmState();
P2.sgs[1].lvlNR=5; P2.E.gridAvail=false;
AL.updateAlarms(A2,P2);
const secs=Object.keys(A2.firstBySection);
ck(secs.length>=2,`first-out latched per section (${secs.length} sections)`);

// --- every board renders on every state, with switches present
for(const [lbl,p] of [['at power',PL],['hot standby',(()=>{const x=PLANT.makePlant();PLANT.initHotStandby(x);return x;})()]]){
  for(const b of ['overview','reactor','startup','rcs','secondary','safeguards','electrical']){
    let h=''; try{ h=B[b](p); }catch(e){ console.log(`  FAIL: ${b} threw on ${lbl}: ${e.message}`); fail++; continue; }
    ck(!/undefined|NaN|\[object/.test(h),`${b} markup clean on ${lbl}`);
  }
}
for(const b of ['reactor','rcs','secondary','safeguards','electrical'])
  ck(switchBank(PL,b).includes('data-sw'),`${b} has a switch bank`);

console.log(fail? `\n*** ${fail} FAILURES ***` : '\nBOARD AUDIT: ALL CHECKS PASSED');
