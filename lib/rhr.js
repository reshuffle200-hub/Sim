// ======================================================================
//  rhr.js — residual heat removal, plus component cooling water
//
//  Below about 350 F the steam generators stop being a useful heat sink:
//  secondary pressure has fallen to near atmospheric and there is very little
//  temperature difference left to drive heat across the tubes.  RHR takes
//  suction from a hot leg, passes the coolant through a heat exchanger cooled
//  by component cooling water, and returns it to the cold legs.
//
//  ENTRY IS INTERLOCKED.  The RHR suction line is low-pressure piping tied
//  directly into the reactor coolant system, so its isolation valves are
//  interlocked shut above about 400 psig.  Opening them at pressure would
//  over-pressurise the RHR system outside containment -- an interfacing
//  systems LOCA, the one that bypasses containment entirely.  The interlock
//  is modelled because it is the reason a cooldown has a required order.
//
//  Heat removal uses effectiveness-NTU against an isothermal-ish CCW side,
//  the same form as the steam generators, so the result does not depend on
//  how the loop happens to be nodalised.
// ======================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function rhrParams() {
  return {
    nTrains: 2,
    pumpGpm: 3000,             // each train at full flow
    UAhx: 1.22e6,              // Btu/hr-F per heat exchanger
    cpRCS: 1.05,

    // --- entry interlocks ---
    permissivePsig: 400,       // suction valves interlocked above this
    permissiveTempF: 350,      // procedural entry temperature
    relockPsig: 425,           // hysteresis: once OPEN, stay open until
                               //  pressure rises ABOVE this.  Setting it below
                               //  the permissive (it was 385) meant the valves
                               //  re-shut on the very next step after opening,
                               //  and RHR silently removed nothing at all.

    // --- component cooling water ---
    ccwSupplyF: 105,           // from the CCW heat exchangers
    ccwFlowGpm: 8000,
    ccwUAsw: 1.0e7,            // CCW to service water, Btu/hr-F
                               //  sized so full RHR duty lands CCW near 110 F;
                               //  at 3e6 it ran to 147 F and alarmed constantly
    swSupplyF: 85,             // ultimate heat sink

    // --- limits ---
    cooldownLimitFperHr: 100,  // technical specification
    rhrDesignTempF: 400,       // RHR piping design
    rhrReliefPsig: 450,        // RHR suction relief (also the LTOP path)

    // --- controls ---
    tauValve: 8.0
  };
}

export function makeRHR(P) {
  const trains = [];
  for (let i = 0; i < P.nTrains; i++) {
    trains.push({
      pumpOn: false, suctionOpen: false, throttle: 0, throttleDemand: 0,
      flowGpm: 0, Tin: 0, Tout: 0, QBtuHr: 0, QMW: 0,
      interlocked: true, tripped: false
    });
  }
  return {
    trains,
    mode: 'manual',            // manual | rate   (rate = hold a cooldown rate)
    rateSetFperHr: 50,
    ccwTempF: P.ccwSupplyF, swTempF: P.swSupplyF,
    QtotalMW: 0, cooldownFperHr: 0, inService: false,
    lastTavg: null, rateInt: 0, decayMW: 0, alarms: {}
  };
}

/**
 * One step.
 *   Ppsia   RCS pressure
 *   ThotF   suction temperature (hot leg)
 *   TavgF   for the cooldown rate indication
 *   Mrcs    RCS mass, for the rate calculation
 * Returns total heat removed, in watts, for the RCS to consume.
 */
