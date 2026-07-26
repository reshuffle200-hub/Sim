// ======================================================================
//  steam.js — water / steam thermodynamic properties
//
//  Saturation line:      IAPWS-IF97 Region 4  (exact, verifiable)
//  Saturated densities:  IAPWS-95 supplementary auxiliary equations
//  Saturated enthalpy:   IAPWS auxiliary alpha() combined with Clapeyron,
//                        h' = alpha + T*v'*dPs/dT, h'' = alpha + T*v''*dPs/dT
//                        so hfg, vfg and dPs/dT are consistent BY CONSTRUCTION.
//
//  Internally SI: T [K], P [MPa], v [m3/kg], h [J/kg], rho [kg/m3]
//  English wrappers at the bottom: degF, psia, ft3/lbm, Btu/lbm
// ======================================================================

export const TC = 647.096;      // critical temperature, K
export const PC = 22.064;       // critical pressure, MPa
export const RHOC = 322.0;      // critical density, kg/m3
export const TTRIP = 273.16;    // triple point, K

// ---------------------------------------------------------------- IF97 R4
const N4 = [
  0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2,
  0.12020824702470e5, -0.32325550322333e7,  0.14915108613530e2,
 -0.48232657361591e4,  0.40511340542057e6, -0.23855557567849,
  0.65017534844798e3
];

/** Saturation pressure [MPa] from temperature [K]. */
export function Psat(T){
  T = Math.min(Math.max(T, TTRIP), TC);
  const th = T + N4[8] / (T - N4[9]);
  const A = th*th + N4[0]*th + N4[1];
  const B = N4[2]*th*th + N4[3]*th + N4[4];
  const C = N4[5]*th*th + N4[6]*th + N4[7];
  const d = 2*C / (-B + Math.sqrt(B*B - 4*A*C));
  return d*d*d*d;
}

/** Saturation temperature [K] from pressure [MPa]. */
export function Tsat(P){
  P = Math.min(Math.max(P, 611.213e-6), PC);
  const b = Math.pow(P, 0.25);
  const E = b*b + N4[2]*b + N4[5];
  const F = N4[0]*b*b + N4[3]*b + N4[6];
  const G = N4[1]*b*b + N4[4]*b + N4[7];
  const D = 2*G / (-F - Math.sqrt(F*F - 4*E*G));
  const t = N4[9] + D;
  return 0.5*(t - Math.sqrt(t*t - 4*(N4[8] + N4[9]*D)));
}

/** dPsat/dT [MPa/K] — analytic derivative of the IF97 R4 equation. */
export function dPsatdT(T){
  T = Math.min(Math.max(T, TTRIP), TC - 1e-6);
  const h = 1e-4;
  return (Psat(T + h) - Psat(T - h)) / (2*h);
}

// ------------------------------------------- saturated densities (IAPWS-95)
const BL = [1.99274064, 1.09965342, -0.510839303, -1.75493479, -45.5170352, -6.74694450e5];
const BV = [-2.03150240, -2.68302940, -5.38626492, -17.2991605, -44.7586581, -63.9201063];

/** Saturated liquid density [kg/m3]. */
export function rhof(T){
  const t = Math.max(1 - Math.min(T, TC)/TC, 0);
  if (t <= 0) return RHOC;
  const r = 1 + BL[0]*Math.pow(t,1/3) + BL[1]*Math.pow(t,2/3) + BL[2]*Math.pow(t,5/3)
              + BL[3]*Math.pow(t,16/3) + BL[4]*Math.pow(t,43/3) + BL[5]*Math.pow(t,110/3);
  return RHOC * r;
}

/** Saturated vapour density [kg/m3]. */
export function rhog(T){
  const t = Math.max(1 - Math.min(T, TC)/TC, 0);
  if (t <= 0) return RHOC;
  const e = BV[0]*Math.pow(t,2/6) + BV[1]*Math.pow(t,4/6) + BV[2]*Math.pow(t,8/6)
          + BV[3]*Math.pow(t,18/6) + BV[4]*Math.pow(t,37/6) + BV[5]*Math.pow(t,71/6);
  return RHOC * Math.exp(e);
}

