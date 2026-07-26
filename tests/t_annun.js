import * as AN from '../ui/annun.js';
const pts=[
  {name:'PZR PRESS HIGH',group:'rcs',seqType:'R',firstOut:true,cls:'bad'},
  {name:'PZR LEVEL LOW', group:'rcs',seqType:'A',firstOut:true,cls:''},
  {name:'SG LEVEL LO-LO',group:'sec',seqType:'M',firstOut:true,cls:'bad'}
];
let v=[false,false,false];
const E=AN.makeEngine(pts);
const read=i=>v[i];
const show=(t,note)=>{
  AN.step(E,read,0.1);
  const s=pts.map((p,i)=>{
    const r=AN.render(E,i,t);
    return `${p.name.split(' ')[0]}:${E.st[i].state}${r.first?'*':''}`;
  }).join('  ');
  console.log(`  ${note.padEnd(30)} ${s}   horn=${E.horn?E.hornKind:'off'}`);
};
console.log('=== ISA-18.1 sequence walk-through ===');
console.log('  (* marks first-out within its group)\n');
show(0,'all normal');
v[0]=true; show(1,'PZR PRESS goes high');
v[1]=true; show(2,'PZR LEVEL follows (consequence)');
AN.silence(E); show(3,'SILENCE pressed');
console.log('    -> horn off, but both windows still flashing: silencing');
console.log('       does not destroy the information about what is new');
v[2]=true; show(4,'SG LEVEL alarms -- REFLASH');
console.log('    -> the horn came back on its own for the new alarm');
AN.acknowledge(E); show(5,'ACKNOWLEDGE pressed');
v[0]=false; show(6,'PZR PRESS clears (sequence R)');
console.log('    -> ringback: slow flash and a different tone. "It cleared"');
console.log('       is itself an event the operator has to sign for');
v[1]=false; show(7,'PZR LEVEL clears (sequence A)');
console.log('    -> sequence A resets itself silently');
AN.acknowledge(E); show(8,'ACKNOWLEDGE the ringback');
v[2]=false; show(9,'SG LEVEL clears (sequence M)');
console.log('    -> sequence M stays lit: a transient that came and went');
console.log('       cannot hide from the next shift');
AN.reset(E); show(10,'RESET pressed');

console.log('\n=== first-out survives the flood ===');
{
  const E2=AN.makeEngine(pts); let w=[false,false,false];
  AN.step(E2,i=>w[i],0.1);
  w[1]=true; AN.step(E2,i=>w[i],0.1);          // level first
  w[0]=true; w[2]=true; AN.step(E2,i=>w[i],0.1);
  console.log('  order of alarm:', AN.sequenceLog(E2).map(x=>x.name).join(' -> '));
  console.log('  first-out rcs group:', pts[E2.firstOutGroup['rcs']].name);
  console.log('  first-out sec group:', pts[E2.firstOutGroup['sec']].name);
}

console.log('\n=== counts ===');
console.log(' ', JSON.stringify(AN.counts(E)));
