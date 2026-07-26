# Westinghouse 3-Loop PWR — Control Room Simulation

Serve over HTTP and open `index.html`. No build step, no bundler, no backend.
ES modules only.

**Deploying:** run `node tools/stamp.mjs` and publish `dist/`. It stamps
`?v=<BUILD>` onto every import specifier in the tree. Without it the browser
revalidates `index.html`, serves the module files from cache, and you get a new
shell talking to old modules — which fails as a `TypeError` on some function
that the current source exports perfectly well, not as a clean cache error.
Stamping only the entry point is not enough: a query string on the shell's
import of `boards.js` does not propagate to `boards.js`'s own import of
`widgets.js`. Every specifier in the tree has to carry it.

**Single file:** run `node tools/bundle.mjs` for
`dist/pwr-sim-standalone.html` — every module inlined, no imports, opens
straight from the filesystem. This exists because ES modules cannot load over
`file://`: the browser applies CORS to module fetches and a local file has no
origin, so every import fails. That is irrelevant on a web server and decisive
on a phone, where one file in Files that opens in Safari is the only realistic
way to keep a copy. The source stays plain ES modules; this is one extra
artifact for the one case the module system cannot serve. Web fonts still come
from Google Fonts, so a first load wants a network; offline it falls back to
system fonts and everything else works.

## Layout
```
index.html   shell: navigation, shared plant instance, simulation loop
lib/         physics modules (23) — imported by the shell
ui/          board renderers, shared widgets, annunciator engine
tests/       audits and scenario tests, Node only, never fetched by the browser
tools/       stamp.mjs (deploy-time cache busting), bundle.mjs (single-file build)
```

## Annunciator and switches
The board carries **423 annunciator windows in 29 sections** and **99 control
switches**. The count is high for one reason: a real board does not have one
`SG LEVEL LOW` window, it has one per steam generator, because "which one" is
the first question an operator asks and a shared window cannot answer it. The
same goes for loops, safeguards trains, diesels, buses and the thirteen
protection functions with their independent channels. Every window reads a
distinct piece of plant state — `tests/t_board.js` asserts none is a duplicate
and that every reader runs in six plant states without throwing.

Windows are grouped into the sections a board is physically laid out in, and
first-out latches **per section**, so a feedwater upset and an electrical upset
each keep their own initiating window. A `Lit only` control collapses the board
to what is actually alarming.

Switches keep three things separate, as hardware does: the **handle** is what
the operator asked for, the **lamps** are what the equipment is doing, and they
are allowed to disagree — that disagreement is how you notice a pump did not
start. Lamp colour follows US practice, where red means running, open, or
energised and green means stopped, closed, or de-energised.

Every switch writes state the physics consumes, and where the model does not
support a position, the position does not exist. Auxiliary feedwater has no
STOP, because the low-level logic re-asserts the start signal on the next step
and a STOP handle would not hold. Stopping a containment fan cooler removes
real heat; degrading condenser vacuum takes the steam dumps away through the
existing interlock; a channel bypass keylock bypasses that channel across all
thirteen protection functions.

## Appearance
The interface is built as a **control board**, not a dashboard. The page is
painted panel steel in the grey-green US PWR control rooms are actually painted;
instruments are recessed into it behind bezels, with engraved phenolic
nameplates above each cutout and amber phosphor readouts inside. Every panel
legend is condensed uppercase because engraved laminate is.

The annunciator carries the idea: each window is translucent plastic with the
legend engraved through it. Unlit, the legend reads flat on milky plastic. Lit,
the backlight floods the window with colour and it glows — so the board is
scannable from across the room only when something is wrong, which is the entire
purpose of an annunciator. Colour carries the sequence: red trouble, amber
caution, green permissive, cyan ringback, white for a window whose process has
cleared but which nobody has reset.

`ui/widgets.js` exports the palette as `P`. Canvas only ever draws inside an
instrument face, so those values are tuned for dark; the panel itself is CSS.
Both read from the same place so they cannot drift. Every foreground/background
pair is AA or better.

## Annunciator
423 windows in 29 bays, each window reading a distinct piece of plant state.
Bays follow the board's physical divisions — protection, protection channels,
nuclear instrumentation, pressurizer, reactor coolant, one bay per steam
generator, steam and feedwater, safeguards, containment, RHR, CVCS, electrical —
with an engraved section nameplate carrying a *lit of total* count, and
first-out latched per bay so a feedwater upset and an electrical upset each keep
their own initiating window.