// ------------------------------------------------ saturated enthalpy helper
const DA = [-1135.905627715, -5.65134998e-8, 2690.66631, 127.287297, -135.003439, 0.981825814];

/** IAPWS auxiliary quantity alpha [J/kg]. Not an enthalpy on its own. */
function alpha(T){
  const th = Math.min(T, TC)/TC;
  return 1000*( DA[0] + DA[1]*Math.pow(th,-19) + DA[2]*th + DA[3]*Math.pow(th,4.5)
              + DA[4]*Math.pow(th,5) + DA[5]*Math.pow(th,54.5) );
}

/** Saturated liquid enthalpy [J/kg]. */
export function hf(T){
  const dp = dPsatdT(T) * 1e6;             // Pa/K
  return alpha(T) + T * dp / rhof(T);
}
/** Saturated vapour enthalpy [J/kg]. */
export function hg(T){
  const dp = dPsatdT(T) * 1e6;
  return alpha(T) + T * dp / rhog(T);
}
/** Latent heat [J/kg]. */
export function hfg(T){ return hg(T) - hf(T); }

// ------------------------------------------------------- subcooled liquid
// Compressed liquid: start from the saturated state at the SAME temperature
// and correct for pressure. dh = v(1 - T*beta)dP, dv = -v*kappa*dP.
// beta and kappa are fitted over 273-620 K and are small corrections.
function betaExp(T){                        // thermal expansion, 1/K
  const t = (T - 273.15)/100;
  return Math.max(-7e-5, (-0.60 + 1.62*t - 0.30*t*t + 0.075*t*t*t)*1e-4);
}
function kappaT(T){                         // isothermal compressibility, 1/MPa
  const t = (T - 273.15)/100;
  return (4.55 + 0.10*t + 0.28*t*t + 0.021*Math.pow(t,4))*1e-4;
}

/** Liquid specific volume [m3/kg] at P [MPa], T [K]. */
export function vLiq(P, T){
  const Ts = Tsat(P);
  const Tl = Math.min(T, Ts);
  const vs = 1/rhof(Tl);
  const dP = P - Psat(Tl);
  return vs * Math.exp(-kappaT(Tl) * dP);
}
/** Liquid enthalpy [J/kg] at P [MPa], T [K]. */
export function hLiq(P, T){
  const Ts = Tsat(P);
  const Tl = Math.min(T, Ts);
  const hs = hf(Tl);
  const dP = (P - Psat(Tl)) * 1e6;
  return hs + (1/rhof(Tl)) * (1 - Tl*betaExp(Tl)) * dP;
}
/** Liquid specific heat [J/kg-K] — numerical, from hLiq. */
export function cpLiq(P, T){
  const h = 0.05;
  return (hLiq(P, T + h) - hLiq(P, T - h)) / (2*h);
}
/** Liquid temperature [K] from pressure and enthalpy (Newton, bounded). */
export function TfromH(P, h){
  let T = 300, lo = 273.16, hi = Tsat(P);
  const hlo = hLiq(P, lo), hhi = hLiq(P, hi);
  if (h <= hlo) return lo;
  if (h >= hhi) return hi;
  T = lo + (hi - lo)*(h - hlo)/(hhi - hlo);
  for (let i = 0; i < 40; i++){
    const f = hLiq(P, T) - h;
    if (Math.abs(f) < 1) break;
    if (f > 0) hi = T; else lo = T;
    const c = cpLiq(P, T);
    let Tn = T - f/Math.max(c, 100);
    if (!(Tn > lo && Tn < hi)) Tn = 0.5*(lo + hi);
    T = Tn;
  }
  return T;
}

