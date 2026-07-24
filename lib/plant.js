// ======================================================================
//  plant.js — integration of the whole primary and secondary
//
//  Until now every module was validated alone or in pairs, with its boundary
//  conditions ASSERTED.  That is exactly where the errors have been hiding all
//  session: asserted core flow, asserted steam flow, asserted secondary
//  temperature.  This module removes the assertions.  Nothing here is free:
//
//     core power        <- kinetics, driven by reactivity
//     reactivity        <- fuel temperature, Tavg, boron, rods, xenon
//     fuel temperature  <- core power and coolant temperature
//     Tavg              <- primary heat balance against the SGs
//     SG heat           <- (Thot - Tsec), and Tsec is now a STATE
//     Tsec              <- secondary inventory and energy
//     steam flow        <- turbine valves and dumps
//     feedwater         <- three-element control off SG level
//     feedwater temp    <- turbine extraction, hence load
//
//  Every one of those is a loop closing on the others.
// ======================================================================

import * as K from './kinetics.js';
import * as RX from './reactivity.js';
import * as FU from './fuel.js';
import * as R from './rcs.js';
import * as SGM from './sg.js';
import * as Z from './pzr.js';
import * as SEC from './secondary.js';
import * as PR from './props.js';
import * as EL from './elec.js';
import * as CV from './cvcs.js';
import * as RH from './rhr.js';
import * as SIM from './si.js';
import * as CN from './cnmt.js';
import * as RP from './rps.js';
import * as SU from './startup.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function makePlant(opt = {}) {
  const life = opt.life || 'MOL';
  const PL = {
    life,
    rx: RX.coreParams(life),
    fu: FU.fuelParams(),
    rp: R.rcsParams(),
    sp: SGM.sgParams(),
    zp: Z.pzrParams(),
    sc: SEC.secParams(),
    ep: EL.elecParams(),
    cp: CV.cvcsParams(),
    rh: RH.rhrParams(),
    sip: SIM.siParams(),
    cnp: CN.cnmtParams(),
    sup: SU.startupParams(),
    // states
    k: K.makeKinetics(),
    fp: RX.makeFP(),
    f: null, S: null, sgs: null, z: null, sec: null, E: null, cv: null, rhr: null, si: null, cnmt: null, rps: null, su: null,
    breakIn2: 0,
    borateGpm: 0, diluteGpm: 0,
    // operator-settable
    ppm: 0, banks: null, rodAuto: true, rodDeadbandF: 1.5,
    // outputs
    power: 0, Tref: 547, t: 0, dnbr: 99,
    lastBalance: null, mtc: 0, boronWorth: 0, _coefT: -99,
    trip: false, tripMsg: '', tripFirst: '',
    sim: { dt: 0.05, speed: 1 }
  };
  SEC.calibrateSec(PL.sc, PL.sp.Wsteam * PL.sp.nSG);
  PL.f = FU.makeFuel(PL.fu);
  PL.S = R.makeRCS(PL.rp);
  PL.sgs = SGM.makeSG(PL.sp);
  PL.z = Z.makePZR(PL.zp);
  PL.sec = SEC.makeSec(PL.sc);
  PL.E = EL.makeElec(PL.ep);
  PL.cv = CV.makeCVCS(PL.cp);
  PL.rhr = RH.makeRHR(PL.rh);
  PL.si = SIM.makeSI(PL.sip);
  PL.cnmt = CN.makeCnmt(PL.cnp);
  PL.rps = RP.makeRPS();
  PL.su = SU.makeStartup(PL.sup);
  PL.banks = RX.fullOutBanks(PL.rx);
  PL.banks.ctrlDemand = 520;
  return PL;
}

