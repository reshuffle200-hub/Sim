// ======================================================================
//  props.js — fast water/steam property lookup for real-time use
//
//  The global pressure solve evaluates v(P,h) for every node at every
//  iteration -- order 1000 evaluations per timestep -- so the full IAPWS
//  routines are far too slow there.
//
//  Naive bilinear tabulation of v(P,h) FAILS: specific volume has a sharp
//  kink at hf and a second at hg, and at low pressure v jumps three orders
//  of magnitude across the two-phase region.  Interpolating across those
//  boundaries gave 200%+ errors.
//
//  Fix: use a NORMALISED enthalpy coordinate so the phase boundaries land
//  exactly on grid lines, and compute the two-phase region analytically
//  from a 1-D saturation table rather than tabulating it at all.
//        s = h/hf        in [0,1]   subcooled
//        s = 1 + x       in [1,2]   two-phase  (analytic, never tabulated)
//        s = 2 + (h-hg)/hg in [2,3] superheated
// ======================================================================

import * as ST from './steam.js?v=0.27.1';

const NP = 120;                       // pressure points
const NS = 60;                        // normalised-enthalpy points per region
const PMIN = 14.7, PMAX = 3150;

const lpMin = Math.log(PMIN), lpMax = Math.log(PMAX);
const pOf  = i => Math.exp(lpMin + (lpMax - lpMin) * i / (NP - 1));
const iOfP = p => (Math.log(Math.min(Math.max(p, PMIN), PMAX)) - lpMin) / (lpMax - lpMin) * (NP - 1);

// 1-D saturation tables
const SAT_T = new Float64Array(NP), SAT_HF = new Float64Array(NP), SAT_HG = new Float64Array(NP);
const SAT_VF = new Float64Array(NP), SAT_VG = new Float64Array(NP);
// 2-D tables on normalised coordinates
const SUB_V = new Float64Array(NP * NS), SUB_T = new Float64Array(NP * NS);
const SUP_V = new Float64Array(NP * NS), SUP_T = new Float64Array(NP * NS);
const SUP_SPAN = 1.6;                 // superheat coordinate runs 0..SUP_SPAN

for (let i = 0; i < NP; i++) {
  const psia = pOf(i), Pm = ST.MPa_from_psi(psia);
  const Ts = ST.Tsat(Pm);
  SAT_T[i]  = ST.F_from_K(Ts);
  SAT_HF[i] = ST.BTUlb_from_Jkg(ST.hf(Ts));
  SAT_HG[i] = ST.BTUlb_from_Jkg(ST.hg(Ts));
  SAT_VF[i] = ST.ft3lb_from_m3kg(1 / ST.rhof(Ts));
  SAT_VG[i] = ST.ft3lb_from_m3kg(1 / ST.rhog(Ts));
  for (let j = 0; j < NS; j++) {
    const f = j / (NS - 1);
    // subcooled: h from 0 to hf
    const hs = f * SAT_HF[i];
    const Tl = ST.TfromH(Pm, ST.Jkg_from_BTUlb(Math.max(hs, 1)));
    SUB_V[i * NS + j] = ST.ft3lb_from_m3kg(ST.vLiq(Pm, Tl));
    SUB_T[i * NS + j] = ST.F_from_K(Tl);
    // superheated: square-law spacing so points bunch up near saturation,
    // where v changes fastest and linear spacing gave ~10% error
    const hv = SAT_HG[i] * (1 + f * f * SUP_SPAN);
    const Tv = ST.TvapFromH(Pm, ST.Jkg_from_BTUlb(hv));
    SUP_V[i * NS + j] = ST.ft3lb_from_m3kg(ST.vVap(Pm, Tv));
    SUP_T[i * NS + j] = ST.F_from_K(Tv);
  }
}

/**
 * The pressure index, computed ONCE and reused.
 *
 * iOfP is a Math.log, and it was being paid for over and over: vPH calls hfP
 * and hgP to find the region, then either lerp2 or vfP+vgP to get the answer --
 * five logarithms to look up one specific volume, all at the same pressure.
 * TPH and xPH do the same.  Steam properties were 60% of total simulation time
 * and most of that was recomputing an index that had not changed.
 *
 * The index lives in module scratch rather than a returned object because
 * these are called tens of thousands of times per second and the allocation
 * showed up as garbage collection.  Nothing here is reentrant and nothing
 * yields, so a single set of scratch values is safe.
 *
 * The last pressure is cached as well.  Consecutive queries overwhelmingly ask
 * about the same node at the same pressure, so the common case skips the
 * logarithm entirely.
 */
let _i0 = 0, _a = 0, _lastP = NaN;

function setP(p) {
  if (p === _lastP) return;
  _lastP = p;
  const fi = iOfP(p);
  _i0 = Math.min(NP - 2, Math.floor(fi));
  _a = fi - _i0;
}

