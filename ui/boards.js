// ======================================================================
//  boards.js — the four detail boards plus the overview
//  Each board is a pure render function of the shared plant instance.
// ======================================================================
import * as W from './widgets.js';
import * as AL from './alarms.js';
import * as CT from './controls.js';
const F = W.F, clamp = W.clamp, P = W.P;

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
      </div><div class="rows" style="border-top:1px solid rgba(232,230,216,.14)">${W.rows([
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
  </div>

  ${W.card('REACTOR & ROD CONTROL SWITCHES', CT.switchBank(PL, 'reactor'),
    CT.switchCount('reactor') + ' switches')}`;
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
    W.decadeMeter(x, 62, 16, bw, h - 46, p * 1e11, 0, 11, { label: 'SOURCE', color: P.violet });
    W.decadeMeter(x, 62 + bw + 34, 16, bw, h - 46, p * 1e8, 0, 11, { label: 'INTERMED', color: P.cyan });
    W.vbar(x, 62 + 2 * (bw + 34), 16, bw, h - 46, p, {
      label: 'POWER', color: p > 1.08 ? P.red : P.blue,
      value: F(p * 100, 1) + '%', marks: [{ at: 1.09, color: P.red }]
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
        color: vals[i] < 10 ? P.red : (i > 3 ? P.violet : P.blue)
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
  </div>

  ${W.card('REACTOR COOLANT SWITCHES', CT.switchBank(PL, 'rcs'),
    CT.switchCount('rcs') + ' switches')}`;
}
export function drawRCSCanvases(PL) {
  const S = PL.S, E = PL.E;
  const c1 = document.getElementById('cRCS');
  if (c1) {
    const { x, w, h } = W.fitCanvas(c1);
    const cx = w / 2, cy = h / 2;
    // vessel
    x.fillStyle = 'rgba(91,157,217,.08)';
    x.fillRect(cx - 34, cy - 62, 68, 124);
    x.strokeStyle = P.blue; x.lineWidth = 2;
    x.strokeRect(cx - 34, cy - 62, 68, 124);
    x.font = '600 10px "Barlow Condensed", sans-serif'; x.fillStyle = P.dim; x.textAlign = 'center';
    x.fillText('RPV', cx, cy - 70);
    x.font = '11px "JetBrains Mono", monospace'; x.fillStyle = P.ink;
    x.fillText(F(PL.k.Ptot * PL.rp.Qrated / 1e6, 0) + ' MW', cx, cy + 4);
    x.font = '10px "JetBrains Mono", monospace'; x.fillStyle = P.dim;
    x.fillText(F(S.Tavg, 1) + ' °F', cx, cy + 18);
    // three loops radiating
    const R = Math.min(w, h) * 0.36;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + i * 2 * Math.PI / 3;
      const sx = cx + Math.cos(a) * R, sy = cy + Math.sin(a) * R;
      const live = S.W[i] > 0.05 * PL.rp.Wrated;
      W.pipe(x, cx + Math.cos(a) * 36, cy + Math.sin(a) * 36, sx, sy, live, S.W[i] / PL.rp.Wrated);
      // SG box
      x.fillStyle = live ? 'rgba(163,113,247,.12)' : P.deadFill;
      x.fillRect(sx - 26, sy - 30, 52, 60);
      x.strokeStyle = live ? P.violet : P.dead; x.lineWidth = 1.6;
      x.strokeRect(sx - 26, sy - 30, 52, 60);
      x.font = '600 9px "Barlow Condensed", sans-serif'; x.fillStyle = P.dim; x.textAlign = 'center';
      x.fillText('SG ' + 'ABC'[i], sx, sy - 36);
      x.font = '10px "JetBrains Mono", monospace'; x.fillStyle = P.ink;
      x.fillText(F(PL.sgs[i].lvlNR, 0) + '%', sx, sy - 6);
      x.fillStyle = P.dim; x.font = '9px "JetBrains Mono", monospace';
      x.fillText(F(PL.sgs[i].Psec, 0), sx, sy + 8);
      x.fillText(F(S.Thot[i], 0) + '/' + F(S.Tcold[i], 0), sx, sy + 21);
      // pump
      const pa = a + 0.62;
      const px = cx + Math.cos(pa) * R * 0.72, py = cy + Math.sin(pa) * R * 0.72;
      W.pumpSym(x, px, py, 12, E.rcpOn[i]);
      x.font = '600 9px "Barlow Condensed", sans-serif'; x.fillStyle = E.rcpOn[i] ? P.green : P.red;
      x.fillText('RCP ' + (i + 1), px, py + 25);
    }
  }
  const c2 = document.getElementById('cPZR');
  if (c2) {
    const { x, w, h } = W.fitCanvas(c2);
    const cx = w * 0.34, cy = h / 2;
    const lvl = S.pzrLevel;
    W.tank(x, cx, cy, 74, h - 90, lvl, lvl > 0.75 || lvl < 0.2 ? P.amber : P.blue,
      'PRESSURIZER', F(lvl * 100, 1) + ' %');
    x.font = '600 13px "JetBrains Mono", monospace'; x.fillStyle = P.ink; x.textAlign = 'center';
    x.fillText(F(S.P - 14.7, 0) + ' psig', cx, cy - (h - 90) / 2 - 26);
    // programme marker
    const py = cy + (h - 90) / 2 - (h - 90) * (PL.z.lvlSet / 100);
    x.strokeStyle = P.dim; x.setLineDash([3, 3]); x.lineWidth = 1;
    x.beginPath(); x.moveTo(cx - 44, py); x.lineTo(cx + 44, py); x.stroke(); x.setLineDash([]);
    x.font = '600 9px "Barlow Condensed", sans-serif'; x.fillStyle = P.dim; x.textAlign = 'left';
    x.fillText('programme', cx + 48, py + 3);
    // relief path
    const rx = w * 0.76;
    const relieving = PL.z.Wrelief > 0;
    W.pipe(x, cx + 37, cy - (h - 90) / 2 + 14, rx, cy - (h - 90) / 2 + 14, relieving, 1);
    W.tank(x, rx, cy + 40, 66, 70, clamp(PL.z.prtWaterFt3 / 1800, 0, 1),
      PL.z.prtRuptured ? P.red : P.cyan, 'RELIEF TANK', F(PL.z.prtPsig, 0) + ' psig');
    x.font = '600 9px "Barlow Condensed", sans-serif';
    x.fillStyle = relieving ? P.red : P.dim2; x.textAlign = 'center';
    x.fillText(relieving ? F(PL.z.Wrelief / 1000, 0) + ' klb/hr' : 'no relief flow',
      (cx + rx) / 2 + 18, cy - (h - 90) / 2 + 6);
    // heaters and spray
    x.font = '10px "JetBrains Mono", monospace'; x.textAlign = 'left';
    x.fillStyle = PL.z.heaterKW > 10 ? P.amber : P.dim2;
    x.fillText('heaters  ' + F(PL.z.heaterKW, 0) + ' kW', 14, h - 26);
    x.fillStyle = PL.z.sprayGpm > 5 ? P.cyan : P.dim2;
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
  </div>

  ${W.card('STEAM & FEEDWATER SWITCHES', CT.switchBank(PL, 'secondary'),
    CT.switchCount('secondary') + ' switches')}`;
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
        color: bad ? P.red : (warn ? P.amber : P.green),
        marks: [{ at: PL.sp.lvlLoLo / 100, color: P.red },
                { at: PL.sp.lvlSetPct / 100, color: P.dim },
                { at: PL.sp.lvlHiHi / 100, color: P.red }]
      });
      x.font = '10px "JetBrains Mono", monospace'; x.fillStyle = P.dim; x.textAlign = 'center';
      x.fillText(F(g.Psec, 0) + ' psia', px + bw / 2, h - 30);
      x.fillStyle = P.dim2;
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
      x.fillStyle = live ? 'rgba(91,157,217,.14)' : P.deadFill;
      x.beginPath(); x.arc(px, y, 15, 0, 7); x.fill();
      x.strokeStyle = live ? P.blue : P.dead; x.lineWidth = 1.6; x.stroke();
      x.font = '600 9px "Barlow Condensed", sans-serif'; x.fillStyle = P.dim; x.textAlign = 'center';
      x.fillText(stages[i], px, y - 26);
      x.font = '10px "JetBrains Mono", monospace'; x.fillStyle = P.ink;
      x.fillText(F(temps[i], 0) + '°', px, y + 34);
    }
    x.font = '11px "JetBrains Mono", monospace'; x.textAlign = 'left';
    x.fillStyle = P.dim;
    x.fillText('feed flow  ' + F(sec.WfwTotal / 1e6, 2) + 'e6 lb/hr', 24, h - 40);
    x.fillText('final temp ' + F(sec.TfwF, 0) + ' °F', 24, h - 24);
    x.fillStyle = sec.afwOn ? P.amber : P.dim2;
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
  </div>

  ${W.card('ELECTRICAL SWITCHES', CT.switchBank(PL, 'electrical'),
    CT.switchCount('electrical') + ' switches')}`;
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
  x.fillStyle = genLive ? 'rgba(63,185,80,.14)' : P.deadFill; x.fill();
  x.strokeStyle = genLive ? P.green : P.dead; x.lineWidth = 2; x.stroke();
  x.font = '600 11px "Barlow Condensed", sans-serif'; x.fillStyle = P.dim; x.textAlign = 'center';
  x.fillText('GEN', 80, 64);
  x.font = '10px "JetBrains Mono", monospace'; x.fillStyle = P.ink;
  x.fillText(F(E.MWe, 0) + ' MWe', 80, 106);
  x.fillStyle = P.dim; x.fillText(F(E.MVAr, 0) + ' MVAr', 80, 119);

  W.pipe(x, 110, 60, 200, 60, genLive, 1);
  W.breaker(x, 155, 60, E.genBkr, '52G');
  // GSU to grid
  x.strokeStyle = genLive ? P.blue : P.dead; x.lineWidth = 2;
  x.beginPath(); x.arc(222, 60, 15, 0, 7); x.stroke();
  x.beginPath(); x.arc(242, 60, 15, 0, 7); x.stroke();
  x.font = '600 9px "Barlow Condensed", sans-serif'; x.fillStyle = P.dim;
  x.fillText('GSU 24/345 kV', 232, 32);
  W.pipe(x, 258, 60, 400, 60, genLive && E.gridAvail, 1);
  x.beginPath(); x.arc(430, 60, 20, 0, 7);
  x.strokeStyle = E.gridAvail ? P.cyan : P.red; x.lineWidth = 2; x.stroke();
  x.beginPath(); x.moveTo(418, 60); x.lineTo(442, 60); x.moveTo(430, 48); x.lineTo(430, 72);
  x.stroke();
  x.fillStyle = E.gridAvail ? P.dim : P.red;
  x.fillText(E.gridAvail ? '345 kV GRID' : 'GRID LOST', 430, 100);

  // UAT and SAT down to the aux bus
  const uatLive = E.auxSource === 'uat', satLive = E.auxSource === 'sat';
  W.pipe(x, 155, 75, 155, 150, uatLive, 1);
  x.font = '600 9px "Barlow Condensed", sans-serif'; x.fillStyle = uatLive ? P.green : P.dim2;
  x.fillText('UAT', 175, 118);
  W.pipe(x, 430, 82, 430, 150, satLive, 1);
  x.fillStyle = satLive ? P.green : P.dim2;
  x.fillText('SAT', 452, 118);

  // 6.9 kV bus
  const auxLive = E.Vaux[0] > 0.5;
  x.beginPath(); x.moveTo(120, 160); x.lineTo(470, 160);
  x.lineWidth = 6; x.strokeStyle = auxLive ? P.blue : P.dead; x.stroke();
  x.font = '600 10px "Barlow Condensed", sans-serif'; x.fillStyle = P.dim; x.textAlign = 'left';
  x.fillText('6.9 kV AUX BUS', 122, 152);
  x.font = '10px "JetBrains Mono", monospace';
  x.fillStyle = auxLive ? P.ink : P.red; x.textAlign = 'right';
  x.fillText(F(E.Vaux[0], 3) + ' pu', 468, 152);

  // RCPs
  for (let i = 0; i < 3; i++) {
    const px = 165 + i * 62;
    W.pipe(x, px, 160, px, 200, E.rcpOn[i], 1);
    W.pumpSym(x, px, 214, 13, E.rcpOn[i]);
    x.font = '600 9px "Barlow Condensed", sans-serif'; x.textAlign = 'center';
    x.fillStyle = E.rcpOn[i] ? P.green : P.red;
    x.fillText('RCP ' + (i + 1), px, 240);
  }
  // safety buses and diesels
  for (let i = 0; i < 2; i++) {
    const bx = 560 + i * 175;
    const onDG = E.safetyFrom[i] === 'edg';
    const live = E.Vsafety[i] > 0.5;
    W.pipe(x, 470, 160, bx, 160, E.safetyFrom[i] === 'offsite', 1);
    x.beginPath(); x.moveTo(bx - 60, 190); x.lineTo(bx + 60, 190);
    x.lineWidth = 6; x.strokeStyle = live ? (onDG ? P.amber : P.blue) : P.dead; x.stroke();
    x.font = '600 10px "Barlow Condensed", sans-serif'; x.fillStyle = P.dim; x.textAlign = 'center';
    x.fillText('4.16 kV SAFETY 1' + 'AB'[i], bx, 182);
    x.font = '10px "JetBrains Mono", monospace';
    x.fillStyle = live ? P.ink : P.red;
    x.fillText(F(E.Vsafety[i], 3) + ' pu  ' + E.safetyFrom[i].toUpperCase(), bx, 208);
    W.pipe(x, 470, 160, bx - 60, 190, E.safetyFrom[i] === 'offsite', 1);
    // diesel
    const d = E.edg[i];
    W.pipe(x, bx, 190, bx, 245, d.bkr, 1);
    W.breaker(x, bx, 232, d.bkr, '');
    x.beginPath(); x.arc(bx, 278, 22, 0, 7);
    x.fillStyle = d.running ? 'rgba(210,153,34,.16)' : P.deadFill; x.fill();
    x.strokeStyle = d.running ? P.amber : (d.tripped ? P.red : P.dead);
    x.lineWidth = 2; x.stroke();
    x.font = '600 10px "Barlow Condensed", sans-serif'; x.fillStyle = P.dim; x.textAlign = 'center';
    x.fillText('DG 1' + 'AB'[i], bx, 282);
    x.font = '9px "JetBrains Mono", monospace';
    x.fillStyle = d.running ? P.amber : P.dim2;
    x.fillText(F(d.rpm, 0) + ' rpm  ' + F(d.loadFrac * 100, 0) + '%', bx, 312);
  }
  x.restore();
}

// ====================================================== STARTUP BOARD
//
//  The approach to criticality, plotted BOTH WAYS.
//
//  1/M is linear in reactivity, and reactivity is near enough linear in both
//  boron concentration and rod position, so an approach produces a straight
//  line in either variable that reaches zero AT criticality.  Extrapolating
//  it is the whole technique: it tells you where criticality is before you
//  arrive, which is the difference between a controlled startup and a
//  startup accident.
//
//  Both variables share ONE 1/M axis and are drawn on the same panel with
//  their own x-axes -- boron along the bottom, rod position along the top.
//  Boron is plotted DESCENDING left to right so that both approaches run the
//  same way across the page: dilution lowers ppm, withdrawal raises steps,
//  and with the boron axis reversed both traces walk down to the right and
//  meet the zero line at their predicted critical condition.
//
//  Whichever variable is being moved carries the information and the other
//  degenerates; that is why both are kept on the board rather than choosing.
//  A rod fit during a pure dilution has no spread to work with and reports
//  nothing at all rather than a number invented out of count-rate scatter.

const SU_BORON = P.blue, SU_RODS = P.violet;

export function startup(PL) {
  const su = PL.su, k = PL.k, S = PL.S;
  const per = (!isFinite(k.period) || Math.abs(k.period) > 9999) ? '∞' : F(k.period, 0) + ' s';
  const dbl = (isFinite(su.doublingS) && su.doublingS > 0 && su.doublingS < 9999)
    ? F(su.doublingS, 0) + ' s' : '—';
  const nPts = su.points.length;
  const surCls = su.alarms.surTrip ? 'bad' : (su.alarms.surHi ? 'warn' : 'good');

  // Confidence is read off R², not off whether the number looks plausible.
  // A fit whose variable has stopped moving still returns a value; the
  // correlation is what tells you it has stopped meaning anything.
  const quality = r2 => r2 >= 0.95 ? 'good' : (r2 >= 0.80 ? 'warn' : 'bad');
  const ecpB = su.ecpPpm != null
    ? [F(su.ecpPpm, 0) + ' ppm', quality(su.ecpR2)]
    : ['— need 3 points', 'dimv'];
  const rodsUnreachable = su.ecpRods != null && su.ecpRods > 528;
  const ecpR = su.ecpRods != null
    ? [rodsUnreachable ? F(su.ecpRods, 0) + ' steps' : F(su.ecpRods, 0) + ' steps',
       rodsUnreachable ? 'bad' : quality(su.ecpRodsR2)]
    : ['— rods not moved', 'dimv'];

  return `<div class="grid3">
  ${W.card('Source range', `<canvas id="cSR" class="cv" style="height:250px"></canvas>
    <div class="rows">${W.rows([
      ['Count rate (meter)', su.srCps >= 1e5 ? su.srCps.toExponential(2) + ' cps' : F(su.srCps, 0) + ' cps',
        su.alarms.srHi ? 'warn' : ''],
      ['Integrated count', su.avgSeconds > 0.5
        ? (su.srCpsAvg >= 1e5 ? su.srCpsAvg.toExponential(2) : F(su.srCpsAvg, 1)) + ' cps'
        : 'restarting', su.avgSeconds > 0.5 ? 'good' : 'dimv'],
      ['Integration time', su.steady
        ? F(su.avgSeconds, 0) + ' of ' + F(PL.sup.avgWindowS, 0) + ' s'
        : 'CONDITIONS CHANGING', su.steady
          ? (su.avgSeconds >= PL.sup.avgWindowS * 0.5 ? 'good' : 'warn') : 'warn'],
      ['Reference CR₀', su.baseCps ? (su.baseCps >= 1e5 ? su.baseCps.toExponential(2) : F(su.baseCps, 1)) + ' cps' : 'not taken', su.baseCps ? 'dimv' : 'warn'],
      ['On scale', su.onScaleSR ? 'yes' : 'OFF SCALE HIGH', su.onScaleSR ? 'good' : 'bad'],
      ['Intermediate range', su.irAmps.toExponential(2) + ' A', 'dimv'],
      ['Power range', su.onScalePR ? F(su.prPct, 3) + ' %' : 'below range', su.onScalePR ? '' : 'dimv']
    ])}</div>`)}
  ${W.card('Startup rate', `<div class="rows">${W.rows([
      ['Startup rate', F(su.surDpm, 3) + ' dpm', surCls],
      ['Alarm / limit', F(PL.sup.surAlarmDpm, 1) + ' / ' + F(PL.sup.surLimitDpm, 1) + ' dpm', 'dimv'],
      ['Reactor period', per],
      ['Doubling time', dbl, 'dimv'],
      ['Neutron flux', k.P.toExponential(2), 'dimv'],
      ['Net reactivity', ((PL.lastBalance?.pcm ?? 0) >= 0 ? '+' : '') + F(PL.lastBalance?.pcm ?? 0, 1) + ' pcm',
        Math.abs(PL.lastBalance?.pcm ?? 0) < 5 ? 'good' : 'warn'],
      ['Current 1/M', F(su.invM, 4), su.invM < 0.08 ? 'warn' : '']
    ])}</div>`)}
  ${W.card('Conditions', `<div class="rows">${W.rows([
      ['Boron', F(PL.ppm, 1) + ' ppm'],
      ['Control bank demand', F(PL.banks.ctrlDemand, 0) + ' / 528 steps'],
      ['Shutdown banks', F(PL.banks.sd[0], 0) + ' / ' + F(PL.banks.sd[1], 0), 'dimv'],
      ['Tavg', F(S.Tavg, 1) + ' °F'],
      ['RCS pressure', F(S.P - 14.7, 0) + ' psig'],
      ['Boron worth', F(PL.boronWorth ?? 0, 2) + ' pcm/ppm', 'dimv'],
      ['Data points', String(nPts), nPts ? '' : 'dimv']
    ])}</div>`)}
  </div>

  ${W.card('1/M approach to criticality', `
    <canvas id="cInvM" class="cv" style="height:330px"></canvas>
    <div class="mini">
      <div class="m"><div class="t">Est. critical boron</div>
        <div class="a ${ecpB[1]}">${ecpB[0]}</div>
        <div class="b">R² ${su.ecpPpm != null ? F(su.ecpR2, 4) : '—'} · now ${F(PL.ppm, 0)} ppm</div></div>
      <div class="m"><div class="t">Est. critical rod position</div>
        <div class="a ${ecpR[1]}">${ecpR[0]}</div>
        <div class="b">${rodsUnreachable
          ? 'beyond 528 — not critical on rods alone at this boron'
          : 'R² ' + (su.ecpRods != null ? F(su.ecpRodsR2, 4) : '—') + ' · now ' + F(PL.banks.ctrlDemand, 0) + ' steps'}</div></div>
      <div class="m"><div class="t">1/M</div>
        <div class="a">${F(su.invM, 4)}</div>
        <div class="b">${su.baseCps ? nPts + ' points logged' : 'take CR₀ to begin'}</div></div>
    </div>
    <div class="btns" style="padding:0 16px 14px">
      <button class="good" data-su="base">Take reference CR₀</button>
      <button class="good" data-su="point">Log 1/M point</button>
      <button data-su="clear">Clear plot</button>
      <button data-su="csv">Copy data</button>
    </div>
    <div class="icnote" style="padding:0 16px 12px">${
      !su.baseCps
        ? 'Take the reference count rate at the shutdown condition first. Every later point is relative to it.'
        : !su.steady
        ? 'Conditions are changing — the integrating counter has restarted. Let boron and rods settle before logging.'
        : su.avgSeconds < PL.sup.avgWindowS * 0.5
        ? `Integrating — ${F(su.avgSeconds, 0)} s of ${F(PL.sup.avgWindowS, 0)} s. Scatter falls as √T, so a short count fits a poor line.`
        : `Integrated ${F(su.avgSeconds, 0)} s — scatter about ${F(100 / Math.sqrt(Math.max(su.avgTrueCps * su.avgSeconds, 1)), 1)}%. Ready to log.`
    }</div>`, nPts ? nPts + ' points' : '')}

  ${W.card('Data points', nPts === 0
    ? '<div class="icnote" style="padding:10px 16px 16px">No points logged.</div>'
    : `<div class="rows">${W.rows(
        su.points.slice(-9).map((p, i) => {
          const n0 = Math.max(0, nPts - 9);
          return [`#${n0 + i + 1} · ${F(p.ppm, 0)} ppm · ${F(p.rods, 0)} steps`,
                  `CR ${p.cps >= 1e5 ? p.cps.toExponential(2) : F(p.cps, 1)}` +
                  ` (${F(p.intS ?? 0, 0)} s) · 1/M ${F(p.invM, 4)}`,
                  p.invM < 0.08 ? 'warn' : 'dimv'];
        }))}</div>`)}`;
}

/**
 * The dual-axis 1/M plot.
 *
 * One y-axis (1/M, criticality at the bottom) and two x-axes: boron along the
 * bottom running high-to-low, rod steps along the top running low-to-high.
 * Each series gets its own least-squares line carried on to 1/M = 0 as a
 * dashed extrapolation with the predicted critical condition marked on its
 * own axis.
 */
export function drawStartupCanvases(PL) {
  const su = PL.su;

  const sr = document.getElementById('cSR');
  if (sr) {
    const { x, w, h } = W.fitCanvas(sr);
    const bw = Math.min(46, (w - 96) / 3);
    W.decadeMeter(x, 66, 16, bw, h - 46, Math.max(su.srCps, 1e-2), -1, 6,
      { label: 'SOURCE cps', color: su.alarms.srHi ? P.red : SU_RODS });
    W.decadeMeter(x, 66 + bw + 36, 16, bw, h - 46, Math.max(su.irAmps, 1e-11), -11, -3,
      { label: 'INTERMED A', color: P.cyan });
    W.decadeMeter(x, 66 + 2 * (bw + 36), 16, bw, h - 46, Math.max(su.prPct, 1e-4), -4, 2,
      { label: 'POWER %', color: P.blue });
  }

  const cv = document.getElementById('cInvM');
  if (!cv) return;
  const { x, w, h } = W.fitCanvas(cv);
  const L = 56, R = w - 18, T = 34, B = h - 40;
  if (R <= L || B <= T) return;

  const pts = su.points.filter(p => p.invM > 0 && p.invM <= 1.05);

  // ---- axis ranges ------------------------------------------------
  // Boron auto-ranges over the data and its own prediction so the line fills
  // the panel; rods are held on the full bank travel, because where you are
  // in the bank is itself information the operator wants.
  let bLo = 0, bHi = 1;
  if (pts.length) {
    const xs = pts.map(p => p.ppm);
    if (su.ecpPpm != null && isFinite(su.ecpPpm)) xs.push(su.ecpPpm);
    bLo = Math.min(...xs); bHi = Math.max(...xs);
    const pad = Math.max((bHi - bLo) * 0.10, 15);
    bLo -= pad; bHi += pad;
    if (bHi - bLo < 50) { const m = (bHi + bLo) / 2; bLo = m - 25; bHi = m + 25; }
  } else { bLo = 0; bHi = 1600; }
  const rLo = 0, rHi = 528;

  const yMax = 1.08;
  const Y = v => B - (B - T) * (clamp(v, 0, yMax) / yMax);
  const Xb = v => R - (R - L) * (clamp(v, bLo, bHi) - bLo) / Math.max(bHi - bLo, 1e-6); // reversed
  const Xr = v => L + (R - L) * (clamp(v, rLo, rHi) - rLo) / Math.max(rHi - rLo, 1e-6);

  // ---- frame and 1/M gridlines ------------------------------------
  W.cutout(x, L, T, R - L, B - T);
  x.font = '10px "JetBrains Mono", monospace'; x.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const v = yMax * i / 5, yy = Y(v);
    x.strokeStyle = P.grid; x.lineWidth = 1;
    x.beginPath(); x.moveTo(L, yy); x.lineTo(R, yy); x.stroke();
    x.fillStyle = P.dim2; x.fillText(v.toFixed(2), L - 7, yy + 3);
  }
  // criticality line: 1/M = 0
  x.strokeStyle = P.red; x.lineWidth = 1.6;
  x.beginPath(); x.moveTo(L, Y(0)); x.lineTo(R, Y(0)); x.stroke();
  x.fillStyle = P.red; x.textAlign = 'left'; x.font = '600 10px "Barlow Condensed", sans-serif';
  x.fillText('CRITICAL', L + 6, Y(0) - 6);
  x.save(); x.translate(14, (T + B) / 2); x.rotate(-Math.PI / 2);
  x.fillStyle = P.dim; x.textAlign = 'center'; x.font = '600 11px "Barlow Condensed", sans-serif';
  x.fillText('1 / M', 0, 0); x.restore();

  // ---- x-axis scales ----------------------------------------------
  x.font = '10px "JetBrains Mono", monospace';
  for (let i = 0; i <= 4; i++) {
    const bv = bLo + (bHi - bLo) * i / 4, bx = Xb(bv);
    x.strokeStyle = P.grid;
    x.beginPath(); x.moveTo(bx, T); x.lineTo(bx, B); x.stroke();
    x.fillStyle = SU_BORON; x.textAlign = 'center';
    x.fillText(bv.toFixed(0), bx, B + 15);
    const rv = rLo + (rHi - rLo) * i / 4, rx = Xr(rv);
    x.fillStyle = SU_RODS;
    x.fillText(rv.toFixed(0), rx, T - 16);
  }
  x.font = '600 10px "Barlow Condensed", sans-serif';
  x.fillStyle = SU_BORON; x.textAlign = 'right';
  x.fillText('BORON  ppm  (decreasing →)', R, B + 30);
  x.fillStyle = SU_RODS; x.textAlign = 'left';
  x.fillText('CONTROL BANK  steps  (withdrawing →)', L, T - 20);

  if (!pts.length) {
    x.fillStyle = P.dim2; x.textAlign = 'center'; x.font = '600 12px "Barlow Condensed", sans-serif';
    x.fillText('No 1/M points logged', (L + R) / 2, (T + B) / 2);
    return;
  }

  // ---- one series ---------------------------------------------------
  const drawSeries = (key, XF, color, fit) => {
    // measured points, joined
    x.strokeStyle = color; x.lineWidth = 1.5;
    x.beginPath();
    pts.forEach((p, i) => { const px = XF(p[key]), py = Y(p.invM);
      i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.stroke();
    pts.forEach(p => {
      x.beginPath(); x.arc(XF(p[key]), Y(p.invM), 3.4, 0, 7);
      x.fillStyle = color; x.fill();
      x.strokeStyle = P.face; x.lineWidth = 1.2; x.stroke();
    });
    if (!fit || !isFinite(fit.x0)) return;
    // least-squares line carried on to 1/M = 0
    const last = pts[pts.length - 1];
    x.setLineDash([5, 4]); x.strokeStyle = color; x.lineWidth = 1.3;
    x.beginPath();
    x.moveTo(XF(last[key]), Y(fit.slope * last[key] + fit.intercept));
    x.lineTo(XF(fit.x0), Y(0));
    x.stroke(); x.setLineDash([]);
    // predicted critical condition, marked on its own axis
    const ix = XF(fit.x0);
    if (ix >= L - 1 && ix <= R + 1) {
      x.beginPath(); x.arc(ix, Y(0), 5, 0, 7);
      x.fillStyle = P.face; x.fill();
      x.strokeStyle = color; x.lineWidth = 2; x.stroke();
      x.font = '600 10px "JetBrains Mono", monospace'; x.fillStyle = color;
      x.textAlign = ix > (L + R) / 2 ? 'right' : 'left';
      x.fillText(F(fit.x0, 0), ix + (ix > (L + R) / 2 ? -9 : 9), Y(0) + 14);
    }
  };

  drawSeries('ppm', Xb, SU_BORON, su.fitPpm);
  drawSeries('rods', Xr, SU_RODS, su.fitRods);

  // current condition, both axes
  x.setLineDash([2, 3]); x.lineWidth = 1;
  [[Xb(PL.ppm), SU_BORON], [Xr(PL.banks.ctrlDemand), SU_RODS]].forEach(([px, c]) => {
    x.strokeStyle = c; x.globalAlpha = 0.45;
    x.beginPath(); x.moveTo(px, T); x.lineTo(px, B); x.stroke();
    x.globalAlpha = 1;
  });
  x.setLineDash([]);
}


// ====================================================== SAFEGUARDS BOARD
//
//  Engineered safeguards and residual heat removal.  These systems sit on
//  their own panel on a real board because they are operated as trains -- A
//  and B, redundant and separately powered -- and the operator's job during an
//  event is to know which train is doing what.  So everything here is per
//  train, never summed.
export function safeguards(PL) {
  const si = PL.si, cn = PL.cnmt, rh = PL.rhr, sip = PL.sip, cnp = PL.cnp;
  const perm = (PL.S.P - 14.7) <= 400 && PL.S.Thot[0] <= 350;

  return `<div class="grid3">
  ${W.card('Safety injection', `<div class="rows">${W.rows([
    ['Status', si.actuated ? 'ACTUATED' : (si.manualBlock ? 'BLOCKED' : 'armed'),
      si.actuated ? 'bad' : (si.manualBlock ? 'warn' : 'good')],
    ['Total flow', F(si.totalGpm, 0) + ' gpm', si.totalGpm > 1 ? 'bad' : 'dimv'],
    ['Suction', (si.suction || 'rwst').toUpperCase(), si.suction === 'sump' ? 'warn' : ''],
    ['RWST level', F(si.rwstPct, 1) + ' %', si.rwstPct < sip.rwstLoPct ? 'bad' : 'good'],
    ['Charging pumps', si.hhOn.filter(Boolean).length + ' of 2',
      si.hhOn.every(Boolean) ? 'good' : 'warn'],
    ['SI pumps', si.siOn.filter(Boolean).length + ' of 2',
      si.siOn.every(Boolean) ? 'good' : 'warn'],
    ['Low head pumps', si.lhOn.filter(Boolean).length + ' of 2',
      si.lhOn.every(Boolean) ? 'good' : 'warn'],
    ['Boron', F(si.boronPpm, 0) + ' ppm', 'dimv']
  ])}</div>`)}
  ${W.card('Accumulators', `<div class="mini">${[0, 1, 2].map(i => {
    const a = si.acc[i];
    return `<div class="m"><div class="t">Accum ${'ABC'[i]}</div>
      <div class="a ${a.discharging ? 'bad' : (a.isolated ? 'dimv' : '')}">${F(a.psig, 0)}</div>
      <div class="b">psig</div>
      <div class="b">${a.isolated ? 'ISOLATED' : (a.empty ? 'EMPTY' : F(a.waterFt3, 0) + ' ft³')}</div>
      ${W.bar(a.waterFt3 / 850, a.empty ? 'bad' : (a.isolated ? 'warn' : 'good'))}</div>`;
  }).join('')}</div>`)}
  ${W.card('Containment', `<div class="rows">${W.rows([
    ['Pressure', F(cn.psig, 2) + ' psig', cn.psig > cnp.isolPsig ? 'bad' : 'good'],
    ['Peak', F(cn.peakPsig, 2) + ' of ' + cnp.designPsig + ' psig', 'dimv'],
    ['Temperature', F(cn.Tf, 0) + ' °F', cn.alarms.hiTemp ? 'warn' : ''],
    ['Isolated', cn.isolated ? 'YES' : 'no', cn.isolated ? 'bad' : 'good'],
    ['Spray', cn.sprayGpm > 0 ? F(cn.sprayGpm, 0) + ' gpm' : 'idle',
      cn.sprayGpm > 0 ? 'bad' : 'dimv'],
    ['Fan coolers', cn.fansOn.filter(Boolean).length + ' of 4',
      cn.fansOn.every(Boolean) ? 'good' : 'warn'],
    ['Fan heat removal', F(cn.QfanMW ?? 0, 1) + ' MW', 'dimv'],
    ['Sump', F(cn.sumpFt3, 0) + ' ft³', cn.alarms.sumpHi ? 'warn' : 'dimv']
  ])}</div>`)}
  </div>

  <div class="grid2">
  ${W.card('Residual heat removal', `<div class="rows">${W.rows([
    ['Status', rh.inService ? 'IN SERVICE' : (perm ? 'entry permitted' : 'interlocked'),
      rh.inService ? 'good' : (perm ? 'warn' : 'dimv')],
    ['Heat removal', F(rh.QtotalMW, 2) + ' MW'],
    ['Cooldown rate', F(rh.cooldownFperHr, 0) + ' °F/hr',
      rh.cooldownFperHr > 100 ? 'warn' : ''],
    ['CCW temperature', F(rh.ccwTempF, 0) + ' °F', rh.ccwTempF > 110 ? 'warn' : 'dimv'],
    ['Entry conditions', perm ? 'met' : `needs ≤400 psig, ≤350 °F`, perm ? 'good' : 'dimv']
  ])}</div>`, rh.mode)}
  ${W.card('RHR trains', `<div class="mini" style="grid-template-columns:repeat(2,1fr)">${[0, 1].map(i => {
    const tr = rh.trains[i];
    return `<div class="m"><div class="t">Train ${'AB'[i]}</div>
      <div class="a ${tr.tripped ? 'bad' : (tr.pumpOn ? '' : 'dimv')}">${F(tr.flowGpm, 0)}</div>
      <div class="b">gpm · ${F(tr.QMW, 2)} MW</div>
      <div class="b">${tr.tripped ? 'TRIPPED' : (tr.interlocked ? 'interlocked'
        : (tr.pumpOn ? 'running' : 'stopped'))}</div>
      <div class="b">${F(tr.Tin, 0)} → ${F(tr.Tout, 0)} °F</div>
      ${W.bar(tr.throttle, tr.tripped ? 'bad' : (tr.pumpOn ? 'good' : 'warn'))}</div>`;
  }).join('')}</div>`)}
  </div>

  ${W.card('Safeguards control switches', CT.switchBank(PL, 'safeguards'),
    CT.switchCount('safeguards') + ' switches')}`;
}

/**
 * Cooling water board.  The whole point of this panel is that it reads as a
 * CHAIN -- component cooling on the left, the exchangers in the middle,
 * service water and the ultimate heat sink on the right -- because that is how
 * the fault is diagnosed.  A single "CCW temperature high" number tells you
 * something is wrong; the chain tells you which link.
 */
export function cooling(PL) {
  const C = PL.cw, cp = PL.cwp;
  const nP = C.pumpSpeed.filter(s => s > 0.5).length;
  const nSW = C.swPumpOn.filter(Boolean).length;
  const nHx = C.hxInService.filter(Boolean).length;
  const MW = q => F(q / 3.412142e6, 1);

  return `<div class="grid3">
  ${W.card('Component cooling water', `<div class="rows">${W.rows([
    ['Supply header', F(C.supplyF, 1) + ' °F',
      C.supplyF > cp.ccwHiHiF ? 'bad' : (C.supplyF > cp.ccwHiF ? 'warn' : 'good')],
    ['Return header', F(C.returnF, 1) + ' °F', 'dimv'],
    ['Loop rise', F(C.returnF - C.supplyF, 1) + ' °F', 'dimv'],
    ['Flow', F(C.flowGpm / 1000, 1) + 'k gpm',
      C.flowGpm < 1 ? 'bad' : (C.flowFrac < cp.ccwLoFlowFrac ? 'warn' : 'good')],
    ['Pumps running', nP + ' of ' + cp.nPumps, nP >= 2 ? 'good' : 'warn'],
    ['Heat load', MW(C.QloadBtuHr) + ' MW', 'dimv'],
    ['Rejected to SW', MW(C.QhxBtuHr) + ' MW', 'dimv'],
    ['Surge tank', F(C.surgePct, 0) + ' %',
      C.surgePct < cp.surgeLoPct ? 'bad' : 'good'],
    ['Loop activity', C.activityUCiMl > 1e-3 ? 'DETECTED' : 'background',
      C.activityUCiMl > 1e-3 ? 'bad' : 'dimv']
  ])}</div>`, `${nHx} of ${cp.nHx} HX`)}

  ${W.card('Cooled by CCW', `<div class="rows">${W.rows([
    ['RHR heat exchangers', F(PL.rhr.QtotalMW, 2) + ' MW',
      PL.rhr.inService ? 'good' : 'dimv'],
    ['Letdown HX', C.letdownIsolated ? 'ISOLATED' : F(PL.cv.letdownGpm, 0) + ' gpm',
      C.letdownIsolated ? 'bad' : 'dimv'],
    ['Spent fuel pool', MW(cp.sfpBtuHr) + ' MW', 'dimv'],
    ['RCP thermal barriers', C.rcpBarrierOK.filter((ok, i) => ok && PL.S.pumpOn[i]).length
      + ' of ' + PL.S.pumpOn.filter(Boolean).length + ' cooled',
      C.alarms.barrierLost ? 'bad' : 'good'],
    ['Seal condition', C.sealDamaged.some(Boolean)
      ? 'DAMAGED ' + C.sealDamaged.map((d, i) => d ? 'ABC'[i] : '').join('')
      : 'intact', C.sealDamaged.some(Boolean) ? 'bad' : 'good'],
    ['Time to seal damage', C.alarms.barrierLost
      ? F(Math.max(cp.sealDamageSec - Math.max(...C.sealTimerSec), 0) / 60, 1) + ' min'
      : '—', C.alarms.barrierLost ? 'bad' : 'dimv']
  ])}</div>`)}

  ${W.card('Service water · ultimate heat sink', `<div class="rows">${W.rows([
    ['UHS supply', F(C.swSupplyF, 1) + ' °F', C.swSupplyF > cp.swHiF ? 'warn' : 'good'],
    ['SW return', F(C.swReturnF, 1) + ' °F', C.swReturnF > 115 ? 'warn' : 'dimv'],
    ['Flow', F(C.swFlowGpm / 1000, 1) + 'k gpm',
      C.swFlowGpm < 1 ? 'bad' : (C.swFlowFrac < cp.swLoFlowFrac ? 'warn' : 'good')],
    ['Pumps running', nSW + ' of ' + cp.nSwPumps, nSW >= 2 ? 'good' : 'warn'],
    ['Strainer ΔP', F(C.strainerDP, 2) + ' psid', C.strainerDP > 1.6 ? 'warn' : 'good'],
    ['Total SW duty', MW(C.swQBtuHr) + ' MW', 'dimv'],
    ['Diesel jacket cooling', PL.E.edg.some(e => e.running)
      ? (C.swFlowGpm > 1 ? 'available' : 'LOST') : 'not required',
      PL.E.edg.some(e => e.running) && C.swFlowGpm < 1 ? 'bad' : 'dimv'],
    ['Fan cooler cooling', PL.cnmt.fansOn.some(Boolean)
      ? (C.swFlowGpm > 1 ? 'available' : 'LOST') : 'secured',
      PL.cnmt.fansOn.some(Boolean) && C.swFlowGpm < 1 ? 'bad' : 'dimv']
  ])}</div>`)}
  </div>

  <div class="grid3">
  ${W.card('Condenser', `<div class="rows">${W.rows([
    ['Back pressure', F(PL.cd.inHg, 2) + ' inHg', PL.cd.alarms.vacuumLow ? 'bad' : 'good'],
    ['', F(PL.cd.psia, 3) + ' psia', 'dimv'],
    ['Saturation temp', F(PL.cd.TcondF, 1) + ' °F', 'dimv'],
    ['Duty', F(PL.cd.dutyMW, 0) + ' MW', 'dimv'],
    ['TTD', F(PL.cd.ttdF, 1) + ' °F',
      PL.cd.ttdF > PL.cdp.ttdCleanF + 6 ? 'warn' : 'good'],
    ['Tube fouling', F(PL.cd.tubeFoul * 100, 0) + ' %', PL.cd.alarms.fouled ? 'warn' : 'dimv'],
    ['Air burden', F(PL.cd.airBurden * 100, 0) + ' %', PL.cd.alarms.airHigh ? 'warn' : 'dimv'],
    ['Air ejectors', PL.cd.ejectorOn.filter(Boolean).length + ' of ' + PL.cdp.nEjectors,
      PL.cd.alarms.ejectorLost ? 'bad' : 'good'],
    ['Output factor', F(PL.cd.mweFactor * 100, 1) + ' %',
      PL.cd.mweFactor < 0.985 ? 'warn' : 'good']
  ])}</div>`)}

  ${W.card('Circulating water', `<div class="rows">${W.rows([
    ['Inlet', F(PL.cd.cwInletF, 1) + ' °F', PL.cd.cwInletF > 88 ? 'warn' : 'good'],
    ['Outlet', F(PL.cd.cwOutletF, 1) + ' °F', PL.cd.alarms.cwOutletHi ? 'warn' : 'dimv'],
    ['Rise', F(PL.cd.cwRiseF, 1) + ' °F', 'dimv'],
    ['Flow', F(PL.cd.cwFlowGpm / 1000, 0) + 'k gpm',
      PL.cd.cwFlowGpm < 1 ? 'bad' : (PL.cd.cwFlowFrac < 0.6 ? 'warn' : 'good')],
    ['Pumps', PL.cd.cwPumpOn.filter(Boolean).length + ' of ' + PL.cdp.nCwPumps,
      PL.cd.cwPumpOn.every(Boolean) ? 'good' : 'warn']
  ])}</div>`)}

  ${W.card('Condensate', `<div class="rows">${W.rows([
    ['Hotwell level', F(PL.cd.hotwellPct, 0) + ' %',
      PL.cd.alarms.hotwellLo ? 'bad' : (PL.cd.alarms.hotwellHi ? 'warn' : 'good')],
    ['Condensate flow', F(PL.cd.condFlowGpm / 1000, 1) + 'k gpm', 'dimv'],
    ['Pumps', PL.cd.condPumpOn.filter(Boolean).length + ' of ' + PL.cdp.nCondPumps,
      PL.cd.alarms.condPumpLost ? 'warn' : 'good'],
    ['Level control', PL.cd.makeupOn ? 'MAKEUP' : (PL.cd.rejectOn ? 'REJECT' : 'in band'),
      PL.cd.makeupOn || PL.cd.rejectOn ? 'warn' : 'good'],
    ['Storage tank', F(PL.cd.cstGal / 1000, 0) + 'k gal', PL.cd.alarms.cstLo ? 'warn' : 'dimv']
  ])}</div>`)}
  </div>

  ${W.card('Heat sink chain', `<div class="note">
    Plant components reject into component cooling water, a closed treated loop;
    CCW rejects through ${nHx} heat exchanger${nHx === 1 ? '' : 's'} into service
    water, an open loop drawn from the ultimate heat sink at
    ${F(C.swSupplyF, 0)} °F. Every link is in series, so the sink temperature
    sets the floor for everything upstream of it —
    ${MW(C.QloadBtuHr)} MW is currently leaving the plant this way.
    Rejection to the environment splits two ways: ${F(PL.cd.dutyMW, 0)} MW leaves
    through the condenser into circulating water, and ${F(C.QloadBtuHr / 3.412142e6, 1)} MW
    of component heat leaves through service water. Both draw on the same sink.
    ${C.alarms.barrierLost
      ? '<b>Thermal barrier cooling is lost.</b> The reactor coolant pump seals are '
        + 'being held by injection alone; the procedure is to trip the pumps before '
        + 'the seals are damaged, because a seal failure is a small-break LOCA '
        + 'inside containment with the pumps running.'
      : ''}
  </div>`)}`;
}