/**
 * Hot standby (Mode 3): the state a startup actually begins from.
 *
 * STABLE FOR ABOUT AN HOUR, NOT INDEFINITELY.
 *
 * The mechanism, traced: initSG produces a correct 50% indicated level on its
 * own.  During the settle, pump heat boils the risers, riser void builds, and
 * the SWELL term in the level indication -- swellGain * alphaRiser, worth up
 * to 11 ft against a 12 ft narrow-range span -- drives the indication to 96%.
 * The feed regulating valves then stay shut on level error while the steam
 * dumps steam off that same pump heat, so the generators drain about 15% per
 * half hour.  Near 90 minutes the level reaches the auxiliary feedwater
 * setpoint, 100 F water enters, the plant overcools and SI actuates.
 *
 * The fault is in the LEVEL INDICATION at low power, not in the mass:
 * swellGain was calibrated at the design point and over-weights the small
 * void present at hot standby.  trimToSetpoint() in sg.js adjusts mass and
 * therefore cannot fix it -- it solves the wrong variable.  Recalibrating the
 * swell term against void at low power is the actual repair.
 *
 * An approach to criticality takes well under an hour, so the startup path
 * works; a long hold at hot standby does not.

 *
 * The reactor is SUBCRITICAL, so there is no fission power to speak of and
 * the only heat is the reactor coolant pumps -- about 13.5 MW -- which the
 * steam dumps reject.  That makes it a far cleaner state to construct than
 * "5% power", which is why initPlant fails down there: at low power the
 * turbine, feedwater heating and steam flow are all in awkward regimes,
 * whereas at hot standby none of them are running at all.
 */
export function initHotStandby(PL, opt = {}) {
  const { rx, rp, sp, zp, sc } = PL;
  const Tavg = rx.TmodHZPF;                       // 547 F, no-load programme

  R.initSteady(rp, PL.S, Tavg, 2250, 0.25);       // no-load level programme
  // Secondary temperature must be set from the ACTUAL heat balance, not
  // guessed.  At hot standby the only heat is the pumps -- 13.5 MW less 1 MW
  // ambient -- which needs a primary-to-secondary difference of just 0.39 F.
  // Guessing 2 F drove 63 MW into the steam generators, five times the pump
  // heat: the plant cooled, pressure fell through 1865 psig, safety injection
  // actuated, and 163 gpm of 100 F RWST water then held it 28 F cold while
  // 2400 ppm borated water pushed the boron up.  Every symptom traced to one
  // guessed boundary condition.
  const NTU = rp.UAsg / (rp.Wrated * rp.cpRCS), effSG = 1 - Math.exp(-NTU);
  const Qhs = (rp.nLoops * rp.pumpHeatMW - rp.ambientLossMW) * 1e6 * 3.412142;
  const Tsec = Tavg - (Qhs / rp.nLoops) / (rp.Wrated * rp.cpRCS * effSG);
  const Psec = Math.max(PR.PsatT(Tsec), 30);
  PL.S.Tsec = [Tsec, Tsec, Tsec];

  PL.sgs = SGM.makeSG(sp);
  for (const sg of PL.sgs) { SGM.initSG(sp, sg, 0.02, Psec, 220); SGM.trimToSetpoint(sp, sg); }
  PL.sec = SEC.makeSec(sc);
  PL.sec.online = false;                          // turbine off line
  PL.sec.loadSet = 0; PL.sec.loadDemand = 0; PL.sec.valvePos = 0;
  PL.sec.dumpMode = 'tavg';
  PL.sec.TfwF = 220;
  for (let i = 0; i < sc.heaterStages.length; i++) PL.sec.stageT[i] = 220;

  // reactor subcritical with a source: flux is set by multiplication, not power
  // Source strength sized so the source range reads a realistic 10-100 cps
  // deep subcritical, rising to thousands near criticality.  At S = 1e-11 the
  // detector saw 0.09 counts per second -- nothing to plot 1/M against.
  PL.k = K.makeKinetics({ n: 1e-8, S: 1e-8 });
  RX.equilibrateFP(rx, PL.fp, 1e-6);
  PL.fp.X = 0; PL.fp.Sm = opt.xenonFree === false ? 1 : 0;
  PL.f = FU.makeFuel(PL.fu);
  PL.f.Tf = Tavg; PL.f.Tc = Tavg;
  PL.z = Z.makePZR(zp);
  PL.cv = CV.makeCVCS(PL.cp);
  PL.rhr = RH.makeRHR(PL.rh);
  PL.si = SIM.makeSI(PL.sip);
  PL.cnmt = CN.makeCnmt(PL.cnp);
  PL.rps = RP.makeRPS();
  PL.su = SU.makeStartup(PL.sup);
  PL.E = EL.makeElec(PL.ep);
  PL.E.genBkr = false;
  PL.banks = RX.fullInBanks(rx);                  // all rods in
  PL.banks.sd = [rx.stepsPerBank, rx.stepsPerBank];   // shutdown banks OUT
  PL.rodAuto = false;
  PL.trip = false; PL.tripMsg = ''; PL.tripFirst = '';
  PL.power = 0;

  // boron for a healthy shutdown margin below the all-rods-in critical value
  const stCrit = { TmodF: Tavg, psia: 2250, TfuelF: Tavg, ppm: 800,
                   banks: PL.banks, X: 0, Sm: PL.fp.Sm };
  PL.ppm = RX.criticalBoron(rx, stCrit) + (opt.marginPpm ?? 250);

  // Settle with safety injection blocked.  Any residual transient during
  // initialisation must not be allowed to actuate ECCS -- once it injects,
  // cold borated water changes the very state being established.
  // The approach to equilibrium at hot standby is SLOW: the driving
  // temperature difference is a fraction of a degree, so the primary and the
  // steam generators take many minutes to settle.  Run until Tavg and pressure
  // have both arrived rather than for a fixed number of steps, and keep safety
  // injection blocked throughout -- letting it inject cold borated water
  // during initialisation changes the very state being established.
  PL.si.manualBlock = true;
  const target = rx.TmodHZPF;
  for (let i = 0; i < 9000 / 0.05; i++) {
    stepPlant(PL, 0.05, { holdLoad: 0, noTrip: true });
    // pressurizer heaters drive pressure back to programme; the dumps and the
    // steam generators bring Tavg back to the no-load value
    if (i > 6000 && Math.abs(PL.S.Tavg - target) < 1.5 && PL.S.P - 14.7 > 2150) break;
  }
  PL.si.manualBlock = false;
  PL.si.actuated = false;
  PL.si.rwstGal = PL.sip.rwstGal; PL.si.rwstPct = 100;
  PL.cnmt = CN.makeCnmt(PL.cnp);
  PL.t = 0;
  return PL;
}

