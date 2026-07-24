// ======================================================================
//  fuel.js — fuel pin thermal model, hot channel, DNBR, OTdT / OPdT
//
//  Two-node lumped pin:
//     Mf cf dTf/dt = Q - (Tf - Tc)/Rfc
//     Mc cc dTc/dt = (Tf - Tc)/Rfc - (Tc - Tcool)/Rcw
//  Rfc lumps fuel conduction and the fuel-clad gap; Rcw lumps clad
//  conduction and the film coefficient.  Rfc is calibrated so that the
//  average fuel temperature at 100% power matches the value the reactivity
//  module was anchored to, which keeps Doppler consistent between modules.
//
//  DNBR uses the W-3 correlation (uniform-flux form), which is the
//  correlation Westinghouse plants are actually licensed against.
//
//  OTdT / OPdT are the standard Westinghouse forms.  The axial flux
//  difference penalty terms f1(dI) and f2(dI) are set to zero because this
//  core model is radially lumped with no axial nodes -- documented, not
//  silently dropped.
// ======================================================================

import * as ST from './steam.js';

export function fuelParams() {
  const P = {
    // --- core geometry, Westinghouse 3-loop ---
    Qrated: 2775e6,            // W thermal
    assemblies: 157,
    rodsPerAssy: 264,          // 17x17 minus 24 guide tubes and 1 instrument
    rodOD: 0.374 / 12,         // ft
    activeLen: 12.0,           // ft
    flowAreaFt2: 51.1,         // core flow area
    DeIn: 0.474,               // heated equivalent diameter, inches

    // --- hot channel factors ---
    Fq: 2.32,                  // heat flux hot channel factor
    FdH: 1.62,                 // enthalpy rise hot channel factor

    // --- thermal masses ---
    MfCf: 0,                   // J/K total, set below
    McCc: 0,
    fuelMassLb: 222000,        // UO2 in the core, lbm
    cladMassLb: 45000,         // Zircaloy, lbm
    cpFuel: 0.081,             // Btu/lbm-F at temperature
    cpClad: 0.083,

    // --- resistances, calibrated ---
    Rfc: 0,                    // F per W  (fuel -> clad)
    Rcw: 0,                    // F per W  (clad -> coolant)
    TfuelRefF: 1447,           // average fuel temp at 100% power
    TcladRefF: 720,            // average clad temp at 100% power
    TcoolRefF: 577,            // Tavg at 100% power

    // --- flow ---
    WrattedLbHr: 0,            // derived below from Q = W*cp*dT0

    // --- OTdT / OPdT (Westinghouse standard form) ---
    dT0: 61.2,                 // full-power core dT, degF (Thot 607.6 / Tcold 546.4)
    cpRCS: 1.28,               // Btu/lbm-F near 577 F, 2250 psia
    Tref: 577.0,               // Tavg at rated
    Pref: 2235,                // psig
    K1: 1.20, K2: 0.0250, K3: 0.00107,
    K4: 1.086, K5: 0.02, K6: 0.00130,
    tauLead: 8, tauLag: 3,     // OTdT lead/lag on Tavg
    tau5: 10,                  // OPdT rate washout time constant, s
    dnbrLimit: 1.30            // W-3 design limit
  };
  calibrate(P);
  return P;
}

function calibrate(P) {
  // Core flow follows from the energy balance at rated conditions rather than
  // being assumed: W = Q / (cp * dT0).  Getting this wrong pushes the hot
  // channel into bulk boiling and collapses DNBR.
  P.WrattedLbHr = (P.Qrated * 3.412142) / (P.cpRCS * P.dT0);
  P.TcoldRefF = P.Tref - P.dT0 / 2;
  P.ThotRefF  = P.Tref + P.dT0 / 2;
  P.nRods = P.assemblies * P.rodsPerAssy;
  P.heatAreaFt2 = P.nRods * Math.PI * P.rodOD * P.activeLen;
  P.qAvgBtu = (P.Qrated * 3.412142) / P.heatAreaFt2;      // Btu/hr-ft2 at rated
  P.Grated = P.WrattedLbHr / P.flowAreaFt2;               // lbm/hr-ft2

  // thermal capacities in Btu/degF
  P.MfCf = P.fuelMassLb * P.cpFuel;
  P.McCc = P.cladMassLb * P.cpClad;

  // resistances from the reference temperature drops, degF per Btu/hr
  const Qbtu = P.Qrated * 3.412142;
  P.Rfc = (P.TfuelRefF - P.TcladRefF) / Qbtu;
  P.Rcw = (P.TcladRefF - P.TcoolRefF) / Qbtu;
  P.tauFuel = P.MfCf * (P.Rfc + P.Rcw);                   // hours
  return P;
}

export function makeFuel(P) {
  return {
    Tf: P.TcoolRefF, Tc: P.TcoolRefF,
    qAvg: 0, qHot: 0, dnbr: 99, dnbrHot: 99,
    dT: 0, dTlag: 0, otdt: 0, opdt: 0, otdtTrip: false, opdtTrip: false
  };
}

/**
 * Advance the pin. p = core power fraction, Tcool = average coolant temp
 * seen by the pin, dt in seconds.
 */
export function stepFuel(P, f, p, TcoolF, dt) {
  const Qbtu = p * P.Qrated * 3.412142;                   // Btu/hr
  const dtHr = dt / 3600;
  const qFC = (f.Tf - f.Tc) / P.Rfc;                      // Btu/hr
  const qCW = (f.Tc - TcoolF) / P.Rcw;
  f.Tf += (Qbtu - qFC) / P.MfCf * dtHr;
  f.Tc += (qFC - qCW) / P.McCc * dtHr;
  f.qAvg = p * P.qAvgBtu;
  f.qHot = f.qAvg * P.Fq;
  return f;
}

