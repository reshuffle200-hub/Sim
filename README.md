# A Real-Time Physics Model of a Westinghouse Three-Loop Pressurized-Water Reactor

**A model-description reference for the `pwr-sim` simulator**

*This document accompanies the source tree and describes the governing equations actually integrated by the code, together with the numerical methods and software structure used to solve them. Each section presents the physics and its equations first, then the corresponding software implementation.*

---

## Abstract

`pwr-sim` is a real-time, full-scope training simulator of a Westinghouse three-loop pressurized-water reactor (PWR) nuclear steam supply system and its balance of plant. The model couples six-group point-reactor kinetics with an explicit reactivity balance (Doppler, moderator density, soluble boron, control rods, and xenon/samarium poisons); a two-node fuel-pin conduction model with W-3 departure-from-nucleate-boiling (DNBR) and the Westinghouse overtemperature/overpower Δ*T* trip functions; a seventeen-volume reactor-coolant-system (RCS) thermal-hydraulic network solved under a single global pressure constraint; a non-equilibrium pressurizer; three U-tube steam generators that carry riser void as a state variable to reproduce shrink-and-swell; a secondary system with an electro-hydraulic turbine and extraction-driven feedwater heating; a synchronous-generator swing model that couples the grid to the reactor coolant pumps; and a four-channel, two-out-of-four reactor protection system. Thermodynamic properties are evaluated from the IAPWS-IF97 and IAPWS-95 formulations. The coefficient set is anchored to the U.S. Nuclear Regulatory Commission *Westinghouse Technology Systems Manual*. The plant is advanced by an operator-split, semi-implicit time integration that is deterministic and bit-reproducible, permitting exact save/restore and shared-state multiplayer operation.

---

## Table of Contents