/** Programmed Tavg for a given load fraction. */
export function TrefOf(PL, load) {
  return PL.rx.TmodHZPF + (PL.rx.TmodRefF - PL.rx.TmodHZPF) * clamp(load, 0, 1);
}

/**
 * Bring the whole plant to a self-consistent steady state at a load fraction.
 * Runs the real coupled model rather than setting each module independently,
 * so the result is a state the dynamics will actually hold.
 */
/**
 * Bring the plant to a self-consistent steady state at a load fraction.
 *
 * VALID RANGE: about 0.25 to 1.05.  Below roughly 20% load the initialisation
 * does not converge -- feedwater is very cold, steam flow per unit power rises
 * sharply, and the pressurizer drains faster than charging can make up.  Low
 * power is the same regime the cold-startup path has to solve properly, with
 * RHR and a boration system, so it is left failing loudly rather than papered
 * over with a fudge.
 */
export function initPlant(PL, load, seconds = 900) {
  if (load < 0.22) console.warn('initPlant: loads below ~0.25 do not converge yet');
  const { rx, fu, rp, sp, zp, sc } = PL;
  const Tavg = TrefOf(PL, load);
  const Tcold = Tavg - rp.dTcore * load / 2;
  const Thot = Tavg + rp.dTcore * load / 2;

  // secondary temperature that the primary can actually sustain at this load
  const NTU = rp.UAsg / (rp.Wrated * rp.cpRCS), eff = 1 - Math.exp(-NTU);
  const Qsg = rp.Qrated * load / rp.nLoops;
  const Tsec = Thot - (Qsg * 3.412142) / (rp.Wrated * rp.cpRCS * eff);
  const Psec = Math.max(PR.PsatT(Tsec), 30);

  // primary
  R.initSteady(rp, PL.S, Tavg, 2250, 0.60);
  PL.S.Tsec = [Tsec, Tsec, Tsec];

  // secondary
  const TfwGuess = sc.hotwellF + (sc.TfwRated - sc.hotwellF) * Math.pow(clamp(load, 0, 1), 0.45);
  PL.sgs = SGM.makeSG(sp);
  for (const sg of PL.sgs) SGM.initSG(sp, sg, Math.max(load, 0.02), Psec, TfwGuess);
  PL.sec = SEC.makeSec(sc);
  PL.sec.online = load > 0.02;
  PL.sec.loadSet = load;
  PL.sec.loadDemand = load;
  PL.sec.valvePos = load;
  PL.sec.TfwF = TfwGuess;
  for (let i = 0; i < sc.heaterStages.length; i++) PL.sec.stageT[i] = TfwGuess;

  // core
  K.equilibrate(PL.k, Math.max(load, 1e-6));
  RX.equilibrateFP(rx, PL.fp, Math.max(load, 1e-6));
  const st = FU.steadyFuel(fu, load, Tavg);
  PL.f = FU.makeFuel(fu);
  PL.f.Tf = st.Tf; PL.f.Tc = st.Tc;
  PL.z = Z.makePZR(zp);
  PL.cv = CV.makeCVCS(PL.cp);
  PL.rhr = RH.makeRHR(PL.rh);
  PL.si = SIM.makeSI(PL.sip);
  PL.cnmt = CN.makeCnmt(PL.cnp);
  PL.rps = RP.makeRPS();
  PL.su = SU.makeStartup(PL.sup);
  PL.E = EL.makeElec(PL.ep);
  PL.E.genBkr = load > 0.02;
  PL.E.Eqp = 1.6; PL.E.Efd = 1.6; PL.E.avrInt = 1.6;
  PL.E.delta = 0.4 * load;
  PL.power = load;

  // boron that holds it critical here
  PL.ppm = RX.criticalBoron(rx, {
    TmodF: Tavg, psia: 2250, TfuelF: st.Tf, ppm: 800,
    banks: PL.banks, X: PL.fp.X, Sm: PL.fp.Sm
  });

  // Settle on the real coupled model.  Rod control must be OFF here: boron is
  // already being trimmed to hold criticality, so leaving rods in automatic
  // makes them chase the same error and drive fully in, leaving no authority.
  // Settle with boron holding the reactor at the target power, and correct the
  // turbine setpoint ALGEBRAICALLY so steam flow removes exactly that power.
  //
  // Steam flow is not proportional to load.  Feedwater is far colder at part
  // load, so each pound of steam carries more energy: at 40% load a pound
  // absorbs about 890 Btu against 780 at full power, and 40% of rated flow
  // removes roughly 46% of rated heat.  A real reactor follows the turbine and
  // rides that out.  A reactor pinned by boron cannot, and the plant overcooled
  // to 476 F and tripped low pressure.  The correction below is direct rather
  // than a feedback trim -- a Tavg integral on the load setpoint went unstable
  // and drove the turbine shut.
  const rodSave = PL.rodAuto;
  PL.rodAuto = false;
  PL.banks.ctrlDemand = 520;
  const dt = 0.05;
  for (let i = 0; i < seconds / dt; i++) {
    if (i % 40 === 0) {
      const hg = PR.hgP(PL.sgs[0].Psec), hfw = PR.hfT(PL.sec.TfwF);
      const Wneed = (load * rp.Qrated * 3.412142) / Math.max(hg - hfw, 1);
      PL.sec.loadSet = clamp(Wneed / sc.Wrated, 0.002, 1.15);
      PL.sec.loadDemand = PL.sec.loadSet;
    }
    stepPlant(PL, dt, { holdCritical: true, holdLoad: load, noTrip: true });
  }
  PL.rodAuto = rodSave;
  PL.t = 0;
  return PL;
}

