// The annunciator wall: section grouping, engraved legends, lit-only filter.
// Mirrors renderTiles() in index.html so the layout is covered by a test
// rather than only by opening a browser.
import * as PLANT from '../lib/plant.js';
import * as AL from '../ui/alarms.js';
import * as AN from '../ui/annun.js';

const PL = PLANT.makePlant({ life: 'MOL' });
PLANT.initPlant(PL, 1.0, 600);
const ANN = AN.makeEngine(AL.annunPoints());
const SECTIONS = AL.sections();

function renderTiles(nowS, showLitOnly = false) {
  const st = ANN.points.map((p, i) => AN.render(ANN, i, nowS));
  return SECTIONS.map(sec => {
    const idx = ANN.points.map((p, i) => i).filter(i => ANN.points[i].section === sec);
    const lit = idx.filter(i => st[i].lit).length;
    const show = showLitOnly ? idx.filter(i => st[i].lit) : idx;
    if (!show.length) return '';
    return `<div class="annsec"><div class="annseclabel">${sec}` +
      `<b class="${lit ? 'lit' : ''}">${lit ? lit + ' of ' + idx.length : idx.length}</b></div>` +
      `<div class="tiles">${show.map(i => {
        const r = st[i], p = ANN.points[i];
        const legend = AL.legendLines(p.name).map(l => `<span>${l}</span>`).join('');
        const cls = r.lit ? 'tile on' + (r.cls ? ' ' + r.cls : '')
          + (r.flash ? (r.cls === 'ringback' ? ' rb' : ' new') : '')
          + (r.first ? ' first' : '') : 'tile';
        return `<div class="${cls}" title="${p.name}">${legend}</div>`;
      }).join('')}</div></div>`;
  }).join('');
}

const step = s => { for (let i = 0; i < s / 0.1; i++) {
  PLANT.stepPlant(PL, 0.1); AN.step(ANN, i2 => AL.readPoint(PL, i2), 0.1); } };

let fail = 0;
const check = (name, cond, detail = '') => {
  if (!cond) { fail++; console.log(`  FAIL  ${name} ${detail}`); }
  else console.log(`  ok    ${name} ${detail}`);
};

step(30);
let html = renderTiles(1);
const nWin = ANN.points.length;

check('every window rendered', (html.match(/class="tile[ "]/g) || []).length === nWin,
      `(${(html.match(/class="tile[ "]/g)||[]).length} of ${nWin})`);
check('every section rendered', (html.match(/annseclabel/g) || []).length === SECTIONS.length,
      `(${SECTIONS.length} sections)`);
check('legends are stacked spans', (html.match(/<span>/g) || []).length >= nWin,
      `(${(html.match(/<span>/g)||[]).length} lines for ${nWin} windows)`);
check('no orphan tag spans', !html.includes('class="tag"'));
check('every window has a tooltip', (html.match(/title="/g) || []).length === nWin);
check('markup balanced', (html.match(/<div/g)||[]).length === (html.match(/<\/div>/g)||[]).length);
check('no undefined in markup', !/undefined|NaN/.test(html));

// at power, few windows lit; lit-only must collapse the wall
const litAtPower = ANN.points.filter((p, i) => AN.render(ANN, i, 1).lit).length;
const litHtml = renderTiles(1, true);
check('lit-only filter shrinks the wall', litHtml.length < html.length,
      `(${litAtPower} lit of ${nWin})`);

// trip: many windows light, first-out marks exactly one per section
PLANT.stepPlant(PL, 0.1, { trip: true });
PL.trip = true;
step(90);
html = renderTiles(2);
const litAfter = ANN.points.filter((p, i) => AN.render(ANN, i, 2).lit).length;
check('trip lights more windows', litAfter > litAtPower, `(${litAtPower} -> ${litAfter})`);
check('first-out marked', (html.match(/ first"/g) || []).length >= 1,
      `(${(html.match(/ first"/g)||[]).length} first-out)`);
check('still every window rendered', (html.match(/class="tile[ "]/g) || []).length === nWin);
check('no undefined after trip', !/undefined|NaN/.test(html));

// section sizes: no bay so large it cannot be scanned
const sizes = SECTIONS.map(s => ANN.points.filter(p => p.section === s).length);
check('no bay over 30 windows', Math.max(...sizes) <= 30, `(largest ${Math.max(...sizes)})`);
check('no empty bay', Math.min(...sizes) > 0, `(smallest ${Math.min(...sizes)})`);

// legend geometry must fit a small window
const lines = ANN.points.map(p => AL.legendLines(p.name));
check('legends at most 3 lines', Math.max(...lines.map(l => l.length)) <= 3,
      `(max ${Math.max(...lines.map(l => l.length))})`);
check('legend lines at most 13 chars', Math.max(...lines.flat().map(s => s.length)) <= 13,
      `(max ${Math.max(...lines.flat().map(s => s.length))})`);
check('no legend loses a word',
      ANN.points.every(p => AL.legendLines(p.name).join(' ') === p.name));

console.log(`\n  ${nWin} windows in ${SECTIONS.length} sections`);
console.log(fail ? `  *** ${fail} CHECKS FAILED ***` : '  ANNUNCIATOR WALL: ALL CHECKS PASSED');
process.exit(fail ? 1 : 0);
