// ======================================================================
//  boards.js — the four detail boards plus the overview
//  Each board is a pure render function of the shared plant instance.
// ======================================================================
import * as W from './widgets.js';
import * as AL from './alarms.js';
const F = W.F, clamp = W.clamp;

const cl = (v, lo, hi) => (v < lo || v > hi) ? 'bad' : '';

// ====================================================== OVERVIEW
export function overview(PL) {
  const S = PL.S, E = PL.E, sec = PL.sec, sgs = PL.sgs;
  return `<div class="grid4">
  ${W.card('Reactor', `<div class="rows">${W.rows([
    ['Thermal power', F(PL.k.Ptot * 100, 2) + ' %'],
    ['Neutron flux', F(PL.k.P * 100, 2) + ' %'],
    ['Decay heat', F(PL.k.Pdecay * 100, 2) + ' %'],
    ['Control bank D', F(PL.banks.ctrlDemand, 0) + ' steps'],
    ['Boron', F(PL.ppm, 0) + ' ppm'],
    ['Avg fuel temp', F(PL.f.Tf, 0) + ' °F'],
    ['DNBR', F(PL.dnbr, 2), PL.dnbr < 1.5 ? 'bad' : 'good']
  ])}</div>`)}
  ${W.card('Reactor coolant', `<div class="rows">${W.rows([
    ['Pressure', F(S.P - 14.7, 0) + ' psig', cl(S.P - 14.7, 2000, 2350)],
    ['PZR level', F(S.pzrLevel * 100, 1) + ' %', cl(S.pzrLevel * 100, 20, 75)],
    ['Subcooling', F(S.subcooling, 0) + ' °F', S.subcooling < 25 ? 'bad' : 'good'],
    ['Thot / Tcold', F(S.Thot[0], 1) + ' / ' + F(S.Tcold[0], 1)],
    ['Core ΔT', F(S.Thot[0] - S.Tcold[0], 1) + ' °F'],
    ['Total flow', F(S.W.reduce((a, b) => a + b, 0) / (PL.rp.Wrated * 3) * 100, 1) + ' %'],
    ['Max void', F(S.voidMax, 3), S.voidMax > 0.005 ? 'bad' : 'dimv']
  ])}</div>`)}
  ${W.card('Steam &amp; feedwater', `<div class="rows">${W.rows([
    ['Steam pressure', F(sgs[0].Psec, 0) + ' psia'],
    ['Steam flow', F(sec.Wturb / 1e6, 2) + 'e6 lb/hr'],
    ['Feed flow', F(sec.WfwTotal / 1e6, 2) + 'e6 lb/hr'],
    ['Feedwater temp', F(sec.TfwF, 0) + ' °F'],
    ['Turbine valves', F(sec.valvePos * 100, 0) + ' %'],
    ['Steam dumps', F(sec.dumpPos * 100, 0) + ' %', sec.dumpPos > 0.02 ? 'warn' : 'dimv'],
    ['AFW', sec.afwOn ? 'RUNNING' : 'standby', sec.afwOn ? 'warn' : 'dimv']
  ])}</div>`)}
  ${W.card('Electrical', `<div class="rows">${W.rows([
    ['Generator', E.tripped ? 'TRIPPED' : (E.genBkr ? 'ON LINE' : 'off line'), E.tripped ? 'bad' : 'good'],
    ['Gross', F(E.MWe, 0) + ' MWe'],
    ['Net to grid', F(E.netMWe, 0) + ' MWe'],
    ['Power factor', F(E.pf, 3) + (E.lead ? ' ld' : ' lg')],
    ['House load', F(E.houseMW, 1) + ' MW'],
    ['Aux source', (E.auxSource || 'none').toUpperCase(), E.auxSource === 'none' ? 'bad' : ''],
    ['RCPs running', E.rcpOn.filter(Boolean).length + ' of 3', E.rcpOn.filter(Boolean).length < 3 ? 'bad' : 'good']
  ])}</div>`)}
  </div>
  <div class="grid2">
    ${W.card('Loops', `<div class="mini">${[0, 1, 2].map(i => `
      <div class="m"><div class="t">Loop ${'ABC'[i]}</div>
      <div class="a">${F(S.Thot[i], 1)}</div>
      <div class="b">cold ${F(S.Tcold[i], 1)} °F</div>
      <div class="b">flow ${F(S.W[i] / PL.rp.Wrated * 100, 1)} %</div>
      ${W.bar(S.W[i] / PL.rp.Wrated, S.W[i] < 0.9 * PL.rp.Wrated ? 'bad' : 'good')}</div>`).join('')}</div>`)}
    ${W.card('Steam generators', `<div class="mini">${[0, 1, 2].map(i => {
      const g = sgs[i], bad = g.lvlNR < PL.sp.lvlLoLo, warn = g.lvlNR < PL.sp.lvlLo || g.lvlNR > PL.sp.lvlHi;
      return `<div class="m"><div class="t">SG ${'ABC'[i]}</div>
      <div class="a">${F(g.lvlNR, 1)}<span class="sm"> %</span></div>
      <div class="b">${F(g.Psec, 0)} psia</div>
      <div class="b">feed ${F(sec.Wfw[i] / 1e6, 2)}e6</div>
      ${W.bar(g.lvlNR / 100, bad ? 'bad' : (warn ? 'warn' : 'good'))}</div>`; }).join('')}</div>`)}
  </div>`;
}

