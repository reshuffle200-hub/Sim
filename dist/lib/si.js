// ======================================================================
//  si.js — emergency core cooling: high head, accumulators, low head
//
//  Three injection paths, each covering a different pressure band, which is
//  the whole design logic of ECCS:
//
//    HIGH HEAD  centrifugal charging pumps, shutoff about 2500 psig.  Small
//               flow, but the only thing that injects while the RCS is still
//               near operating pressure -- so it covers small breaks.
//    ACCUMULATORS  passive.  Nitrogen at 600 psig behind a check valve; when
//               RCS pressure falls below that the valve simply opens.  No
//               power, no signal, no operator.  They cover the large-break
//               blowdown that pumps are far too slow for.
//    LOW HEAD   RHR pumps in injection mode, shutoff about 200 psig.  Large
//               flow, but only once the system has depressurised.
//
//  Every pump follows a head-flow curve, so flow depends on RCS pressure:
//  a pump with 1520 psig shutoff delivers nothing at all into a 2000 psig
//  system.  Modelling injection as a constant rate would make small breaks
//  look far more benign than they are.
//
//  Suction transfers from the refuelling water tank to the containment sump
//  when the tank runs low.  That switchover is where operators have to act.
// ======================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function siParams() {
  return {
    // --- high head (charging pumps in SI mode) ---
    hhTrains: 2, hhShutoffPsig: 2500, hhMaxGpm: 150,
    // --- intermediate head SI pumps ---
    siTrains: 2, siShutoffPsig: 1520, siMaxGpm: 400,
    // --- low head (RHR pumps in injection) ---
    lhTrains: 2, lhShutoffPsig: 200, lhMaxGpm: 3000,

    // --- accumulators ---
    nAcc: 3,
    accTotalFt3: 1350,         // each, water plus nitrogen
    accWaterFt3: 850,
    accPsig: 600,
    accLineK: 0.055,           // discharge resistance
    accPpm: 2400,

    // --- refuelling water storage tank ---
    rwstGal: 350000,
    rwstPpm: 2400,
    rwstLoPct: 32,             // switch to sump recirculation
    rwstEmptyPct: 8,

    // --- actuation ---
    pzrLoPsig: 1850,
    steamLineLoPsia: 600,
    tempF: 100                 // injected water temperature
  };
}

export function makeSI(P) {
  const acc = [];
  for (let i = 0; i < P.nAcc; i++) {
    acc.push({
      waterFt3: P.accWaterFt3,
      gasFt3: P.accTotalFt3 - P.accWaterFt3,
      psig: P.accPsig,
      isolated: false, discharging: false, flowGpm: 0, empty: false
    });
  }
  return {
    actuated: false, manualBlock: false, resetLatched: false,
    hhOn: [true, true], siOn: [true, true], lhOn: [true, true],
    // discharge valves, normally open and separately operable
    hhValve: [true, true], siValve: [true, true], lhValve: [true, true],
    hhGpm: 0, siGpm: 0, lhGpm: 0, accGpm: 0, totalGpm: 0,
    acc,
    rwstGal: P.rwstGal, rwstPct: 100,
    suction: 'rwst',           // rwst | sump
    injectedGal: 0, boronPpm: P.rwstPpm,
    alarms: {}
  };
}

/** Head-flow curve: zero at shutoff, maximum at zero back-pressure. */
function pumpFlow(maxGpm, shutoffPsig, psig) {
  if (psig >= shutoffPsig) return 0;
  return maxGpm * Math.sqrt(1 - psig / shutoffPsig);
}

/**
 * One step.
 *   Ppsia    RCS pressure
 *   dt       seconds
 * Returns { lbHr, ppm } to be injected into the cold legs.
 */
