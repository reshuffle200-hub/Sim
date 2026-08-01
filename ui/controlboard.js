// ======================================================================
//  controlboard.js — full-screen "main control board" view.
//
//  Authentic control-room layout: panels arranged by system (as real
//  benchboards are), each panel carrying its annunciator tiles on top,
//  key gauges in the middle, and its switch bench below. Built lazily
//  when opened; tiles update by class each frame (cheap), benches/gauges
//  refresh on a throttle. Pan/zoom + fullscreen are handled by the host.
// ======================================================================
import * as AN from './annun.js';
import * as AL from './alarms.js';
import * as CT from './controls.js';

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
const n = (v, d = 0, u = '') => (v == null || isNaN(v)) ? '--' : (+v).toFixed(d) + u;

// System panels, left-to-right, each mapping annunciator sections + a switch board.
export const PANELS = [
  { name:'REACTOR & PROTECTION', board:'reactor',
    secs:['REACTOR & PROTECTION','NUCLEAR INSTRUMENTATION','PROTECTION CHANNELS',
          'PROTECTION CHANNEL I','PROTECTION CHANNEL II','PROTECTION CHANNEL III','PROTECTION CHANNEL IV',
          'ROD CONTROL','ROD BANKS'] },
  { name:'REACTOR COOLANT', board:'rcs',
    secs:['PRESSURIZER','REACTOR COOLANT','CHEMICAL & VOLUME CONTROL','VALVE LINEUP'] },
  { name:'STEAM & FEEDWATER', board:'secondary',
    secs:['STEAM GENERATOR A','STEAM GENERATOR B','STEAM GENERATOR C','STEAM & FEEDWATER',
          'CONDENSER & VACUUM','CIRCULATING WATER','CONDENSATE'] },
  { name:'SAFEGUARDS & CONTAINMENT', board:'safeguards',
    secs:['SAFEGUARDS','CONTAINMENT','RESIDUAL HEAT REMOVAL'] },
  { name:'ELECTRICAL', board:'electrical', secs:['ELECTRICAL'] },
  { name:'AUX & RADIATION', board:'cooling',
    secs:['RADIATION - PROCESS','RADIATION - SG','RADIATION - AREA','COMPONENT COOLING','SERVICE WATER'] },
];

