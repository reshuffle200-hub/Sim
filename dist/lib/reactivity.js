// ======================================================================
//  reactivity.js — reactivity balance for a Westinghouse 3-loop core, MOL
//
//  Total rho = excess + Doppler + moderator + boron + rods + Xe + Sm
//
//  The moderator and boron terms are BOTH driven by moderator density,
//  which is what makes MTC behave correctly across the full range:
//    - hot, moderate boron  -> MTC strongly negative
//    - cold, high boron     -> MTC near zero or positive, because heating
//                              expels boron faster than it costs moderation
//  That coupling is why the cold startup behaves the way it does, so it is
//  modelled explicitly rather than as a tabulated MTC.
//
//  CALIBRATION SOURCE: anchored to the NRC Westinghouse Technology Systems
//  Manual, Section 2.1 "Reactor Physics Review" (ML11223A207):
//     MTC at 500 F, 0 ppm    = -17 pcm/F          (Fig 2.1-8)
//     MTC at 500 F, 500 ppm  =  -8 pcm/F          (Fig 2.1-8)
//     MTC turns positive above about 1400 ppm     (Sect 2.1.6.2)
//     Doppler-only power defect, 0-100%  ~ -1500 pcm   (Fig 2.1-7)
//     Total power defect, 0-100%  -1500 to -2500 pcm BOL->EOL (Fig 2.1-10)
//     Fuel temperature rise 0-100%: ~1000 F BOL, ~800 F EOL
//     Samarium equilibrium  = -650 pcm                 (Sect 2.1.7.1)
//     Xenon peaks 8-9 h after trip, envelope to -5500 pcm (Fig 2.1-14/15)
//  The moderator term is taken linear in density; the non-linearity of MTC
//  with temperature then falls out of the density curve itself, which is
//  the mechanism the NRC text describes.  Still a fit, not lattice physics.
// ======================================================================

import * as ST from './steam.js?v=0.27.0';

export const PCM = 1e-5;                 // 1 pcm in dk/k

// ------------------------------------------------------------ core config
export function coreParams(life = 'MOL') {
  const P = {
    life,
    // --- reference (design) state: HFP, equilibrium Xe/Sm, D bank at 220 ---
    TmodRefF: 577.0,        // Tavg at 100% power, degF (sliding Tavg program)
    TmodHZPF: 547.0,        // Tavg at zero power
    PrefPsia: 2250,
    TfuelRefF: 1447,        // average fuel temperature at 100% power (+900 F)
    TfuelHZPF: 547.0,       // fuel temperature at zero power = moderator

    // --- Doppler: rho = -KD*(sqrt(Tf) - sqrt(Tf_hzp)) ---
    KD: 0,                  // set below from the wanted Doppler defect
    dopplerDefect: 1500,    // pcm, zero power -> full power  (NRC Fig 2.1-7)

    // --- moderator density curve: rho_mod = a1*u + a2*u^2, u = dm/dmRef - 1 ---
    a1: 0, a2: 0,
    // NRC anchors used to solve for a1, a2 and the boron worth
    mtc500_0ppm:   -17.0,   // pcm/degF at 500 F, 0 ppm
    mtc500_500ppm:  -8.0,   // pcm/degF at 500 F, 500 ppm
    mtcZeroPpm:   1400,     // ppm at which MTC crosses zero at Tavg(HFP)

    // --- boron --- (solved in calibrate(), not assumed)
    boronWorthHot: -10.0,

    // --- rods: 6 banks, 228 steps each, 128-step overlap on the control banks
    stepsPerBank: 228,
    overlap: 128,
    ctrlBankWorth: [420, 460, 480, 300],   // pcm, banks A B C D fully inserted
    sdBankWorth:   [1900, 1900],           // pcm, shutdown banks A B

    // --- fission products ---
    xeEqWorth: -2700,       // pcm at 100% power equilibrium
    smEqWorth: -650,        // pcm equilibrium (NRC 2.1.7.1)
    lamI: 2.9e-5,           // I-135 decay, 1/s  (T1/2 6.65 h)
    lamX: 2.1e-5,           // Xe-135 decay, 1/s (T1/2 9.17 h)
    sigX: 7.95e-5,          // Xe burnout at 100% power, 1/s
    gI: 0.0639, gX: 0.00237,
    lamPm: 3.6e-6,          // Pm-149 decay, 1/s (T1/2 53.1 h)
    sigSm: 1.05e-5,         // Sm burnout at 100% power, 1/s
    gPm: 0.01071,

    excess: 0,              // calibrated so the reference state is critical
    critBoronRef: 750       // ppm at the reference state
  };

  // The moderator density curve does NOT move with burnup -- it is a property
  // of the lattice.  What changes with cycle life is the boron concentration
  // and the fuel-clad gap (hence the fuel temperature rise).  MTC therefore
  // becomes strongly negative at EOL purely because the boron is gone, which
  // is the mechanism the NRC text describes.
  if (life === 'BOL') { P.critBoronRef = 1300; P.TfuelRefF = 1547; P.dopplerDefect = 1600; }
  if (life === 'EOL') { P.critBoronRef = 30;   P.TfuelRefF = 1347; P.dopplerDefect = 1400; }

  calibrate(P);
  return P;
}

