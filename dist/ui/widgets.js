// ======================================================================
//  widgets.js — shared rendering helpers for every board
//
//  PALETTE.  The boards are drawn as instruments RECESSED INTO PANEL STEEL,
//  which is why there are two colour worlds here and not one.  The panel face
//  is a light grey-green painted sheet -- the colour US PWR control boards are
//  actually painted -- and every legend on it is engraved black.  The
//  instruments cut into that panel have near-black faces with a green cast,
//  like glass over a phosphor, and everything inside them reads light-on-dark.
//
//  Canvas only ever draws INSIDE an instrument, so everything below is tuned
//  for the dark face.  The panel itself is CSS.  Both take their values from
//  here so they cannot drift apart.
// ======================================================================

export const P = {
  face:    '#0a0d0b',           // instrument face, green-black
  faceLip: 'rgba(0,0,0,.55)',   // inside edge of the cutout
  grid:    'rgba(232,230,216,.07)',
  gridKey: 'rgba(232,230,216,.16)',
  ink:     '#e8e6d8',           // lit scale markings, warm white
  dim:     '#969c8a',
  dim2:    '#67705f',
  phosphor:'#ffb02e',           // amber digital readout
  amber:   '#f0a92a',
  red:     '#e0503a',
  green:   '#5fbe62',
  cyan:    '#4fc4c8',
  violet:  '#a98ae0',
  blue:    '#5b9dd9',
  dead:    '#2b302a',           // de-energised / no flow
  deadFill:'#12160f'
};
export const F = (x, n = 1) => Number.isFinite(x) ? x.toFixed(n) : '—';
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const el = id => document.getElementById(id);

/** Key/value rows. list = [label, value, className] */
export function rows(list) {
  return list.map(([k, v, c]) =>
    `<div class="row"><span class="k">${k}</span><span class="v ${c || ''}">${v}</span></div>`).join('');
}
/** Horizontal bar with a value and optional limit markers. */
export function bar(frac, cls, marks) {
  const m = (marks || []).map(x =>
    `<u style="left:${clamp(x * 100, 0, 100)}%"></u>`).join('');
  return `<div class="bar">${m}<i class="${cls || ''}" style="width:${clamp(frac * 100, 0, 100)}%"></i></div>`;
}
/** Card wrapper. */
export function card(title, body, extra) {
  return `<div class="card"><h2>${title}${extra ? `<span>${extra}</span>` : ''}</h2>${body}</div>`;
}
/** Small tile with a big number. */
export function stat(label, value, unit, cls) {
  return `<div class="m"><div class="t">${label}</div><div class="a ${cls || ''}">${value}</div>` +
         `<div class="b">${unit || ''}</div></div>`;
}

/**
 * Draw a rectangle as a CUTOUT in the panel: dark face, with a shadow along
 * the top and left inside edges and a faint catch-light along the bottom and
 * right.  That is what an instrument recessed behind a bezel actually looks
 * like, and it is what separates a panel from a set of coloured rectangles.
 */
export function cutout(x, px, py, pw, ph, fill) {
  x.fillStyle = fill || P.face;
  x.fillRect(px, py, pw, ph);
  x.lineWidth = 1;
  x.strokeStyle = P.faceLip;                       // shadowed inside edge
  x.beginPath();
  x.moveTo(px + .5, py + ph - .5); x.lineTo(px + .5, py + .5); x.lineTo(px + pw - .5, py + .5);
  x.stroke();
  x.strokeStyle = 'rgba(232,230,216,.08)';         // catch-light opposite
  x.beginPath();
  x.moveTo(px + pw - .5, py + .5); x.lineTo(px + pw - .5, py + ph - .5); x.lineTo(px + .5, py + ph - .5);
  x.stroke();
}

// ------------------------------------------------------------- canvas
export function fitCanvas(cv) {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(2, Math.round(r.width)), h = Math.max(2, Math.round(r.height));
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const x = cv.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  return { x, w, h };
}