Most of the count comes from de-aggregation, which is the honest way to get it:
there is no single `SG LEVEL LOW` window, there is one per generator, because
"which one" is the first question an operator asks. The protection bay carries a
partial-trip and a channel-inop window per protection function, since one
channel calling for a trip and one channel out of service are the two things
that change what the coincidence logic will do next.

A real board has several times this many. The gap is systems this model does not
simulate yet — radiation monitoring, condensate, circulating water, turbine
auxiliaries — and windows for them would never light, which is worse than not
having them.

**Dead windows.** A window that can never light is worse than a missing one: it
reads as *this condition is not present*, forever. Two failure modes are silent,
because `readPoint()` swallows exceptions and NaN comparisons are false — a
mistyped property path, and an array compared to a number (`sec.frvPos > 0.95`
is false at every power, because `[1,1,1]` stringifies to `"1,1,1"` and then to
`NaN`). `t_windows.js` audits both against a live plant and proves every
protection-channel window is reachable through the real `setChannel()` API.

Note that the RPS only evaluates inside `checkTrips()`, which `initPlant()` skips
via `noTrip` — so channel-derived state does not exist until the plant is stepped
normally. An audit that runs straight after initialisation will see every channel
window as dead.

Legends are engraved on two or three short lines, as a window this size
requires; `legendLines()` balances them and never drops a word.

## Boards
All seven share ONE plant instance, so switching boards mid-transient does not
disturb the simulation.

| board | shows |
|---|---|
| Overview | four-column summary, loops, steam generators, 10-minute trends |
| Reactor | source / intermediate / power range, reactivity balance broken out by component, rod banks with 128-step overlap, DNBR, OTdT and OPdT margins |
| Safeguards | SI and containment per train, accumulators, RHR trains, 21 control switches |
| Startup | source range with integrating counter, startup rate and period, 1/M plotted against boron and rod position on one shared axis, estimated critical condition for each |
| Reactor coolant | three-loop mimic, pressurizer with relief path and tank, subcooling margin, charging and letdown |
| Steam & feedwater | SG level bargraphs with trip setpoints marked, feedwater train, turbine, steam dumps |
| Electrical | station one-line from generator through the aux transformers to the safety buses, both diesels |

## Physics modules
| module | what it does |
|---|---|
| `steam.js` | IAPWS-IF97 saturation, saturated and compressed properties |
| `props.js` | fast property tables for real-time use |
| `kinetics.js` | six-group point kinetics, ANS-5.1 decay heat, neutron source |
| `reactivity.js` | Doppler, moderator/boron coupling, rod banks, xenon, samarium |
| `fuel.js` | fuel pin thermal, hot channel, W-3 DNBR, OTdT/OPdT |
| `rcs.js` | 17-volume reactor coolant system, three loops, loop seals |
| `pzr.js` | pressurizer control, PORVs, safeties, relief tank, LTOP |
| `sg.js` | steam generators with real shrink and swell |
| `secondary.js` | steam header, turbine EHC, dumps, feedwater train |
| `elec.js` | generator, aux transformers, buses, two emergency diesels |
| `cvcs.js` | boration and dilution, charging, letdown, volume control tank |
| `rhr.js` | residual heat removal with entry interlocks, component cooling water |
| `si.js` | ECCS: high head, accumulators, low head, RWST, sump recirculation |
| `cnmt.js` | containment pressure and temperature, sprays, fan coolers, sump |
| `plant.js` | integration — every boundary condition supplied, none asserted |
| `ic.js` | initial conditions: snapshot, restore, library, JSON import/export |

## Initial conditions
Snapshot the plant at any point and return to it instantly. Restoration is
**bit-identical**, not approximate: `tests/t_ic.js` steps an original and a
restored copy in parallel for 6000 steps and checks they never diverge by a
single ULP. Snapshots are about 16 KB, held in memory, persisted to
localStorage when the host allows it, and exportable as a JSON file so a
scenario can be shared. Three standard conditions (100%, 50%, hot standby)
are generated on demand.

