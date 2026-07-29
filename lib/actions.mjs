// ======================================================================
//  actions.mjs — the authoritative command surface for multiplayer.
//
//  Every operator input that mutates the shared plant lives here as one
//  named action `(PL, msg) => void`.  The browser NEVER applies these
//  locally; it sends `{ a: '<name>', ...args }` over the socket and the
//  sim server calls the matching action against the ONE authoritative
//  plant.  That is what keeps every control room in lockstep.
//
//  These are lifted verbatim from the inline handlers that used to live
//  in index.html, so behaviour is identical — only the place they run
//  has moved from each browser to the server.
//
//  restore / pause / speed are handled by the server itself (they touch
//  server state, not just PL) and are intentionally not in this table.
// ======================================================================
import * as CT  from '../ui/controls.js';
import * as RH  from './rhr.js';
import * as EL  from './elec.js';
import * as SIM from './si.js';
import * as SU  from './startup.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const API = CT.switchApi();

export const ACTIONS = {
  // 107 control switches — idx into CT.SWITCHES, pos index or 'next'
  sw: (PL, m) => CT.actuate(PL, m.sw | 0, m.pos === 'next' ? 'next' : (m.pos | 0), API),

  // control-rod jog (held: repeats)
  rod: (PL, m) => { PL.banks.ctrlDemand = clamp(PL.banks.ctrlDemand + (+m.d || 0), 0, 528); },

  // boration / dilution (toggles, mutually exclusive)
  dilute: (PL) => { PL.diluteGpm = PL.diluteGpm > 0 ? 0 : PL.cp.dilMaxGpm; PL.borateGpm = 0; },
  borate: (PL) => { PL.borateGpm = PL.borateGpm > 0 ? 0 : PL.cp.boricMaxGpm; PL.diluteGpm = 0; },

  // setpoints
  dumpSet: (PL, m) => { PL.sc.dumpPressSet = +m.v; },
  pzrSet:  (PL, m) => { PL.zp.pSet = +m.v; },
  dumpMode: (PL) => { PL.sec.dumpMode = PL.sec.dumpMode === 'tavg' ? 'pressure' : 'tavg'; },

  // residual heat removal in/out of service
  rhr: (PL) => {
    if (PL.rhr.inService) { RH.removeFromService(PL.rhr); return; }
    if (RH.placeInService(PL.rh, PL.rhr, 0.4)) { PL.rhr.mode = 'rate'; PL.rhr.rateSetFperHr = 45; }
  },

  // malfunctions / events
  break:   (PL, m) => { PL.breakIn2 = PL.breakIn2 > 0 ? 0 : (+m.in2); },
  siBlock: (PL) => { if (PL.si.manualBlock) { PL.si.manualBlock = false; } else SIM.blockSI(PL.si); },
  scram: (PL) => {
    PL.trip = true; PL.tripMsg = 'MANUAL TRIP';
    if (!PL.tripFirst) PL.tripFirst = 'MANUAL TRIP';
    PL.sec.tripped = true; EL.tripGenerator(PL.E, 'UNIT TRIP');
    PL.banks.ctrlDemand = 0; PL.banks.sd = [0, 0];
  },
  turb: (PL) => { PL.sec.tripped = true; },
  loop: (PL) => { EL.loseOffsite(PL.E); EL.tripGenerator(PL.E, 'LOOP'); },
  lofw: (PL) => { PL.sec.mfpOn = [false, false]; },
  rcp:  (PL, m) => { const i = (m.i ?? 1) | 0; PL.E.rcpOn[i] = false; PL.S.pumpOn[i] = false; },
  porv: (PL) => { PL.z.porvStuck[0] = true; },

  // startup 1/M points
  suBase:  (PL) => SU.takeBaseline(PL.su, PL.ppm, PL.banks.ctrlDemand),
  suPoint: (PL) => SU.takePoint(PL.su, PL.ppm, PL.banks.ctrlDemand),
  suClear: (PL) => SU.clearPoints(PL.su),
};

/** Apply one wire message to the authoritative plant. Returns true if handled. */
export function apply(PL, msg) {
  const fn = ACTIONS[msg && msg.a];
  if (!fn) return false;
  fn(PL, msg);
  return true;
}
