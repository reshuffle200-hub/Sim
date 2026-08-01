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
// alarm band: returns a warn/bad colour when out of range, else null (normal)
function band(v, lo, hi, lolo, hihi) {
  if ((lolo != null && v <= lolo) || (hihi != null && v >= hihi)) return C.bad;
  if (v < lo || v > hi) return C.warn;
  return null;
}
// wrap a chunk in a hover tooltip (native SVG <title>)
const tip = (t, inner) => `<g><title>${esc(t)}</title>${inner}</g>`;

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

  const top = PL.trip ? 46 : 20;
  const W = 980, H = top + 620;
  let g = '';

  // ---- trip banner ----
  if (PL.trip) {
    g += `<rect x="0" y="0" width="${W}" height="30" fill="${C.bad}" opacity="0.9"/>`
       + T(W/2, 20, 'REACTOR TRIP &nbsp; &mdash; &nbsp; ' + esc(PL.tripFirst || PL.tripMsg || ''), { size:15, fill:'#fff', anchor:'middle', weight:700 });
  }

  // ================= REACTOR VESSEL =================
  const rx = 44, ry = top + 146, rw = 104, rh = 374;
  const pf = Math.max(0, Math.min(1, k.Ptot));
  const coreCol = powerPct > 1 ? `rgb(${Math.round(120+120*pf)},${Math.round(90+40*pf)},40)` : '#2a3020';
  g += box(rx, ry, rw, rh, { fill:C.vessel, r:10, sw:1.5 });
  g += box(rx+18, ry+30, rw-36, rh-90, { fill:coreCol, stroke:'#4a3a1a', r:4 });
  g += T(rx+rw/2, ry+20, 'REACTOR', { anchor:'middle', size:12, fill:C.dim, weight:600 });
  g += T(rx+rw/2, ry+rh/2-8, f(powerPct,1)+'%', { anchor:'middle', size:26, fill:'#fff', weight:700 });
  g += T(rx+rw/2, ry+rh/2+12, 'thermal', { anchor:'middle', size:10, fill:'#e8dcc0' });
  // readouts near the bottom, clear of loop-3 entry
  g += T(rx+rw/2, ry+rh-40, 'Rods '+f(PL.banks.ctrlDemand,0)+' st', { anchor:'middle', size:11, fill:C.txt });
  g += T(rx+rw/2, ry+rh-24, 'Boron '+f(PL.ppm,0)+' ppm', { anchor:'middle', size:11, fill:C.txt });
  const dnbrBad = PL.dnbr < 1.5;
  g += T(rx+rw/2, ry-10, 'DNBR '+f(PL.dnbr,2), { anchor:'middle', size:12, fill:dnbrBad?C.bad:C.acc, weight:600 });
  g += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="transparent"><title>Reactor \u00b7 ${f(powerPct,1)}% thermal \u00b7 rods ${f(PL.banks.ctrlDemand,0)} steps \u00b7 boron ${f(PL.ppm,0)} ppm \u00b7 DNBR ${f(PL.dnbr,2)} (trip &lt;1.5)</title></rect>`;

  // ================= PRESSURIZER (above loop-1 hot leg) =================
  const px = 210, py = top+4, pw = 42, ph = 92;
  const pzrCol = band(pzrLvl*100, 20, 75, 15, 92);
  const porv = z.porvOpen && (z.porvOpen[0]||z.porvOpen[1]);
  const pzrInner = box(px, py, pw, ph, { r:14, sw:pzrCol?2:1.5, stroke:pzrCol||C.stroke })
    + vbar(px+7, py+8, pw-14, ph-16, pzrLvl, C.cold, { warnLo:0.20, warnHi:0.75 })
    + T(px+pw/2, py-6, 'PZR', { anchor:'middle', size:11, fill:C.dim, weight:600 })
    + T(px+pw+8, py+ph/2-4, f(pzrLvl*100,0)+'%', { anchor:'start', size:12, fill:pzrCol||C.txt, weight:600 })
    + (porv ? T(px+pw+8, py+ph/2+12, 'PORV', { anchor:'start', size:9, fill:C.bad })
            : (z.heatersOn ? T(px+pw+8, py+ph/2+12, 'htr', { anchor:'start', size:9, fill:C.warn }) : ''));
  g += tip(`Pressurizer \u00b7 level ${f(pzrLvl*100,0)}% (normal 20-75%) \u00b7 ${f(rcsPsig,0)} psig \u00b7 heaters ${z.heatersOn?'ON':'off'}${porv?' \u00b7 PORV OPEN':''}`, pzrInner);
  // surge line down to loop 1 hot leg
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
    // RCP (red when stopped) + tooltip
    const rcpInner = `<circle cx="${rcpx}" cy="${cy}" r="14" fill="${on?C.on:C.off}" stroke="${C.stroke}"/>`
      + T(rcpx, cy+4, 'P', { anchor:'middle', size:12, fill:'#12160f', weight:700 })
      + T(rcpx, cy+30, 'RCP '+(i+1), { anchor:'middle', size:9, fill:on?C.dim:C.bad });
    g += tip(`Reactor coolant pump ${i+1} \u00b7 ${on?'RUNNING':'STOPPED'} \u00b7 loop flow ${f(S.W[i]/PL.rp.Wrated*100,0)}%`, rcpInner);
    // steam generator (alarm-aware level) + tooltip
    const lvl = sgs[i].lvlNR || 0, lvlCol = band(lvl, 20, 85, 12, 92);
    const sgInner = box(sgx, sgy, sgw, sgh, { fill:C.vessel, r:8, stroke:lvlCol||C.stroke, sw:lvlCol?2:1 })
      + vbar(sgx+8, sgy+10, 16, sgh-20, lvl/100, C.cold, { warnLo:0.20, warnHi:0.85 })
      + T(sgx+sgw-6, sgy+22, 'SG'+(i+1), { anchor:'end', size:11, fill:C.dim, weight:600 })
      + T(sgx+sgw-6, sgy+40, f(lvl,0)+'%', { anchor:'end', size:12, fill:lvlCol||C.txt, weight:lvlCol?700:400 })
      + T(sgx+sgw-6, sgy+58, f(sgs[i].Psec,0), { anchor:'end', size:11, fill:C.steam })
      + T(sgx+sgw-6, sgy+72, 'psia', { anchor:'end', size:8, fill:C.dim });
    g += tip(`Steam generator ${i+1} \u00b7 level ${f(lvl,0)}% (normal 20-85%) \u00b7 ${f(sgs[i].Psec,0)} psia \u00b7 steam ${f(sgs[i].Wsteam/1e6,2)}e6 lb/hr`, sgInner);
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
  g += `<rect x="640" y="${turbY-40}" width="96" height="80" fill="transparent"><title>Turbine \u00b7 ${turbTrip?'TRIPPED':'governor valve '+f(sec.valvePos*100,0)+'% open'} \u00b7 steam ${f(sec.Wturb/1e6,2)}e6 lb/hr</title></rect>`;
  g += pipe([[736, turbY],[770, turbY]], C.stroke, 4);
  // generator
  g += `<circle cx="806" cy="${turbY}" r="36" fill="${C.vessel}" stroke="${C.stroke}" stroke-width="1.5"/>`;
  g += T(806, turbY-8, 'GEN', { anchor:'middle', size:11, fill:C.dim, weight:600 });
  g += T(806, turbY+12, f(E.MWe,0), { anchor:'middle', size:18, fill:'#fff', weight:700 });
  g += T(806, turbY+26, 'MWe', { anchor:'middle', size:9, fill:C.dim });
  g += `<rect x="770" y="${turbY-36}" width="72" height="72" fill="transparent"><title>Generator \u00b7 ${f(E.MWe,0)} MWe gross \u00b7 ${f(E.netMWe,0)} MWe net \u00b7 breaker ${E.genBkr?'closed':'OPEN'} \u00b7 grid ${E.gridAvail?'available':'LOST'}</title></rect>`;
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
