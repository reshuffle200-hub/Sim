// ======================================================================
//  procedures.js — guided operating procedures for the right-side panel.
//  Steps follow the real Westinghouse PWR operating flow (General
//  Operating Procedures for startup/shutdown, and the E-0 "Reactor Trip
//  or Safety Injection" immediate/subsequent actions). Each step carries
//  a check(PL) that auto-detects completion from live plant state.
//  These are representative training procedures, not a specific plant's
//  controlled documents.
// ======================================================================

const psig = PL => PL.S.P - 14.7;
const allRCP = PL => PL.S.pumpOn.every(Boolean);
const anyRCP = PL => PL.S.pumpOn.some(Boolean);
const sgOK   = (PL, lo, hi) => PL.sgs.every(s => s.lvlNR >= lo && s.lvlNR <= hi);

export const PROCEDURES = [
  {
    id: 'startup', name: 'Startup', title: 'Reactor Startup', sub: 'GOP · Mode 3 \u2192 Mode 1',
    steps: [
      { t: 'Establish RCS at no-load', d: 'All reactor coolant pumps running; RCS pressure \u2265 2200 psig.',
        check: PL => allRCP(PL) && psig(PL) >= 2200,
        val: PL => `${PL.S.pumpOn.filter(Boolean).length}/${PL.S.pumpOn.length} RCPs \u00b7 ${psig(PL).toFixed(0)} psig` },
      { t: 'Pressurizer on program', d: 'Pressurizer level in the no-load program band (~20\u201365%).',
        check: PL => PL.S.pzrLevel > 0.18 && PL.S.pzrLevel < 0.66,
        val: PL => `PZR ${(PL.S.pzrLevel*100).toFixed(0)}%` },
      { t: 'Reset reactor trip breakers', d: 'Trip reset; rod drive energized and ready to withdraw.',
        check: PL => !PL.trip,
        val: PL => PL.trip ? 'TRIPPED' : 'reset' },
      { t: 'Withdraw banks toward criticality', d: 'In MANUAL, withdraw control banks (and dilute as needed) to add positive reactivity.',
        check: PL => PL.banks.ctrlDemand > 20,
        val: PL => `rods ${PL.banks.ctrlDemand.toFixed(0)} steps` },
      { t: 'Achieve criticality', d: 'Positive stable startup rate; flux rising off the source range. Watch DPM.',
        check: PL => PL.power > 1e-4,
        val: PL => `power ${(PL.power*100).toExponential(1)}% \u00b7 period ${isFinite(PL.k.period)?PL.k.period.toFixed(0)+'s':'\u221e'}` },
      { t: 'Point of adding heat', d: 'Raise power above ~2%; place rod control in AUTO once in the power range.',
        check: PL => PL.power > 0.02,
        val: PL => `${(PL.power*100).toFixed(1)}%` },
      { t: 'Synchronize generator', d: 'Roll turbine, close the generator breaker onto the grid.',
        check: PL => PL.E.genBkr && PL.E.MWe > 5,
        val: PL => PL.E.genBkr ? `${PL.E.MWe.toFixed(0)} MWe on line` : 'breaker open' },
      { t: 'Escalate to 100%', d: 'Raise power to full; Tavg on programmed reference.',
        check: PL => PL.power > 0.98,
        val: PL => `${(PL.power*100).toFixed(1)}%` },
    ],
  },
  {
    id: 'shutdown', name: 'Shutdown', title: 'Normal Shutdown', sub: 'GOP · Mode 1 \u2192 Mode 3',
    steps: [
      { t: 'Commence load reduction', d: 'Reduce turbine load; borate to hold Tavg on program as power drops.',
        check: PL => PL.power < 0.95,
        val: PL => `${(PL.power*100).toFixed(0)}%` },
      { t: 'Reduce below 30%', d: 'Continue ramp with boration and bank insertion.',
        check: PL => PL.power < 0.30,
        val: PL => `${(PL.power*100).toFixed(0)}%` },
      { t: 'Generator off the grid', d: 'Unload and open the generator breaker.',
        check: PL => !PL.E.genBkr || PL.E.MWe < 5,
        val: PL => PL.E.genBkr ? `${PL.E.MWe.toFixed(0)} MWe` : 'off line' },
      { t: 'Reduce to low power', d: 'Insert banks / borate to just above the point of adding heat.',
        check: PL => PL.power < 0.03,
        val: PL => `${(PL.power*100).toFixed(2)}%` },
      { t: 'Trip / fully insert rods', d: 'Place the reactor subcritical; verify rods on bottom.',
        check: PL => PL.trip || PL.banks.ctrlDemand < 10,
        val: PL => PL.trip ? 'tripped' : `rods ${PL.banks.ctrlDemand.toFixed(0)}` },
      { t: 'Stabilize at hot standby', d: 'Hold RCS at no-load Tavg (~557\u00b0F) and ~2235 psig; heat sink available.',
        check: PL => PL.S.Tavg > 540 && PL.S.Tavg < 565 && psig(PL) > 2100 && psig(PL) < 2320,
        val: PL => `Tavg ${PL.S.Tavg.toFixed(0)}\u00b0F \u00b7 ${psig(PL).toFixed(0)} psig` },
    ],
  },
  {
    id: 'trip', name: 'Trip Response', title: 'Reactor Trip Response', sub: 'E-0 immediate actions',
    steps: [
      { t: 'Verify reactor trip', d: 'Rods on bottom; neutron flux dropping; trip breakers open.',
        check: PL => PL.trip && PL.power < 0.10,
        val: PL => `trip ${PL.trip?'YES':'NO'} \u00b7 ${(PL.power*100).toFixed(1)}%` },
      { t: 'Verify turbine trip', d: 'All turbine stop valves closed.',
        check: PL => PL.sec.tripped,
        val: PL => PL.sec.tripped ? 'tripped' : 'RUNNING' },
      { t: 'Verify AC to safeguards buses', d: 'Offsite power available, or emergency diesels supplying.',
        check: PL => PL.E.gridAvail || anyRCP(PL),
        val: PL => PL.E.gridAvail ? 'offsite available' : 'OFFSITE LOST' },
      { t: 'Verify RCS heat sink (SGs)', d: 'Feed to steam generators; narrow-range level 20\u201350%.',
        check: PL => sgOK(PL, 15, 55),
        val: PL => 'SG ' + PL.sgs.map(s => s.lvlNR.toFixed(0)).join('/') + '%' },
      { t: 'Verify RCS pressure control', d: 'Pressurizer pressure > 1900 psig; adequate subcooling.',
        check: PL => psig(PL) > 1900,
        val: PL => `${psig(PL).toFixed(0)} psig` },
      { t: 'Verify pressurizer level', d: 'Level on scale (not solid, not emptied).',
        check: PL => PL.S.pzrLevel > 0.05 && PL.S.pzrLevel < 0.92,
        val: PL => `${(PL.S.pzrLevel*100).toFixed(0)}%` },
      { t: 'Stabilize RCS', d: 'Tavg trending to no-load and controlled; verify diagnostics for the follow-on procedure.',
        check: PL => PL.S.Tavg < 562,
        val: PL => `Tavg ${PL.S.Tavg.toFixed(0)}\u00b0F` },
    ],
  },
];

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));