// ---- analog gauge rendering ----
const G = { green:'#5a7040', amber:'#e0b24d', red:'#e0574c' };
function polar(cx, cy, r, deg) { const a = deg * Math.PI / 180; return [cx + r*Math.cos(a), cy + r*Math.sin(a)]; }
function arc(cx, cy, r, d0, d1) {
  const [x0,y0] = polar(cx,cy,r,d0), [x1,y1] = polar(cx,cy,r,d1);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${(d1-d0)>180?1:0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}
// semicircular dial: needle sweeps left(min) -> top -> right(max)
function dial(label, val, min, max, unit, bands) {
  const cx = 46, cy = 42, r = 34;
  const t = Math.max(0, Math.min(1, ((val - min) / (max - min)) || 0));
  const [nx, ny] = polar(cx, cy, r*0.82, 180 + t*180);
  let bandSvg = '';
  (bands || []).forEach(b => {
    const t0 = Math.max(0,(b[0]-min)/(max-min)), t1 = Math.min(1,(b[1]-min)/(max-min));
    if (t1 > t0) bandSvg += `<path d="${arc(cx,cy,r,180+t0*180,180+t1*180)}" fill="none" stroke="${b[2]}" stroke-width="4"/>`;
  });
  let ticks = '';
  for (let k = 0; k <= 4; k++) { const [tx,ty]=polar(cx,cy,r,180+k/4*180), [ix,iy]=polar(cx,cy,r-5,180+k/4*180);
    ticks += `<line x1="${tx.toFixed(1)}" y1="${ty.toFixed(1)}" x2="${ix.toFixed(1)}" y2="${iy.toFixed(1)}" stroke="#5a6552" stroke-width="1"/>`; }
  const vs = (val==null||isNaN(val)) ? '--' : (Math.abs(val) >= 100 ? (+val).toFixed(0) : (+val).toFixed(1));
  return `<div class="cbdial"><svg viewBox="0 0 92 74">
    <path d="${arc(cx,cy,r,180,360)}" fill="none" stroke="#2a3222" stroke-width="4"/>${bandSvg}${ticks}
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#e6ecde" stroke-width="2"/>
    <circle cx="${cx}" cy="${cy}" r="2.6" fill="#e6ecde"/>
    <text x="${cx}" y="${cy+14}" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">${vs}</text>
    <text x="${cx}" y="${cy+23}" text-anchor="middle" font-size="7" fill="#8a9379">${esc(unit)}</text>
    <text x="${cx}" y="70" text-anchor="middle" font-size="8" font-weight="600" fill="#cbd3c1">${esc(label)}</text>
  </svg></div>`;
}
function lamp(label, on, txt, color) {
  return `<div class="cblamp"><span class="cblampdot" style="background:${on?color:'#39422f'};box-shadow:${on?'0 0 6px '+color:'none'}"></span>
    <div class="cblamptext"><b>${esc(txt)}</b><span>${esc(label)}</span></div></div>`;
}

const GAUGES = {
  reactor: PL => [
    dial('POWER', PL.k.Ptot*100, 0, 120, '%', [[0,100,G.green],[100,108,G.amber],[108,120,G.red]]),
    dial('DNBR', PL.dnbr, 1, 3, '', [[1,1.5,G.red],[1.5,1.8,G.amber],[1.8,3,G.green]]),
    dial('ROD POS', PL.banks.ctrlDemand, 0, 528, 'steps', []),
    dial('BORON', PL.ppm, 0, 1600, 'ppm', []),
  ],
  rcs: PL => [
    dial('RCS PRESS', PL.S.P-14.7, 1700, 2500, 'psig', [[1700,1900,G.red],[1900,2350,G.green],[2350,2500,G.red]]),
    dial('Tavg', PL.S.Tavg, 530, 600, '\u00b0F', [[530,545,G.amber],[545,590,G.green],[590,600,G.red]]),
    dial('PZR LVL', PL.S.pzrLevel*100, 0, 100, '%', [[0,17,G.red],[17,25,G.amber],[25,70,G.green],[92,100,G.red]]),
    dial('SUBCOOL', PL.S.subcooling, 0, 80, '\u00b0F', [[0,20,G.red],[20,35,G.amber],[35,80,G.green]]),
  ],
  secondary: PL => [
    dial('GEN', PL.E.MWe, 0, 1000, 'MWe', []),
    dial('SG-A LVL', PL.sgs[0].lvlNR, 0, 100, '%', [[0,15,G.red],[15,20,G.amber],[20,85,G.green]]),
    dial('STM HDR', PL.sec.Pheader, 0, 1200, 'psia', []),
    dial('FEED FLOW', PL.sec.WfwTotal/1e6, 0, 16, 'Mlb/h', []),
  ],
  safeguards: PL => [
    dial('RWST', PL.si.rwstPct, 0, 100, '%', [[0,20,G.red],[20,100,G.green]]),
    dial('SI FLOW', PL.si.totalGpm, 0, 4000, 'gpm', []),
    lamp('CONTAINMENT', PL.cnmt.isolated, PL.cnmt.isolated?'ISOL':'NORMAL', G.red),
    lamp('CNMT SPRAY', PL.cnmt.sprayOn.some(Boolean), PL.cnmt.sprayOn.some(Boolean)?'ON':'OFF', '#4a9fd4'),
  ],
  electrical: PL => [
    dial('GROSS', PL.E.MWe, 0, 1000, 'MWe', []),
    dial('NET OUT', PL.E.netMWe, 0, 1000, 'MWe', []),
    lamp('GRID', PL.E.gridAvail, PL.E.gridAvail?'UP':'LOST', '#7fd18a'),
    lamp('DIESELS', PL.E.edg.some(e=>e.running), PL.E.edg.map(e=>e.running?'ON':'\u2013').join(' '), G.amber),
  ],
  cooling: PL => [
    dial('CCW SUP', PL.cw.supplyF, 60, 150, '\u00b0F', [[60,120,G.green],[120,140,G.amber],[140,150,G.red]]),
    dial('COND VAC', PL.cd.inHg, 0, 6, 'inHg', [[0,4,G.green],[4,6,G.amber]]),
    lamp('CCW PUMPS', PL.cw.pumpOn.filter(Boolean).length>0, PL.cw.pumpOn.filter(Boolean).length+'/3', '#7fd18a'),
    lamp('SW PUMPS', PL.cw.swPumpOn.filter(Boolean).length>0, PL.cw.swPumpOn.filter(Boolean).length+'/3', '#7fd18a'),
  ],
};

function gaugeHTML(PL, board) {
  try { return (GAUGES[board] ? GAUGES[board](PL) : []).join(''); } catch (e) { return ''; }
}

// section -> window indices (computed once from the engine)
function sectionIndex(ANN) {
  const map = {};
  ANN.points.forEach((p, i) => (map[p.section] || (map[p.section] = [])).push(i));
  return map;
}

/** Build the full control-board HTML (called once on open). */
export function build(PL, ANN) {
  const idxBySec = sectionIndex(ANN);
  const panels = PANELS.map(panel => {
    const ann = panel.secs.map(sec => {
      const idx = idxBySec[sec] || [];
      if (!idx.length) return '';
      const tiles = idx.map(i => {
        const p = ANN.points[i];
        const legend = AL.legendLines(p.name).map(l => `<span>${esc(l)}</span>`).join('');
        return `<div class="tile" id="cbt${i}" title="${esc(p.name)}">${legend}</div>`;
      }).join('');
      return `<div class="annsec"><div class="annseclabel">${esc(sec)}<b>${idx.length}</b></div>
        <div class="tiles">${tiles}</div></div>`;
    }).join('');
    return `<div class="cbpanel">
      <div class="cbpaneltitle">${esc(panel.name)}</div>
      <div class="cbann">${ann}</div>
      <div class="cbgauges" data-panel="${panel.board}"></div>
      <div class="cbbench" data-board="${panel.board}"></div>
    </div>`;
  }).join('');
  return `<div class="cbrow">${panels}</div>`;
}

/** Update live state: tile classes (cheap), plus gauges + benches (throttled by caller). */
export function update(PL, ANN, benches = false) {
  for (let i = 0; i < ANN.points.length; i++) {
    const t = document.getElementById('cbt' + i);
    if (!t) continue;
    const r = AN.render(ANN, i, 0);
    const cls = r.lit
      ? 'tile on' + (r.cls ? ' ' + r.cls : '') + (r.flash ? (r.cls === 'ringback' ? ' rb' : ' new') : '') + (r.first ? ' first' : '')
      : 'tile';
    if (t.className !== cls) t.className = cls;
  }
  if (benches) {
    document.querySelectorAll('.cbgauges').forEach(g => { g.innerHTML = gaugeHTML(PL, g.dataset.panel); });
    document.querySelectorAll('.cbbench').forEach(b => {
      const html = CT.switchBank(PL, b.dataset.board);
      if (b._h !== html) { b.innerHTML = html; b._h = html; }
    });
  }
}
