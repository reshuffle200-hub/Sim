// ======================================================================
//  rods.js — control rod drive mechanism and digital rod position indication
//
//  Rods have been a single number.  `banks.ctrlDemand` is a step counter, every
//  bank position is derived from it, and reactivity is computed straight off
//  that -- so a rod is always exactly where it was told to go.  There is no
//  drive shaft, no measurement, and therefore no way to pose the question the
//  instrument exists to answer.
//
//  DRPI IS A MEASUREMENT, NOT A READOUT.  That distinction is the whole point
//  and it is worth being explicit about, because a simulator that reports
//  `ctrlDemand` on a display labelled DRPI has not modelled the instrument, it
//  has modelled a mirror.  The step counter counts pulses the rod control
//  system SENT.  DRPI senses the drive shaft itself: a stack of coils around
//  each pressure housing, the shaft being ferromagnetic, each coil's impedance
//  changing as the shaft passes it.  One counts intent, the other observes
//  position, and comparing them is how a dropped or stuck rod is found.
//
//  Consequences of it being a real instrument:
//
//    * It is COARSE.  Coils sit every six steps, so indication is quantised to
//      six steps and cannot be better than about +/-4 even when healthy.  A
//      rod that has slipped three steps is invisible.
//    * It is TWO CHANNELS.  Odd coils on channel A, even on channel B, in
//      separate cabinets.  Losing one does not lose indication -- it halves the
//      resolution, to twelve steps.  That is a degraded instrument, not a
//      failed one, and the board should say so.
//    * It can be WRONG.  A failed coil stack reads what it reads.
//
//  WHAT THIS DELIBERATELY DOES NOT MODEL.  A dropped rod's real danger is not
//  the reactivity it inserts -- that part is here and it is honest -- but the
//  RADIAL POWER TILT it causes.  Flux redistributes toward the opposite side of
//  the core and the DNBR penalty comes from that local peaking.  This model has
//  one thermal-hydraulic node and no radial or azimuthal shape, so there is
//  nowhere for a tilt to exist.  Inventing a DNBR penalty here would be a
//  fudge factor wearing the costume of physics, so there isn't one: the
//  reactivity and the INDICATION are real, the peaking consequence is absent,
//  and it stays absent until there is a spatial model to put it in.
// ======================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

//  A Westinghouse 3-loop core carries 48 rod cluster control assemblies.  Four
//  control banks and two shutdown banks, sized so the control banks are the
//  small ones -- they are the banks that move in normal operation.
export const GROUPS = [
  { id: 'CA', name: 'CONTROL A',  kind: 'ctrl', idx: 0, n: 4 },
  { id: 'CB', name: 'CONTROL B',  kind: 'ctrl', idx: 1, n: 4 },
  { id: 'CC', name: 'CONTROL C',  kind: 'ctrl', idx: 2, n: 8 },
  { id: 'CD', name: 'CONTROL D',  kind: 'ctrl', idx: 3, n: 8 },
  { id: 'SA', name: 'SHUTDOWN A', kind: 'sd',   idx: 0, n: 12 },
  { id: 'SB', name: 'SHUTDOWN B', kind: 'sd',   idx: 1, n: 12 }
];

//  CORE MAP.  A 157-assembly core is a 13x13 lattice with three assemblies cut
//  from each corner -- 169 minus 12 -- which is why the row widths below sum to
//  exactly 157.  Rows are lettered A to N skipping I, as reactor engineers
//  label them, because I reads as a 1.
//
//  The RCCA pattern is generated rather than transcribed: twelve seed positions
//  on alternate lattice sites, each rotated four ways about the centre, giving
//  48 assemblies with four-fold symmetry and no centre rod.  It is a
//  REPRESENTATIVE pattern, not a specific plant's core loading -- what is real
//  and worth relying on is the symmetry and the count, both of which the tests
//  assert.  Nothing physical is derived from a rod's map position; the map is
//  for the eye, because a dropped rod means something different at the core
//  centre than at the periphery and a list of forty-eight numbers cannot show
//  that.
export const CORE_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N'];
export const ROW_WIDTHS = [9, 11, 13, 13, 13, 13, 13, 13, 13, 13, 13, 11, 9];
const CENTRE = 6;