export function stepRHR(P, R, Ppsia, ThotF, TavgF, Mrcs, dt) {
  const psig = Ppsia - 14.7;

  // --- suction interlock ---
  for (const t of R.trains) {
    const wasOpen = !t.interlocked;
    t.interlocked = wasOpen ? (psig > P.relockPsig) : (psig > P.permissivePsig);
    if (t.interlocked) t.suctionOpen = false;      // interlock forces shut
  }

  // --- cooldown rate controller ---
  // Pure integral on the rate error overshot badly (97 F/hr on a 50 setpoint),
  // because the rate signal is necessarily filtered and the controller was
  // acting on stale information.  Feedforward from the heat balance sets the
  // throttle directly and the integral only trims the residue.
  if (R.mode === 'rate') {
    const active = R.trains.filter(t => t.pumpOn && t.suctionOpen && !t.interlocked);
    if (active.length) {
      const Mcp = Math.max(Mrcs, 1) * P.cpRCS;
      const Qwant = (R.decayMW ?? 0) * 1e6 * 3.412142
                  + Mcp * R.rateSetFperHr;                       // Btu/hr
      const W1 = P.pumpGpm * 8.34 * 60;
      const eff1 = 1 - Math.exp(-P.UAhx / (W1 * P.cpRCS));
      const Qfull = Math.max(W1 * P.cpRCS * (ThotF - R.ccwTempF) * eff1, 1);
      const ff = clamp(Qwant / (Qfull * active.length), 0, 1);
      const err = R.rateSetFperHr - R.cooldownFperHr;
      R.rateInt = clamp((R.rateInt ?? 0) + err * 0.00012 * dt, -0.35, 0.35);
      for (const t of active) t.throttleDemand = clamp(ff + R.rateInt, 0, 1);
    }
  }

  // --- each train ---
  let Qtot = 0;
  for (const t of R.trains) {
    t.throttle += (t.throttleDemand - t.throttle) * Math.min(1, dt / P.tauValve);
    t.throttle = clamp(t.throttle, 0, 1);
    const running = t.pumpOn && t.suctionOpen && !t.interlocked && !t.tripped;
    t.flowGpm = running ? P.pumpGpm * t.throttle : 0;
    if (t.flowGpm < 1) { t.QBtuHr = 0; t.QMW = 0; t.Tin = ThotF; t.Tout = ThotF; continue; }

    const W = t.flowGpm * 8.34 * 60;               // lbm/hr
    const NTU = P.UAhx / (W * P.cpRCS);
    const eff = 1 - Math.exp(-NTU);
    t.Tin = ThotF;
    const Q = W * P.cpRCS * (ThotF - R.ccwTempF) * eff;
    t.QBtuHr = Math.max(Q, 0);
    t.Tout = ThotF - t.QBtuHr / Math.max(W * P.cpRCS, 1);
    t.QMW = t.QBtuHr / 3.412142 / 1e6;
    Qtot += t.QBtuHr;
  }
  R.QtotalMW = Qtot / 3.412142 / 1e6;
  R.inService = R.trains.some(t => t.flowGpm > 1);

  // --- CCW rides on what RHR dumps into it, rejected to service water ---
  const ccwEq = R.swTempF + Qtot / P.ccwUAsw;
  R.ccwTempF += (ccwEq - R.ccwTempF) * Math.min(1, dt / 45);

  // --- cooldown rate ---
  if (R.lastTavg !== null && dt > 0) {
    // The instantaneous rate is extremely noisy: a 0.01 F change over a 0.05 s
    // step reads as 720 F/hr.  Clamp before filtering, or the indication spikes
    // to four figures on numerical jitter alone.
    const inst = clamp((R.lastTavg - TavgF) / dt * 3600, -400, 400);
    R.cooldownFperHr += (inst - R.cooldownFperHr) * Math.min(1, dt / 20);
  }
  R.lastTavg = TavgF;

  R.alarms = {
    interlocked: R.trains.some(t => t.interlocked),
    inService: R.inService,
    rateHigh: R.cooldownFperHr > P.cooldownLimitFperHr,
    rhrOverTemp: R.trains.some(t => t.flowGpm > 1 && t.Tin > P.rhrDesignTempF),
    ccwHigh: R.ccwTempF > 120,
    pumpRunningNoFlow: R.trains.some(t => t.pumpOn && t.flowGpm < 1)
  };
  return Qtot / 3.412142;                          // watts, for the RCS
}

/** Can RHR be placed in service right now? */
export function entryPermitted(P, Ppsia, ThotF) {
  return (Ppsia - 14.7) <= P.permissivePsig && ThotF <= P.permissiveTempF;
}
/** Put both trains in service at a given throttle, respecting the interlock. */
export function placeInService(P, R, throttle = 0.5) {
  let ok = false;
  for (const t of R.trains) {
    if (t.interlocked) continue;
    t.pumpOn = true; t.suctionOpen = true; t.throttleDemand = clamp(throttle, 0, 1);
    ok = true;
  }
  return ok;
}
export function removeFromService(R) {
  for (const t of R.trains) { t.pumpOn = false; t.suctionOpen = false; t.throttleDemand = 0; }
}