/**
 * One coupled step of the entire plant.
 */
export function stepPlant(PL, dt, opt = {}) {
  const { rx, fu, rp, sp, zp, sc } = PL;
  const S = PL.S, sgs = PL.sgs, sec = PL.sec, z = PL.z, f = PL.f;

  // ---------- 0. automatic rod control ----------
  // Westinghouse rod control runs on the Tavg error against the programmed
  // Tref, with a deadband and a speed that ramps with the error.  Without it
  // nothing pins Tavg to programme and it sits wherever the heat balance
  // leaves it.
  if (PL.rodAuto && !PL.trip) {
    const err = S.Tavg - PL.Tref;                 // positive = too hot = insert
    const db = PL.rodDeadbandF ?? 1.5;
    if (Math.abs(err) > db) {
      const over = Math.abs(err) - db;
      const spd = clamp(8 + over * 26, 8, 72);    // steps per minute
      const dir = err > 0 ? -1 : +1;              // hot -> insert
      PL.banks.ctrlDemand = clamp(
        PL.banks.ctrlDemand + dir * spd / 60 * dt, 0,
        3 * (rx.stepsPerBank - rx.overlap) + rx.stepsPerBank);
    }
  }

  // ---------- 1. reactivity from the present state ----------
  const rhoObj = RX.total(rx, {
    TmodF: S.Tavg, psia: S.P, TfuelF: f.Tf, ppm: PL.ppm,
    banks: PL.banks, X: PL.fp.X, Sm: PL.fp.Sm
  });
  let rho = rhoObj.total;
  PL.lastBalance = rhoObj;                      // exposed for the reactor board
  if (!PL._coefT || PL.t - PL._coefT > 2) {     // coefficients are costly; refresh slowly
    PL._coefT = PL.t;
    const st = { TmodF: S.Tavg, psia: S.P, TfuelF: f.Tf, ppm: PL.ppm,
                 banks: PL.banks, X: PL.fp.X, Sm: PL.fp.Sm };
    PL.mtc = RX.mtc(rx, st);
    PL.boronWorth = RX.boronWorth(rx, st);
  }
  if (opt.holdCritical) {
    // during initialisation only: trim boron to hold criticality
    PL.ppm += rhoObj.pcm * 0.02;
    rho = 0;
  }
  if (PL.trip) rho -= 0.09;                     // rods in

  // ---------- 2. neutronics ----------
  K.stepKinetics(PL.k, rho, dt);
  RX.stepFP(rx, PL.fp, PL.k.P, dt);
  PL.power = PL.k.Ptot;

  // ---------- 3. fuel ----------
  FU.stepFuel(fu, f, PL.k.Ptot, S.Tavg, dt);

  // ---------- 4. secondary: turbine, dumps, feedwater ----------
  const load = opt.holdLoad !== undefined ? opt.holdLoad
             : clamp(sec.Wturb / Math.max(sc.Wrated, 1), 0, 1.2);
  PL.Tref = TrefOf(PL, load);
  SEC.stepSec(sc, sec, sgs, S.Tavg, PL.Tref, dt);

  // ---------- 5. steam generators ----------
  const demand = SEC.steamDemand(sc, sec, sp.nSG);
  for (let i = 0; i < sp.nSG; i++) {
    const fw = SEC.feedTo(sc, sec, i);
    sgs[i].msivOpen = sec.msivOpen[i];
    const Qin = S.Qsg[i] / 3.412142;             // Btu/hr -> W, from the primary
    SGM.stepSG(sp, sgs[i], Qin, fw.W, fw.T, demand[i], dt);
    // hand the secondary state back to the primary
    S.Tsec[i] = sgs[i].Tsat;
    S.sgHtFactor[i] = sgs[i].htFactor;
  }

  // ---------- 6. pressurizer control ----------
  Z.stepPZR(zp, z, S.P, S.pzrLevel * 100, S.Tavg, S.Tcold[0], dt);

  // ---------- 6a. chemical and volume control ----------
  // Boron is a plant state now, not an operator variable: it moves only when
  // the boric acid or primary water pumps run, at the rate the mass balance
  // allows, and with the transport lag of the charging line and the loops.
  if (!opt.holdCritical) {
    PL.ppm = CV.stepCVCS(PL.cp, PL.cv, PL.ppm, R.totalMass(S), dt,
      { borateGpm: PL.borateGpm, diluteGpm: PL.diluteGpm });
  }

  // ---------- 6b. electrical ----------
  // Turbine shaft power drives the generator; bus voltage drives the RCPs.
  // This is the only path by which the grid can reach the core.
  const safetyLoadMW = PL.ep.safetyBaseMW + (PL.trip ? 2.0 : 0);
  EL.stepElec(PL.ep, PL.E, sec.MWe, safetyLoadMW, dt);
  for (let i = 0; i < rp.nLoops; i++) {
    if (!PL.E.rcpOn[i] && S.pumpOn[i]) S.pumpOn[i] = false;
  }

  // ---------- 6b2. emergency core cooling ----------
  // Break area is set by the operator; SI actuates on its own from pressure.
  S.breakArea = (PL.breakIn2 || 0) / 144;              // in^2 -> ft^2
  // Containment receives whatever leaves the break, and its pressure is an
  // actuation signal in its own right: high containment pressure starts SI
  // even when RCS pressure has not fallen far enough to do it.
  const hBreak = S.nodes[S.idx[S.breakNode] !== undefined ? S.idx[S.breakNode] : S.idx.CLA].h;
  CN.stepCnmt(PL.cnp, PL.cnmt, S.breakFlow || 0, hBreak, dt, {});
  const inj = SIM.stepSI(PL.sip, PL.si, S.P, dt, { containmentHigh: PL.cnmt.hiPressure });
  S.siFlow = inj.lbHr;
  // injected water is heavily borated, so it dilutes the RCS toward RWST boron
  if (inj.lbHr > 1 && !opt.holdCritical) {
    const M = R.totalMass(S);
    PL.ppm += (inj.lbHr * (inj.ppm - PL.ppm) / Math.max(M, 1)) * (dt / 3600);
  }

  // ---------- 6c. residual heat removal ----------
  PL.rhr.decayMW = PL.k.Pdecay * rp.Qrated / 1e6;
  const Qrhr = RH.stepRHR(PL.rh, PL.rhr, S.P, S.Thot[0], S.Tavg, R.totalMass(S), dt);

  // ---------- 7. primary ----------
  R.stepRCS(rp, S, PL.k.Ptot * rp.Qrated, dt, {
    Qpzr: z.Qpzr, Wspray: z.sprayLbHr, Wrelief: z.Wrelief,
    chargeLbHr: z.chargeLbHr, letdownLbHr: z.letdownLbHr,
    // Charging passes through the REGENERATIVE heat exchanger, where letdown
    // preheats it to roughly 490 F.  Injecting it at 120 F -- which is what
    // this did -- removed about 12 MW at full charging flow and cooled the
    // plant faster than the pressurizer heaters could recover it, so a clean
    // turbine trip drove pressure through the safety injection setpoint.
    hCharge: PR.hfT(clamp(S.Tcold[0] - 60, 100, 500)),
    QrhrW: Qrhr
  });

  // ---------- 7b. DNBR ----------
  const flowFrac = S.W.reduce((a, b) => a + b, 0) / (rp.Wrated * rp.nLoops);
  const d = FU.dnbr(fu, PL.k.Ptot, Math.max(flowFrac, 0.02), S.P, S.Tcold[0]);
  PL.dnbr = d.dnbr;

  // ---------- 7c. nuclear instrumentation ----------
  SU.stepStartup(PL.sup, PL.su, PL.k.P, PL.k.period, dt);

  // ---------- 8. protection ----------
  FU.stepTrips(fu, f, S.Thot[0] - S.Tcold[0], S.Tavg, S.P - 14.7, dt);
  if (!opt.noTrip) checkTrips(PL, dt);

  PL.t += dt;
  return PL;
}