/** Moderator density [lbm/ft3] at temperature and pressure. */
export function modDensity(Tf, psia) {
  const P = ST.MPa_from_psi(psia);
  const T = ST.K_from_F(Tf);
  const Ts = ST.Tsat(P);
  const v = ST.vLiq(P, Math.min(T, Ts - 0.01));
  return 1 / ST.ft3lb_from_m3kg(v);
}

function calibrate(P) {
  // Doppler constant from the published defect
  P.KD = P.dopplerDefect / (Math.sqrt(P.TfuelRefF) - Math.sqrt(P.TfuelHZPF));

  P.dmRef = modDensity(P.TmodRefF, P.PrefPsia);

  // du/dT at the two anchor temperatures
  const h = 0.5;
  const dudT = T => (modDensity(T + h, P.PrefPsia) - modDensity(T - h, P.PrefPsia)) / (2 * h) / P.dmRef;
  const d500 = dudT(500), dRef = dudT(P.TmodRefF);
  const u500 = modDensity(500, P.PrefPsia) / P.dmRef - 1;
  const uRef = 0;

  // (1) boron slope: MTC(500,500ppm) - MTC(500,0ppm) = 500 * bW * du/dT(500)
  P.boronWorthHot = (P.mtc500_500ppm - P.mtc500_0ppm) / (500 * d500);

  // (2) MTC_0(500) = (a1 + 2*a2*u500) * du/dT(500) = mtc500_0ppm
  // (3) MTC(Tref, mtcZeroPpm) = 0
  //     (a1 + 2*a2*uRef)*dRef + mtcZeroPpm*bW*dRef = 0
  //   -> a1 + 2*a2*uRef = -mtcZeroPpm*bW
  const A = P.mtc500_0ppm / d500;                 // a1 + 2*a2*u500
  const B = -P.mtcZeroPpm * P.boronWorthHot;      // a1 + 2*a2*uRef  (uRef = 0 -> a1)
  P.a1 = B;
  P.a2 = (A - P.a1) / (2 * u500);

  // excess reactivity so the reference state is exactly critical
  const st = {
    TmodF: P.TmodRefF, psia: P.PrefPsia, TfuelF: P.TfuelRefF,
    ppm: P.critBoronRef, banks: fullOutBanks(P), X: 1, Sm: 1
  };
  st.banks.ctrlDemand = 3 * (P.stepsPerBank - P.overlap) + P.stepsPerBank - 8;
  P.excess = 0;
  P.excess = -total(P, st).pcm;
  return P;
}

// ----------------------------------------------------------------- rods
export function fullOutBanks(P) {
  return {
    ctrlDemand: 3 * (P.stepsPerBank - P.overlap) + P.stepsPerBank,   // 3*100 + 228 = 528
    sd: [P.stepsPerBank, P.stepsPerBank]
  };
}
export function fullInBanks(P) {
  return { ctrlDemand: 0, sd: [0, 0] };
}

/** Individual control bank positions [steps withdrawn] from the demand counter. */
export function bankPositions(P, ctrlDemand) {
  const S = P.stepsPerBank, ov = P.overlap, lead = S - ov;   // 100 steps
  const pos = [];
  for (let i = 0; i < 4; i++) {
    pos.push(Math.max(0, Math.min(S, ctrlDemand - i * lead)));
  }
  return pos;
}

/**
 * Integral worth of a bank, as a fraction of its total worth, for a given
 * withdrawal in steps. S-shaped: differential worth is chopped-cosine, so
 * the integral is x/L - sin(2*pi*x/L)/(2*pi).
 */
export function bankIntegral(stepsOut, S) {
  const x = Math.max(0, Math.min(1, stepsOut / S));
  return x - Math.sin(2 * Math.PI * x) / (2 * Math.PI);
}

/** Rod reactivity [pcm], negative. Zero when everything is fully withdrawn. */
export function rodWorth(P, banks) {
  let w = 0;
  const pos = bankPositions(P, banks.ctrlDemand);
  for (let i = 0; i < 4; i++) {
    w += P.ctrlBankWorth[i] * (bankIntegral(pos[i], P.stepsPerBank) - 1);
  }
  for (let i = 0; i < 2; i++) {
    w += P.sdBankWorth[i] * (bankIntegral(banks.sd[i], P.stepsPerBank) - 1);
  }
  return w;
}

/** Total worth available if every rod dropped from the present position. */
export function shutdownMargin(P, banks) {
  return rodWorth(P, fullInBanks(P)) - rodWorth(P, banks);
}

