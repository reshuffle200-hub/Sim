// ======================================================================
//  sg.js — steam generator secondary side, Westinghouse U-tube
//
//  THE POINT OF THIS MODULE IS SHRINK AND SWELL.
//
//  Indicated narrow-range level is NOT the collapsed liquid level.  The
//  riser (tube bundle) carries a two-phase mixture, and the level tap sees
//  that mixture's swelled height.  So:
//
//    - open the feed regulating valve  -> colder water enters the downcomer,
//      subcools the riser inlet, COLLAPSES voids, and indicated level FALLS
//      before it rises.  Feed more, level drops.  That is the wrong-way
//      response that makes SG level the hardest loop in the plant and the
//      one that trips units.
//
//    - increase steam demand -> pressure falls, existing voids EXPAND, and
//      indicated level SWELLS before inventory depletion pulls it down.
//
//  Both are non-minimum-phase.  A model that tracks only mass gets the
//  steady state right and the transient exactly backwards, so the riser
//  void fraction is carried as a state with its own lag.
//
//  Secondary inventory is solved the same way as the RCS: mass and energy
//  in a fixed volume, pressure from the volume constraint.
// ======================================================================

import * as PR from './props.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function sgParams() {
  const P = {
    nSG: 3,
    Vsec: 5500,            // secondary volume per SG, ft3
    Mnominal: 95000,       // water inventory at full power, lbm
    Vriser: 1600,          // tube bundle / riser volume, ft3
    Vdown: 900,            // downcomer volume, ft3
    Hnr: 12.0,             // narrow-range span, ft
    HnrBase: 28.0,         // elevation of the bottom NR tap above tubesheet
    Htotal: 46.0,          // shell height, ft
    Htubes: 20.0,          // top of the U-tube bundle above the tubesheet, ft

    Prated: 812,           // steam pressure at full power, psia
    Wsteam: 0,             // DERIVED from the energy balance, not asserted
    Tfw: 440,              // final feedwater temperature at full power, degF
    TfwLow: 100,           // condensate temperature with heaters bypassed
    Qrated: 2775e6 / 3,    // W thermal per SG

    // circulation and void dynamics
    circRatio: 3.5,        // recirculation ratio at full power
    slip: 2.0,             // slip ratio; homogeneous flow overstates void badly
    riserProfile: 0.60,    // riser-average void as a fraction of exit void
    tauVoid: 4.0,          // riser void response time constant, s
    kFlash: 0.020,         // riser void added per psi/s of depressurisation
    tauFlash: 6.0,         // how fast the flash void decays away, s
    swellGain: 11.0,       // feet of indicated level per unit riser void
    tauLevel: 1.5,         // level transmitter lag, s

    // level control programme
    lvlSetPct: 50,         // narrow-range setpoint
    lvlLoLo: 17,           // reactor trip and AFW start
    lvlLo: 25, lvlHi: 75,
    lvlHiHi: 82,           // turbine trip and feedwater isolation

    // relief.  A single lumped safety valve was 4x too small: with the MSIV
    // shut at full power the SG must pass its ENTIRE steam flow through the
    // code safeties, and pressure otherwise runs away to the solver bound.
    // Real Westinghouse SGs carry five safeties with staggered setpoints,
    // sized as a set to relieve full steam flow.
    safetySetPsig: [1085, 1097, 1109, 1120, 1131],
    safetyBlowdown: 0.05,  // fraction of setpoint before reseating
    safetyCapEach: 0,      // derived: full steam flow shared over the five
    arvLiftPsig: 1075,     // atmospheric relief.  No-load steam pressure is
                           //  about 990 psig, so a 1025 psig setpoint left only
                           //  2 psi of margin: the valve cycled at hot standby,
                           //  boiled the generators down over 90 minutes, AFW
                           //  started on low level with 100 F water, the plant
                           //  overcooled and safety injection actuated.  Sits
                           //  clear of no-load and below the first code safety.
    arvCapLbHr: 4.2e5
  };
  calibrateSG(P);
  return P;
}