/**
 * KNOWN LIMITATION.  Post-trip pressurizer pressure undershoots: this model
 * bottoms near 1833 psig on a clean turbine trip where a real Westinghouse
 * plant bottoms near 2000.  Because the low-pressure safety injection setpoint
 * is 1865 psig, a clean turbine trip actuates SI here when it should not.
 * The cause is that the pressurizer gives up too much pressure for the volume
 * the RCS contraction demands of it.  Charging is NOT the fix -- it makes the
 * undershoot worse, since charging water is cooler than the saturated water in
 * the pressurizer and condenses steam.  Left visible rather than hidden by
 * moving the setpoint.
 *
 * Protection is the two-out-of-four RPS.  The old single-channel table is
 * gone: with one channel per parameter, bypasses, failures and surveillance
 * testing had no meaning, and a single drifting instrument scrammed the unit.
 */
function checkTrips(PL, dt) {
  if (!PL.rps) return;
  RP.stepRPS(PL.rps, PL, dt);
  if (PL.rps.trip && !PL.trip) {
    PL.trip = true;
    PL.tripMsg = PL.rps.firstOut || 'REACTOR TRIP';
    PL.tripFirst = PL.rps.firstOut || 'REACTOR TRIP';
    PL.sec.tripped = true;
    if (PL.E) EL.tripGenerator(PL.E, 'UNIT TRIP');
    PL.banks.ctrlDemand = 0;
    PL.banks.sd = [0, 0];
  }
  // safeguards drive the systems that already exist
  const e = PL.rps.esf;
  if (e.si.actuated && PL.si && !PL.si.manualBlock) PL.si.actuated = true;
  if (e.afw.actuated && PL.sec) PL.sec.afwOn = true;
  if (e.spray.actuated && PL.cnmt) PL.cnmt.sprayOn = [true, true];
  if (e.msiv.actuated && PL.sec) PL.sec.msivOpen = [false, false, false];
  if (e.fwIsol.actuated && PL.sec) PL.sec.mfpOn = [false, false];
}

