// ======================================================================
//  startup.js — source range instrumentation, 1/M, estimated critical
//
//  Taking a reactor critical is done blind on flux alone: the count rate
//  climbs, but a climbing count rate never tells you HOW CLOSE you are.
//  1/M does.
//
//  With a neutron source present, the subcritical steady flux is
//        n = -S * Lambda / rho
//  so the multiplication M = n/n0 satisfies  1/M = rho/rho0.  Reactivity is
//  very nearly linear in boron, so a plot of 1/M against boron concentration
//  is a STRAIGHT LINE THAT REACHES ZERO AT CRITICALITY.  Extrapolating it
//  predicts the critical boron before you get there -- which is the whole
//  point, because arriving at criticality unexpectedly is how you get a
//  startup accident.
//
//  Count rate is reported with Poisson noise, because at a few hundred counts
//  per second the statistical scatter is what makes the plot hard to read and
//  is precisely why you take a formal data point and wait for it to settle
//  rather than watching the needle.
// ======================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function startupParams() {
  return {
    srCountsPerPower: 2.2e13,   // counts/s per unit of rated power fraction
    srMaxCps: 1e6,              // source range trips off scale here
    irMinAmps: 1e-11, irMaxAmps: 1e-3,
    prMinPower: 1e-4,
    detEff: 1.0,
    poisson: true,
    // high flux at shutdown alarm, source range
    srHiCps: 1e5,
    // startup rate limits
    surLimitDpm: 1.0,           // technical specification, decades per minute
    surAlarmDpm: 0.8,
    // formal data points are INTEGRATED, not sampled off the meter
    avgWindowS: 60,             // integration time for a formal 1/M point, s
    steadyPpmRate: 0.01,        // ppm/s below which boron counts as steady
  };
}

export function makeStartup(P) {
  return {
    srCps: 0, srDecades: 0, irAmps: 0, prPct: 0,
    surDpm: 0, doublingS: Infinity,
    points: [],                  // formal 1/M data points
    baseCps: null,               // CR0, the reference count rate
    invM: 1,
    ecpPpm: null, ecpR2: 0,      // extrapolation against boron
    ecpRods: null, ecpRodsR2: 0, // extrapolation against rod position
    fitPpm: null, fitRods: null,
    srCpsAvg: 0, avgSeconds: 0, avgTrueCps: 0, steady: false,
    _avgSum: 0, _avgDur: 0, _avgTick: 0, _lastPpm: null, _lastRods: null,
    blocked: false, alarms: {}
  };
}

/** Standard normal deviate. */
function gauss() {
  const u = Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u + 1e-12)) * Math.cos(2 * Math.PI * v);
}

/**
 * A count rate as measured by integrating for T seconds.
 *
 * Counts collected are lambda*T with standard deviation sqrt(lambda*T), so the
 * RATE derived from them has sigma = sqrt(lambda/T).  Integrating longer buys
 * precision as sqrt(T) -- which is the entire reason a formal 1/M point is a
 * timed count and not a glance at the meter.  At 130 cps a one-second look
 * scatters about 9%; a 60-second integration scatters about 1.1%, and only the
 * second of those is good enough to fit a line through.
 */
function integratedRate(lambda, T) {
  if (lambda <= 0 || T <= 0) return 0;
  return Math.max(0, lambda + gauss() * Math.sqrt(lambda / T));
}

/** Poisson-ish scatter on a count rate. */
function noisy(cps) {
  if (cps <= 0) return 0;
  // normal approximation to Poisson for a 1 s count
  const s = Math.sqrt(cps);
  const u = Math.random(), v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u + 1e-12)) * Math.cos(2 * Math.PI * v);
  return Math.max(0, cps + z * s);
}

/**
 * One step.
 *   nPower  neutron power as a fraction of rated (k.P)
 *   period  reactor period, s
 *   cond    {ppm, rods} — optional, lets the integrating counter tell whether
 *           conditions are steady enough for a formal count to mean anything
 */