function calibrateSG(P) {
  // Steam flow follows from the energy balance, exactly as core flow did:
  //   W = Q / (hg - hfw).  Asserting it instead left a 3% imbalance that
  //   pushed the secondary 200 psi off its design pressure.
  P.hfwRated = PR.hfT(P.Tfw);
  P.Wsteam = (P.Qrated * 3.412142) / (PR.hgP(P.Prated) - P.hfwRated);
  // safeties as a set must pass full steam flow, with margin
  P.safetyCapEach = 1.10 * P.Wsteam / P.safetySetPsig.length;

  // Design-point boiling duty and recirculation flow.  circRatio is a DESIGN
  // POINT quantity -- it is only meaningful at rated conditions -- so the
  // circulation flow it implies has to be anchored here and scaled off-design
  // by buoyancy, not re-derived from circRatio at every power.  See
  // riserVoidFrom for why re-deriving it cancels the power dependence.
  const hfgR = Math.max(PR.hgP(P.Prated) - PR.hfP(P.Prated), 1);
  const QbtuR = P.Qrated * 3.412142;
  const QsubR = Math.max(P.Wsteam * (PR.hfP(P.Prated) - P.hfwRated), 0);
  P.QboilRated = Math.max(QbtuR - QsubR, 1);
  P.WcircRated = P.circRatio * (P.QboilRated / hfgR);
  // place the narrow-range span so the design point indicates 50%
  const nom = nominalLevelFt(P);
  P.HnrBase = nom - 0.5 * P.Hnr;
  return P;
}

/** Indicated level height at the design point, used to place the NR span. */
function nominalLevelFt(P) {
  const vf = PR.vfP(P.Prated), vg = PR.vgP(P.Prated);
  const Vliq = P.Vsec * 0.42;
  const M = Vliq / vf + (P.Vsec - Vliq) / vg;
  const a = riserVoidFrom(P, P.Qrated, P.Wsteam, P.hfwRated, P.Prated, P.Wsteam);
  return (Vliq / P.Vsec) * P.Htotal + P.swellGain * a;
}

export function makeSG(P) {
  const sgs = [];
  for (let i = 0; i < P.nSG; i++) {
    sgs.push({
      M: P.Mnominal, U: 0,
      Psec: P.Prated, Tsat: 0,
      alphaRiser: 0, alphaEq: 0, alphaBoil: 0, flash: 0, PsecPrev: 0,
      lvlNR: P.lvlSetPct, lvlRaw: P.lvlSetPct, lvlColl: 0,
      Wfw: P.Wsteam, hfw: 0, Wsteam: P.Wsteam, Qin: P.Qrated,
      arvOpen: false, safetyOpen: [false,false,false,false,false], Wrelief: 0,
      tubeCoverage: 1, htFactor: 1, QinRequested: 0,
      msivOpen: true, dryout: false, tubeUncovered: false
    });
  }
  return sgs;
}

/** Put one SG in equilibrium at a given power fraction. */
/**
 * Trim SG mass so the narrow-range indication starts at its control setpoint.
 *
 * initSG fills to a fixed 42% liquid fraction, which is right at power but
 * wrong at no load: with no boiling there is no riser swell, so the same water
 * indicates very differently.  At hot standby it read 98%, the feed regulating
 * valve stayed shut on level error while the dumps steamed off pump heat, and
 * the generators drained until AFW started and overcooled the plant.
 */
