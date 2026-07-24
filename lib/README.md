# Westinghouse 3-Loop PWR — Control Room Simulation

Serve over HTTP and open `index.html`. GitHub Pages works directly.
No build step, no bundler, no backend. ES modules only.

## Layout
```
index.html   shell: navigation, shared plant instance, simulation loop
lib/         physics modules (11) — imported by the shell
ui/          board renderers, shared widgets, annunciator engine
tests/       audits and scenario tests, Node only, never fetched by the browser
```

## Boards
All five share ONE plant instance, so switching boards mid-transient does not
disturb the simulation.

| board | shows |
|---|---|
| Overview | four-column summary, loops, steam generators, 10-minute trends |
| Reactor | source / intermediate / power range, reactivity balance broken out by component, rod banks with 128-step overlap, DNBR, OTdT and OPdT margins |
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
least-squares extrapolation to estimated critical boron, and startup rate.

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
**Hot standby holds for about an hour, not indefinitely.** Pump heat boils the
steam generator risers, and the swell term in the narrow-range level indication
(worth up to 11 ft against a 12 ft span) drives the indication to 96%. The feed
valves stay shut on level error while the dumps steam off that same pump heat,
so the generators drain and auxiliary feedwater eventually starts and overcools
the plant. The fault is in the level indication at low power, not the water
inventory: `swellGain` was calibrated at the design point and over-weights the
small void present at no load. An approach to criticality takes well under an
hour, so the startup path itself works. Documented in `plant.js`.

Count rate carries Poisson scatter, so a 1/M point taken instantaneously is
too noisy to fit. Average over 30-60 s per point, as real practice requires.

Initialisation converges from about 35% to 105% load. Below roughly 20% it
does not: feedwater is very cold, steam flow per unit power rises sharply,
and the pressurizer drains faster than charging can make it up. That is the
same regime the cold startup has to solve properly, so it fails loudly rather
than being papered over.

Lumped-parameter. No axial nodes, so no axial flux difference and no xenon
oscillations. Cold startup needs source-range instrumentation and 1/M plots, which are not
built.  Not a substitute for a licensed simulator.