export function stepSI(P, S, Ppsia, dt, opt = {}) {
  const psig = Ppsia - 14.7;

  // ---------------- actuation ----------------
  const auto = psig < P.pzrLoPsig || (opt.containmentHigh === true);
  if (auto && !S.manualBlock) S.actuated = true;
  if (opt.manualActuate) S.actuated = true;
  if (opt.reset && psig > P.pzrLoPsig + 100) { S.actuated = false; }

  // ---------------- pumped injection ----------------
  let hh = 0, si = 0, lh = 0;
  if (S.actuated && S.rwstPct > P.rwstEmptyPct) {
    // A pump only delivers if its discharge valve is open.  Deadheading it
    // against a shut valve is a real and quiet failure -- the pump lamp is lit,
    // the flow indication is zero -- and it was not previously expressible.
    for (let i = 0; i < P.hhTrains; i++)
      if (S.hhOn[i] && S.hhValve[i]) hh += pumpFlow(P.hhMaxGpm, P.hhShutoffPsig, psig);
    for (let i = 0; i < P.siTrains; i++)
      if (S.siOn[i] && S.siValve[i]) si += pumpFlow(P.siMaxGpm, P.siShutoffPsig, psig);
    for (let i = 0; i < P.lhTrains; i++)
      if (S.lhOn[i] && S.lhValve[i]) lh += pumpFlow(P.lhMaxGpm, P.lhShutoffPsig, psig);
  }
  S.hhGpm = hh; S.siGpm = si; S.lhGpm = lh;

  // ---------------- accumulators (passive) ----------------
  let accTot = 0;
  for (const a of S.acc) {
    a.discharging = false; a.flowGpm = 0;
    if (a.isolated || a.waterFt3 <= 0.5) { a.empty = a.waterFt3 <= 0.5; continue; }
    const dp = a.psig - psig;
    if (dp <= 0) continue;                       // check valve holds shut
    a.discharging = true;
    a.flowGpm = P.accLineK * Math.sqrt(dp) * 1000;
    const outFt3 = a.flowGpm * dt / 60 / 7.481;
    const take = Math.min(outFt3, a.waterFt3);
    a.waterFt3 -= take;
    a.gasFt3 += take;
    // nitrogen expands isothermally: P1 V1 = P2 V2
    a.psig = ((P.accPsig + 14.7) * (P.accTotalFt3 - P.accWaterFt3) / Math.max(a.gasFt3, 1e-6)) - 14.7;
    a.flowGpm = take * 7.481 * 60 / Math.max(dt, 1e-6);
    accTot += a.flowGpm;
  }
  S.accGpm = accTot;

  // ---------------- inventory and suction ----------------
  const pumped = hh + si + lh;
  if (S.suction === 'rwst') {
    S.rwstGal = Math.max(0, S.rwstGal - pumped * dt / 60);
    S.rwstPct = S.rwstGal / P.rwstGal * 100;
    if (S.rwstPct < P.rwstLoPct && opt.autoSwap !== false) S.suction = 'sump';
  }
  S.injectedGal += (pumped + accTot) * dt / 60;
  S.totalGpm = pumped + accTot;

  // ---------------- boron of the injected stream ----------------
  const num = (hh + si + lh) * P.rwstPpm + accTot * P.accPpm;
  S.boronPpm = S.totalGpm > 0.01 ? num / S.totalGpm : P.rwstPpm;

  S.alarms = {
    actuated: S.actuated,
    injecting: S.totalGpm > 1,
    accDischarging: S.acc.some(a => a.discharging),
    accEmpty: S.acc.some(a => a.empty),
    rwstLo: S.rwstPct < P.rwstLoPct,
    rwstEmpty: S.rwstPct < P.rwstEmptyPct,
    onSump: S.suction === 'sump',
    blocked: S.manualBlock
  };
  return { gpm: S.totalGpm, lbHr: S.totalGpm * 8.34 * 60, ppm: S.boronPpm };
}

/**
 * Individual valve lineup.
 *
 * Every pump in here already had a switch, but the DISCHARGE VALVES did not --
 * so a running pump could not be lined up or isolated, only started and
 * stopped.  On a real board those are separate handles for a reason: a pump
 * running against a shut discharge valve is a pump doing nothing, and that is a
 * failure mode the board has to be able to show.  Each valve gates the flow it
 * is in series with, so shutting one has the effect shutting it should.
 */
export function isolateAccumulators(S) { S.acc.forEach(a => a.isolated = true); }
export function setAccIsolation(S, i, isolated) {
  if (S.acc[i]) S.acc[i].isolated = !!isolated;
}
export function blockSI(S) { S.manualBlock = true; S.actuated = false; }