/** Render the panel body for the active procedure against live plant state. */
export function renderProcedures(PL, activeId) {
  const proc = PROCEDURES.find(p => p.id === activeId) || PROCEDURES[0];
  const done = proc.steps.map(s => { try { return !!s.check(PL); } catch { return false; } });
  const nDone = done.filter(Boolean).length;
  const curIdx = done.indexOf(false);   // first not-yet-complete step

  const tabs = PROCEDURES.map(p =>
    `<button class="proctab${p.id===proc.id?' on':''}" data-proc="${p.id}">${esc(p.name)}</button>`).join('');

  const steps = proc.steps.map((s, i) => {
    const state = done[i] ? 'done' : (i === curIdx ? 'cur' : 'pending');
    const icon = done[i] ? '\u2713' : (i === curIdx ? '\u25b6' : '\u25cb');
    let v = ''; try { v = s.val ? s.val(PL) : ''; } catch { v = ''; }
    return `<li class="procstep ${state}">
      <span class="procicon">${icon}</span>
      <div class="proctext"><b>${i+1}. ${esc(s.t)}</b>
        <div class="procdetail">${esc(s.d)}</div>
        ${v ? `<div class="procval">${esc(v)}</div>` : ''}
      </div></li>`;
  }).join('');

  return `<div class="prochdr"><div class="proctitle">${esc(proc.title)}</div>
      <div class="procsub">${esc(proc.sub)} \u00b7 ${nDone}/${proc.steps.length} complete</div></div>
    <div class="proctabs">${tabs}</div>
    <ol class="procsteps">${steps}</ol>
    <div class="procfoot">Steps tick off automatically as the plant reaches each condition. Representative training procedure.</div>`;
}