export function inCore(r, c) {
  if (r < 0 || r > 12 || c < 0 || c > 12) return false;
  return Math.abs(c - CENTRE) <= (ROW_WIDTHS[r] - 1) / 2;
}

/** The 48 RCCA locations, four-fold symmetric, ordered centre outwards. */
export function rccaLocations() {
  const orbit = (dr, dc) => [[dr, dc], [-dc, dr], [-dr, -dc], [dc, -dr]];
  const cand = [];
  for (let dr = -CENTRE; dr <= CENTRE; dr++)
    for (let dc = -CENTRE; dc <= CENTRE; dc++) {
      if (dr === 0 && dc === 0) continue;
      if ((dr + dc) % 2 !== 0) continue;
      cand.push([dr, dc, dr * dr + dc * dc]);
    }
  cand.sort((a, b) => a[2] - b[2]);
  const used = new Set(), out = [];
  for (const [dr, dc] of cand) {
    if (out.length >= 48) break;
    const orb = orbit(dr, dc);
    if (orb.some(([a, b]) => used.has(a + ',' + b))) continue;
    if (!orb.every(([a, b]) => inCore(CENTRE + a, CENTRE + b))) continue;
    for (const [a, b] of orb) {
      used.add(a + ',' + b);
      out.push({ row: CENTRE + a, col: CENTRE + b,
                 id: CORE_ROWS[CENTRE + a] + (CENTRE + b + 1) });
    }
  }
  return out;
}

//  DADS — the DRPI Advanced Display System.
//
//  Modelled against the Westinghouse data sheet rather than invented, which is
//  why the vocabulary here is theirs: HALF ACCURACY MODE, DATA CABINETS, GRAY
//  CODES, redundant display trains, integrated rod drop testing.  The features
//  that made it into this model are the ones an operator can see the effect of:
//
//    half accuracy   the laptop can force an individual rod to single-channel
//                    operation to limit the impact of a coil failure.  This is
//                    the real name for the degraded mode already modelled here,
//                    and it is a CHOICE as well as a failure -- you accept
//                    twelve-step resolution to keep an indication you trust.
//    data cabinets   rods are addressed in groups, so a cabinet fault takes out
//                    a set of rods at once rather than one.  Diagnosing which
//                    cabinet is the point of the advanced diagnostics.
//    Gray code       the coil stack reports position Gray-coded, one bit
//                    changing per transition, so a read caught mid-transition
//                    is off by one step and not by half the core.
//    two trains      redundant displays; maintenance on one while the other
//                    keeps indicating, and either alone shows every rod.
//    rod drop test   integrated and automatic, timed off the trip breaker.
//
//  Not modelled: error-log playback, cRIO resource status, backlight heartbeat
//  monitoring, hot-swappable supplies. Those are maintenance-side features with
//  nothing for an operator at the board to observe.
export const N_CABINETS = 4;

/** Gray code of the coil count, as the data cabinets actually report it. */
export function grayCode(steps, spacing) {
  const n = Math.max(0, Math.round(steps / spacing));
  const g = n ^ (n >> 1);
  return g.toString(2).padStart(6, '0');
}

export function rodParams() {
  return {
    coilSpacing: 6,            // steps between DRPI coils
    driveStepsMin: 72,         // maximum drive speed, steps per minute
    dropSec: 2.2,              // gravity insertion time, rods free to bottom
    slipStepsMin: 0,           // a slipping rod's drift, set per rod

    // Deviation alarms.  The setpoint has to be wider than the instrument's own
    // resolution or the alarm is measuring the instrument, not the rod.
    deviationSteps: 12,
    bankDeviationSteps: 12,
    rodBottomSteps: 6,

    // Rod insertion limit: a SETPOINT, not physics.  The real curve is
    // plant-specific and this one is representative -- what it encodes
    // faithfully is the shape, that the limit rises with power because the
    // shutdown margin available from the remaining banks has to cover a larger
    // trip.  Treated like every other alarm setpoint in this model.
    rilBase: 40,               // steps at zero power
    rilSlope: 130,             // additional steps per unit power
    rilMarginSteps: 20,        // low-low alarm below the limit

    tauDrive: 0.4,             // s, drive response lag

    // Rod drop testing, integrated per the data sheet and timed off the trip
    // breaker.  The acceptance criterion is time to dashpot entry.
    dropTestLimitSec: 2.4,
    dashpotSteps: 20           // dashpot entry, where the drop timing stops
  };
}