// ====================================================== REACTOR BOARD
export function reactor(PL) {
  const rb = PL.rx, S = PL.S;
  const bal = PL.lastBalance || {};
  const comps = [
    ['Excess (fuel + poison)', bal.excess], ['Doppler', bal.doppler],
    ['Moderator', bal.moderator], ['Boron', bal.boron],
    ['Control rods', bal.rods], ['Xenon', bal.xenon], ['Samarium', bal.samarium]
  ];
  const pos = PLBankPositions(PL);
  return `<div class="grid3">
  ${W.card('Nuclear instrumentation', `<canvas id="cNI" class="cv" style="height:230px"></canvas>
    <div class="rows">${W.rows([
      ['Reactor period', (!isFinite(PL.k.period) || Math.abs(PL.k.period) > 9999) ? '∞' : F(PL.k.period, 0) + ' s'],
      ['Startup rate', F(26 / Math.max(Math.abs(PL.k.period), 1e-6) * Math.sign(PL.k.period || 1), 2) + ' dpm'],
      ['Total thermal', F(PL.k.Ptot * 100, 2) + ' %'],
      ['Decay heat', F(PL.k.Pdecay * 100, 2) + ' %']
    ])}</div>`)}
  ${W.card('Reactivity balance', `<div class="rows">${W.rows(
      comps.map(([k, v]) => [k, (v === undefined ? '—' : (v >= 0 ? '+' : '') + F(v, 0) + ' pcm'),
        v === undefined ? 'dimv' : (v >= 0 ? 'good' : '')]))}
      </div><div class="rows" style="border-top:1px solid var(--line)">${W.rows([
      ['NET', ((bal.pcm ?? 0) >= 0 ? '+' : '') + F(bal.pcm ?? 0, 1) + ' pcm',
        Math.abs(bal.pcm ?? 0) < 5 ? 'good' : 'warn'],
      ['Boron worth', F(PL.boronWorth ?? 0, 2) + ' pcm/ppm', 'dimv'],
      ['MTC', F(PL.mtc ?? 0, 2) + ' pcm/°F', 'dimv']
    ])}</div>`)}
  ${W.card('Rod banks', `<canvas id="cRods" class="cv" style="height:200px"></canvas>
    <div class="rows">${W.rows([
      ['Bank demand', F(PL.banks.ctrlDemand, 0) + ' / 528 steps'],
      ['Control A / B', F(pos[0], 0) + ' / ' + F(pos[1], 0)],
      ['Control C / D', F(pos[2], 0) + ' / ' + F(pos[3], 0)],
      ['Shutdown A / B', F(PL.banks.sd[0], 0) + ' / ' + F(PL.banks.sd[1], 0)],
      ['Mode', PL.rodAuto ? 'AUTOMATIC' : 'MANUAL', PL.rodAuto ? 'good' : 'warn']
    ])}</div>`)}
  </div>
  <div class="grid3">
  ${W.card('Core thermal limits', `<div class="rows">${W.rows([
    ['DNBR', F(PL.dnbr, 2), PL.dnbr < 1.3 ? 'bad' : (PL.dnbr < 1.5 ? 'warn' : 'good')],
    ['Design limit', '1.30', 'dimv'],
    ['Core ΔT', F(S.Thot[0] - S.Tcold[0], 1) + ' °F'],
    ['OTΔT setpoint', F(PL.f.otdt, 1) + ' °F', PL.f.otdtTrip ? 'bad' : ''],
    ['OTΔT margin', F(PL.f.otdtMargin ?? 0, 1) + ' °F', (PL.f.otdtMargin ?? 9) < 5 ? 'warn' : 'good'],
    ['OPΔT setpoint', F(PL.f.opdt, 1) + ' °F', PL.f.opdtTrip ? 'bad' : ''],
    ['OPΔT margin', F(PL.f.opdtMargin ?? 0, 1) + ' °F', (PL.f.opdtMargin ?? 9) < 5 ? 'warn' : 'good'],
    ['Avg fuel temp', F(PL.f.Tf, 0) + ' °F'],
    ['Clad temp', F(PL.f.Tc, 0) + ' °F']
  ])}</div>`)}
  ${W.card('Temperature control', `<div class="rows">${W.rows([
    ['Tavg', F(S.Tavg, 1) + ' °F'],
    ['Tref (programme)', F(PL.Tref, 1) + ' °F', 'dimv'],
    ['Deviation', ((S.Tavg - PL.Tref) >= 0 ? '+' : '') + F(S.Tavg - PL.Tref, 2) + ' °F',
      Math.abs(S.Tavg - PL.Tref) > 4 ? 'bad' : (Math.abs(S.Tavg - PL.Tref) > 1.5 ? 'warn' : 'good')],
    ['Thot', F(S.Thot[0], 1) + ' °F'],
    ['Tcold', F(S.Tcold[0], 1) + ' °F'],
    ['Turbine load', F(PL.sec.loadDemand * 100, 1) + ' %'],
    ['Load setpoint', F(PL.sec.loadSet * 100, 0) + ' %', 'dimv']
  ])}</div>`)}
  ${W.card('Fission products', `<div class="rows">${W.rows([
    ['Xenon-135 worth', F(rb.xeEqWorth * PL.fp.X, 0) + ' pcm'],
    ['Xenon (normalised)', F(PL.fp.X, 3), 'dimv'],
    ['Iodine-135', F(PL.fp.I, 3), 'dimv'],
    ['Samarium worth', F(rb.smEqWorth * PL.fp.Sm, 0) + ' pcm'],
    ['Boron', F(PL.ppm, 0) + ' ppm'],
    ['Cycle life', PL.life, 'dimv']
  ])}</div>`)}
  </div>`;
}
function PLBankPositions(PL) {
  const S = PL.rx.stepsPerBank, ov = PL.rx.overlap, lead = S - ov, d = PL.banks.ctrlDemand;
  return [0, 1, 2, 3].map(i => Math.max(0, Math.min(S, d - i * lead)));
}
export function drawReactorCanvases(PL) {
  const ni = document.getElementById('cNI');
  if (ni) {
    const { x, w, h } = W.fitCanvas(ni);
    const p = Math.max(PL.k.P, 1e-11);
    const bw = Math.min(46, (w - 90) / 3);
    W.decadeMeter(x, 62, 16, bw, h - 46, p * 1e11, 0, 11, { label: 'SOURCE', color: '#a371f7' });
    W.decadeMeter(x, 62 + bw + 34, 16, bw, h - 46, p * 1e8, 0, 11, { label: 'INTERMED', color: '#39c5cf' });
    W.vbar(x, 62 + 2 * (bw + 34), 16, bw, h - 46, p, {
      label: 'POWER', color: p > 1.08 ? '#f85149' : '#4a9eff',
      value: F(p * 100, 1) + '%', marks: [{ at: 1.09, color: '#f85149' }]
    });
  }
  const rc = document.getElementById('cRods');
  if (rc) {
    const { x, w, h } = W.fitCanvas(rc);
    const pos = PLBankPositions(PL);
    const names = ['CA', 'CB', 'CC', 'CD', 'SA', 'SB'];
    const vals = [...pos, PL.banks.sd[0], PL.banks.sd[1]];
    const bw = Math.min(34, (w - 40) / 6 - 8);
    for (let i = 0; i < 6; i++) {
      const px = 24 + i * ((w - 40) / 6);
      W.vbar(x, px, 18, bw, h - 48, vals[i] / 228, {
        label: names[i], value: F(vals[i], 0),
        color: vals[i] < 10 ? '#f85149' : (i > 3 ? '#a371f7' : '#4a9eff')
      });
    }
  }
}

