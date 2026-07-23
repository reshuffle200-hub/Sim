// ======================================================================
//  widgets.js — shared rendering helpers for every board
// ======================================================================
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
  x.fillStyle = '#0b1017';
  x.fillRect(px, py, pw, ph);
  const f = clamp(frac, 0, 1);
  x.fillStyle = opt.color || '#4a9eff';
  x.fillRect(px, py + ph * (1 - f), pw, ph * f);
  x.strokeStyle = 'rgba(255,255,255,.10)'; x.lineWidth = 1;
  x.strokeRect(px + .5, py + .5, pw - 1, ph - 1);
  (opt.marks || []).forEach(m => {
    const my = py + ph * (1 - clamp(m.at, 0, 1));
    x.strokeStyle = m.color || '#f85149'; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(px - 3, my); x.lineTo(px + pw + 3, my); x.stroke();
  });
  if (opt.label) {
    x.font = '10px Inter, sans-serif'; x.fillStyle = '#8b98a5'; x.textAlign = 'center';
    x.fillText(opt.label, px + pw / 2, py + ph + 14);
  }
  if (opt.value !== undefined) {
    x.font = '600 11px JetBrains Mono, monospace'; x.fillStyle = '#e6edf3'; x.textAlign = 'center';
    x.fillText(opt.value, px + pw / 2, py - 6);
  }
}

/** Log-scale decade meter, for source and intermediate range flux. */
export function decadeMeter(x, px, py, pw, ph, value, decLo, decHi, opt = {}) {
  const v = Math.max(value, Math.pow(10, decLo));
  const lg = clamp(Math.log10(v), decLo, decHi);
  const f = (lg - decLo) / (decHi - decLo);
  x.fillStyle = '#0b1017'; x.fillRect(px, py, pw, ph);
  for (let d = decLo; d <= decHi; d++) {
    const dy = py + ph * (1 - (d - decLo) / (decHi - decLo));
    x.strokeStyle = 'rgba(255,255,255,.07)'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(px, dy); x.lineTo(px + pw, dy); x.stroke();
    x.font = '9px JetBrains Mono, monospace'; x.fillStyle = '#5e6b7a'; x.textAlign = 'right';
    x.fillText('1e' + d, px - 5, dy + 3);
  }
  x.fillStyle = opt.color || '#39c5cf';
  x.fillRect(px, py + ph * (1 - f), pw, ph * f);
  x.strokeStyle = 'rgba(255,255,255,.10)'; x.strokeRect(px + .5, py + .5, pw - 1, ph - 1);
  if (opt.label) {
    x.font = '10px Inter, sans-serif'; x.fillStyle = '#8b98a5'; x.textAlign = 'center';
    x.fillText(opt.label, px + pw / 2, py + ph + 14);
  }
}

/** Multi-pane strip chart. panes = [{yr,ser:[[key,color,label]]}] */
export function stripChart(x, w, h, hist, panes, t0, t1) {
  const ph = (h - 4) / panes.length;
  panes.forEach((pn, pi) => {
    const T = pi * ph + 10, B = (pi + 1) * ph - 6, L = 58, R = w - 92;
    x.strokeStyle = 'rgba(255,255,255,.05)'; x.lineWidth = 1;
    x.font = '10px JetBrains Mono, monospace'; x.fillStyle = '#5e6b7a'; x.textAlign = 'right';
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
      x.fillStyle = sd[1]; x.textAlign = 'left'; x.font = '10px JetBrains Mono, monospace';
      x.fillText(sd[2], R + 8, T + 12 + si * 13);
    });
  });
}

// ---------------------------------------------------- mimic primitives
export function pipe(x, x0, y0, x1, y1, live, cur) {
  x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1);
  x.lineWidth = 3.5;
  x.strokeStyle = live ? `rgba(74,158,255,${0.35 + 0.6 * clamp(cur ?? 1, 0, 1)})` : '#2a3441';
  x.stroke();
}
export function breaker(x, cx, cy, closed, label) {
  x.lineWidth = 2;
  x.strokeStyle = closed ? '#f85149' : '#3fb950';
  x.fillStyle = closed ? 'rgba(248,81,73,.18)' : '#131a22';
  x.beginPath(); x.rect(cx - 8, cy - 10, 16, 20); x.fill(); x.stroke();
  if (!closed) {
    x.beginPath(); x.moveTo(cx - 4, cy - 5); x.lineTo(cx + 4, cy + 5); x.stroke();
  }
  if (label) {
    x.font = '9px Inter, sans-serif'; x.fillStyle = '#5e6b7a'; x.textAlign = 'center';
    x.fillText(label, cx, cy + 22);
  }
}
export function tank(x, cx, cy, w, h, frac, color, label, sub) {
  x.fillStyle = '#0b1017'; x.fillRect(cx - w / 2, cy - h / 2, w, h);
  const f = clamp(frac, 0, 1);
  x.fillStyle = color || '#4a9eff';
  x.fillRect(cx - w / 2, cy + h / 2 - h * f, w, h * f);
  x.strokeStyle = 'rgba(255,255,255,.14)'; x.lineWidth = 1;
  x.strokeRect(cx - w / 2 + .5, cy - h / 2 + .5, w - 1, h - 1);
  x.textAlign = 'center';
  if (label) { x.font = '600 10px Inter, sans-serif'; x.fillStyle = '#8b98a5';
    x.fillText(label, cx, cy - h / 2 - 8); }
  if (sub) { x.font = '10px JetBrains Mono, monospace'; x.fillStyle = '#e6edf3';
    x.fillText(sub, cx, cy + h / 2 + 15); }
}
export function pumpSym(x, cx, cy, r, running) {
  x.beginPath(); x.arc(cx, cy, r, 0, 7);
  x.fillStyle = running ? 'rgba(63,185,80,.18)' : '#131a22';
  x.fill();
  x.strokeStyle = running ? '#3fb950' : '#3a4552'; x.lineWidth = 2; x.stroke();
  x.beginPath(); x.moveTo(cx - r * .5, cy); x.lineTo(cx + r * .5, cy);
  x.moveTo(cx, cy - r * .5); x.lineTo(cx, cy + r * .5);
  x.strokeStyle = running ? '#3fb950' : '#3a4552'; x.lineWidth = 1.5; x.stroke();
}