export function makeRods(P, stepsPerBank = 228) {
  const rods = [];
  const loc = rccaLocations();
  let li = 0;
  for (const g of GROUPS) {
    for (let k = 0; k < g.n; k++) {
      const L = loc[li++] || { row: 6, col: 6, id: '--' };
      rods.push({
        core: L.id, row: L.row, col: L.col,
        id: `${g.id}-${k + 1}`, group: g.id, kind: g.kind, bank: g.idx,
        demand: stepsPerBank, actual: stepsPerBank,
        stuck: false, dropped: false, slip: 0, halfAccuracy: false,
        drpiA: true, drpiB: true          // both coil channels healthy
      });
    }
  }
  return {
    rods, stepsPerBank,
    // Display trains: either alone shows every rod, which is the point of the
    // redundancy -- a failed train degrades maintenance access, not indication.
    trainA: true, trainB: true,
    cabinet: rods.map((_, i) => i % N_CABINETS),
    cabinetOK: Array.from({ length: N_CABINETS }, () => true),
    gray: rods.map(() => '000000'),
    dropTest: { running: false, t: 0, times: rods.map(() => null), done: false },
    events: [],

    drpi: rods.map(() => stepsPerBank),
    deviation: rods.map(() => 0),
    alarms: {}, anyDropped: false, anyStuck: false, anyDeviation: false,
    degradedChannels: 0
  };
}

/**
 * DRPI reading for one rod.
 *
 * Both channels healthy: coils every `spacing` steps.  One channel: every
 * other coil is gone, so the effective spacing doubles.  Neither: no
 * indication at all, which is reported as null rather than as zero -- a rod
 * with no position indication is not a rod at the bottom, and conflating those
 * two is exactly the confusion that gets a shutdown margin calculation wrong.
 */
export function readDRPI(P, rod, stepsPerBank, cabinetOK = true) {
  // A dead data cabinet takes its whole group of rods with it -- that is why
  // the diagnostics bother to identify WHICH cabinet.
  if (!cabinetOK) return null;
  // Half accuracy is either forced from the maintenance laptop or the
  // consequence of losing a channel; the instrument cannot tell the difference
  // and neither should this.
  const n = rod.halfAccuracy ? 1 : (rod.drpiA ? 1 : 0) + (rod.drpiB ? 1 : 0);
  if (n === 0) return null;
  const spacing = P.coilSpacing * (n === 1 ? 2 : 1);
  const q = Math.round(rod.actual / spacing) * spacing;
  return clamp(q, 0, stepsPerBank);
}

/**
 * One step of the drive mechanism.
 *
 *   demand = { ctrl: [4 bank positions], sd: [2 bank positions] }
 *
 * The mechanism is a magnetic jack: three coils latch grooves in the drive
 * shaft and walk it in discrete steps.  It is fail-safe by construction --
 * de-energise the coils and every gripper releases -- which is why a reactor
 * trip is physically just opening the trip breakers, and why a dropped rod
 * falls at gravity rather than driving in.
 */