// ====================================================== RCS BOARD
export function rcs(PL) {
  const S = PL.S, z = PL.z;
  return `<div class="grid2">
  ${W.card('Reactor coolant system', `<canvas id="cRCS" class="cv" style="height:330px"></canvas>`)}
  ${W.card('Pressurizer', `<canvas id="cPZR" class="cv" style="height:330px"></canvas>`)}
  </div>
  <div class="grid4">
  ${W.card('Pressure &amp; inventory', `<div class="rows">${W.rows([
    ['RCS pressure', F(S.P - 14.7, 0) + ' psig', cl(S.P - 14.7, 2000, 2350)],
    ['Saturation temp', F(S.Tsat, 1) + ' °F', 'dimv'],
    ['Subcooling margin', F(S.subcooling, 0) + ' °F', S.subcooling < 25 ? 'bad' : 'good'],
    ['PZR level', F(S.pzrLevel * 100, 1) + ' %', cl(S.pzrLevel * 100, 20, 75)],
    ['Level programme', F(z.lvlSet, 1) + ' %', 'dimv'],
    ['Max RCS void', F(S.voidMax, 4), S.voidMax > 0.005 ? 'bad' : 'dimv'],
    ['Solid plant', S.solid ? 'YES' : 'no', S.solid ? 'bad' : 'dimv']
  ])}</div>`)}
  ${W.card('Pressure control', `<div class="rows">${W.rows([
    ['Heaters', F(z.heaterKW, 0) + ' kW'],
    ['Spray', F(z.sprayGpm, 0) + ' gpm'],
    ['PORV 1 / 2', (z.porvOpen[0] ? 'OPEN' : 'shut') + ' / ' + (z.porvOpen[1] ? 'OPEN' : 'shut'),
      z.porvOpen.some(Boolean) ? 'bad' : 'dimv'],
    ['Code safeties', z.safetyOpen.some(Boolean) ? 'OPEN' : 'shut', z.safetyOpen.some(Boolean) ? 'bad' : 'dimv'],
    ['LTOP', z.ltopArmed ? 'ARMED' : 'off', z.ltopArmed ? 'warn' : 'dimv'],
    ['Relief flow', F(z.Wrelief / 1000, 0) + ' klb/hr', z.Wrelief > 0 ? 'bad' : 'dimv'],
    ['Relief tank', F(z.prtPsig, 0) + ' psig' + (z.prtRuptured ? ' RUPTURED' : ''),
      z.prtRuptured ? 'bad' : 'dimv']
  ])}</div>`)}
  ${W.card('Charging &amp; letdown', `<div class="rows">${W.rows([
    ['Charging', F(z.chargeGpm, 0) + ' gpm'],
    ['Letdown', F(z.letdownGpm, 0) + ' gpm'],
    ['Net makeup', ((z.chargeGpm - z.letdownGpm) >= 0 ? '+' : '') + F(z.chargeGpm - z.letdownGpm, 0) + ' gpm'],
    ['Boron', F(PL.ppm, 0) + ' ppm'],
    ['Level deviation', ((z.lvlDev) >= 0 ? '+' : '') + F(z.lvlDev, 1) + ' %',
      Math.abs(z.lvlDev) > 5 ? 'warn' : 'good']
  ])}</div>`)}
  ${W.card('Loop detail', `<div class="rows">${W.rows(
    [0, 1, 2].flatMap(i => [
      [`Loop ${'ABC'[i]} Thot`, F(S.Thot[i], 1) + ' °F'],
      [`Loop ${'ABC'[i]} flow`, F(S.W[i] / PL.rp.Wrated * 100, 1) + ' %',
        S.W[i] < 0.9 * PL.rp.Wrated ? 'bad' : '']
    ]))}</div>`)}
  </div>`;
}
export function drawRCSCanvases(PL) {
  const S = PL.S, E = PL.E;
  const c1 = document.getElementById('cRCS');
  if (c1) {
    const { x, w, h } = W.fitCanvas(c1);
    const cx = w / 2, cy = h / 2;
    // vessel
    x.fillStyle = 'rgba(74,158,255,.08)';
    x.fillRect(cx - 34, cy - 62, 68, 124);
    x.strokeStyle = '#4a9eff'; x.lineWidth = 2;
    x.strokeRect(cx - 34, cy - 62, 68, 124);
    x.font = '600 10px Inter, sans-serif'; x.fillStyle = '#8b98a5'; x.textAlign = 'center';
    x.fillText('RPV', cx, cy - 70);
    x.font = '11px JetBrains Mono, monospace'; x.fillStyle = '#e6edf3';
    x.fillText(F(PL.k.Ptot * PL.rp.Qrated / 1e6, 0) + ' MW', cx, cy + 4);
    x.font = '10px JetBrains Mono, monospace'; x.fillStyle = '#8b98a5';
    x.fillText(F(S.Tavg, 1) + ' °F', cx, cy + 18);
    // three loops radiating
    const R = Math.min(w, h) * 0.36;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + i * 2 * Math.PI / 3;
      const sx = cx + Math.cos(a) * R, sy = cy + Math.sin(a) * R;
      const live = S.W[i] > 0.05 * PL.rp.Wrated;
      W.pipe(x, cx + Math.cos(a) * 36, cy + Math.sin(a) * 36, sx, sy, live, S.W[i] / PL.rp.Wrated);
      // SG box
      x.fillStyle = live ? 'rgba(163,113,247,.12)' : '#131a22';
      x.fillRect(sx - 26, sy - 30, 52, 60);
      x.strokeStyle = live ? '#a371f7' : '#3a4552'; x.lineWidth = 1.6;
      x.strokeRect(sx - 26, sy - 30, 52, 60);
      x.font = '600 9px Inter, sans-serif'; x.fillStyle = '#8b98a5'; x.textAlign = 'center';
      x.fillText('SG ' + 'ABC'[i], sx, sy - 36);
      x.font = '10px JetBrains Mono, monospace'; x.fillStyle = '#e6edf3';
      x.fillText(F(PL.sgs[i].lvlNR, 0) + '%', sx, sy - 6);
      x.fillStyle = '#8b98a5'; x.font = '9px JetBrains Mono, monospace';
      x.fillText(F(PL.sgs[i].Psec, 0), sx, sy + 8);
      x.fillText(F(S.Thot[i], 0) + '/' + F(S.Tcold[i], 0), sx, sy + 21);
      // pump
      const pa = a + 0.62;
      const px = cx + Math.cos(pa) * R * 0.72, py = cy + Math.sin(pa) * R * 0.72;
      W.pumpSym(x, px, py, 12, E.rcpOn[i]);
      x.font = '9px Inter, sans-serif'; x.fillStyle = E.rcpOn[i] ? '#3fb950' : '#f85149';
      x.fillText('RCP ' + (i + 1), px, py + 25);
    }
  }
  const c2 = document.getElementById('cPZR');
  if (c2) {
    const { x, w, h } = W.fitCanvas(c2);
    const cx = w * 0.34, cy = h / 2;
    const lvl = S.pzrLevel;
    W.tank(x, cx, cy, 74, h - 90, lvl, lvl > 0.75 || lvl < 0.2 ? '#d29922' : '#4a9eff',
      'PRESSURIZER', F(lvl * 100, 1) + ' %');
    x.font = '600 13px JetBrains Mono, monospace'; x.fillStyle = '#e6edf3'; x.textAlign = 'center';
    x.fillText(F(S.P - 14.7, 0) + ' psig', cx, cy - (h - 90) / 2 - 26);
    // programme marker
    const py = cy + (h - 90) / 2 - (h - 90) * (PL.z.lvlSet / 100);
    x.strokeStyle = '#8b98a5'; x.setLineDash([3, 3]); x.lineWidth = 1;
    x.beginPath(); x.moveTo(cx - 44, py); x.lineTo(cx + 44, py); x.stroke(); x.setLineDash([]);
    x.font = '9px Inter, sans-serif'; x.fillStyle = '#8b98a5'; x.textAlign = 'left';
    x.fillText('programme', cx + 48, py + 3);
    // relief path
    const rx = w * 0.76;
    const relieving = PL.z.Wrelief > 0;
    W.pipe(x, cx + 37, cy - (h - 90) / 2 + 14, rx, cy - (h - 90) / 2 + 14, relieving, 1);
    W.tank(x, rx, cy + 40, 66, 70, clamp(PL.z.prtWaterFt3 / 1800, 0, 1),
      PL.z.prtRuptured ? '#f85149' : '#39c5cf', 'RELIEF TANK', F(PL.z.prtPsig, 0) + ' psig');
    x.font = '9px Inter, sans-serif';
    x.fillStyle = relieving ? '#f85149' : '#5e6b7a'; x.textAlign = 'center';
    x.fillText(relieving ? F(PL.z.Wrelief / 1000, 0) + ' klb/hr' : 'no relief flow',
      (cx + rx) / 2 + 18, cy - (h - 90) / 2 + 6);
    // heaters and spray
    x.font = '10px JetBrains Mono, monospace'; x.textAlign = 'left';
    x.fillStyle = PL.z.heaterKW > 10 ? '#d29922' : '#5e6b7a';
    x.fillText('heaters  ' + F(PL.z.heaterKW, 0) + ' kW', 14, h - 26);
    x.fillStyle = PL.z.sprayGpm > 5 ? '#39c5cf' : '#5e6b7a';
    x.fillText('spray  ' + F(PL.z.sprayGpm, 0) + ' gpm', 14, h - 12);
  }
}

