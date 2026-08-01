// ======================================================================
//  ic.js — initial conditions: snapshot and restore plant state
//
//  Real simulators keep a library of ICs and restore them instantly; that is
//  how an instructor sets up a scenario.  Without it every session starts at
//  one operating point and pays the settling cost again, and once a cold
//  startup exists you would sit through a twelve-hour heatup to practise the
//  five minutes that matter.
//
//  CORRECTNESS BAR: a restored snapshot must produce a BIT-IDENTICAL
//  continuation.  Anything less is not a snapshot, it is a re-initialisation
//  that happens to look similar.  ic_roundtrip in the tests checks exactly
//  that by stepping an original and a restored copy in parallel.
//
//  Storage: in-memory always; localStorage when the host allows it (some
//  sandboxed viewers block it, so every access is guarded); and JSON export
//  or import so an IC can be shared as a file.
// ======================================================================

const STATE_KEYS = ['k','fp','f','S','sgs','z','sec','E','cv','rhr','si','cnmt','rps','su','banks','ro','cw','cd','rd'];
const SCALAR_KEYS = ['life','ppm','rodAuto','rodDeadbandF','power','Tref','t','dnbr',
                     'trip','tripMsg','tripFirst','mtc','boronWorth','_coefT',
                     'borateGpm','diluteGpm','breakIn2','rodInhibit'];
// parameter blocks are captured too, because the operator can change some of
// them at run time (ramp rate, setpoints) and a snapshot must reproduce those
const PARAM_KEYS = ['rx','fu','rp','sp','zp','sc','ep','cp','rh','sip','cnp','sup','cwp','cdp','rdp','rop'];

const VERSION = 1;

/** Deep clone through JSON. The plant holds only plain data, no functions. */
function clone(o) { return JSON.parse(JSON.stringify(o)); }

/** Capture the complete plant state. */
export function snapshot(PL, meta = {}) {
  const ic = { v: VERSION, saved: Date.now(), meta, state: {}, params: {} };
  for (const k of STATE_KEYS) ic.state[k] = clone(PL[k]);
  for (const k of SCALAR_KEYS) ic.state[k] = PL[k] === undefined ? null : clone(PL[k]);
  for (const k of PARAM_KEYS) ic.params[k] = clone(PL[k]);
  ic.state.lastBalance = PL.lastBalance ? clone(PL.lastBalance) : null;
  return ic;
}

/** Restore into an existing plant object, in place. */
export function restore(PL, ic) {
  if (!ic || ic.v !== VERSION) throw new Error('incompatible initial condition');
  for (const k of PARAM_KEYS) if (ic.params[k]) Object.assign(PL[k], clone(ic.params[k]));
  for (const k of STATE_KEYS) if (k in ic.state) PL[k] = clone(ic.state[k]);
  for (const k of SCALAR_KEYS) if (k in ic.state) PL[k] = clone(ic.state[k]);
  PL.lastBalance = ic.state.lastBalance ? clone(ic.state.lastBalance) : null;
  return PL;
}

// ------------------------------------------------------------- library
export function makeLibrary() {
  return { slots: {}, order: [] };
}
export function save(lib, name, PL, meta) {
  lib.slots[name] = snapshot(PL, meta || {});
  if (!lib.order.includes(name)) lib.order.push(name);
  persist(lib);
  return lib.slots[name];
}
export function load(lib, name, PL) {
  const ic = lib.slots[name];
  if (!ic) throw new Error('no such initial condition: ' + name);
  return restore(PL, ic);
}
export function remove(lib, name) {
  delete lib.slots[name];
  lib.order = lib.order.filter(n => n !== name);
  persist(lib);
}

// ------------------------------------------------------- storage (guarded)
const KEY = 'pwr-sim-ic-library-v1';
function storageOK() {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem('__t', '1'); localStorage.removeItem('__t');
    return true;
  } catch (e) { return false; }
}
export const persistAvailable = storageOK();

export function persist(lib) {
  if (!persistAvailable) return false;
  try { localStorage.setItem(KEY, JSON.stringify(lib)); return true; }
  catch (e) { return false; }
}
export function loadPersisted() {
  if (!persistAvailable) return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const lib = JSON.parse(raw);
    return (lib && lib.slots && lib.order) ? lib : null;
  } catch (e) { return null; }
}

// --------------------------------------------------------- file transfer
export function toJSON(ic) { return JSON.stringify(ic); }
export function fromJSON(txt) {
  const ic = JSON.parse(txt);
  if (!ic || ic.v !== VERSION) throw new Error('not a compatible IC file');
  return ic;
}
/** Approximate size, for showing the operator what a slot costs. */
export function sizeKB(ic) { return JSON.stringify(ic).length / 1024; }

/** Short human description of an IC, for the list. */
export function describe(ic) {
  const s = ic.state;
  const pow = s.k ? (s.k.Ptot * 100) : 0;
  const tavg = s.S ? s.S.Tavg : 0;
  const p = s.S ? s.S.P - 14.7 : 0;
  return `${pow.toFixed(1)}% · ${tavg.toFixed(0)} °F · ${p.toFixed(0)} psig`
       + (s.trip ? ' · TRIPPED' : '');
}
