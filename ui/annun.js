// ======================================================================
//  annun.js — ISA-18.1 annunciator sequence engine
//
//  A real annunciator is a state machine, not a lamp.  What the panel had
//  before was a lamp: on when the condition was true, off when it was not.
//  That loses the two things the sequence exists for --
//
//    you cannot tell a NEW alarm from one you dealt with ten minutes ago,
//    and you cannot tell that something ALARMED AND CLEARED while your back
//    was turned.
//
//  Sequences implemented (ISA-18.1 nomenclature):
//    A     automatic reset.  Clears itself when the process returns.
//    M     manual reset.  Stays lit after the process returns until reset,
//          so a transient that came and went cannot hide.
//    R     ringback.  When the process returns, the window flashes SLOWLY
//          with a distinct tone until acknowledged again -- so "it cleared"
//          is itself an event you have to sign for.
//    F1    first-out.  Within a group, the window that alarmed FIRST is
//          held distinct; the rest are consequences.
//
//  SILENCE and ACKNOWLEDGE are separate, deliberately.  Silence stops the
//  horn and nothing else -- the window keeps flashing, so silencing does not
//  destroy the information about what is new.  Acknowledge is the operator
//  saying they have actually seen it.
// ======================================================================

export const ST = {
  NORMAL:   'normal',      // dark
  ALARM:    'alarm',       // fast flash + horn
  ACK:      'ack',         // steady
  RINGBACK: 'ringback',    // slow flash + ringback tone, process has returned
  CLEARED:  'cleared'      // process returned, waiting on manual reset (M)
};

/**
 * First-out is latched per BOARD SECTION, not per coarse group.  A board has
 * one first-out relay per annunciator bay, so a feedwater upset and an
 * electrical upset each keep their own initiating window -- and so do steam
 * generators A, B and C, which is the whole point of de-aggregating them.
 * Keying this off `group` collapsed all fourteen bays onto five latches and
 * threw away the distinction the windows exist to make.  Points without a
 * section fall back to group so the engine still works standalone.
 */
const foKey = p => p.section || p.group;

export function makeEngine(points) {
  return {
    points,
    st: points.map(() => ({
      state: ST.NORMAL, seq: 0, first: false, t: 0, everAlarmed: false
    })),
    seqCounter: 0,
    horn: false, hornKind: 'none',    // none | alarm | ringback
    silenced: false,
    firstOutGroup: {},                // group -> index of the first-out point
    lampTest: false
  };
}

/**
 * points = [{ name, group, seqType: 'A'|'M'|'R', firstOut: bool, cls, test }]
 * read(i) must return the current process state (true = abnormal).
 */
export function step(E, read, dt) {
  let wantAlarmHorn = false, wantRingbackHorn = false;

  for (let i = 0; i < E.points.length; i++) {
    const p = E.points[i], s = E.st[i];
    let on = false;
    try { on = !!read(i); } catch (e) { on = false; }
    s.t += dt;

    switch (s.state) {
      case ST.NORMAL:
        if (on) {
          s.state = ST.ALARM; s.seq = ++E.seqCounter; s.t = 0;
          s.everAlarmed = true;
          E.silenced = false;                       // REFLASH: a new alarm
          const fo = foKey(p);
          if (p.firstOut && E.firstOutGroup[fo] === undefined)
            E.firstOutGroup[fo] = i;
        }
        break;

      case ST.ALARM:
        wantAlarmHorn = true;
        if (!on && p.seqType === 'A') { s.state = ST.NORMAL; s.t = 0; }
        // M and R stay in ALARM until acknowledged, even if the process returns
        break;

      case ST.ACK:
        if (!on) {
          if (p.seqType === 'A') { s.state = ST.NORMAL; s.t = 0; }
          // Ringback is a NEW event -- the process returning is something the
          // operator has to sign for -- so it re-sounds the horn even though
          // the previous alarm was already acknowledged and silenced.
          else if (p.seqType === 'R') { s.state = ST.RINGBACK; s.t = 0; E.silenced = false; }
          else { s.state = ST.CLEARED; s.t = 0; }   // M: needs manual reset
        }
        break;

      case ST.RINGBACK:
        wantRingbackHorn = true;
        if (on) { s.state = ST.ALARM; s.seq = ++E.seqCounter; s.t = 0; E.silenced = false; }
        break;

      case ST.CLEARED:
        if (on) { s.state = ST.ALARM; s.seq = ++E.seqCounter; s.t = 0; E.silenced = false; }
        break;
    }
  }

  // clear first-out for a section once nothing in it is alarming
  for (const g in E.firstOutGroup) {
    const anyActive = E.points.some((p, i) =>
      foKey(p) === g && E.st[i].state !== ST.NORMAL && E.st[i].state !== ST.CLEARED);
    if (!anyActive) delete E.firstOutGroup[g];
  }

  E.hornKind = wantAlarmHorn ? 'alarm' : (wantRingbackHorn ? 'ringback' : 'none');
  E.horn = E.hornKind !== 'none' && !E.silenced;
  return E;
}

/** Silence the horn only. Windows keep flashing. */
export function silence(E) { E.silenced = true; }

/** Acknowledge: flashing goes steady, horn stops. */
export function acknowledge(E) {
  for (let i = 0; i < E.points.length; i++) {
    const s = E.st[i];
    if (s.state === ST.ALARM) { s.state = ST.ACK; s.t = 0; }
    else if (s.state === ST.RINGBACK) { s.state = ST.NORMAL; s.t = 0; }
  }
  E.silenced = true;
}

/** Reset: clears windows whose process has returned (sequence M). */
export function reset(E) {
  for (const s of E.st) if (s.state === ST.CLEARED) { s.state = ST.NORMAL; s.t = 0; }
  E.firstOutGroup = {};
}

/** Lamp test: everything lights. */
export function setLampTest(E, on) { E.lampTest = on; }

/** Visual state for one window at the current instant. */
export function render(E, i, nowSec) {
  const p = E.points[i], s = E.st[i];
  if (E.lampTest) return { lit: true, flash: false, cls: p.cls || '', first: false };
  const isFirst = E.firstOutGroup[foKey(p)] === i;
  switch (s.state) {
    case ST.ALARM:
      return { lit: true, flash: (nowSec * 2.2) % 1 < 0.5, cls: p.cls || '', first: isFirst, label: 'NEW' };
    case ST.ACK:
      return { lit: true, flash: false, cls: p.cls || '', first: isFirst };
    case ST.RINGBACK:
      return { lit: true, flash: (nowSec * 0.75) % 1 < 0.5, cls: 'ringback', first: false, label: 'RTN' };
    case ST.CLEARED:
      return { lit: true, flash: false, cls: 'cleared', first: false, label: 'RESET' };
    default:
      return { lit: false, flash: false, cls: '', first: false };
  }
}

export function counts(E) {
  let alarm = 0, ack = 0, ring = 0, cleared = 0;
  for (const s of E.st) {
    if (s.state === ST.ALARM) alarm++;
    else if (s.state === ST.ACK) ack++;
    else if (s.state === ST.RINGBACK) ring++;
    else if (s.state === ST.CLEARED) cleared++;
  }
  return { alarm, ack, ring, cleared, active: alarm + ack };
}

/** Chronological log of what alarmed, in order. */
export function sequenceLog(E) {
  return E.points
    .map((p, i) => ({ name: p.name, seq: E.st[i].seq, state: E.st[i].state }))
    .filter(x => x.seq > 0 && x.state !== ST.NORMAL)
    .sort((a, b) => a.seq - b.seq);
}