// ====================================================== SECONDARY BOARD
export function secondary(PL) {
  const sec = PL.sec, sgs = PL.sgs;
  return `<div class="grid2">
  ${W.card('Steam generators', `<canvas id="cSG" class="cv" style="height:300px"></canvas>`)}
  ${W.card('Feedwater train', `<canvas id="cFW" class="cv" style="height:300px"></canvas>`)}
  </div>
  <div class="grid4">
  ${W.card('Steam', `<div class="rows">${W.rows([
    ['Header pressure', F(sec.Pheader, 0) + ' psia'],
    ['Turbine flow', F(sec.Wturb / 1e6, 2) + 'e6 lb/hr'],
    ['Dump flow', F(sec.Wdump / 1e6, 2) + 'e6 lb/hr', sec.Wdump > 1e4 ? 'warn' : 'dimv'],
    ['Turbine valves', F(sec.valvePos * 100, 1) + ' %'],
    ['Impulse pressure', F(sec.impulsePsia, 0) + ' psia'],
    ['Dump mode', sec.dumpMode.toUpperCase(), 'dimv'],
    ['Dump position', F(sec.dumpPos * 100, 1) + ' %', sec.dumpPos > 0.02 ? 'warn' : 'dimv']
  ])}</div>`)}
  ${W.card('Feedwater', `<div class="rows">${W.rows([
    ['Total feed flow', F(sec.WfwTotal / 1e6, 2) + 'e6 lb/hr'],
    ['Final feed temp', F(sec.TfwF, 0) + ' °F'],
    ['MFP 1 / 2', (sec.mfpOn[0] ? 'RUN' : 'OFF') + ' / ' + (sec.mfpOn[1] ? 'RUN' : 'OFF'),
      sec.mfpOn.some(x => !x) ? 'bad' : 'good'],
    ['MFP capacity', F(sec.mfpCapacity * 100, 0) + ' %'],
    ['AFW', sec.afwOn ? 'ACTUATED' : 'standby', sec.afwOn ? 'warn' : 'dimv'],
    ['AFW flow', F(sec.Wafw.reduce((a, b) => a + b, 0) / 1000, 0) + ' klb/hr', 'dimv'],
    ['Hotwell temp', F(PL.sc.hotwellF, 0) + ' °F', 'dimv']
  ])}</div>`)}
  ${W.card('Turbine generator', `<div class="rows">${W.rows([
    ['Status', sec.tripped ? 'TRIPPED' : (sec.online ? 'ON LINE' : 'off line'),
      sec.tripped ? 'bad' : 'good'],
    ['Gross output', F(sec.MWe, 0) + ' MWe'],
    ['Load demand', F(sec.loadDemand * 100, 1) + ' %'],
    ['Load setpoint', F(sec.loadSet * 100, 0) + ' %', 'dimv'],
    ['Ramp rate', F(PL.sc.rampPctPerMin, 0) + ' %/min', 'dimv'],
    ['Condenser', F(sec.condPsia, 2) + ' psia', 'dimv'],
    ['Condenser duty', F(sec.condDutyMW, 0) + ' MW', 'dimv']
  ])}</div>`)}
  ${W.card('SG detail', `<div class="rows">${W.rows(
    [0, 1, 2].flatMap(i => [
      [`SG ${'ABC'[i]} level`, F(sgs[i].lvlNR, 1) + ' %',
        sgs[i].lvlNR < PL.sp.lvlLoLo ? 'bad' : ''],
      [`SG ${'ABC'[i]} riser void`, F(sgs[i].alphaRiser, 3), 'dimv']
    ]))}</div>`)}
  </div>`;
}
export function drawSecondaryCanvases(PL) {
  const sgs = PL.sgs, sec = PL.sec;
  const c1 = document.getElementById('cSG');
  if (c1) {
    const { x, w, h } = W.fitCanvas(c1);
    const bw = Math.min(56, (w - 80) / 3 - 20);
    for (let i = 0; i < 3; i++) {
      const px = 56 + i * ((w - 70) / 3);
      const g = sgs[i];
      const bad = g.lvlNR < PL.sp.lvlLoLo, warn = g.lvlNR < PL.sp.lvlLo || g.lvlNR > PL.sp.lvlHi;
      W.vbar(x, px, 34, bw, h - 84, g.lvlNR / 100, {
        label: 'SG ' + 'ABC'[i], value: F(g.lvlNR, 1) + '%',
        color: bad ? '#f85149' : (warn ? '#d29922' : '#3fb950'),
        marks: [{ at: PL.sp.lvlLoLo / 100, color: '#f85149' },
                { at: PL.sp.lvlSetPct / 100, color: '#8b98a5' },
                { at: PL.sp.lvlHiHi / 100, color: '#f85149' }]
      });
      x.font = '10px JetBrains Mono, monospace'; x.fillStyle = '#8b98a5'; x.textAlign = 'center';
      x.fillText(F(g.Psec, 0) + ' psia', px + bw / 2, h - 30);
      x.fillStyle = '#5e6b7a';
      x.fillText('void ' + F(g.alphaRiser, 2), px + bw / 2, h - 17);
      x.fillText('fd ' + F(sec.Wfw[i] / 1e6, 2), px + bw / 2, h - 4);
    }
  }
  const c2 = document.getElementById('cFW');
  if (c2) {
    const { x, w, h } = W.fitCanvas(c2);
    const y = h * 0.42;
    const live = sec.WfwTotal > 1e4;
    const stages = ['HOTWELL', 'COND P', 'LP HTR', 'MFP', 'HP HTR', 'TO SG'];
    const temps = [PL.sc.hotwellF, PL.sc.hotwellF, sec.stageT[1], sec.stageT[1], sec.TfwF, sec.TfwF];
    const n = stages.length;
    for (let i = 0; i < n; i++) {
      const px = 40 + i * ((w - 70) / (n - 1));
      if (i < n - 1) W.pipe(x, px, y, 40 + (i + 1) * ((w - 70) / (n - 1)), y, live, 1);
      x.fillStyle = live ? 'rgba(74,158,255,.14)' : '#131a22';
      x.beginPath(); x.arc(px, y, 15, 0, 7); x.fill();
      x.strokeStyle = live ? '#4a9eff' : '#3a4552'; x.lineWidth = 1.6; x.stroke();
      x.font = '9px Inter, sans-serif'; x.fillStyle = '#8b98a5'; x.textAlign = 'center';
      x.fillText(stages[i], px, y - 26);
      x.font = '10px JetBrains Mono, monospace'; x.fillStyle = '#e6edf3';
      x.fillText(F(temps[i], 0) + '°', px, y + 34);
    }
    x.font = '11px JetBrains Mono, monospace'; x.textAlign = 'left';
    x.fillStyle = '#8b98a5';
    x.fillText('feed flow  ' + F(sec.WfwTotal / 1e6, 2) + 'e6 lb/hr', 24, h - 40);
    x.fillText('final temp ' + F(sec.TfwF, 0) + ' °F', 24, h - 24);
    x.fillStyle = sec.afwOn ? '#d29922' : '#5e6b7a';
    x.fillText('AFW ' + (sec.afwOn ? 'ACTUATED  ' + F(sec.Wafw.reduce((a, b) => a + b, 0) / 1000, 0) + ' klb/hr' : 'standby'), 24, h - 8);
  }
}