/** Steady fuel and clad temperatures at power fraction p. */
export function steadyFuel(P, p, TcoolF) {
  const Qbtu = p * P.Qrated * 3.412142;
  const Tc = TcoolF + Qbtu * P.Rcw;
  return { Tf: Tc + Qbtu * P.Rfc, Tc };
}

// ------------------------------------------------------------------ W-3
/**
 * W-3 critical heat flux, uniform axial flux, English units.
 *   P    psia
 *   G    lbm/hr-ft2
 *   x    local quality (negative when subcooled)
 *   De   heated equivalent diameter, inches
 *   hf   saturated liquid enthalpy, Btu/lbm
 *   hin  core inlet enthalpy, Btu/lbm
 * Returns Btu/hr-ft2.
 */
export function w3CHF(Ppsia, G, x, DeIn, hf, hin) {
  const Pp = Math.min(Math.max(Ppsia, 800), 2400);
  const xx = Math.min(Math.max(x, -0.15), 0.15);
  const t1 = (2.022 - 0.0004302 * Pp)
           + (0.1722 - 0.0000984 * Pp) * Math.exp((18.177 - 0.004129 * Pp) * xx);
  const t2 = (0.1484 - 1.596 * xx + 0.1729 * xx * Math.abs(xx)) * (G / 1e6) + 1.037;
  const t3 = 1.157 - 0.869 * xx;
  const t4 = 0.2664 + 0.8357 * Math.exp(-3.151 * DeIn);
  const t5 = 0.8258 + 0.000794 * (hf - hin);
  return 1e6 * t1 * t2 * t3 * t4 * t5;
}

/**
 * Hot-channel DNBR.
 *  p      core power fraction
 *  flowFr core flow fraction of rated
 *  Ppsia  RCS pressure
 *  TinF   core inlet temperature
 */
export function dnbr(P, p, flowFr, Ppsia, TinF) {
  const Pm = ST.MPa_from_psi(Ppsia);
  const Ts = ST.F_from_K(ST.Tsat(Pm));
  const hfSat = ST.BTUlb_from_Jkg(ST.hf(ST.Tsat(Pm)));
  const hgSat = ST.BTUlb_from_Jkg(ST.hg(ST.Tsat(Pm)));
  const hin = ST.BTUlb_from_Jkg(ST.hLiq(Pm, ST.K_from_F(Math.min(TinF, Ts - 0.5))));

  const G = Math.max(P.Grated * flowFr, 1e4);
  // enthalpy rise in the hot channel: average rise scaled by F-deltaH
  const Wtot = Math.max(P.WrattedLbHr * flowFr, 1e3);
  const dhAvg = (p * P.Qrated * 3.412142) / Wtot;
  const hOutHot = hin + dhAvg * P.FdH;
  const xHot = (hOutHot - hfSat) / Math.max(hgSat - hfSat, 1);

  const chf = w3CHF(Ppsia, G, xHot, P.DeIn, hfSat, hin);
  const qLocal = Math.max(p * P.qAvgBtu * P.Fq, 1);
  return { dnbr: chf / qLocal, chf, qLocal, xHot, hin, hOutHot, Tsat: Ts };
}

// --------------------------------------------------- OTdT / OPdT setpoints
/**
 * Westinghouse overtemperature and overpower delta-T.
 *   dT      measured loop delta-T, degF
 *   Tavg    measured Tavg, degF
 *   Ppsig   pressurizer pressure, psig
 *   dTavgdt rate of change of Tavg, degF/s (OPdT rate term)
 * f1(dI) and f2(dI) are zero: this core is radially lumped, no axial nodes.
 */
export function otdtSetpoint(P, Tavg, Ppsig) {
  return P.dT0 * (P.K1 - P.K2 * (Tavg - P.Tref) + P.K3 * (Ppsig - P.Pref));
}
export function opdtSetpoint(P, Tavg, rateTerm) {
  // rateTerm is the washed-out Tavg signal (degF), positive only on heatup
  const rate = P.K5 * Math.max(rateTerm, 0);
  return P.dT0 * (P.K4 - rate - P.K6 * Math.max(Tavg - P.Tref, 0));
}

/** Update the trip functions, with the OTdT lead/lag on Tavg. */
export function stepTrips(P, f, dT, Tavg, Ppsig, dt) {
  // lead/lag compensation on Tavg
  const a = dt / Math.max(P.tauLag, 1e-3);
  f.TavgLag = f.TavgLag === undefined ? Tavg : f.TavgLag + a * (Tavg - f.TavgLag);
  const Tcomp = Tavg + (P.tauLead / P.tauLag) * (Tavg - f.TavgLag);

  f.dT = dT;
  f.otdt = otdtSetpoint(P, Tcomp, Ppsig);
  // OPdT rate term: washout (high-pass) on Tavg, tau5 = 10 s.  This is the
  // real dynamic-compensation form; a raw derivative spikes on any step.
  const b = dt / Math.max(P.tau5, 1e-3);
  f.TavgWash = f.TavgWash === undefined ? Tavg : f.TavgWash + b * (Tavg - f.TavgWash);
  const rateTerm = Tavg - f.TavgWash;
  f.opdt = opdtSetpoint(P, Tavg, rateTerm);
  f.otdtTrip = dT > f.otdt;
  f.opdtTrip = dT > f.opdt;
  f.otdtMargin = f.otdt - dT;
  f.opdtMargin = f.opdt - dT;
  return f;
}