## Startup
`initHotStandby` builds Mode 3: all rods in but shutdown banks out, subcritical
with a neutron source, pumps running, dumps holding Tavg on the no-load
programme. From there, withdraw control banks, dilute, and take 1/M points.
`startup.js` provides source and intermediate range indication, multiplication,
least-squares extrapolation, and startup rate. The **Startup board** plots 1/M
against **both** boron concentration and control bank position on one shared
1/M axis — boron along the bottom running high to low, rods along the top
running low to high, so both approaches walk down to the right and meet zero at
their predicted critical condition. Each axis carries its own least-squares fit
and its own extrapolation.

The two are not redundant. Whichever variable is being moved carries the
information and the other degenerates, so a rod fit taken during a pure
dilution has no spread to work with and reports nothing at all rather than a
number invented out of count-rate scatter. Confidence is read off R², not off
whether the number looks plausible — a fit whose variable has stopped moving
still returns a value, and the correlation is what tells you it has stopped
meaning anything. A predicted rod position beyond 528 steps is flagged: it
means criticality is not reachable on rod withdrawal alone at that boron.

Formal points are **integrated, not sampled**. Counts collected over T seconds
have standard deviation sqrt(lambda·T), so the rate derived from them scatters
as sqrt(lambda/T): at 130 cps a one-second look scatters about 9% and a
60-second integration about 1.1%. The counter accumulates only while boron and
rods are steady and restarts when either moves, exactly as practice requires —
make the change, wait, then count. Against a known plant this predicts critical
boron to about 2 ppm and critical rod position to about 13 steps.

## Annunciator
Full ISA-18.1 sequence, not a lamp. Fifty-three windows across five groups:
25 on sequence A (self-clearing), 9 on R (ringback), 19 on M (manual reset).
Silence and acknowledge are separate — silencing stops the horn and leaves the
window flashing, so it cannot destroy the information about what is new. A new
alarm reflashes and re-sounds automatically. Sequence M keeps a window lit
after the process returns, so a transient that came and went cannot hide from
the next shift. Audible horn via Web Audio, with a distinct ringback tone.

## Tests
```
cd tests
node audit.js     # conservation, dt independence, cold states, closed loop
node audit2.js    # steam generator: relief, tube coverage, envelope
node audit3.js    # integrated plant: energy balance, dt independence, 1 h drift,
                  #   event envelope, snapshot fidelity from arbitrary states
node audit4.js    # safety systems: containment conservation, accumulator bounds,
                  #   SI block, RWST swap, LOCA dt independence, 9-case envelope
node t_plant.js   # integrated steady state at 100%
node t_load.js    # load reduction 100% -> 75%
node t_trip.js    # turbine trip
node t_elec.js    # loss of offsite power, diesel start, natural circulation
node t_ic.js      # snapshot round-trip fidelity
node t_annun.js   # ISA-18.1 sequence walk-through
node t_annbank.js # annunciator wall: bays, legends, lit-only filter
node t_windows.js # dead-window audit: paths, array comparisons, channel reachability
node t_suboard.js # 1/M validated both ways against true criticality
node t_board.js   # windows, switches, and switch-to-annunciator wiring
```
No dependencies. `package.json` only sets `{"type":"module"}`.

## Local preview
ES modules are blocked over `file://`, so double-clicking gives a blank page.
```
python3 -m http.server 8000     # then http://localhost:8000
```

## Calibration
Reactivity coefficients anchored to the NRC Westinghouse Technology Systems
Manual §2.1 (ML11223A207). Plant parameters are representative of a 3-loop
PWR, not any specific station.

## Known limits
**Hot standby holds indefinitely** as of 0.15.3.  It previously drifted: the
narrow-range indication climbed to 96% during the settle, the feed valves stayed
shut on level error, and the generators drained until AFW started and overcooled
the plant.  The cause was not the swell gain but the riser void model, which
returned the same void (0.445) at every power because circulation was derived as
`circRatio * Wboil`, cancelling the power dependence out of the exit quality.
Circulation is now anchored at the design point and scaled as `Qboil^(1/3)`.
Rated conditions are unchanged to the last digit.

Count rate carries Poisson scatter, so a 1/M point taken instantaneously is
too noisy to fit. Average over 30-60 s per point, as real practice requires.

Initialisation converges from about 35% to 105% load. Below roughly 20% it
does not: feedwater is very cold, steam flow per unit power rises sharply,
and the pressurizer drains faster than charging can make it up. That is the
same regime the cold startup has to solve properly, so it fails loudly rather
than being papered over.

Lumped-parameter. No axial nodes, so no axial flux difference and no xenon
oscillations. Not a substitute for a licensed simulator.