export function trimToSetpoint(P, sg, targetPct = P.lvlSetPct) {
  // Solve for the mass ANALYTICALLY rather than nudging it and re-stepping.
  // The first attempt scaled mass and ran the model forward, but the level
  // transmitter lag outlasted the settle so it never converged.
  for (let i = 0; i < 40; i++) {
    const swellFt = P.swellGain * sg.alphaRiser;
    const wantColl = clamp((P.HnrBase + (targetPct / 100) * P.Hnr - swellFt) / P.Htotal, 0.02, 0.95);
    const Vliq = wantColl * P.Vsec;
    const vf = PR.vfP(sg.Psec), vg = PR.vgP(sg.Psec);
    const hf = PR.hfP(sg.Psec), hg = PR.hgP(sg.Psec);
    const M = Vliq / vf + (P.Vsec - Vliq) / vg;
    const x = ((P.Vsec / M) - vf) / (vg - vf);
    const h = hf + x * (hg - hf);
    sg.M = M;
    sg.U = M * (h - sg.Psec * 144 * (P.Vsec / M) / 778.169);
    refreshSG(P, sg);
    // seed the transmitter at its steady value instead of waiting out the lag
    sg.lvlRaw = clamp((sg.lvlColl * P.Htotal + swellFt - P.HnrBase) / P.Hnr * 100, -20, 120);
    sg.lvlNR = sg.lvlRaw;
    if (Math.abs(sg.lvlNR - targetPct) < 0.3) break;
  }
  return sg;
}

export function initSG(P, sg, powerFrac, Psec, TfwF) {
  const hf = PR.hfP(Psec), hg = PR.hgP(Psec);
  const vf = PR.vfP(Psec), vg = PR.vgP(Psec);
  // choose mass so the collapsed level sits at the programme setpoint
  const Vliq = P.Vsec * 0.42;
  sg.M = Vliq / vf + (P.Vsec - Vliq) / vg;
  const x = ((P.Vsec / sg.M) - vf) / (vg - vf);
  const h = hf + x * (hg - hf);
  sg.U = sg.M * (h - Psec * 144 * (P.Vsec / sg.M) / 778.169);
  sg.Psec = Psec;
  sg.Qin = P.Qrated * powerFrac;
  sg.Wsteam = P.Wsteam * powerFrac;
  sg.Wfw = sg.Wsteam;
  sg.hfw = PR.TsatP(Psec) > TfwF ? approxLiqH(TfwF) : approxLiqH(TfwF);
  sg.alphaEq = riserVoidEq(P, sg, powerFrac);
  sg.alphaRiser = sg.alphaEq;
  refreshSG(P, sg);
  return sg;
}

/** Feedwater enthalpy from temperature -- real table, not a polynomial. */
const approxLiqH = TF => PR.hfT(TF);

/**
 * Riser void fraction, slip corrected.
 *
 * Homogeneous flow gives alpha = 0.84 at 16% quality, because steam is 27x
 * less dense than water.  Real bundles run near 0.5 average.  Two corrections
 * are needed and both matter for the transient direction:
 *
 *   1. SLIP.  Steam moves faster than water, so it occupies less volume than
 *      homogeneous flow implies:  alpha = 1/(1 + ((1-x)/x)(rhog/rhof) S)
 *   2. BOILING LENGTH.  Feedwater subcooling must be made up before boiling
 *      starts, so the lower riser carries no void at all.  Colder feedwater
 *      pushes the boiling boundary up, cuts the average void, and COLLAPSES
 *      the level -- which is precisely the shrink mechanism.
 */