export function stepRods(P, R, demand, dt, opt = {}) {
  const S = R.stepsPerBank;
  const tripped = opt.tripped === true;
  const maxMove = P.driveStepsMin / 60 * dt;

  for (let i = 0; i < R.rods.length; i++) {
    const rod = R.rods[i];
    const bankDemand = rod.kind === 'ctrl'
      ? (demand.ctrl[rod.bank] ?? S)
      : (demand.sd[rod.bank] ?? S);
    // The step counter counts whole pulses.  Leaving it fractional made every
    // deviation reading a long decimal that no counter could ever display.
    rod.demand = Math.round(clamp(bankDemand, 0, S));

    if (rod.stuck) {
      // A stuck rod is MECHANICALLY BOUND, so it does not move for the drive
      // and it does not move for gravity either.  Testing the trip first meant
      // a stuck rod still fell on a scram, which quietly defeated the one
      // condition that matters most after a trip: a rod that failed to insert.
      // The counter, meanwhile, keeps counting -- it is counting pulses sent.
    } else if (tripped || rod.dropped) {
      // gravity, not the drive: full insertion in a couple of seconds
      rod.actual = Math.max(0, rod.actual - S / P.dropSec * dt);
    } else {
      const want = rod.demand - rod.actual;
      const move = clamp(want, -maxMove, maxMove);
      rod.actual = clamp(rod.actual + move, 0, S);
      if (rod.slip) rod.actual = clamp(rod.actual - rod.slip / 60 * dt, 0, S);
    }

    R.drpi[i] = readDRPI(P, rod, S, R.cabinetOK[R.cabinet[i]]);
    R.gray[i] = R.drpi[i] === null ? '------' : grayCode(R.drpi[i], P.coilSpacing);
    // Deviation is measured against INDICATION, because that is all an
    // operator has.  A rod that has slipped less than the coil spacing is
    // genuinely undetectable and the model should not pretend otherwise.
    R.deviation[i] = R.drpi[i] === null ? 0 : Math.round(R.drpi[i] - rod.demand);
  }

  // ---- group statistics ----
  R.groups = GROUPS.map(g => {
    const idx = R.rods.map((r, i) => [r, i]).filter(([r]) => r.group === g.id);
    const read = idx.map(([, i]) => R.drpi[i]).filter(v => v !== null);
    const lo = read.length ? Math.min(...read) : null;
    const hi = read.length ? Math.max(...read) : null;
    return {
      id: g.id, name: g.name, n: g.n,
      demand: idx.length ? idx[0][0].demand : 0,
      lo, hi, spread: read.length ? hi - lo : 0,
      noIndication: idx.length - read.length
    };
  });

  R.anyDropped = R.rods.some((r, i) =>
    R.drpi[i] !== null && R.drpi[i] <= P.rodBottomSteps && r.demand > P.rodBottomSteps);
  R.anyStuck = R.rods.some(r => r.stuck);
  R.anyDeviation = R.deviation.some((d, i) =>
    R.drpi[i] !== null && Math.abs(d) > P.deviationSteps);
  R.degradedChannels = R.rods.filter(r => r.halfAccuracy || !r.drpiA || !r.drpiB).length;
  R.forcedHalf = R.rods.filter(r => r.halfAccuracy).length;
  R.cabinetsFailed = R.cabinetOK.filter(v => !v).length;

  // ---- integrated rod drop test ----
  // Timed off the trip breaker, per the data sheet. The criterion is time to
  // DASHPOT ENTRY, not to zero: the dashpot decelerates the last stretch, so
  // timing to the bottom would measure the dashpot rather than the drop.
  const D = R.dropTest;
  if (D.running) {
    D.t += dt;
    for (let i = 0; i < R.rods.length; i++)
      if (D.times[i] === null && R.rods[i].actual <= P.dashpotSteps) D.times[i] = D.t;
    if (D.times.every(t => t !== null) || D.t > P.dropTestLimitSec * 6) {
      D.running = false; D.done = true;
    }
  }

  R.alarms = {
    rodDeviation:   R.anyDeviation,
    rodBottom:      R.anyDropped,
    rodStuck:       R.anyStuck && !tripped,
    bankMisaligned: R.groups.some(g => g.spread > P.bankDeviationSteps),
    drpiDegraded:   R.degradedChannels > 0,
    drpiLost:       R.rods.some(r => !r.drpiA && !r.drpiB),
    urgentFailure:  R.rods.some(r => r.stuck) || R.anyDropped,
    notAtBottom:    tripped && R.rods.some(r => r.actual > P.rodBottomSteps),
    halfAccuracy:   R.forcedHalf > 0,
    cabinetFault:   R.cabinetsFailed > 0,
    trainFault:     !R.trainA || !R.trainB,
    displayLost:    !R.trainA && !R.trainB,
    dropTestFail:   R.dropTest.done && R.dropTest.times.some(
                      t => t === null || t > P.dropTestLimitSec)
  };
  return R;
}