// ====================================================== ELECTRICAL BOARD
export function electrical(PL) {
  const E = PL.E;
  return `<div class="grid1">
  ${W.card('Station one-line', `<canvas id="cEL" class="cv" style="height:340px"></canvas>`)}
  </div>
  <div class="grid4">
  ${W.card('Main generator', `<div class="rows">${W.rows([
    ['Status', E.tripped ? 'TRIPPED — ' + E.tripMsg : (E.genBkr ? 'ON LINE' : 'off line'),
      E.tripped ? 'bad' : 'good'],
    ['Gross output', F(E.MWe, 0) + ' MWe'],
    ['Reactive', F(E.MVAr, 0) + ' MVAr'],
    ['Power factor', F(E.pf, 3) + (E.lead ? ' leading' : ' lagging'), E.lead ? 'warn' : ''],
    ['Terminal volts', F(Math.hypot(E.Vt.re, E.Vt.im), 3) + ' pu'],
    ['Rotor angle', F(E.delta * 180 / Math.PI, 1) + '°'],
    ['Rating', F(PL.ep.Srated, 0) + ' MVA · ' + F(PL.ep.Vgen, 0) + ' kV', 'dimv']
  ])}</div>`)}
  ${W.card('Buses', `<div class="rows">${W.rows([
    ['Aux source', (E.auxSource || 'none').toUpperCase(), E.auxSource === 'none' ? 'bad' : 'good'],
    ['6.9 kV bus 1A', F(E.Vaux[0], 3) + ' pu', E.Vaux[0] < 0.9 ? 'bad' : 'good'],
    ['6.9 kV bus 1B', F(E.Vaux[1], 3) + ' pu', E.Vaux[1] < 0.9 ? 'bad' : 'good'],
    ['4.16 kV safety 1A', F(E.Vsafety[0], 3) + ' pu · ' + E.safetyFrom[0].toUpperCase(),
      E.Vsafety[0] < 0.9 ? 'bad' : 'good'],
    ['4.16 kV safety 1B', F(E.Vsafety[1], 3) + ' pu · ' + E.safetyFrom[1].toUpperCase(),
      E.Vsafety[1] < 0.9 ? 'bad' : 'good'],
    ['House load', F(E.houseMW, 1) + ' MW'],
    ['Net to grid', F(E.netMWe, 0) + ' MWe']
  ])}</div>`)}
  ${[0, 1].map(i => {
    const d = E.edg[i];
    return W.card('Diesel generator 1' + 'AB'[i], `<div class="rows">${W.rows([
      ['Status', d.tripped ? 'TRIPPED — ' + d.tripMsg : (d.running ? 'RUNNING' : (d.airValve ? 'CRANKING' : 'standby')),
        d.tripped ? 'bad' : (d.running ? 'good' : 'dimv')],
      ['Speed', F(d.rpm, 0) + ' rpm'],
      ['Frequency', F(d.rpm / 900 * 60, 2) + ' Hz'],
      ['Volts', F(d.V, 3) + ' pu'],
      ['Breaker', d.bkr ? 'CLOSED' : 'open', d.bkr ? 'good' : 'dimv'],
      ['Load', F(d.loadMW, 2) + ' MW  (' + F(d.loadFrac * 100, 0) + '%)',
        d.loadFrac > 1 ? 'bad' : ''],
      ['Start air', F(d.airPsi, 0) + ' psi', d.airPsi < 150 ? 'warn' : 'dimv'],
      ['Ready in', d.readyT ? F(d.readyT, 2) + ' s' : '—',
        d.readyT && d.readyT <= 10 ? 'good' : (d.readyT ? 'bad' : 'dimv')]
    ])}</div>`);
  }).join('')}
  </div>`;
}
export function drawElecCanvases(PL) {
  const E = PL.E;
  const c = document.getElementById('cEL');
  if (!c) return;
  const { x, w, h } = W.fitCanvas(c);
  const sx = Math.min(w / 900, h / 320);
  x.save(); x.translate((w - 900 * sx) / 2, (h - 320 * sx) / 2); x.scale(sx, sx);
  const genLive = E.genBkr && !E.tripped;

  // generator
  x.beginPath(); x.arc(80, 60, 30, 0, 7);
  x.fillStyle = genLive ? 'rgba(63,185,80,.14)' : '#131a22'; x.fill();
  x.strokeStyle = genLive ? '#3fb950' : '#3a4552'; x.lineWidth = 2; x.stroke();
  x.font = '600 11px Inter, sans-serif'; x.fillStyle = '#8b98a5'; x.textAlign = 'center';
  x.fillText('GEN', 80, 64);
  x.font = '10px JetBrains Mono, monospace'; x.fillStyle = '#e6edf3';
  x.fillText(F(E.MWe, 0) + ' MWe', 80, 106);
  x.fillStyle = '#8b98a5'; x.fillText(F(E.MVAr, 0) + ' MVAr', 80, 119);

  W.pipe(x, 110, 60, 200, 60, genLive, 1);
  W.breaker(x, 155, 60, E.genBkr, '52G');
  // GSU to grid
  x.strokeStyle = genLive ? '#4a9eff' : '#3a4552'; x.lineWidth = 2;
  x.beginPath(); x.arc(222, 60, 15, 0, 7); x.stroke();
  x.beginPath(); x.arc(242, 60, 15, 0, 7); x.stroke();
  x.font = '9px Inter, sans-serif'; x.fillStyle = '#8b98a5';
  x.fillText('GSU 24/345 kV', 232, 32);
  W.pipe(x, 258, 60, 400, 60, genLive && E.gridAvail, 1);
  x.beginPath(); x.arc(430, 60, 20, 0, 7);
  x.strokeStyle = E.gridAvail ? '#39c5cf' : '#f85149'; x.lineWidth = 2; x.stroke();
  x.beginPath(); x.moveTo(418, 60); x.lineTo(442, 60); x.moveTo(430, 48); x.lineTo(430, 72);
  x.stroke();
  x.fillStyle = E.gridAvail ? '#8b98a5' : '#f85149';
  x.fillText(E.gridAvail ? '345 kV GRID' : 'GRID LOST', 430, 100);

  // UAT and SAT down to the aux bus
  const uatLive = E.auxSource === 'uat', satLive = E.auxSource === 'sat';
  W.pipe(x, 155, 75, 155, 150, uatLive, 1);
  x.font = '9px Inter, sans-serif'; x.fillStyle = uatLive ? '#3fb950' : '#5e6b7a';
  x.fillText('UAT', 175, 118);
  W.pipe(x, 430, 82, 430, 150, satLive, 1);
  x.fillStyle = satLive ? '#3fb950' : '#5e6b7a';
  x.fillText('SAT', 452, 118);

  // 6.9 kV bus
  const auxLive = E.Vaux[0] > 0.5;
  x.beginPath(); x.moveTo(120, 160); x.lineTo(470, 160);
  x.lineWidth = 6; x.strokeStyle = auxLive ? '#4a9eff' : '#2a3441'; x.stroke();
  x.font = '600 10px Inter, sans-serif'; x.fillStyle = '#8b98a5'; x.textAlign = 'left';
  x.fillText('6.9 kV AUX BUS', 122, 152);
  x.font = '10px JetBrains Mono, monospace';
  x.fillStyle = auxLive ? '#e6edf3' : '#f85149'; x.textAlign = 'right';
  x.fillText(F(E.Vaux[0], 3) + ' pu', 468, 152);

  // RCPs
  for (let i = 0; i < 3; i++) {
    const px = 165 + i * 62;
    W.pipe(x, px, 160, px, 200, E.rcpOn[i], 1);
    W.pumpSym(x, px, 214, 13, E.rcpOn[i]);
    x.font = '9px Inter, sans-serif'; x.textAlign = 'center';
    x.fillStyle = E.rcpOn[i] ? '#3fb950' : '#f85149';
    x.fillText('RCP ' + (i + 1), px, 240);
  }
  // safety buses and diesels
  for (let i = 0; i < 2; i++) {
    const bx = 560 + i * 175;
    const onDG = E.safetyFrom[i] === 'edg';
    const live = E.Vsafety[i] > 0.5;
    W.pipe(x, 470, 160, bx, 160, E.safetyFrom[i] === 'offsite', 1);
    x.beginPath(); x.moveTo(bx - 60, 190); x.lineTo(bx + 60, 190);
    x.lineWidth = 6; x.strokeStyle = live ? (onDG ? '#d29922' : '#4a9eff') : '#2a3441'; x.stroke();
    x.font = '600 10px Inter, sans-serif'; x.fillStyle = '#8b98a5'; x.textAlign = 'center';
    x.fillText('4.16 kV SAFETY 1' + 'AB'[i], bx, 182);
    x.font = '10px JetBrains Mono, monospace';
    x.fillStyle = live ? '#e6edf3' : '#f85149';
    x.fillText(F(E.Vsafety[i], 3) + ' pu  ' + E.safetyFrom[i].toUpperCase(), bx, 208);
    W.pipe(x, 470, 160, bx - 60, 190, E.safetyFrom[i] === 'offsite', 1);
    // diesel
    const d = E.edg[i];
    W.pipe(x, bx, 190, bx, 245, d.bkr, 1);
    W.breaker(x, bx, 232, d.bkr, '');
    x.beginPath(); x.arc(bx, 278, 22, 0, 7);
    x.fillStyle = d.running ? 'rgba(210,153,34,.16)' : '#131a22'; x.fill();
    x.strokeStyle = d.running ? '#d29922' : (d.tripped ? '#f85149' : '#3a4552');
    x.lineWidth = 2; x.stroke();
    x.font = '600 10px Inter, sans-serif'; x.fillStyle = '#8b98a5'; x.textAlign = 'center';
    x.fillText('DG 1' + 'AB'[i], bx, 282);
    x.font = '9px JetBrains Mono, monospace';
    x.fillStyle = d.running ? '#d29922' : '#5e6b7a';
    x.fillText(F(d.rpm, 0) + ' rpm  ' + F(d.loadFrac * 100, 0) + '%', bx, 312);
  }
  x.restore();
}