/** Vertical bargraph, the shape of a real level or flux indicator. */
export function vbar(x, px, py, pw, ph, frac, opt = {}) {
  cutout(x, px, py, pw, ph);
  const f = clamp(frac, 0, 1);
  const col = opt.color || P.blue;
  // scale graduations etched on the face, visible behind the column
  x.strokeStyle = P.grid; x.lineWidth = 1;
  for (let i = 1; i < 10; i++) {
    const gy = Math.round(py + ph * i / 10) + .5;
    x.beginPath(); x.moveTo(px + 1, gy); x.lineTo(px + (i % 5 ? 4 : 7), gy); x.stroke();
    x.beginPath(); x.moveTo(px + pw - (i % 5 ? 4 : 7), gy); x.lineTo(px + pw - 1, gy); x.stroke();
  }
  if (f > 0.002) {
    x.save();
    x.shadowColor = col; x.shadowBlur = 7;
    x.fillStyle = col;
    x.fillRect(px + 1, py + ph * (1 - f), pw - 2, ph * f);
    x.restore();
  }
  (opt.marks || []).forEach(m => {
    const my = py + ph * (1 - clamp(m.at, 0, 1));
    x.strokeStyle = m.color || P.red; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(px - 3, my); x.lineTo(px + pw + 3, my); x.stroke();
  });
  if (opt.label) {
    x.font = '600 10px "Barlow Condensed", sans-serif'; x.fillStyle = P.dim; x.textAlign = 'center';
    x.fillText(opt.label, px + pw / 2, py + ph + 14);
  }
  if (opt.value !== undefined) {
    x.font = '600 11px "Share Tech Mono", monospace'; x.fillStyle = P.ink; x.textAlign = 'center';
    x.fillText(opt.value, px + pw / 2, py - 6);
  }
}

/** Log-scale decade meter, for source and intermediate range flux. */
export function decadeMeter(x, px, py, pw, ph, value, decLo, decHi, opt = {}) {
  const v = Math.max(value, Math.pow(10, decLo));
  const lg = clamp(Math.log10(v), decLo, decHi);
  const f = (lg - decLo) / (decHi - decLo);
  cutout(x, px, py, pw, ph);
  for (let d = decLo; d <= decHi; d++) {
    const dy = py + ph * (1 - (d - decLo) / (decHi - decLo));
    x.strokeStyle = P.grid; x.lineWidth = 1;
    x.beginPath(); x.moveTo(px, dy); x.lineTo(px + pw, dy); x.stroke();
    x.font = '9px "JetBrains Mono", monospace'; x.fillStyle = P.dim2; x.textAlign = 'right';
    x.fillText('1e' + d, px - 5, dy + 3);
  }
  const dcol = opt.color || P.cyan;
  x.save();
  x.shadowColor = dcol; x.shadowBlur = 7;
  x.fillStyle = dcol;
  x.fillRect(px + 1, py + ph * (1 - f), pw - 2, ph * f);
  x.restore();
  if (opt.label) {
    x.font = '600 10px "Barlow Condensed", sans-serif'; x.fillStyle = P.dim; x.textAlign = 'center';
    x.fillText(opt.label, px + pw / 2, py + ph + 14);
  }
}

