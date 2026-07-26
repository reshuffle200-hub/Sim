// ======================================================================
//  kinetics.js — point reactor kinetics + decay heat
//
//  dn/dt   = (rho - beta)/Lambda * n + sum(lam_i * C_i) + S
//  dC_i/dt = beta_i/Lambda * n - lam_i * C_i
//
//  A source term is carried explicitly because the cold-shutdown start
//  depends on it: subcritical multiplication, 1/M plots and source range
//  indication all come from S, not from the flux.
//
//  Decay heat is a set of exponential groups fitted to the Way-Wigner
//  correlation for infinite irradiation, P/P0 = 0.0622 * t^-0.2.
//
//  IMPORTANT: decay heat is a SHARE of reactor power, not an addition to it.
//  At steady state roughly 8% of the heat comes from fission-product decay
//  and the rest promptly from fission, so
//        Ptot = P * (1 - DH_TOTAL) + Pdecay
//  and at equilibrium Pdecay = DH_TOTAL * P, giving Ptot = P exactly.
//  After a trip P collapses in seconds while Pdecay persists, so Ptot decays
//  to the decay-heat curve.  Adding the two instead ran the integrated plant
//  at 108.4% power and pushed it into saturation.
// ======================================================================

// U-235 thermal, six delayed groups.
export const BETA_I = [0.000215, 0.001424, 0.001274, 0.002568, 0.000748, 0.000273];
export const LAMBDA_I = [0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01];
export const BETA0 = BETA_I.reduce((a, b) => a + b, 0);   // 0.0065

// Decay-heat groups: fractions of full power and decay constants [1/s].
// Fitted below and checked against Way-Wigner in the test.
export const DH_F = [0.003739, 0.001559, 0.003165, 0.004927, 0.007852, 0.01238, 0.01985, 0.03055];
export const DH_L = [1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1.0];
export const DH_TOTAL = DH_F.reduce((a, b) => a + b, 0);   // ~0.084

export function makeKinetics(opt = {}) {
  const k = {
    Lambda: opt.Lambda ?? 2.0e-5,   // prompt neutron generation time, s
    beta:   opt.beta   ?? BETA0,    // effective delayed fraction
    betaI:  BETA_I.slice(),
    lamI:   LAMBDA_I.slice(),
    n:      opt.n ?? 1e-8,          // neutron population, fraction of rated
    C:      new Array(6).fill(0),
    S:      opt.S ?? 1e-12,         // source, fraction-of-rated per second
    // decay heat
    D:      new Array(DH_F.length).fill(0),
    P:      0,                      // fission power, fraction of rated
    Pdecay: 0,                      // decay heat, fraction of rated
    Ptot:   0,
    rho:    0,
    period: Infinity,
    dpm:    0                       // reactivity in pcm for display
  };
  // start with precursors in equilibrium with the current flux
  for (let i = 0; i < 6; i++) k.C[i] = k.betaI[i] * k.n / (k.lamI[i] * k.Lambda);
  return k;
}

/** Put the whole model in equilibrium at power level p (fraction of rated). */
export function equilibrate(k, p) {
  k.n = p;
  for (let i = 0; i < 6; i++) k.C[i] = k.betaI[i] * k.n / (k.lamI[i] * k.Lambda);
  for (let i = 0; i < DH_F.length; i++) k.D[i] = DH_F[i] * p;   // infinite irradiation
  k.P = p;
  k.Pdecay = k.D.reduce((a, b) => a + b, 0);
  k.Ptot = k.P * (1 - DH_TOTAL) + k.Pdecay;
  return k;
}

/**
 * Advance one step. rho is total reactivity (dk/k, so 0.0065 = 1 dollar).
 * Uses an implicit (backward Euler) update on n and C, which is stable at
 * the large time steps a plant simulator needs despite Lambda ~ 2e-5 s.
 */
export function stepKinetics(k, rho, dt) {
  k.rho = rho;
  const L = k.Lambda;

  // Backward Euler: solve the coupled system for n(t+dt).
  //   n  = [n0 + dt*(sum lam_i*C_i^{new}) + dt*S] / [1 - dt*(rho-beta)/L]
  //   C_i^{new} = (C_i + dt*beta_i/L * n) / (1 + dt*lam_i)
  // Substituting C into n gives a single linear equation in n.
  let num = k.n + dt * k.S;
  let den = 1 - dt * (rho - k.beta) / L;
  for (let i = 0; i < 6; i++) {
    const a = 1 + dt * k.lamI[i];
    num += dt * k.lamI[i] * k.C[i] / a;
    den -= dt * k.lamI[i] * (dt * k.betaI[i] / L) / a;
  }
  let n = num / den;
  if (!(n > 0) || !isFinite(n)) n = 1e-12;       // supercritical blow-up guard
  n = Math.min(n, 50);                            // 5000% — protection acts long before

  for (let i = 0; i < 6; i++) {
    k.C[i] = (k.C[i] + dt * k.betaI[i] / L * n) / (1 + dt * k.lamI[i]);
  }

  // reactor period from the observed rate of change
  const rate = (n - k.n) / Math.max(dt, 1e-9) / Math.max(n, 1e-30);
  k.period = Math.abs(rate) < 1e-9 ? Infinity : 1 / rate;
  k.n = n;
  k.P = n;

  // decay heat: each group is fed by fission and decays
  let pd = 0;
  for (let i = 0; i < DH_F.length; i++) {
    const src = DH_L[i] * DH_F[i] * k.P;         // production proportional to power
    k.D[i] = (k.D[i] + dt * src) / (1 + dt * DH_L[i]);
    pd += k.D[i];
  }
  k.Pdecay = pd;
  k.Ptot = k.P * (1 - DH_TOTAL) + k.Pdecay;
  k.dpm = rho / BETA0 * 100;                     // cents
  return k;
}

/** Stable reactor period from the inhour equation, for cross-checking. */
export function inhourPeriod(rho, Lambda = 2.0e-5, betaI = BETA_I, lamI = LAMBDA_I) {
  if (Math.abs(rho) < 1e-12) return Infinity;
  const f = w => {
    let s = Lambda * w;
    for (let i = 0; i < betaI.length; i++) s += betaI[i] * w / (w + lamI[i]);
    return s - rho;
  };
  // the stable root lies above -lam_min for rho>0, and between -lam_min and 0 for rho<0
  let lo, hi;
  if (rho > 0) { lo = 1e-9; hi = 1e5; }
  else { lo = -lamI[0] + 1e-9; hi = -1e-12; }
  let flo = f(lo);
  for (let i = 0; i < 200; i++) {
    const m = 0.5 * (lo + hi), fm = f(m);
    if (flo * fm <= 0) hi = m; else { lo = m; flo = fm; }
  }
  return 1 / (0.5 * (lo + hi));
}

/** Way-Wigner decay heat for infinite irradiation, fraction of rated. */
export function wayWigner(tSec) {
  if (tSec <= 0) return 0.0622;
  return 0.0622 * Math.pow(Math.max(tSec, 0.1), -0.2);
}

/** Subcritical steady flux for a given negative reactivity. n = -S*Lambda/rho */
export function subcriticalN(k, rho) {
  if (rho >= -1e-9) return Infinity;
  return -k.S * k.Lambda / rho;
}
