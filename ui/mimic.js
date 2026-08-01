// ======================================================================
//  mimic.js — live plant mimic (P&ID overview) board.
//  A pure render function of the plant instance, like the other boards:
//  returns an SVG string that is re-generated each frame with live values.
//  Reactor -> 3 RCS loops (hot leg / SG / cold leg / RCP) -> turbine ->
//  generator -> grid, plus pressurizer, and a trip banner.
// ======================================================================

const C = {
  bg:'#12160f', panel:'#1b2116', stroke:'#3a4433', grid:'#2a3222',
  hot:'#e0662e', cold:'#4a9fd4', steam:'#9fb8c4', on:'#7fd18a', off:'#586151',
  txt:'#cbd3c1', dim:'#8a9379', acc:'#9ec472', bad:'#e0574c', warn:'#e0b24d', vessel:'#232b1c'
};
const f = (v, d = 0) => (v == null || isNaN(v)) ? '--' : (+v).toFixed(d);
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));

function T(x, y, s, { size = 12, fill = C.txt, anchor = 'start', weight = 400, mono = false } = {}) {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}" ${mono?'font-family="ui-monospace,monospace"':''}>${s}</text>`;
}
function box(x, y, w, h, { fill = C.panel, stroke = C.stroke, r = 4, sw = 1 } = {}) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}
// vertical fill gauge (0..1), fills from bottom
function vbar(x, y, w, h, frac, col, { warnLo = null, warnHi = null } = {}) {
  frac = Math.max(0, Math.min(1, frac || 0));
  const fh = h * frac, fy = y + h - fh;
  let c = col;
  if (warnLo != null && frac < warnLo) c = C.bad;
  if (warnHi != null && frac > warnHi) c = C.bad;
  return box(x, y, w, h, { fill:'#0c0f0a', stroke:C.stroke, r:2 })
    + `<rect x="${x+1}" y="${fy}" width="${w-2}" height="${Math.max(0,fh)}" rx="1" fill="${c}" opacity="0.85"/>`;
}
const pipe = (pts, col, w = 5) =>
  `<polyline points="${pts.map(p=>p.join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;

export function mimic(PL) {
  const S = PL.S, z = PL.z, sec = PL.sec, E = PL.E, sgs = PL.sgs, k = PL.k;
  const powerPct = k.Ptot * 100;
  const rcsPsig = S.P - 14.7;
  const pzrLvl = S.pzrLevel;           // 0..1
  const nLoops = S.Thot.length;
  const totFlowPct = S.W.reduce((a,b)=>a+b,0) / (PL.rp.Wrated * nLoops) * 100;

  const W = 980, H = 600;
  let g = '';

  // ---- trip banner ----
  if (PL.trip) {
    g += `<rect x="0" y="0" width="${W}" height="30" fill="${C.bad}" opacity="0.9"/>`
       + T(W/2, 20, 'REACTOR TRIP &nbsp; &mdash; &nbsp; ' + esc(PL.tripFirst || PL.tripMsg || ''), { size:15, fill:'#fff', anchor:'middle', weight:700 });
  }
  const top = PL.trip ? 46 : 20;

  // ================= REACTOR VESSEL =================
  const rx = 44, ry = top + 150, rw = 104, rh = 232;
  const pf = Math.max(0, Math.min(1, k.Ptot));
  const coreCol = powerPct > 1 ? `rgb(${Math.round(120+120*pf)},${Math.round(90+40*pf)},40)` : '#2a3020';
  g += box(rx, ry, rw, rh, { fill:C.vessel, r:10, sw:1.5 });
  g += box(rx+18, ry+40, rw-36, rh-80, { fill:coreCol, stroke:'#4a3a1a', r:4 });
  g += T(rx+rw/2, ry+22, 'REACTOR', { anchor:'middle', size:12, fill:C.dim, weight:600 });
  g += T(rx+rw/2, ry+rh/2-6, f(powerPct,1)+'%', { anchor:'middle', size:26, fill:'#fff', weight:700 });
  g += T(rx+rw/2, ry+rh/2+14, 'thermal', { anchor:'middle', size:10, fill:'#e8dcc0' });
  // rod bank + boron + dnbr under reactor
  g += T(rx+rw/2, ry+rh-30, 'Rods '+f(PL.banks.ctrlDemand,0)+' st', { anchor:'middle', size:11, fill:C.txt });
  g += T(rx+rw/2, ry+rh-14, 'Boron '+f(PL.ppm,0)+' ppm', { anchor:'middle', size:11, fill:C.txt });
  const dnbrBad = PL.dnbr < 1.5;
  g += T(rx+rw/2, ry-8, 'DNBR '+f(PL.dnbr,2), { anchor:'middle', size:12, fill:dnbrBad?C.bad:C.acc, weight:600 });

  // ================= PRESSURIZER (on loop-1 hot leg) =================
  const px = 210, py = top+8, pw = 46, ph = 116;
  g += box(px, py, pw, ph, { r:16, sw:1.5 });
  g += vbar(px+7, py+8, pw-14, ph-16, pzrLvl, C.cold, { warnLo:0.20, warnHi:0.75 });
  g += T(px+pw/2, py-6, 'PZR', { anchor:'middle', size:11, fill:C.dim, weight:600 });
  g += T(px+pw/2, py+ph+14, f(pzrLvl*100,0)+'%', { anchor:'middle', size:12, fill:C.txt, weight:600 });
  if (z.heatersOn) g += T(px+pw/2, py+ph+28, 'HTR', { anchor:'middle', size:9, fill:C.warn });
  if (z.porvOpen && (z.porvOpen[0]||z.porvOpen[1])) g += T(px+pw/2, py+ph+28, 'PORV', { anchor:'middle', size:9, fill:C.bad });
  // surge line down to loop 1
  g += pipe([[px+pw/2, py+ph],[px+pw/2, top+150]], C.stroke, 3);

  // ================= 3 RCS LOOPS =================
  const sgx = 430, sgw = 74, sgh = 96;      // steam generator box
  const rcpx = 320;                          // RCP on cold leg
  const loopY = i => top + 150 + i*150;      // hot-leg y for each loop
  const hdrX = 560;                          // steam header x
  const steamPts = [];
  for (let i = 0; i < nLoops; i++) {
    const y = loopY(i), cy = y + 54;         // hot y, cold y
    const hot = S.Thot[i], cold = S.Tcold[i], on = (S.pumpOn && S.pumpOn[i]) || (E.rcpOn && E.rcpOn[i]);
    const sgy = y - sgh/2;
    // hot leg: reactor -> SG
    g += pipe([[rx+rw, y],[sgx, y]], C.hot, 6);
    g += T((rx+rw+sgx)/2, y-8, f(hot,0)+'&deg;F', { anchor:'middle', size:11, fill:C.hot, weight:600 });
    // cold leg: SG bottom -> RCP -> reactor
    g += pipe([[sgx+sgw/2, sgy+sgh],[sgx+sgw/2, cy],[rcpx, cy],[rx+rw, cy]], C.cold, 6);
    g += T((rcpx+rx+rw)/2, cy+16, f(cold,0)+'&deg;F', { anchor:'middle', size:11, fill:C.cold, weight:600 });
    // RCP
    g += `<circle cx="${rcpx}" cy="${cy}" r="14" fill="${on?C.on:C.off}" stroke="${C.stroke}"/>`;
    g += T(rcpx, cy+4, 'P', { anchor:'middle', size:12, fill:'#12160f', weight:700 });
    g += T(rcpx, cy+30, 'RCP '+(i+1), { anchor:'middle', size:9, fill:on?C.dim:C.bad });
    // steam generator
    g += box(sgx, sgy, sgw, sgh, { fill:C.vessel, r:8 });
    g += vbar(sgx+8, sgy+10, 16, sgh-20, (sgs[i].lvlNR||0)/100, C.cold, { warnLo:0.20, warnHi:0.85 });
    g += T(sgx+sgw-6, sgy+22, 'SG'+(i+1), { anchor:'end', size:11, fill:C.dim, weight:600 });
    g += T(sgx+sgw-6, sgy+40, f(sgs[i].lvlNR,0)+'%', { anchor:'end', size:12, fill:C.txt });
    g += T(sgx+sgw-6, sgy+58, f(sgs[i].Psec,0), { anchor:'end', size:11, fill:C.steam });
    g += T(sgx+sgw-6, sgy+72, 'psia', { anchor:'end', size:8, fill:C.dim });
    // steam outlet up to header
    g += pipe([[sgx+sgw, sgy+16],[hdrX, sgy+16]], C.steam, 4);
    steamPts.push(sgy+16);
  }
  // steam header (vertical joining all SG outlets) -> turbine
  const hTop = Math.min(...steamPts), hBot = Math.max(...steamPts);
  const turbY = top + 150 + (nLoops-1)*150/2;   // vertical middle of loops
  g += pipe([[hdrX, hTop],[hdrX, hBot]], C.steam, 4);
  g += pipe([[hdrX, turbY],[640, turbY]], C.steam, 5);
  g += T(hdrX+6, hTop-6, 'steam '+f(sec.Pheader,0)+' psia', { size:10, fill:C.steam });

  // ================= TURBINE -> GENERATOR -> GRID =================
  const turbTrip = sec.tripped;
  g += box(640, turbY-40, 96, 80, { fill:C.vessel, r:6 });
  g += T(688, turbY-20, 'TURBINE', { anchor:'middle', size:11, fill:C.dim, weight:600 });
  g += T(688, turbY+2, f(sec.valvePos*100,0)+'%', { anchor:'middle', size:16, fill:turbTrip?C.bad:C.txt, weight:600 });
  g += T(688, turbY+18, turbTrip?'TRIPPED':'gov valve', { anchor:'middle', size:9, fill:turbTrip?C.bad:C.dim });
  g += pipe([[736, turbY],[770, turbY]], C.stroke, 4);
  // generator
  g += `<circle cx="806" cy="${turbY}" r="36" fill="${C.vessel}" stroke="${C.stroke}" stroke-width="1.5"/>`;
  g += T(806, turbY-8, 'GEN', { anchor:'middle', size:11, fill:C.dim, weight:600 });
  g += T(806, turbY+12, f(E.MWe,0), { anchor:'middle', size:18, fill:'#fff', weight:700 });
  g += T(806, turbY+26, 'MWe', { anchor:'middle', size:9, fill:C.dim });
  // breaker + grid
  const gb = E.genBkr, grid = E.gridAvail;
  g += pipe([[842, turbY],[892, turbY]], gb?C.on:C.off, 4);
  g += `<rect x="864" y="${turbY-7}" width="14" height="14" fill="${gb?C.on:C.off}" stroke="${C.stroke}"/>`;
  g += box(900, turbY-28, 56, 56, { r:6 });
  g += T(928, turbY-6, 'GRID', { anchor:'middle', size:11, fill:grid?C.acc:C.bad, weight:600 });
  g += T(928, turbY+12, grid?'up':'LOST', { anchor:'middle', size:11, fill:grid?C.dim:C.bad });

  // ================= GLOBAL READOUT STRIP =================
  const gy = H - 42;
  g += `<line x1="20" y1="${gy-14}" x2="${W-20}" y2="${gy-14}" stroke="${C.grid}"/>`;
  const stat = [
    ['RCS press', f(rcsPsig,0)+' psig', rcsPsig<2000||rcsPsig>2350?C.bad:C.txt],
    ['Tavg', f(S.Tavg,1)+' &deg;F', C.txt],
    ['RCS flow', f(totFlowPct,0)+' %', totFlowPct<90?C.bad:C.txt],
    ['PZR level', f(pzrLvl*100,0)+' %', C.txt],
    ['Net output', f(E.netMWe,0)+' MWe', C.txt],
    ['Boron', f(PL.ppm,0)+' ppm', C.txt],
  ];
  const cw = (W-40)/stat.length;
  stat.forEach(([lab,val,col],i)=>{
    const x = 20 + cw*i + cw/2;
    g += T(x, gy, lab, { anchor:'middle', size:10, fill:C.dim });
    g += T(x, gy+18, val, { anchor:'middle', size:15, fill:col, weight:600 });
  });

  return `<div class="card" style="padding:6px"><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;background:${C.bg};border-radius:8px" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif">${g}</svg></div>`;
}
