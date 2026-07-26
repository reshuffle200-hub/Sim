// ======================================================================
//  cvcs.js — chemical and volume control: boration and dilution
//
//  This is the system that actually takes the reactor critical from cold and
//  that compensates xenon and burnup at power.  Rods trim; boron does the
//  heavy lifting, because rod worth is small compared with the several
//  thousand pcm that has to be removed between cold shutdown and full power.
//
//  Boron changes by mass balance on a well-mixed RCS:
//        M dC/dt = W_in * C_in  -  W_out * C_rcs
//  so dilution is inherently SLOWER than boration at the same flow: borating
//  drives against a difference of thousands of ppm, diluting only against the
//  few hundred ppm already there.  That asymmetry is real and it is why
//  operators plan dilutions well in advance.
//
//  Mixing is not instantaneous.  A first-order lag on the delivered
//  concentration represents transport through the charging line, the loops
//  and the core -- roughly one loop transit plus mixing.  Without it a
//  dilution appears at the core the instant the valve opens, which makes
//  approach-to-critical look far easier than it is.
// ======================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function cvcsParams() {
  return {
    // --- sources ---
    baPpm: 7000,               // boric acid storage tank concentration
    baTankGal: 120000,
    pwPpm: 0,                  // primary water (reactor makeup water)
    pwTankGal: 200000,

    // --- volume control tank ---
    vctGal: 4000, vctLevelPct: 55,

    // --- charging and letdown ---
    chargeMaxGpm: 150,
    letdownGpm: 75,
    sealInjGpm: 24,            // RCP seal injection, part of charging
    boricMaxGpm: 30,           // boric acid pump
    dilMaxGpm: 120,            // primary water pump

    // --- mixing ---
    tauMixS: 55,               // charging line + loop transit + core mixing
    rcsMassLb: 380000,         // updated from the RCS each step

    // --- emergency boration ---
    emergBoricGpm: 30,

    // --- alarms ---
    vctLoPct: 20, vctHiPct: 85,
    baTankLoGal: 20000
  };
}

export function makeCVCS(P) {
  return {
    mode: 'auto',              // auto | borate | dilute | emergency
    borateGpm: 0, diluteGpm: 0,
    chargeGpm: P.letdownGpm, letdownGpm: P.letdownGpm,
    baTankGal: P.baTankGal, pwTankGal: P.pwTankGal,
    vctPct: P.vctLevelPct,
    cCharge: 0,                // concentration actually being delivered, ppm
    cDelivered: 0,             // after mixing lag
    ppmRate: 0,                // current rate of change, ppm/hr
    borated: 0, diluted: 0,    // running totals, gallons
    emergency: false,
    // Individual valve lineup.  Letdown runs through three parallel orifices
    // and charging through an isolation valve, and none of that was operable --
    // letdown was simply a constant.  Orifices are how letdown flow is actually
    // adjusted, so they gate it in thirds; the isolation valves gate it fully.
    orifice: [true, true, true],
    letdownIsol: true,
    chargingIsol: true,
    sealInjection: true,
    baIsol: true,
    alarms: {}
  };
}

/**
 * One step.
 *   ppm     current RCS boron
 *   Mrcs    RCS mass, lbm
 *   demand  { borateGpm, diluteGpm } manual demand, or null for hold
 * Returns the new RCS boron concentration.
 */
export function stepCVCS(P, C, ppm, Mrcs, dt, demand = {}) {
  P.rcsMassLb = Mrcs;

  // --- flows ---
  let bor = clamp(demand.borateGpm ?? 0, 0, P.boricMaxGpm);
  let dil = clamp(demand.diluteGpm ?? 0, 0, P.dilMaxGpm);
  if (C.emergency) bor = P.emergBoricGpm;
  if (C.baTankGal <= 0) bor = 0;
  if (C.pwTankGal <= 0) dil = 0;
  C.borateGpm = bor; C.diluteGpm = dil;

  // charging makes up letdown plus whatever is being added
  // Letdown is what the lined-up orifices pass, not a constant.  Each of the
  // three carries a third of rated flow, and the isolation valve gates all of
  // them -- so the board can now show letdown reduced, not merely on or off.
  const nOrifice = C.orifice.filter(Boolean).length;
  C.letdownGpm = C.letdownIsol ? P.letdownGpm * nOrifice / C.orifice.length : 0;
  C.chargeGpm = C.chargingIsol
    ? clamp(C.letdownGpm + (C.baIsol ? bor : 0) + dil, 0, P.chargeMaxGpm)
    : 0;

  // --- blended concentration entering the RCS ---
  // the balance of charging comes from the VCT, which sits at RCS boron
  const makeup = bor + dil;
  const fromVct = Math.max(C.chargeGpm - makeup, 0);
  const num = bor * P.baPpm + dil * P.pwPpm + fromVct * ppm;
  C.cCharge = C.chargeGpm > 0 ? num / C.chargeGpm : ppm;

  // transport and mixing lag
  C.cDelivered += (C.cCharge - C.cDelivered) * Math.min(1, dt / P.tauMixS);

  // --- RCS boron mass balance ---
  // The naive form  M dC/dt = Wch*Cch - Wld*C  is WRONG when charging and
  // letdown differ, and it fails silently: the letdown term exactly cancels
  // the VCT fraction of charging, so dilution had literally no effect.
  // Doing it properly, with boron mass and water mass both conserved:
  //     d(M*C)/dt = Wch*Cch - Wld*C ,   dM/dt = Wch - Wld
  //  => M dC/dt = Wch*(Cch - C)
  // Adding pure water dilutes because it brings in water without boron, not
  // because it pushes boron out.
  const lbPerGal = 8.34;
  const Wch = C.chargeGpm * lbPerGal * 60;          // lbm/hr
  const Wld = C.letdownGpm * lbPerGal * 60;
  const dC = Wch * (C.cDelivered - ppm) / Math.max(Mrcs, 1);         // ppm/hr
  C.ppmRate = dC;
  const newPpm = Math.max(0, ppm + dC * (dt / 3600));

  // --- inventories ---
  C.baTankGal = Math.max(0, C.baTankGal - bor * dt / 60);
  C.pwTankGal = Math.max(0, C.pwTankGal - dil * dt / 60);
  C.borated += bor * dt / 60;
  C.diluted += dil * dt / 60;
  // VCT rides on the difference between charging and letdown
  C.vctPct = clamp(C.vctPct + (C.letdownGpm - C.chargeGpm + makeup) * dt / 60 / P.vctGal * 100, 0, 100);

  C.alarms = {
    vctLo: C.vctPct < P.vctLoPct,
    vctHi: C.vctPct > P.vctHiPct,
    baTankLo: C.baTankGal < P.baTankLoGal,
    borating: bor > 0.5,
    diluting: dil > 0.5,
    emergency: C.emergency
  };
  return newPpm;
}

/**
 * Gallons of boric acid needed to change RCS boron by a given amount.
 * Useful for planning and for the estimated critical position calculation.
 */
export function galToBorate(P, fromPpm, toPpm, Mrcs) {
  if (toPpm <= fromPpm) return 0;
  const Vrcs = Mrcs / 8.34 / 60 * 60;   // approximate gallons
  return Vrcs * Math.log((P.baPpm - fromPpm) / (P.baPpm - toPpm));
}
/** Gallons of primary water needed to dilute from one concentration to another. */
export function galToDilute(P, fromPpm, toPpm, Mrcs) {
  if (toPpm >= fromPpm || toPpm <= 0) return 0;
  const Vrcs = Mrcs / 8.34 / 60 * 60;
  return Vrcs * Math.log(fromPpm / toPpm);
}