1. [Introduction](#1-introduction)
   1. [Scope and intended use](#11-scope-and-intended-use)
   2. [Calibration basis](#12-calibration-basis)
   3. [Nomenclature](#13-nomenclature)
2. [Neutron Kinetics and Decay Heat](#2-neutron-kinetics-and-decay-heat)
3. [Reactivity Feedback](#3-reactivity-feedback)
4. [Fuel-Pin Thermal Model, DNBR, and Trip Functions](#4-fuel-pin-thermal-model-dnbr-and-trip-functions)
5. [Reactor Coolant System](#5-reactor-coolant-system)
6. [Pressurizer](#6-pressurizer)
7. [Steam Generators: Shrink and Swell](#7-steam-generators-shrink-and-swell)
8. [Secondary System](#8-secondary-system)
9. [Electrical System](#9-electrical-system)
10. [Reactor Protection System](#10-reactor-protection-system)
11. [Auxiliary Systems](#11-auxiliary-systems)
12. [Thermodynamic Properties](#12-thermodynamic-properties)
13. [Numerical Framework and Plant Integration](#13-numerical-framework-and-plant-integration)
14. [Validation and Limitations](#14-validation-and-limitations)
15. [Software Architecture](#15-software-architecture)
16. [References](#16-references)

---

## 1. Introduction

### 1.1 Scope and intended use

The simulator reproduces the observable behavior of a Westinghouse three-loop PWR (≈2775 MW thermal, ≈916 MWe gross) across the full operating envelope from cold shutdown through hot standby to 100 % power, including design-basis transients: reactor and turbine trips, loss of coolant flow, loss of offsite power, small-break loss-of-coolant accidents, steam-generator tube ruptures, and controlled cooldown to residual-heat-removal entry. It is a *lumped-parameter, control-oriented* model. The design objective is correct **trends, timing, and cause-and-effect** on control-room instrumentation and procedures, not spatially resolved accident analysis. It is explicitly not a substitute for a systems code such as RELAP or TRACE, and its limitations are stated with each subsystem and collected in [§14](#14-validation-and-limitations).

Each of the sections that follow presents the governing physics and its equations first, and then the corresponding **software implementation** — the state variables, the discretization actually used, and the source file that owns it.

### 1.2 Calibration basis

The neutronics and reactivity coefficients are anchored to the U.S. NRC *Westinghouse Technology Systems Manual*, §2.1 "Reactor Physics Review" (ML11223A207). Anchored quantities include the moderator temperature coefficient at 500 °F for 0 and 500 ppm boron, the boron concentration at which the coefficient crosses zero, the Doppler-only and total power defects, the equilibrium samarium worth, and the post-trip xenon envelope. Thermodynamic properties follow IAPWS-IF97 (industrial formulation) and the IAPWS-95 supplementary saturation equations. Decay heat is fitted to the Way–Wigner infinite-irradiation correlation and cross-checked in the test suite. The critical-heat-flux correlation is the Westinghouse W-3 form against which these plants are licensed.

### 1.3 Nomenclature

| Symbol | Meaning | Units |
|---|---|---|
| $n$ | neutron population (fraction of rated) | – |
| $C_i$ | delayed-neutron precursor concentration, group $i$ | – |
| $\rho$ | reactivity ($\delta k/k$; $\beta$ = 1 dollar) | – |
| $\beta,\ \beta_i$ | total / group delayed fraction | – |
| $\lambda_i$ | precursor decay constant, group $i$ | s⁻¹ |
| $\Lambda$ | prompt neutron generation time | s |
| $S$ | intrinsic neutron source | s⁻¹ |
| $P,\ P_{\text{decay}},\ P_{\text{tot}}$ | fission / decay / total power (fraction of rated) | – |
| $T_f,\ T_c$ | average fuel, clad temperature | °F |
| $T_{\text{avg}}$ | RCS average temperature | °F |
| $\Delta T$ | loop hot-to-cold-leg temperature difference | °F |
| $M_i,\ U_i,\ u_i$ | node mass, internal energy, specific internal energy | lbm, Btu |
| $W$ | mass flow rate | lbm h⁻¹ or lbm s⁻¹ |
| $v(P,u)$ | specific volume from equation of state | ft³ lbm⁻¹ |
| $\alpha_v$ | void fraction | – |
| $\delta,\ \omega,\ H$ | rotor angle, speed deviation, inertia constant | rad, rad s⁻¹, s |

---

## 2. Neutron Kinetics and Decay Heat

### 2.1 Physics and equations

Core power is governed by the **point reactor kinetics equations** with six delayed-neutron groups and an explicit intrinsic source $S$:

$$\frac{dn}{dt} = \frac{\rho - \beta}{\Lambda}\, n + \sum_{i=1}^{6} \lambda_i C_i + S, \qquad \frac{dC_i}{dt} = \frac{\beta_i}{\Lambda}\, n - \lambda_i C_i .$$

The source term is retained explicitly rather than dropped, because the cold-shutdown regime depends on it: subcritical multiplication, the $1/M$ approach to criticality, and source-range indication all derive from $S$, not from the flux. The delayed data are the standard U-235 thermal set,

$$\beta_i = [2.15,\ 14.24,\ 12.74,\ 25.68,\ 7.48,\ 2.73]\times10^{-4},\quad \sum_i\beta_i = \beta = 6.5\times10^{-3},$$

$$\lambda_i = [0.0124,\ 0.0305,\ 0.111,\ 0.301,\ 1.14,\ 3.01]\ \text{s}^{-1},\qquad \Lambda = 2.0\times10^{-5}\ \text{s}.$$

The **stable reactor period** $T$ is available from the inhour equation for cross-checking,

$$\rho = \Lambda\,\omega + \sum_{i}\frac{\beta_i\,\omega}{\omega + \lambda_i},\qquad T = 1/\omega,$$

while the displayed period is measured directly from the observed rate of change of $n$.

**Decay heat** is treated as a *share* of reactor power rather than an addition to it. Fission-product decay is represented by eight exponential groups fitted to the Way–Wigner infinite-irradiation correlation,

$$\left.\frac{P}{P_0}\right|_{\text{Way-Wigner}} = 0.0622\; t^{-0.2},$$

each group obeying a production–decay balance driven by fission power,

$$\frac{dD_j}{dt} = \lambda_j^{D}\big(f_j\,P - D_j\big),\qquad \sum_j f_j \equiv D_{\text{TOTAL}} \approx 0.084 .$$

Total thermal power is then

$$P_{\text{tot}} = P\,(1 - D_{\text{TOTAL}}) + \sum_j D_j ,$$

so that at equilibrium $\sum_j D_j = D_{\text{TOTAL}}\,P$ and $P_{\text{tot}} = P$ exactly, while after a trip the prompt term $P$ collapses in seconds and $P_{\text{tot}}$ relaxes onto the decay-heat curve. (Adding the two terms instead of apportioning them would run the integrated plant at ≈108 % power and drive it into saturation — a documented pitfall.)

### 2.2 Software implementation

The kinetics live in **`lib/kinetics.js`**, with state `{n, C[6], S, D[8], P, Pdecay, Ptot, rho, period}`. Because $\Lambda \sim 2\times10^{-5}$ s makes the prompt term extremely stiff, `stepKinetics()` uses a **backward-Euler (implicit)** update that is unconditionally stable at the ~50 ms plant time step. Substituting the implicit precursor update

$$C_i^{t+\Delta t} = \frac{C_i^{t} + \Delta t\,(\beta_i/\Lambda)\,n^{t+\Delta t}}{1 + \Delta t\,\lambda_i}$$

into the flux equation yields a single linear equation solved in closed form each step,

$$n^{t+\Delta t} = \frac{\;n^{t} + \Delta t\,S + \displaystyle\sum_i \frac{\Delta t\,\lambda_i\,C_i^{t}}{1+\Delta t\,\lambda_i}\;} {\;1 - \dfrac{\Delta t\,(\rho-\beta)}{\Lambda} - \displaystyle\sum_i \frac{\Delta t\,\lambda_i}{1+\Delta t\,\lambda_i}\cdot\frac{\Delta t\,\beta_i}{\Lambda}\;}.$$

A supercritical blow-up guard clamps $n$ to $[10^{-12},\,50]$ (5000 %); protection acts far below the upper clamp. The decay groups use the same implicit loss treatment. `inhourPeriod()` and `wayWigner()` are provided for verification and are exercised against the correlation in the test suite.

---

## 3. Reactivity Feedback

### 3.1 Physics and equations

The reactivity fed to the kinetics is a sum of physically distinct effects,

$$\rho = \rho_{\text{excess}} + \rho_{\text{Doppler}} + \rho_{\text{mod}} + \rho_{\text{boron}} + \rho_{\text{rods}} + \rho_{\text{Xe}} + \rho_{\text{Sm}} .$$

**Doppler.** The fuel-temperature (Doppler) feedback follows the customary square-root law,

$$\rho_{\text{Doppler}} = -K_D\left(\sqrt{T_f} - \sqrt{T_{f,\text{HZP}}}\right),$$

with $K_D$ solved from the published zero-to-full-power Doppler defect (≈1500 pcm at middle of life).

**Moderator and boron.** Both terms are driven by **moderator density**, which is what makes the moderator temperature coefficient (MTC) behave correctly across the range. With $u = \rho_m/\rho_{m,\text{ref}} - 1$ the fractional density change,

$$\rho_{\text{mod}} = a_1 u + a_2 u^2,\qquad \rho_{\text{boron}} = w_B\,C_B \cdot \frac{\rho_m}{\rho_{m,\text{ref}}},$$

where $\rho_m(T,P)$ is evaluated from the saturated-liquid density. Because heating expels boron (density) faster than it costs moderation at high concentration, the MTC is strongly negative when hot with little boron and approaches zero — or turns positive above ≈1400 ppm — when cold with heavy boron, exactly the mechanism the NRC text describes. The coefficients $a_1, a_2, w_B$ are *solved*, not tabulated, from three anchors: MTC(500 °F, 0 ppm) = −17 pcm/°F, MTC(500 °F, 500 ppm) = −8 pcm/°F, and MTC = 0 at 1400 ppm. The MTC itself is reported as the numerical derivative $d\rho/dT_{\text{mod}}$.

**Control rods.** Six banks of 228 steps, with 128-step overlap on the control banks, integrate group worths (control banks A/B/C/D = 420/460/480/300 pcm; shutdown banks 1900 pcm each) along an S-shaped differential-worth curve.

**Fission-product poisons.** Iodine-135, xenon-135, promethium-149, and samarium-149 evolve by

$$\frac{dI}{dt} = \gamma_I \Sigma_f \phi - \lambda_I I,\qquad \frac{dX}{dt} = \gamma_X \Sigma_f \phi + \lambda_I I - \lambda_X X - \sigma_X \phi\, X,$$

$$\frac{d\,\text{Pm}}{dt} = \gamma_{\text{Pm}} \Sigma_f \phi - \lambda_{\text{Pm}}\, \text{Pm},\qquad \frac{d\,\text{Sm}}{dt} = \lambda_{\text{Pm}}\, \text{Pm} - \sigma_{\text{Sm}} \phi\, \text{Sm},$$

with $\rho_{\text{Xe}} = w_{\text{Xe}} X$ and $\rho_{\text{Sm}} = w_{\text{Sm}}\,\text{Sm}$. The equilibrium worths and time constants reproduce the ≈−2700 pcm equilibrium xenon, ≈−650 pcm samarium, and the 8–9 h post-trip xenon peak.

### 3.2 Software implementation

The balance is in **`lib/reactivity.js`**. `coreParams(life)` builds the coefficient set for beginning/middle/end of life; `calibrate()` solves $K_D$, $a_1$, $a_2$, and $w_B$ from the NRC anchors at construction time so that no coefficient is hand-entered. `modDensity(T,P)` obtains $\rho_m$ from the IAPWS saturated-liquid specific volume ([§12](#12-thermodynamic-properties)). Poisons are stored in the `fp` state block and advanced by `stepFP()` using implicit loss terms so that the long xenon/samarium time constants remain stable at large steps. `total()` assembles $\rho$ each step and is called *before* the kinetics update within the plant loop, so the worth reflects the present fuel temperature, boron, rod position, and poison inventory.

---

## 4. Fuel-Pin Thermal Model, DNBR, and Trip Functions

### 4.1 Physics and equations

Heat transfer from fuel to coolant is a **two-node lumped pin** — fuel meat and clad — with thermal resistances that lump conduction, the fuel-clad gap, and the film:

$$M_f c_f \frac{dT_f}{dt} = Q - \frac{T_f - T_c}{R_{fc}},\qquad M_c c_c \frac{dT_c}{dt} = \frac{T_f - T_c}{R_{fc}} - \frac{T_c - T_{\text{cool}}}{R_{cw}} .$$

$R_{fc}$ is calibrated so the average fuel temperature at 100 % power matches the value to which the Doppler feedback was anchored, keeping the two modules mutually consistent.

**Departure from nucleate boiling** uses the Westinghouse **W-3 correlation** (uniform-flux form). The critical heat flux is

$$q''_{\text{CHF}} = 10^{6}\, t_1 t_2 t_3 t_4 t_5,$$

with, for pressure $P$ (psia), mass flux $G$ (lbm h⁻¹ ft⁻²), quality $x$, heated equivalent diameter $D_e$ (in), and inlet subcooling through $h_f - h_{\text{in}}$:

$$t_1 = (2.022 - 4.302\times10^{-4}P) + (0.1722 - 9.84\times10^{-5}P)\,e^{(18.177 - 4.129\times10^{-3}P)\,x},$$

$$t_2 = \big(0.1484 - 1.596\,x + 0.1729\,x|x|\big)\frac{G}{10^{6}} + 1.037,\qquad t_3 = 1.157 - 0.869\,x,$$

$$t_4 = 0.2664 + 0.8357\,e^{-3.151 D_e},\qquad t_5 = 0.8258 + 7.94\times10^{-4}(h_f - h_{\text{in}}).$$

The margin is $\text{DNBR} = q''_{\text{CHF}}/q''_{\text{local}}$, evaluated in the hot channel using the enthalpy-rise and heat-flux hot-channel factors $F_{\Delta H}=1.62$ and $F_q=2.32$; the licensing limit is 1.30.

**Overtemperature and overpower Δ*T*** trips take the standard Westinghouse form:

$$\Delta T_{\text{OT}} = \Delta T_0\big[K_1 - K_2\,(T_{\text{avg}} - T_{\text{ref}}) + K_3\,(P - P_{\text{ref}})\big],$$

$$\Delta T_{\text{OP}} = \Delta T_0\big[K_4 - K_5\,\langle\dot T_{\text{avg}}\rangle - K_6\,\max(T_{\text{avg}} - T_{\text{ref}},\,0)\big],$$

with a lead/lag network on $T_{\text{avg}}$ feeding OTΔ*T* and a high-pass (washout) on $T_{\text{avg}}$ supplying the rate term of OPΔ*T*. The reactor trips when the measured $\Delta T$ exceeds the running setpoint. The axial-flux-difference penalty functions $f_1(\Delta I)$, $f_2(\Delta I)$ are set to zero because the core is radially lumped with no axial nodes — a documented simplification, not a silent omission.

### 4.2 Software implementation

The model is in **`lib/fuel.js`**. `stepFuel()` advances $T_f$ and $T_c$; `dnbr()` evaluates the hot-channel enthalpy rise and calls `w3CHF()`. Saturation properties inside the DNBR path are read from the pressure-tabulated tables in `props.js` (accurate to 0.03 %, far inside the correlation uncertainty) rather than re-solving the equation of state each step. `stepTrips()` maintains the lead/lag and washout filters as first-order lags and updates the OTΔ*T*/OPΔ*T* setpoints and their trip flags; the resulting margins are surfaced to the protection system and the control-room meters.

---

## 5. Reactor Coolant System

### 5.1 Physics and equations

The RCS is nodalized into **seventeen control volumes**: the vessel (lower plenum, core, upper plenum, upper head, downcomer) plus, for each of the three loops, a hot leg with steam-generator inlet plenum, the SG tube region, a loop seal with outlet plenum, and a cold leg. Each node carries a mass $M_i$ and internal energy $U_i$ from its own mass and energy balance.

**Pressure** is not propagated acoustically. Because pressure waves settle in milliseconds — far faster than anything on a control panel — a single RCS pressure is found each step from a **global volume constraint**:

$$\text{find } P \text{ such that } \sum_i M_i\, v\big(P, u_i\big) = V_{\text{total}}.$$

Given a trial $P$, every node's specific volume $v(P,u_i)$ follows from the equation of state, and the pressure that makes the fluid exactly fill the fixed geometry is the solution. This single formulation covers all regimes without mode switching: water-solid (very stiff $P$), a pressurizer steam bubble (compliant), and RCS voiding (nodes flash and absorb volume).

**Flow** in each loop follows a lumped momentum balance,

$$\frac{L}{A}\frac{dW}{dt} = \Delta P_{\text{pump}} + \Delta P_{\text{buoyancy}} - K\,W|W|,$$

so pump coastdown, natural circulation, and reverse flow emerge from the same equation rather than being scripted. The loop seal is a distinct low-elevation volume; when it voids, its gravity head is lost and the loop can clear — the mechanism governing small-break LOCA behavior.

### 5.2 Software implementation

The network is in **`lib/rcs.js`**. `stepRCS()` performs, each step: (i) donor-cell (upwind) transport of mass and energy between nodes along the computed loop flows; (ii) a bracketed root solve for the pressure $P$ satisfying the volume constraint; (iii) the per-loop momentum update for $W$. Two-phase nodes carry a drift-flux void fraction. Documented limitations: lumped-parameter and uniform-pressure, donor-cell enthalpy, no counter-current flow limiting, and no intra-node phase separation beyond the drift-flux void — appropriate for trends and timing, not for a mechanistic LOCA calculation.

---

## 6. Pressurizer

### 6.1 Physics and equations

The pressurizer *volume* is one node in the RCS global pressure solve ([§5](#5-reactor-coolant-system)); this module supplies the heat and mass sources acting on that node. Steam and water are held at the **saturation temperature of the common pressure** (the equilibrium assumption). Pressure control comprises a proportional (variable) heater bank and backup banks, spray from two cold legs, two power-operated relief valves (PORVs) each with a motor-operated block valve, and three ASME code safety valves; a relief tank with water seal, nitrogen space, and rupture disc receives the discharge. Representative setpoints: program pressure 2235 psig, backup heaters on at −20 psig, spray opening 2260→2310 psig, PORV lift 2335 psig / reset 2315 psig, code safeties above.

Level is governed by a program that ramps the setpoint with $T_{\text{avg}}$ (an insurge/outsurge follows RCS thermal expansion); the level error drives charging and letdown in the chemical and volume control system ([§11](#11-auxiliary-systems)).

### 6.2 Software implementation

**`lib/pzr.js`** computes, each step, the net heater power (proportional term ∝ pressure error plus banked backup heaters), the spray flow as a function of pressure between its opening and full-open points, and the relief-path flow through PORVs and safeties with their lift/reset hysteresis. These appear to the RCS pressure node as energy and mass sources. The equilibrium assumption makes spray look marginally more effective and insurge peaks marginally lower than a non-equilibrium pressurizer; level behavior, relief-valve cycling, and drain-down timing — the scenarios of interest — are unaffected.

---

## 7. Steam Generators: Shrink and Swell

### 7.1 Physics and equations

The defining behavior of the steam-generator model is **shrink and swell**: indicated narrow-range level is *not* the collapsed-liquid level. The riser (tube bundle) carries a two-phase mixture whose swelled height the level tap senses. Two non-minimum-phase responses follow:

- **Opening the feed regulating valve** admits colder water to the downcomer, subcools the riser inlet, *collapses* voids, and drives indicated level *down* before inventory brings it up. Feeding more makes level fall first — the wrong-way response that makes SG level the hardest control loop in the plant.
- **Increasing steam demand** drops pressure, *expands* existing voids, and *swells* indicated level before inventory depletion pulls it back.

To capture both, the **riser void fraction is carried as a state** with its own first-order lag, rather than being reconstructed algebraically from mass. Secondary inventory is solved exactly as the RCS is — mass and energy in a fixed volume, pressure from the volume constraint — per steam generator:

$$\frac{dM}{dt} = W_{\text{fw}} - W_{\text{steam}},\qquad \frac{dU}{dt} = W_{\text{fw}} h_{\text{fw}} + \dot Q_{\text{prim}} - W_{\text{steam}} h_g,$$

with the steam pressure $P_{\text{sec}}$ from $\sum_k M_k\, v(P_{\text{sec}}, u_k) = V_{\text{sec}}$ and steam flow $W_{\text{steam}}$ *derived* from the energy balance, not asserted. Indicated narrow-range level is the swelled two-phase height across the tap span (span 12 ft, base 28 ft above the tubesheet).

### 7.2 Software implementation

**`lib/sg.js`** advances, per generator: primary-to-secondary heat transfer $\dot Q_{\text{prim}}$, the mass/energy balance, the volume-constraint pressure solve, and the lagged riser void state from which the indicated level is computed. Final feedwater temperature is an input from the secondary model ([§8](#8-secondary-system)), so cold feedwater at low power correctly makes shrink most severe there. The output is the swelled narrow-range level that the operator sees and the feedwater controller acts on.

---

## 8. Secondary System

### 8.1 Physics and equations

The three generators feed a **common steam header** through their main steam isolation valves. Flow to the turbine is choked through the nozzle chest, hence linear in header pressure and valve position,

$$W_{\text{turb}} \propto x_{\text{valve}}\, P_{\text{header}} .$$

The **turbine** is modeled as an electro-hydraulic control (EHC) with a load setpoint, ramp-rate limit, and runback; impulse (first-stage) pressure is proportional to steam flow, which is what the operator reads as load. **Steam dumps** operate in two genuinely different modes: a *T*avg mode that modulates on $(T_{\text{avg}} - T_{\text{ref}})$ to absorb the power mismatch after a load rejection or trip, and a *pressure* mode that modulates on header pressure for the controlled cooldown to residual-heat-removal entry.

The **feedwater train** — condenser and hotwell, condensate pumps, low-pressure heaters, main feed pumps, high-pressure heaters, and a regulating valve per generator — computes final feedwater temperature from turbine extraction rather than a lookup, so $T_{\text{fw}}$ falls out of load. That coupling is what makes shrink severe at low power ([§7](#7-steam-generators-shrink-and-swell)).

### 8.2 Software implementation

**`lib/secondary.js`** (with condenser detail in **`lib/cond.js`**) advances the header pressure from generator inflow and turbine/dump outflow, the EHC turbine load with its rate limit, the two dump-mode controllers, and the feedwater heater string driven by extraction. `calibrateSec()` sets the header and nozzle coefficients so that rated steam flow and pressure are reproduced at 100 % power. Electrical output MWe is passed to the generator model ([§9](#9-electrical-system)).

---

## 9. Electrical System

### 9.1 Physics and equations

The single most important electrical coupling is that **the reactor coolant pumps are electrical loads**: lose the buses and they coast down, and the primary drops onto natural circulation (which the RCS momentum balance already supports). The distribution is main generator → generator step-up transformer → switchyard → grid, with unit and station auxiliary transformers feeding the 6.9 kV non-safety and 4.16 kV safety buses, the latter backed by two emergency diesel generators.

The synchronous machine obeys the **swing equation**,

$$\frac{2H}{\omega_s}\frac{d\omega}{dt} = P_m - P_e - D\frac{\omega}{\omega_s},\qquad \frac{d\delta}{dt} = \omega,$$

with electrical power $P_e = \mathrm{Re}\{V\,I^*\}$ obtained from a complex phasor solution of the machine behind its transient reactance against the grid, an automatic voltage regulator on the field, and rated inertia and reactances for a ≈1080 MVA three-loop machine (sized so that at 0.90 power factor it carries the 916 MWe load, giving the correct inertia and load-rejection response).

### 9.2 Software implementation

**`lib/elec.js`** carries the generator state `{delta, omega, Eqp, Efd, avrInt}` and the breaker/bus topology. `stepElec()` integrates the swing equation and the AVR, solves the network phasors with the complex-arithmetic helpers defined in the module, and sets bus availability. Bus voltages then determine whether each reactor coolant pump remains powered, closing the loop back to RCS flow.

---

## 10. Reactor Protection System

### 10.1 Physics and equations

Every protection parameter is measured by **four independent instrument channels**, and the reactor trips only when **two of the four** agree (2-out-of-4 coincidence). This is not cosmetic: it is why a plant runs with a failed instrument and why one drifting channel does not scram the unit. Each channel is NORMAL, TRIPPED, BYPASSED, or FAILED. Bypassing removes a channel from the logic (2/4 → 2/3); a channel failed-clear silently erodes margin, since two of the remaining three must now trip. A **first-out** memory latches the parameter that satisfied its coincidence first — after a trip, roughly twenty windows light within a second, but only one caused it.

Trip functions include power-range high flux, overtemperature and overpower Δ*T* ([§4](#4-fuel-pin-thermal-model-dnbr-and-trip-functions)), high and low pressurizer pressure, high pressurizer level, low reactor coolant flow, and the low-pressure trip that must remain active after a trip because that is exactly when a small break needs it. Each parameter carries a setpoint, hysteresis band, and direction (trips above or below setpoint).

### 10.2 Software implementation

**`lib/rps.js`** defines `RPS_PARAMS`, each entry giving the number of channels, coincidence, direction, setpoint (or a state-dependent setpoint function `spOf` for OTΔ*T*/OPΔ*T*), and a `read(plant)` accessor. `stepRPS()` evaluates every channel against its setpoint with hysteresis, applies the channel state (bypass/fail), tests coincidence, latches first-out, and asserts the trip. Engineered-safeguards actuation (safety injection, containment isolation) is handled by the same coincidence machinery.

---

## 11. Auxiliary Systems

Supporting systems are modeled to the depth needed for their control-room effect, each in its own module:

- **Chemical and Volume Control (`lib/cvcs.js`)** — charging and letdown, volume-control tank, boric-acid and blended makeup; sets RCS boron and pressurizer level in concert with the level program.
- **Component Cooling and Service Water (`lib/ccw.js`)** — the intermediate cooling loop and its ultimate heat sink, with per-train pumps and heat exchangers.
- **Residual Heat Removal (`lib/rhr.js`)** — shutdown cooling placed in service below the RHR-entry pressure/temperature, with a rate-controlled cooldown.
- **Safety Injection (`lib/si.js`)** — high-head, intermediate, and low-head trains, accumulators, and the refueling water storage tank, actuated by the protection coincidence logic.
- **Containment (`lib/cnmt.js`)** — pressure/temperature response to mass and energy release, spray and fan coolers, isolation, and hydrogen control.
- **Radiation (`lib/rad.js`)** — process, effluent, and area monitors driven by primary activity and any primary-to-secondary or containment leakage.
- **Startup instrumentation (`lib/startup.js`)** — source- and intermediate-range detectors, startup rate, and the $1/M$ approach to criticality.

Each is advanced once per plant step and reads/writes the shared plant state so that its effects (e.g. isolating letdown, losing a cooling train, actuating injection) propagate into the primary and secondary balances.

---

## 12. Thermodynamic Properties

### 12.1 Physics and equations

Water and steam properties come from the international standard formulations. The **saturation line** is IAPWS-IF97 Region 4, an exact quadratic-in-$\vartheta$ inversion,

$$\vartheta = T + \frac{n_9}{T - n_{10}},\qquad P_s(T) = \left[\frac{2C}{-B + \sqrt{B^2 - 4AC}}\right]^{4},$$

with $A,B,C$ quadratic in $\vartheta$ from the IF97 coefficients. **Saturated densities** use the IAPWS-95 supplementary auxiliary equations, and **saturated enthalpies** are built from the auxiliary $\alpha(T)$ combined with the Clapeyron relation,

$$h' = \alpha + T v'\frac{dP_s}{dT},\qquad h'' = \alpha + T v''\frac{dP_s}{dT},$$

so that $h_{fg}$, $v_{fg}$, and $dP_s/dT$ are mutually consistent by construction. Internally all properties are SI (K, MPa, m³/kg, J/kg); English-unit wrappers (°F, psia, ft³/lbm, Btu/lbm) are provided for the plant modules.

### 12.2 Software implementation

**`lib/steam.js`** implements the IF97/IAPWS-95 relations directly (`Psat`, `Tsat`, saturated $v$, $h$, and their unit conversions). **`lib/props.js`** tabulates the handful of saturation properties that appear inside hot inner loops (e.g. the DNBR path) against pressure to within 0.03 %, trading a negligible accuracy loss for a large reduction in per-step transcendental evaluations. The tabulation error is far inside the correlation uncertainties of the models that consume it.

---

## 13. Numerical Framework and Plant Integration

### 13.1 Method

The plant is advanced by **operator splitting** with a semi-implicit treatment of each stiff subsystem. Within one step $\Delta t$ (nominally 0.05 s of simulated time) the modules are evaluated in a fixed causal order so that each sees the freshly updated upstream state:

1. control-rod drive motion;
2. **reactivity** from the present fuel temperature, $T_{\text{avg}}$, boron, rods, and poisons;
3. **kinetics** (backward Euler) → fission and total power;
4. **fuel** conduction → fuel/clad temperatures and $\Delta T$;
5. **secondary** (turbine, dumps, feedwater) and **steam generators**;
6. **electrical** swing and buses (→ RCP power);
7. **RCS** transport, global pressure solve, and momentum;
8. **pressurizer**, **CVCS**, safeguards, containment, radiation;
9. **trip functions** and the **protection** coincidence logic.

Each subsystem uses an integrator matched to its own stiffness — implicit updates for the fast neutron and precursor dynamics and for the long poison time constants, bracketed root solves for the volume-constraint pressures, and explicit first-order updates where the physics is slow. The scheme is approximately **time-step-independent** across the range of real-time and fast-forward rates the interface offers, and it is **deterministic**: given identical initial conditions and inputs it produces identical trajectories, with no reliance on wall-clock timing or uncontrolled random sources.

### 13.2 Software implementation

**`lib/plant.js`** owns the composite plant state and the `stepPlant(PL, dt)` loop that sequences the modules above; `makePlant()` and `initPlant()` construct and settle the plant to a self-consistent equilibrium at a requested power. **`lib/ic.js`** provides snapshot/restore of the complete state as plain, serializable data; restoration is **bit-identical**, which is what makes exact save/load, scenario reset, and shared-state multiplayer possible — a restored copy and the original step in lockstep indefinitely. The determinism and the snapshot round-trip are checked in the automated test suite.

---

## 14. Validation and Limitations

The coefficient set is anchored to published NRC values, and the following behaviors are reproduced and checked qualitatively or in tests: the Way–Wigner decay-heat curve after trip; the sign and magnitude of the MTC versus temperature and boron; the zero-to-full-power Doppler and total power defects; equilibrium and post-trip xenon and equilibrium samarium worths; the wrong-way (non-minimum-phase) steam-generator level response to feed and to steam demand; natural circulation on loss of forced flow; and load-rejection generator dynamics.

The model is nonetheless a **lumped-parameter, control-oriented** representation. Principal simplifications, each stated with its subsystem above, include: point (zero-dimensional) neutronics with no spatial or axial flux distribution (hence $f_1(\Delta I) = f_2(\Delta I) = 0$ in the Δ*T* trips); a uniform-pressure RCS with donor-cell enthalpy transport and a drift-flux void, without counter-current flow limiting or mechanistic phase separation; an equilibrium pressurizer; and property tabulation inside hot loops. These make the simulator excellent for operator training, procedure walk-throughs, and cause-and-effect study, and unsuitable as a licensing or best-estimate accident-analysis tool.

---

## 15. Software Architecture

The physics library (`lib/`) is pure, dependency-free ES-module JavaScript that runs identically in a browser and in Node. Each module owns one subsystem and exposes a `params`/`make`/`step` triple; `plant.js` composes them. The user interface (`ui/`) is a set of render functions — control boards, a live plant mimic, analog gauges, an annunciator wall, and a procedures panel — that read the shared plant state and never mutate it except through a single command channel.

The same physics core runs in two deployment modes. **Single-player** serves the static files (browser-hosted `lib/` + `ui/`), advancing the plant locally in the render loop. **Multiplayer** moves the identical `stepPlant` loop onto an authoritative Node server that owns one plant instance, broadcasts state at a fixed rate, and applies operator commands under a role model; clients become terminals that restore the broadcast state and issue commands. Determinism and bit-identical snapshots ([§13](#13-numerical-framework-and-plant-integration)) are precisely what let the two modes share code and let many clients observe one consistent plant. Deployment specifics — server hosting, authentication, and cache-busted static delivery — are documented in `DEPLOY.md`.

---

## 16. References

1. U.S. Nuclear Regulatory Commission, *Westinghouse Technology Systems Manual*, §2.1 "Reactor Physics Review," ML11223A207.
2. International Association for the Properties of Water and Steam, *Revised Release on the IAPWS Industrial Formulation 1997 for the Thermodynamic Properties of Water and Steam* (IAPWS-IF97).
3. International Association for the Properties of Water and Steam, *Revised Supplementary Release on Saturation Properties of Ordinary Water Substance* (IAPWS-95 auxiliary equations).
4. K. Way and E. P. Wigner, "The Rate of Decay of Fission Products," *Physical Review* **73**, 1318 (1948).
5. L. S. Tong, *Boiling Crisis and Critical Heat Flux*, and the Westinghouse W-3 correlation as applied in PWR thermal-hydraulic design.
6. American Nuclear Society, *Decay Heat Power in Light Water Reactors*, ANS-5.1 (cross-reference for the decay-heat treatment).
7. J. J. Duderstadt and L. J. Hamilton, *Nuclear Reactor Analysis* (point kinetics, inhour equation, fission-product poisoning).

---

*This document describes the model as implemented in the accompanying source. Where the text gives a representative numerical value, the authoritative value is the one in the corresponding module's parameter block.*