export function riserVoidFrom(P, QinW, Wfw, hfw, Psec, Wsteam) {
  const hf = PR.hfP(Psec), hg = PR.hgP(Psec), hfg = Math.max(hg - hf, 1);
  const vf = PR.vfP(Psec), vg = PR.vgP(Psec);
  const Qbtu = Math.max(QinW * 3.412142, 0);
  if (Qbtu < 1) return 0;

  // energy spent raising feedwater to saturation cannot make steam
  const Qsub = Math.max(Wfw * (hf - hfw), 0);
  const Qboil = Math.max(Qbtu - Qsub, 0);
  const subFrac = clamp(Qsub / Math.max(Qbtu, 1), 0, 0.95);

  // Circulation is a natural-circulation loop driven by riser buoyancy; it
  // does NOT follow steam demand instantaneously.  Tying it to Wsteam made a
  // steam-demand step CUT the void, producing shrink where swell belongs.
  //
  // It must not be tied to the BOILING rate either.  Setting
  // Wcirc = circRatio * Wboil makes the exit quality
  //     xExit = Qboil / (Wcirc * hfg) = 1 / circRatio
  // identically, at every power: Qboil cancels.  The riser void then came out
  // at 0.445 whether the generator was making 925 MW or absorbing 4 MW of pump
  // heat, so the swell term contributed its full ~5 ft at hot standby and the
  // narrow-range indication sat near the top of the span with the correct
  // water inventory in the shell.
  //
  // Recirculation ratio is a DESIGN POINT number.  Off design the loop is a
  // buoyancy-driven thermosyphon: the driving head goes as the average void,
  // the loop resistance goes as the square of the flow, so
  //     W^2 ~ dP ~ alpha ~ x ~ Qboil / W    =>    W ~ Qboil^(1/3)
  // the standard cube-root law for natural circulation.  Anchoring that at the
  // design point keeps rated conditions bit-identical (the ratio is 1 there)
  // while exit quality now falls as Qboil^(2/3) toward no load.
  const fBoil = Qboil / P.QboilRated;
  const Wcirc = Math.max(P.WcircRated * Math.cbrt(fBoil), 1e3);
  const xExit = clamp(Qboil / (Wcirc * hfg), 1e-7, 0.95);

  const aExit = 1 / (1 + ((1 - xExit) / xExit) * (vf / vg) * P.slip);
  // average over the riser: zero below the boiling boundary, profile above
  return clamp(aExit * P.riserProfile * (1 - subFrac), 0, 0.92);
}

function riserVoidEq(P, sg, powerFrac) {
  return riserVoidFrom(P, sg.Qin, sg.Wfw, sg.hfw, sg.Psec, Math.max(sg.Wsteam, P.Wsteam * 0.02));
}

function refreshSG(P, sg) {
  const v = P.Vsec / Math.max(sg.M, 1);
  const u = sg.U / Math.max(sg.M, 1);
  // pressure from the volume constraint on this shell
  sg.Psec = solveSecP(P, sg.M, u);
  const h = u + sg.Psec * 144 * v / 778.169;
  sg.Tsat = PR.TsatP(sg.Psec);
  const vf = PR.vfP(sg.Psec), vg = PR.vgP(sg.Psec);
  const hf = PR.hfP(sg.Psec), hg = PR.hgP(sg.Psec);
  const x = clamp((h - hf) / Math.max(hg - hf, 1), 0, 1);
  // collapsed liquid level: liquid volume spread over the shell
  const Vliq = sg.M * (1 - x) * vf;
  sg.lvlColl = clamp(Vliq / P.Vsec, 0, 1);
  sg.dryout = x > 0.85;
  return sg;
}

function solveSecP(P, M, u) {
  const vTarget = P.Vsec / Math.max(M, 1);
  const f = p => PR.vPU(p, u) - vTarget;
  let lo = 15, hi = 3000, flo = f(lo);
  if (flo < 0) return lo;
  if (f(hi) > 0) return hi;
  for (let i = 0; i < 40; i++) {
    const m = 0.5 * (lo + hi);
    if (f(m) > 0) lo = m; else hi = m;
  }
  return 0.5 * (lo + hi);
}

/**
 * Advance one steam generator.
 *   Qin   heat from the primary, W
 *   Wfw   feedwater flow, lbm/hr
 *   TfwF  feedwater temperature
 *   Wdemand steam flow demanded by the header, lbm/hr
 */