// interpolate with the index already set
function at1(tbl) {
  return (1 - _a) * tbl[_i0] + _a * tbl[_i0 + 1];
}
function at2(tbl, f) {
  const fj = (f < 0 ? 0 : f > 1 ? 1 : f) * (NS - 1);
  const j0 = Math.min(NS - 2, Math.floor(fj)), b = fj - j0;
  const k0 = _i0 * NS + j0, k1 = k0 + NS;
  return (1 - _a) * ((1 - b) * tbl[k0] + b * tbl[k0 + 1])
       +      _a  * ((1 - b) * tbl[k1] + b * tbl[k1 + 1]);
}

function lerp1(tbl, p) { setP(p); return at1(tbl); }
function lerp2(tbl, p, f) { setP(p); return at2(tbl, f); }

export const TsatP = p => lerp1(SAT_T, p);
export const hfP   = p => lerp1(SAT_HF, p);
export const hgP   = p => lerp1(SAT_HG, p);
export const vfP   = p => lerp1(SAT_VF, p);
export const vgP   = p => lerp1(SAT_VG, p);

/** Specific volume [ft3/lbm] from pressure [psia] and enthalpy [Btu/lbm]. */
export function vPH(p, h) {
  setP(p);
  const hf = at1(SAT_HF), hg = at1(SAT_HG);
  if (h <= hf) return at2(SUB_V, hf > 0 ? h / hf : 0);
  if (h >= hg) return at2(SUP_V, Math.sqrt((h / hg - 1) / SUP_SPAN));
  const x = (h - hf) / (hg - hf);                    // two-phase: analytic
  const vf = at1(SAT_VF);
  return vf + x * (at1(SAT_VG) - vf);
}
/** Temperature [degF] from pressure and enthalpy. */
export function TPH(p, h) {
  setP(p);
  const hf = at1(SAT_HF), hg = at1(SAT_HG);
  if (h <= hf) return at2(SUB_T, hf > 0 ? h / hf : 0);
  if (h >= hg) return at2(SUP_T, Math.sqrt((h / hg - 1) / SUP_SPAN));
  return at1(SAT_T);
}
/** Quality: -1 subcooled, 0..1 two-phase, 2 superheated. */
export function xPH(p, h) {
  setP(p);
  const hf = at1(SAT_HF), hg = at1(SAT_HG);
  if (h <= hf) return -1;
  if (h >= hg) return 2;
  return (h - hf) / (hg - hf);
}
/** Void fraction (homogeneous). */
export function alphaPH(p, h) {
  setP(p);
  const hf = at1(SAT_HF), hg = at1(SAT_HG);
  if (h <= hf) return 0;
  if (h >= hg) return 1;
  const x = (h - hf) / (hg - hf), vf = at1(SAT_VF), vg = at1(SAT_VG);
  const v = vf + x * (vg - vf);
  return Math.max(0, Math.min(1, (v - vf) / (vg - vf)));
}
/** Specific volume from pressure and specific INTERNAL energy. */
export function vPU(p, u) {
  const c = p * 144 / 778.169;
  let v = vPH(p, u + c * 0.02);
  v = vPH(p, u + c * v);
  return vPH(p, u + c * v);
}
export const hFromU = (p, u) => u + p * 144 * vPU(p, u) / 778.169;

// --- saturated liquid properties as a function of TEMPERATURE -------------
// Feedwater, condensate and RHR all need h(T) for compressed liquid, where
// enthalpy is very close to the saturated value at the same temperature.
// A crude polynomial is not good enough: at 440 F it was 26 Btu/lbm high,
// which unbalanced the steam generator energy balance by 3% and drove the
// secondary pressure 200 psi off design.
const NT = 240, TMIN = 60, TMAX = 700;
const HF_T = new Float64Array(NT), PS_T = new Float64Array(NT), VF_T = new Float64Array(NT);
for (let i = 0; i < NT; i++) {
  const TF = TMIN + (TMAX - TMIN) * i / (NT - 1);
  const Tk = ST.K_from_F(TF);
  PS_T[i] = ST.psi_from_MPa(ST.Psat(Tk));
  HF_T[i] = ST.BTUlb_from_Jkg(ST.hf(Tk));
  VF_T[i] = ST.ft3lb_from_m3kg(1 / ST.rhof(Tk));
}
function lerpT(tbl, TF) {
  const f = (Math.min(Math.max(TF, TMIN), TMAX) - TMIN) / (TMAX - TMIN) * (NT - 1);
  const i0 = Math.min(NT - 2, Math.floor(f)), a = f - i0;
  return (1 - a) * tbl[i0] + a * tbl[i0 + 1];
}
/** Saturated liquid enthalpy [Btu/lbm] at temperature [degF]. */
export const hfT = TF => lerpT(HF_T, TF);
/** Saturation pressure [psia] at temperature [degF]. */
export const PsatT = TF => lerpT(PS_T, TF);
/** Saturated liquid specific volume [ft3/lbm] at temperature [degF]. */
export const vfT = TF => lerpT(VF_T, TF);
/** Liquid temperature [degF] from enthalpy [Btu/lbm]. */
export function TfromHf(h) {
  let lo = TMIN, hi = TMAX;
  for (let i = 0; i < 40; i++) { const m = 0.5 * (lo + hi); if (hfT(m) < h) lo = m; else hi = m; }
  return 0.5 * (lo + hi);
}