// -------------------------------------------------------- fission products
export function makeFP() { return { I: 1, X: 1, Pm: 1, Sm: 1 }; }

/**
 * Equilibrium chains at power p (fraction of rated), normalised so that
 * I = X = Pm = Sm = 1 at 100% power.
 *   x_eq(p) = (lamX + sigX) * p / (lamX + sigX * p)
 *   sm_eq   = 1 for any p > 0  (the classic flux-independent result)
 */
export function equilibrateFP(P, fp, p) {
  fp.I = p;
  fp.X = (P.lamX + P.sigX) * p / (P.lamX + P.sigX * p);
  fp.Pm = p;
  fp.Sm = p > 1e-6 ? 1 : fp.Sm;
  return fp;
}

/**
 * Advance the chains.  Normalised form, derived from
 *   dI/dt = gI*Sf*phi - lamI*I
 *   dX/dt = gX*Sf*phi + lamI*I - lamX*X - sigX*phi*X
 *   dPm/dt = gPm*Sf*phi - lamPm*Pm
 *   dSm/dt = lamPm*Pm - sigSm*phi*Sm
 * Implicit in the loss terms so long time steps stay stable.
 */
export function stepFP(P, fp, p, dt) {
  const g = P.gI / (P.gI + P.gX), gx = P.gX / (P.gI + P.gX);
  const kXB = P.lamX + P.sigX;

  fp.I = (fp.I + dt * P.lamI * p) / (1 + dt * P.lamI);
  const prodX = kXB * (gx * p + g * fp.I);
  fp.X = (fp.X + dt * prodX) / (1 + dt * (P.lamX + P.sigX * p));
  fp.Pm = (fp.Pm + dt * P.lamPm * p) / (1 + dt * P.lamPm);
  fp.Sm = (fp.Sm + dt * P.sigSm * fp.Pm) / (1 + dt * P.sigSm * p);

  fp.I = Math.max(fp.I, 0); fp.X = Math.max(fp.X, 0);
  fp.Pm = Math.max(fp.Pm, 0); fp.Sm = Math.max(fp.Sm, 0);
  return fp;
}

// ------------------------------------------------------------ the balance
/**
 * st = { TmodF, psia, TfuelF, ppm, banks, X, Sm }
 * Returns every component in pcm plus the total in dk/k.
 */
export function total(P, st) {
  const dm = modDensity(st.TmodF, st.psia);
  const u = dm / P.dmRef - 1;

  const doppler = -P.KD * (Math.sqrt(Math.max(st.TfuelF, 60)) - Math.sqrt(P.TfuelHZPF));
  const moderator = P.a1 * u + P.a2 * u * u;
  const boron = P.boronWorthHot * st.ppm * (1 + u);
  // Rod worth comes from ACTUAL positions when a drive model is supplying them
  // (rods.js), and from the step counter otherwise.  The two agree exactly on a
  // healthy core -- per-rod shares sum back to bank worth -- so this override
  // changes nothing until a rod stops tracking its demand.
  const rods = st.rodWorthPcm !== undefined ? st.rodWorthPcm : rodWorth(P, st.banks);
  const xenon = P.xeEqWorth * st.X;
  const samarium = P.smEqWorth * st.Sm;

  const pcm = P.excess + doppler + moderator + boron + rods + xenon + samarium;
  return {
    excess: P.excess, doppler, moderator, boron, rods, xenon, samarium,
    pcm, total: pcm * PCM
  };
}

/** Moderator temperature coefficient [pcm/degF] at the given state. */
export function mtc(P, st) {
  const h = 0.5;
  const a = total(P, { ...st, TmodF: st.TmodF - h }).pcm;
  const b = total(P, { ...st, TmodF: st.TmodF + h }).pcm;
  return (b - a) / (2 * h);
}
/** Doppler coefficient [pcm/degF]. */
export function dtc(P, st) {
  const h = 5;
  const a = total(P, { ...st, TfuelF: st.TfuelF - h }).pcm;
  const b = total(P, { ...st, TfuelF: st.TfuelF + h }).pcm;
  return (b - a) / (2 * h);
}
/** Boron worth [pcm/ppm] at the given state. */
export function boronWorth(P, st) {
  const a = total(P, { ...st, ppm: st.ppm - 5 }).pcm;
  const b = total(P, { ...st, ppm: st.ppm + 5 }).pcm;
  return (b - a) / 10;
}

/** Boron concentration that makes the given state exactly critical. */
export function criticalBoron(P, st) {
  let lo = 0, hi = 3000;
  for (let i = 0; i < 60; i++) {
    const m = 0.5 * (lo + hi);
    if (total(P, { ...st, ppm: m }).pcm > 0) lo = m; else hi = m;
  }
  return 0.5 * (lo + hi);
}