export function stepSG(P, sg, QinReq, Wfw, TfwF, Wdemand, dt) {
  const dtHr = dt / 3600;
  // ---- tube coverage gates heat transfer ----
  // A steam generator that has boiled dry cannot absorb primary heat: the
  // tubes are in steam, not water.  Without this the shell superheats without
  // limit -- an isolated SG ran to 1488 psig at 125 s purely because full core
  // power was still being forced into 3000 lbm of fluid.
  const mixFt = sg.lvlColl * P.Htotal + P.swellGain * sg.alphaRiser;
  sg.tubeCoverage = clamp(mixFt / P.Htubes, 0, 1);
  sg.htFactor = sg.tubeCoverage * sg.tubeCoverage * (3 - 2 * sg.tubeCoverage);  // smoothstep
  const Qin = QinReq * sg.htFactor;
  sg.QinRequested = QinReq;
  sg.Qin = Qin;
  sg.Wfw = Wfw;
  sg.hfw = approxLiqH(TfwF);

  // ---- relief valves ----
  const psig = sg.Psec - 14.7;
  let Wrel = 0;
  for (let i = 0; i < P.safetySetPsig.length; i++) {
    const set = P.safetySetPsig[i];
    if (!sg.safetyOpen[i] && psig > set) sg.safetyOpen[i] = true;
    else if (sg.safetyOpen[i] && psig < set * (1 - P.safetyBlowdown)) sg.safetyOpen[i] = false;
    if (sg.safetyOpen[i]) Wrel += P.safetyCapEach * Math.sqrt(clamp(psig / set, 0, 2));
  }
  if (!sg.arvOpen && psig > P.arvLiftPsig) sg.arvOpen = true;
  else if (sg.arvOpen && psig < P.arvLiftPsig * 0.97) sg.arvOpen = false;
  if (sg.arvOpen) Wrel += P.arvCapLbHr;
  sg.Wrelief = Wrel;
  sg.nSafetyOpen = sg.safetyOpen.filter(Boolean).length;

  // ---- steam leaving ----
  const Wout = (sg.msivOpen ? Math.max(Wdemand, 0) : 0) + sg.Wrelief;
  sg.Wsteam = Wout;

  // ---- mass and energy ----
  const hg = PR.hgP(sg.Psec);
  sg.M += (Wfw - Wout) * dtHr;
  sg.M = Math.max(sg.M, 100);
  sg.U += (Wfw * sg.hfw - Wout * hg + Qin * 3.412142) * dtHr;

  refreshSG(P, sg);

  // ---- riser void: boiling term plus a flashing term ----
  // Dropping pressure flashes saturated liquid throughout the shell.  That is
  // the dominant SWELL mechanism on a steam-demand step and it is far larger
  // than the density-ratio effect: an 11 psi drop flashes enough liquid to
  // add over a foot of mixture height.
  const dPdt = (sg.Psec - (sg.PsecPrev ?? sg.Psec)) / Math.max(dt, 1e-6);
  sg.PsecPrev = sg.Psec;
  const pf = clamp(Qin / P.Qrated, 0, 1.3);
  sg.alphaBoil = riserVoidEq(P, sg, pf);
  sg.flash += (P.kFlash * Math.max(-dPdt, 0) - sg.flash) * Math.min(1, dt / 0.5);
  sg.flash *= Math.max(0, 1 - dt / P.tauFlash);
  sg.alphaEq = clamp(sg.alphaBoil + sg.flash, 0, 0.95);
  sg.alphaRiser += (sg.alphaEq - sg.alphaRiser) * Math.min(1, dt / P.tauVoid);

  // ---- indicated narrow-range level ----
  // collapsed level mapped onto the NR span, plus the swell contribution
  const collFt = sg.lvlColl * P.Htotal;
  const swellFt = P.swellGain * sg.alphaRiser;
  const rawPct = (collFt + swellFt - P.HnrBase) / P.Hnr * 100;
  sg.lvlRaw = clamp(rawPct, -20, 120);
  sg.lvlNR += (sg.lvlRaw - sg.lvlNR) * Math.min(1, dt / P.tauLevel);
  sg.tubeUncovered = sg.tubeCoverage < 0.98;
  return sg;
}

/** Steam flow the header can draw, given turbine and dump demand. */
export function totalSteam(sgs) { return sgs.reduce((a, s) => a + s.Wsteam, 0); }
export function avgLevel(sgs) { return sgs.reduce((a, s) => a + s.lvlNR, 0) / sgs.length; }
export function minLevel(sgs) { return Math.min(...sgs.map(s => s.lvlNR)); }