export function resetTrip(PL) {
  PL.trip = false; PL.tripMsg = ''; PL.tripFirst = '';
  if (PL.rps) RP.resetRPS(PL.rps);
}

/** Compact snapshot for a panel or a test. */
export function snapshot(PL) {
  const S = PL.S, sgs = PL.sgs, sec = PL.sec;
  return {
    t: PL.t,
    power: PL.k.Ptot * 100,
    Tavg: S.Tavg, Tref: PL.Tref, Thot: S.Thot[0], Tcold: S.Tcold[0],
    Ppzr: S.P - 14.7, pzrLvl: S.pzrLevel * 100,
    Psec: sgs[0].Psec, sgLvl: sgs.map(s => s.lvlNR),
    Wsteam: sec.Wturb / 1e6, Wdump: sec.Wdump / 1e6, Wfw: sec.WfwTotal / 1e6,
    MWe: sec.MWe, Tfw: sec.TfwF,
    ppm: PL.ppm, Tfuel: PL.f.Tf,
    void: S.voidMax, subcool: S.subcooling, dnbr: PL.dnbr,
    ppmRate: PL.cv ? PL.cv.ppmRate : 0,
    borating: PL.cv ? PL.cv.borateGpm : 0, diluting: PL.cv ? PL.cv.diluteGpm : 0,
    rhrMW: PL.rhr ? PL.rhr.QtotalMW : 0, rhrIn: PL.rhr ? PL.rhr.inService : false,
    siActuated: PL.si ? PL.si.actuated : false, siGpm: PL.si ? PL.si.totalGpm : 0,
    rwstPct: PL.si ? PL.si.rwstPct : 100, breakIn2: PL.breakIn2 || 0,
    breakFlow: S.breakFlow || 0,
    cnmtPsig: PL.cnmt ? PL.cnmt.psig : 0, cnmtTf: PL.cnmt ? PL.cnmt.Tf : 0,
    cnmtSpray: PL.cnmt ? PL.cnmt.sprayGpm : 0, sumpFt3: PL.cnmt ? PL.cnmt.sumpFt3 : 0,
    firstOut: PL.rps ? PL.rps.firstOut : '',
    esf: PL.rps ? Object.fromEntries(Object.entries(PL.rps.esf).map(([k,v])=>[k,v.actuated])) : {},
    cooldownRate: PL.rhr ? PL.rhr.cooldownFperHr : 0,
    trip: PL.trip, tripMsg: PL.tripMsg,
    genMWe: PL.E ? PL.E.MWe : 0, netMWe: PL.E ? PL.E.netMWe : 0,
    house: PL.E ? PL.E.houseMW : 0,
    Vaux: PL.E ? PL.E.Vaux[0] : 0, Vsafety: PL.E ? PL.E.Vsafety[0] : 0,
    rcps: PL.E ? PL.E.rcpOn.filter(Boolean).length : 0,
    edgReady: PL.E ? PL.E.edg.map(e => e.ready) : [],
    edgBkr: PL.E ? PL.E.edg.map(e => e.bkr) : []
  };
}