/** Multi-pane strip chart. panes = [{yr,ser:[[key,color,label]]}] */
export function stripChart(x, w, h, hist, panes, t0, t1) {
  const ph = (h - 4) / panes.length;
  panes.forEach((pn, pi) => {
    const T = pi * ph + 10, B = (pi + 1) * ph - 6, L = 58, R = w - 92;
    x.strokeStyle = P.grid; x.lineWidth = 1;
    x.font = '10px "JetBrains Mono", monospace'; x.fillStyle = P.dim2; x.textAlign = 'right';
    for (let i = 0; i <= 3; i++) {
      const y = B - (B - T) * i / 3, v = pn.yr[0] + (pn.yr[1] - pn.yr[0]) * i / 3;
      x.beginPath(); x.moveTo(L, y); x.lineTo(R, y); x.stroke();
      x.fillText(Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1), L - 7, y + 3);
    }
    const X = v => L + (R - L) * (v - t0) / Math.max(t1 - t0, 1);
    const Y = v => B - (B - T) * (clamp(v, pn.yr[0], pn.yr[1]) - pn.yr[0]) / (pn.yr[1] - pn.yr[0]);
    pn.ser.forEach((sd, si) => {
      const d = hist(sd[0]);
      if (d.length < 2) return;
      x.beginPath(); let started = false;
      for (const [tt, vv] of d) {
        if (tt < t0) continue;
        const pxx = X(tt), pyy = Y(vv);
        started ? x.lineTo(pxx, pyy) : (x.moveTo(pxx, pyy), started = true);
      }
      x.strokeStyle = sd[1]; x.lineWidth = 1.6; x.stroke();
      x.fillStyle = sd[1]; x.textAlign = 'left'; x.font = '10px "JetBrains Mono", monospace';
      x.fillText(sd[2], R + 8, T + 12 + si * 13);
    });
  });
}

// ---------------------------------------------------- mimic primitives
export function pipe(x, x0, y0, x1, y1, live, cur) {
  x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1);
  x.lineWidth = 3.5;
  x.strokeStyle = live ? `rgba(74,158,255,${0.35 + 0.6 * clamp(cur ?? 1, 0, 1)})` : P.dead;
  x.stroke();
}
export function breaker(x, cx, cy, closed, label) {
  x.lineWidth = 2;
  x.strokeStyle = closed ? P.red : P.green;
  x.fillStyle = closed ? 'rgba(224,80,58,.18)' : P.deadFill;
  x.beginPath(); x.rect(cx - 8, cy - 10, 16, 20); x.fill(); x.stroke();
  if (!closed) {
    x.beginPath(); x.moveTo(cx - 4, cy - 5); x.lineTo(cx + 4, cy + 5); x.stroke();
  }
  if (label) {
    x.font = '600 9.5px "Barlow Condensed", sans-serif'; x.fillStyle = P.dim2; x.textAlign = 'center';
    x.fillText(label, cx, cy + 22);
  }
}
export function tank(x, cx, cy, w, h, frac, color, label, sub) {
  cutout(x, cx - w / 2, cy - h / 2, w, h);
  const f = clamp(frac, 0, 1);
  x.fillStyle = color || P.blue;
  x.fillRect(cx - w / 2 + 1, cy + h / 2 - h * f, w - 2, h * f);
  x.textAlign = 'center';
  if (label) { x.font = '600 10px "Barlow Condensed", sans-serif'; x.fillStyle = P.dim;
    x.fillText(label, cx, cy - h / 2 - 8); }
  if (sub) { x.font = '10px "JetBrains Mono", monospace'; x.fillStyle = P.ink;
    x.fillText(sub, cx, cy + h / 2 + 15); }
}
/**
 * Running equipment is RED and stopped equipment is GREEN, which is US
 * practice and reads backwards to everyone who has not stood at one: red
 * means energised, open, running -- the state that can hurt you.  This drew
 * running pumps green while breaker() next to it drew closed breakers red,
 * so the same board taught two opposite conventions at once.
 */
export function pumpSym(x, cx, cy, r, running) {
  x.beginPath(); x.arc(cx, cy, r, 0, 7);
  x.fillStyle = running ? 'rgba(224,80,58,.18)' : P.deadFill;
  x.fill();
  x.strokeStyle = running ? P.red : P.green; x.lineWidth = 2; x.stroke();
  x.beginPath(); x.moveTo(cx - r * .5, cy); x.lineTo(cx + r * .5, cy);
  x.moveTo(cx, cy - r * .5); x.lineTo(cx, cy + r * .5);
  x.strokeStyle = running ? P.red : P.green; x.lineWidth = 1.5; x.stroke();
}
