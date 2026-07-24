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
    surAlarmDpm: 0.8
  };
}

export function makeStartup(P) {
  return {
    srCps: 0, srDecades: 0, irAmps: 0, prPct: 0,
    surDpm: 0, doublingS: Infinity,
    points: [],                  // formal 1/M data points
    baseCps: null,               // CR0, the reference count rate
    invM: 1, ecpPpm: null, ecpR2: 0,
    blocked: false, alarms: {}
  };
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
 */
export function stepStartup(P, S, nPower, period, dt) {
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
  S.baseCps = Math.max(S.srCps, 1e-6);
  S.points = [{ ppm, rods, cps: S.baseCps, invM: 1 }];
  S.invM = 1;
  return S;
}

/** Log a formal 1/M data point at the current condition. */
export function takePoint(S, ppm, rods) {
  if (!S.baseCps) takeBaseline(S, ppm, rods);
  const invM = clamp(S.baseCps / Math.max(S.srCps, 1e-6), 0, 2);
  S.points.push({ ppm, rods, cps: S.srCps, invM });
  fitECP(S);
  return S.points[S.points.length - 1];
}

/**
 * Least-squares fit of 1/M against boron and extrapolate to 1/M = 0.
 * That intercept is the estimated critical boron.
 */
export function fitECP(S) {
  const pts = S.points.filter(p => p.invM > 0.02 && p.invM <= 1.05);
  if (pts.length < 3) { S.ecpPpm = null; S.ecpR2 = 0; return null; }
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  const n = pts.length;
  for (const p of pts) { sx += p.ppm; sy += p.invM; sxx += p.ppm * p.ppm;
                         sxy += p.ppm * p.invM; syy += p.invM * p.invM; }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-9) { S.ecpPpm = null; return null; }
  const m = (n * sxy - sx * sy) / den;
  const b = (sy - m * sx) / n;
  if (Math.abs(m) < 1e-12) { S.ecpPpm = null; return null; }
  S.ecpPpm = -b / m;                        // where the line crosses 1/M = 0
  const num = n * sxy - sx * sy;
  S.ecpR2 = (num * num) / Math.max(den * (n * syy - sy * sy), 1e-12);
  return S.ecpPpm;
}

export function clearPoints(S) { S.points = []; S.baseCps = null; S.ecpPpm = null; S.invM = 1; }