export function stepStartup(P, S, nPower, period, dt, cond = null) {
  const trueCps = clamp(nPower * P.srCountsPerPower * P.detEff, 0, P.srMaxCps * 10);
  S.srCpsTrue = trueCps;
  S.srCps = P.poisson && trueCps < 1e6 ? noisy(trueCps) : trueCps;
  S.srDecades = S.srCps > 0 ? Math.log10(Math.max(S.srCps, 1e-2)) : -2;
  S.onScaleSR = trueCps < P.srMaxCps;

  S.irAmps = clamp(nPower * 1e-3, P.irMinAmps, P.irMaxAmps);
  S.prPct = nPower * 100;
  S.onScalePR = nPower > P.prMinPower;

  // startup rate in decades per minute
  S.surDpm = (isFinite(period) && Math.abs(period) > 1e-6) ? 26 / period : 0;
  S.doublingS = (isFinite(period) && period > 0) ? period * Math.LN2 : Infinity;

  // ---- integrating counter -------------------------------------------
  // Accumulates only while conditions are STEADY.  Diluting or moving rods
  // invalidates the integration in progress, exactly as it would in practice:
  // you make the change, then you wait, then you count.
  if (cond) {
    const dPpm = (S._lastPpm == null) ? 0 : Math.abs(cond.ppm - S._lastPpm) / Math.max(dt, 1e-9);
    const dRod = (S._lastRods == null) ? 0 : Math.abs(cond.rods - S._lastRods);
    S.steady = dPpm < P.steadyPpmRate && dRod < 1e-9;
    S._lastPpm = cond.ppm; S._lastRods = cond.rods;
  } else S.steady = true;

  if (!S.steady) { S._avgSum = 0; S._avgDur = 0; }
  else {
    S._avgSum += trueCps * dt;
    S._avgDur += dt;
    if (S._avgDur > P.avgWindowS) {           // slide the window
      const drop = S._avgDur - P.avgWindowS;
      S._avgSum -= (S._avgSum / S._avgDur) * drop;
      S._avgDur = P.avgWindowS;
    }
  }
  S.avgSeconds = S._avgDur;
  S.avgTrueCps = S._avgDur > 0 ? S._avgSum / S._avgDur : trueCps;
  // refresh the integrated reading once a second so it settles visibly
  S._avgTick += dt;
  if (S._avgTick >= 1 || S.srCpsAvg === 0) {
    S._avgTick = 0;
    S.srCpsAvg = P.poisson ? integratedRate(S.avgTrueCps, Math.max(S._avgDur, 1))
                           : S.avgTrueCps;
  }

  if (S.baseCps) S.invM = clamp(S.baseCps / Math.max(S.srCps, 1e-6), 0, 2);

  S.alarms = {
    srHi: S.srCps > P.srHiCps,
    surHi: S.surDpm > P.surAlarmDpm,
    surTrip: S.surDpm > P.surLimitDpm,
    offScale: !S.onScaleSR,
    critical: Math.abs(S.surDpm) > 0.02 && S.invM < 0.08
  };
  return S;
}

/** Take the reference count rate. Everything after is relative to this. */
export function takeBaseline(S, ppm, rods) {
  S.baseCps = Math.max(S.srCpsAvg || S.srCps, 1e-6);
  S.points = [{ ppm, rods, cps: S.baseCps, invM: 1, intS: S.avgSeconds || 0 }];
  S.invM = 1;
  S._avgSum = 0; S._avgDur = 0;          // start the next integration fresh
  return S;
}

/** Log a formal 1/M data point at the current condition. */
export function takePoint(S, ppm, rods) {
  if (!S.baseCps) { takeBaseline(S, ppm, rods); return S.points[0]; }
  const cps = Math.max(S.srCpsAvg || S.srCps, 1e-6);
  const invM = clamp(S.baseCps / cps, 0, 2);
  S.points.push({ ppm, rods, cps, invM, intS: S.avgSeconds || 0 });
  S._avgSum = 0; S._avgDur = 0;          // banked; integrate afresh for the next
  fitECP(S);
  return S.points[S.points.length - 1];
}

/**
 * Least-squares fit of 1/M against one independent variable, extrapolated to
 * 1/M = 0.  That intercept is the estimated critical condition.
 *
 * Works for either axis.  Boron and rod position approach criticality from
 * opposite directions -- diluting lowers ppm, withdrawing raises steps -- so
 * the slope is positive against boron and negative against rods.  Neither the
 * fit nor the extrapolation cares, but the guard on `den` does real work here:
 * if a variable never moved (rods parked through a pure dilution, which is the
 * normal way to do it) every x is identical, den is zero, and the fit has to
 * decline rather than return an intercept invented from noise.
 */
function fitAxis(pts, key) {
  const n = pts.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const x = p[key], y = p.invM;
    sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y;
  }
  const den = n * sxx - sx * sx;
  // spread guard: a variable that never moved cannot predict anything
  if (Math.abs(den) < 1e-9) return null;
  const m = (n * sxy - sx * sy) / den;
  const b = (sy - m * sx) / n;
  if (Math.abs(m) < 1e-12) return null;
  const num = n * sxy - sx * sy;
  const r2 = (num * num) / Math.max(den * (n * syy - sy * sy), 1e-12);
  return { slope: m, intercept: b, x0: -b / m, r2, n };
}

/**
 * Fit 1/M against BOTH boron and rod position.
 *
 * Two independent extrapolations of the same approach.  They are not
 * redundant: whichever variable is actually being moved carries the
 * information, and the other one degenerates and reports nothing.  Holding
 * both on the board means the prediction survives switching from dilution to
 * rod withdrawal partway up, which is how an approach is usually finished.
 */
export function fitECP(S) {
  const pts = S.points.filter(p => p.invM > 0.02 && p.invM <= 1.05);
  const fb = fitAxis(pts, 'ppm');
  const fr = fitAxis(pts, 'rods');
  S.fitPpm = fb;
  S.fitRods = fr;
  S.ecpPpm = fb ? fb.x0 : null;          // estimated critical boron, ppm
  S.ecpR2 = fb ? fb.r2 : 0;
  S.ecpRods = fr ? fr.x0 : null;         // estimated critical rod position, steps
  S.ecpRodsR2 = fr ? fr.r2 : 0;
  return S.ecpPpm;
}

export function clearPoints(S) {
  S.points = []; S.baseCps = null; S.invM = 1;
  S.ecpPpm = null; S.ecpR2 = 0; S.ecpRods = null; S.ecpRodsR2 = 0;
  S.fitPpm = null; S.fitRods = null;
  S._avgSum = 0; S._avgDur = 0;
}