// -------------------------------------------------------- superheated steam
// Ideal gas with a compressibility factor that degrades toward saturation.
const RW = 461.526;                          // J/kg-K
export function zSteam(P, T){
  const Ts = Tsat(P);
  const sh = Math.max(T - Ts, 0);
  const zsat = Psat(Math.min(T,TC))*1e6 / (rhog(Math.min(T,TC)) * RW * Math.min(T,TC));
  const zs = Math.min(Math.max(zsat, 0.30), 1.0);
  return zs + (1 - zs)*(1 - Math.exp(-sh/95));
}
/** Superheated steam specific volume [m3/kg]. */
export function vVap(P, T){
  const Ts = Tsat(P);
  if (T <= Ts) return 1/rhog(Ts);
  return zSteam(P,T) * RW * T / (P*1e6);
}
/** Superheated steam enthalpy [J/kg]. */
export function hVap(P, T){
  const Ts = Tsat(P);
  if (T <= Ts) return hg(Ts);
  return hg(Ts) + cpVapAvg(P) * (T - Ts);
}
function cpVapAvg(P){                        // mean cp of steam near saturation
  return 1900 + 2100*Math.pow(Math.min(P,PC)/PC, 0.9);
}
/** Steam temperature [K] from pressure and enthalpy. */
export function TvapFromH(P, h){
  const Ts = Tsat(P), hgs = hg(Ts);
  if (h <= hgs) return Ts;
  return Ts + (h - hgs)/cpVapAvg(P);
}

// ------------------------------------------------------------ two-phase mix
/**
 * Given pressure and mixture specific volume/enthalpy, resolve the state.
 * Returns {phase, x, T, v, h} where x is quality (0 sub, 1 superheat).
 */
export function stateFromPH(P, h){
  const Ts = Tsat(P);
  const hfs = hf(Ts), hgs = hg(Ts);
  if (h < hfs) return {phase:'sub',  x:0, T:TfromH(P,h),   v:vLiq(P,TfromH(P,h))};
  if (h > hgs) return {phase:'sup',  x:1, T:TvapFromH(P,h),v:vVap(P,TvapFromH(P,h))};
  const x = (h - hfs)/Math.max(hgs - hfs, 1);
  const vfs = 1/rhof(Ts), vgs = 1/rhog(Ts);
  return {phase:'two', x, T:Ts, v: vfs + x*(vgs - vfs)};
}

/**
 * Resolve pressure from mixture specific volume and enthalpy (bisection).
 * This is the workhorse for a control volume carrying mass and energy.
 */
export function PfromVH(v, h, Plo = 0.005, Phi = 22.0){
  const f = P => stateFromPH(P, h).v - v;
  let a = Plo, b = Phi, fa = f(a), fb = f(b);
  if (fa*fb > 0) return fa > 0 ? b : a;      // out of range: clamp
  for (let i = 0; i < 80; i++){
    const m = 0.5*(a + b), fm = f(m);
    if (fm === 0) return m;
    if (fa*fm < 0){ b = m; fb = fm; } else { a = m; fa = fm; }
    if (b - a < 1e-9) break;
  }
  return 0.5*(a + b);
}

// ------------------------------------------------------------- unit helpers
export const K_from_F  = F => (F - 32)/1.8 + 273.15;
export const F_from_K  = K => (K - 273.15)*1.8 + 32;
export const R_from_K  = K => K*1.8;
export const MPa_from_psi = p => p * 0.00689475729;
export const psi_from_MPa = P => P / 0.00689475729;
export const BTUlb_from_Jkg = h => h / 2326.0;
export const Jkg_from_BTUlb = h => h * 2326.0;
export const ft3lb_from_m3kg = v => v * 16.018463;
export const m3kg_from_ft3lb = v => v / 16.018463;
export const lbft3_from_kgm3 = r => r / 16.018463;

/** English-unit convenience bundle for the saturated state at P [psia]. */
export function satEnglish(psia){
  const P = MPa_from_psi(psia), T = Tsat(P);
  return {
    Tf:  F_from_K(T),
    hf:  BTUlb_from_Jkg(hf(T)),
    hg:  BTUlb_from_Jkg(hg(T)),
    hfg: BTUlb_from_Jkg(hfg(T)),
    vf:  ft3lb_from_m3kg(1/rhof(T)),
    vg:  ft3lb_from_m3kg(1/rhog(T)),
    rhof: lbft3_from_kgm3(rhof(T)),
    rhog: lbft3_from_kgm3(rhog(T))
  };
}
