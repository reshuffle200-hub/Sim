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
    // states
    k: K.makeKinetics(),
    fp: RX.makeFP(),
    f: null, S: null, sgs: null, z: null, sec: null, E: null,
    // operator-settable
    ppm: 0, banks: null, rodAuto: true, rodDeadbandF: 1.5,
    // outputs
    power: 0, Tref: 547, t: 0, dnbr: 99,
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
  PL.banks = RX.fullOutBanks(PL.rx);
  PL.banks.ctrlDemand = 520;
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
export function initPlant(PL, load, seconds = 900) {
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
  const rodSave = PL.rodAuto;
  PL.rodAuto = false;
  PL.banks.ctrlDemand = 520;
  const dt = 0.05;
  for (let i = 0; i < seconds / dt; i++) {
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
        4 * rx.stepsPerBank - 3 * (rx.stepsPerBank - rx.overlap));
    }
  }

  // ---------- 1. reactivity from the present state ----------
  const rhoObj = RX.total(rx, {
    TmodF: S.Tavg, psia: S.P, TfuelF: f.Tf, ppm: PL.ppm,
    banks: PL.banks, X: PL.fp.X, Sm: PL.fp.Sm
  });
  let rho = rhoObj.total;
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

  // ---------- 6b. electrical ----------
  // Turbine shaft power drives the generator; bus voltage drives the RCPs.
  // This is the only path by which the grid can reach the core.
  const safetyLoadMW = PL.ep.safetyBaseMW + (PL.trip ? 2.0 : 0);
  EL.stepElec(PL.ep, PL.E, sec.MWe, safetyLoadMW, dt);
  for (let i = 0; i < rp.nLoops; i++) {
    if (!PL.E.rcpOn[i] && S.pumpOn[i]) S.pumpOn[i] = false;
  }

  // ---------- 7. primary ----------
  R.stepRCS(rp, S, PL.k.Ptot * rp.Qrated, dt, {
    Qpzr: z.Qpzr, Wspray: z.sprayLbHr, Wrelief: z.Wrelief,
    chargeLbHr: z.chargeLbHr, letdownLbHr: z.letdownLbHr
  });

  // ---------- 7b. DNBR ----------
  const flowFrac = S.W.reduce((a, b) => a + b, 0) / (rp.Wrated * rp.nLoops);
  const d = FU.dnbr(fu, PL.k.Ptot, Math.max(flowFrac, 0.02), S.P, S.Tcold[0]);
  PL.dnbr = d.dnbr;

  // ---------- 8. protection ----------
  FU.stepTrips(fu, f, S.Thot[0] - S.Tcold[0], S.Tavg, S.P - 14.7, dt);
  if (!opt.noTrip) checkTrips(PL);

  PL.t += dt;
  return PL;
}

const TRIPS = [
  ['HIGH FLUX',            PL => PL.k.P > 1.18],
  ['OVERTEMPERATURE dT',   PL => PL.f.otdtTrip],
  ['OVERPOWER dT',         PL => PL.f.opdtTrip],
  ['PZR PRESSURE HIGH',    PL => PL.S.P - 14.7 > PL.zp.pHiTrip],
  ['PZR PRESSURE LOW',     PL => PL.S.P - 14.7 < PL.zp.pLoTrip && PL.power > 0.1],
  ['PZR LEVEL HIGH',       PL => PL.S.pzrLevel * 100 > PL.zp.lvlHiTrip],
  ['SG LEVEL LO-LO',       PL => PL.sgs.some(s => s.lvlNR < PL.sp.lvlLoLo)],
  ['LOW RCS FLOW',         PL => PL.S.W.some(w => w < 0.87 * PL.rp.Wrated) && PL.power > 0.1],
  ['TURBINE TRIP',         PL => PL.sec.tripped && PL.power > 0.5]
];

function checkTrips(PL) {
  for (const [name, fn] of TRIPS) {
    let hit = false;
    try { hit = fn(PL); } catch (e) { hit = false; }
    if (hit && !PL.trip) {
      PL.trip = true;
      PL.tripMsg = name;
      PL.tripFirst = name;                       // first-out latches here
      PL.sec.tripped = true;                     // turbine follows the reactor
      if (PL.E) EL.tripGenerator(PL.E, 'UNIT TRIP');
      PL.banks.ctrlDemand = 0;
      PL.banks.sd = [0, 0];
    }
  }
}

export function resetTrip(PL) {
  PL.trip = false; PL.tripMsg = ''; PL.tripFirst = '';
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
    trip: PL.trip, tripMsg: PL.tripMsg,
    genMWe: PL.E ? PL.E.MWe : 0, netMWe: PL.E ? PL.E.netMWe : 0,
    house: PL.E ? PL.E.houseMW : 0,
    Vaux: PL.E ? PL.E.Vaux[0] : 0, Vsafety: PL.E ? PL.E.Vsafety[0] : 0,
    rcps: PL.E ? PL.E.rcpOn.filter(Boolean).length : 0,
    edgReady: PL.E ? PL.E.edg.map(e => e.ready) : [],
    edgBkr: PL.E ? PL.E.edg.map(e => e.bkr) : []
  };
}
