// ======================================================================
//  version.js — single source of truth for the build version
//
//  Filenames are NOT versioned, deliberately.  Renaming plant.js to
//  plant-v3.js breaks every import that references it, so one edit cascades
//  through every importing file plus index.html.  The problem versioned
//  filenames actually solve is browser caching, and a query string solves
//  that without the cascade: import './lib/plant.js?v=' + BUILD.
//
//  Bump BUILD on every change that ships. The panel displays it, so you can
//  confirm at a glance that the deployed copy is the one you uploaded.
// ======================================================================
export const BUILD = '0.15.2';
export const BUILT = '2026-07-23';

/** Per-module versions, bumped when that module changes. */
export const MODULES = {
  'steam.js':      '1.0.0',
  'props.js':      '1.2.0',
  'kinetics.js':   '1.1.0',
  'reactivity.js': '1.2.0',
  'fuel.js':       '1.1.0',
  'rcs.js':        '1.5.0',
  'pzr.js':        '1.3.0',
  'sg.js':         '1.2.0',
  'secondary.js':  '1.2.0',
  'elec.js':       '1.0.1',
  'plant.js':      '1.8.0',
  'cvcs.js':       '1.0.1',
  'rhr.js':        '1.0.1',
  'si.js':         '1.0.0',
  'cnmt.js':       '1.0.1',
  'rps.js':        '1.0.0',
  'ic.js':         '1.5.0',
  'version.js':    '1.0.0'
};