/**
 * Rod reactivity [pcm] from ACTUAL positions rather than from the counter.
 *
 * Bank worth is apportioned equally among the rods in the bank, and each rod
 * contributes its own integral worth.  When every rod sits at its bank demand
 * this reduces EXACTLY to the bank-level formula in reactivity.js -- the shares
 * sum back to the whole -- so nothing changes on a healthy core, and a
 * misaligned or dropped rod is expressible for the first time.
 *
 * `bankIntegral` is passed in rather than imported so this module does not
 * depend on reactivity.js and can be tested on its own.
 */
export function rodWorthActual(rxP, R, bankIntegral) {
  const S = R.stepsPerBank;
  let w = 0;
  for (const g of GROUPS) {
    const total = g.kind === 'ctrl' ? rxP.ctrlBankWorth[g.idx] : rxP.sdBankWorth[g.idx];
    const share = total / g.n;
    for (const rod of R.rods) {
      if (rod.group !== g.id) continue;
      w += share * (bankIntegral(rod.actual, S) - 1);
    }
  }
  return w;
}

/**
 * Rod insertion limit for the current power, on the demand counter.
 * Returns the limit and how much margin is left to it.
 */
export function insertionLimit(P, powerFrac, ctrlDemand) {
  const limit = P.rilBase + P.rilSlope * clamp(powerFrac, 0, 1);
  return {
    limit,
    margin: ctrlDemand - limit,
    lo: ctrlDemand < limit + P.rilMarginSteps,
    loLo: ctrlDemand < limit
  };
}

/** Align every rod to its demand: the lineup a healthy core starts from. */
export function alignRods(R, demand) {
  const S = R.stepsPerBank;
  for (const rod of R.rods) {
    rod.demand = clamp(rod.kind === 'ctrl'
      ? (demand.ctrl[rod.bank] ?? S) : (demand.sd[rod.bank] ?? S), 0, S);
    rod.actual = rod.demand;
    rod.dropped = false; rod.stuck = false; rod.slip = 0;
  }
  return R;
}

/** Start the integrated rod drop test. Requires the rods to be free to fall. */
export function startDropTest(R) {
  R.dropTest = { running: true, t: 0, times: R.rods.map(() => null), done: false };
  R.events.push({ t: Date.now(), what: 'ROD DROP TEST STARTED' });
}
/** Force a rod to single-channel operation from the maintenance laptop. */
export function setHalfAccuracy(R, id, on) {
  const r = find(R, id);
  if (r) r.halfAccuracy = !!on;
}
export function failCabinet(R, n, ok = false) { R.cabinetOK[n] = ok; }

export function dropRod(R, id)    { const r = find(R, id); if (r) r.dropped = true; }
export function stickRod(R, id)   { const r = find(R, id); if (r) r.stuck = true; }
export function slipRod(R, id, s) { const r = find(R, id); if (r) r.slip = s; }
export function healRod(R, id) {
  const r = find(R, id);
  if (r) { r.dropped = false; r.stuck = false; r.slip = 0; r.drpiA = true; r.drpiB = true; }
}
export function failDRPI(R, id, ch) {
  const r = find(R, id);
  if (!r) return;
  if (ch === 'A' || ch === 'both') r.drpiA = false;
  if (ch === 'B' || ch === 'both') r.drpiB = false;
}
function find(R, id) {
  return typeof id === 'number' ? R.rods[id] : R.rods.find(r => r.id === id);
}
