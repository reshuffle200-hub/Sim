// ======================================================================
//  stamp.mjs — stamp the build version onto every import specifier
//
//  WHY THIS EXISTS.  version.js has always carried this note:
//
//      Filenames are NOT versioned, deliberately.  [...] The problem
//      versioned filenames actually solve is browser caching, and a query
//      string solves that without the cascade:
//          import './lib/plant.js?v=' + BUILD
//
//  The reasoning is right and the mechanism was never wired up -- and could
//  not have been, as written.  A STATIC import specifier is a string literal;
//  it cannot be concatenated with a variable.  Only a dynamic `await import()`
//  can take an expression, and converting fifty static imports across twenty-
//  one modules into dynamic ones would be far worse than the disease.
//
//  Worse, cache-busting only the entry point does nothing.  A query string on
//  index.html's import of boards.js does not propagate to boards.js's own
//  import of widgets.js, so the nested modules come straight back out of cache
//  anyway.  Every specifier in the tree has to carry the version or none of it
//  works.  That is what this does.
//
//  The symptom it prevents is nasty precisely because it is not a clean
//  failure: the browser revalidates index.html, serves the module files from
//  cache, and you get a NEW shell talking to OLD modules.  What that looked
//  like in practice was
//
//      Uncaught TypeError: AL.sections is not a function
//
//  from a build in which alarms.js exports sections perfectly well.
//
//  There is still no bundler and no build step for development: serve the
//  source directory and it runs. This is a DEPLOY step, and it only rewrites
//  strings.
//
//  Usage:   node tools/stamp.mjs            -> writes ./dist
//           node tools/stamp.mjs --check    -> verify, change nothing
// ======================================================================

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');
const CHECK = process.argv.includes('--check');

// Directories that ship. tests/ is Node-only and never fetched by the browser.
const SHIP = ['lib', 'ui'];
const SHIP_FILES = ['index.html', 'README.md'];

const BUILD = (() => {
  const src = readFileSync(join(ROOT, 'lib/version.js'), 'utf8');
  const m = src.match(/export const BUILD = '([^']+)'/);
  if (!m) throw new Error('lib/version.js does not declare BUILD');
  return m[1];
})();

/**
 * Rewrite every relative module specifier to carry ?v=BUILD.
 *
 * Matches both static imports and re-exports, in .js and inside the module
 * script in index.html.  Specifiers that already carry a query are re-stamped
 * rather than doubled, so running this twice is safe.
 */
function stamp(src) {
  return src.replace(
    /((?:^|[\s;{}])(?:import|export)\s[^'"]*?from\s*|(?:^|[\s;{(])import\s*\()\s*(['"])(\.[^'"?]+\.js)(?:\?[^'"]*)?\2/g,
    (_, head, q, spec) => `${head}${q}${spec}?v=${BUILD}${q}`
  );
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    statSync(p).isDirectory() ? walk(p, acc) : acc.push(p);
  }
  return acc;
}

const files = [
  ...SHIP.flatMap(d => walk(join(ROOT, d))),
  ...SHIP_FILES.map(f => join(ROOT, f))
];

let stamped = 0, specifiers = 0, unstamped = [];
if (!CHECK) { rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true }); }

for (const abs of files) {
  const rel = relative(ROOT, abs);
  const src = readFileSync(abs, 'utf8');
  const isCode = rel.endsWith('.js') || rel.endsWith('.html');
  const out = isCode ? stamp(src) : src;

  if (isCode) {
    const n = (out.match(new RegExp(`\\?v=${BUILD.replace(/\./g, '\\.')}`, 'g')) || []).length;
    specifiers += n;
    if (out !== src) stamped++;
    // anything relative and .js that did NOT pick up a stamp is a specifier
    // this regex does not understand, and it would be served stale
    for (const m of out.matchAll(/(['"])(\.[^'"]+\.js)\1/g))
      if (!m[2].includes('?v=')) unstamped.push(`${rel}: ${m[2]}`);
  }

  if (!CHECK) {
    const dest = join(OUT, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, out);
  }
}

console.log(`build ${BUILD}`);
console.log(`${files.length} files, ${stamped} rewritten, ${specifiers} specifiers stamped`);
if (unstamped.length) {
  console.log('\nUNSTAMPED specifiers (these would be served from cache):');
  for (const u of unstamped) console.log('  ' + u);
  process.exit(1);
}
console.log(CHECK ? 'check passed' : `wrote ${relative(ROOT, OUT)}/ — deploy this directory`);
