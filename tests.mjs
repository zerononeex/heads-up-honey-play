// Plain checks for the non-trivial logic. Run: node tests.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Load the app's single inline script without a DOM (init() only runs when `document` exists).
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
const $ = name => vm.runInContext(name, ctx);
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

test('date math', () => {
  assert.equal($('addDays')('2026-02-28', 1), '2026-03-01');
  assert.equal($('diffDays')('2026-03-07', '2026-03-09'), 2);
  assert.equal($('shiftMonth')('2026-01', 1), '2026-02');
  assert.equal($('shiftMonth')('2026-01', -1), '2025-12');
});

test('migration guard refuses unknown versions', () => {
  assert.equal($('migrate')({ version: 1, days: {} }).version, 1);
  assert.throws(() => $('migrate')({ version: 2 }));
  assert.throws(() => $('migrate')(null));
});

test('calendar renders a Sunday-start month with flow shading', () => {
  const h = $('calHTML')('2026-10', { days: { '2026-10-05': { flow: 3 } }, selected: '2026-10-05', today: '2026-10-24' });
  assert.equal((h.match(/data-date=/g) || []).length, 31);
  assert.match(h, /class="d f3 sel" data-date="2026-10-05"/);
  assert.equal((h.match(/<div><\/div>/g) || []).length, 4); // Oct 1 2026 is a Thursday
});

// Fixture builder: period start dates -> a store with 4 Medium days each. Sample data lives only here.
const storeWith = (starts, extra = {}) => {
  const st = $('blankStore')();
  for (const s of starts) for (let i = 0; i < 4; i++) st.days[$('addDays')(s, i)] = { ...$('blankEntry')(), flow: 3 };
  Object.assign(st.days, extra);
  return st;
};
const startsFrom = (first, lens) => lens.reduce((a, l) => [...a, $('addDays')(a.at(-1), l)], [first]);

test('prediction: median of an odd count', () => {
  const p = $('predict')(startsFrom('2026-01-01', [27, 30, 28]));
  assert.equal(p.medianUsed, 28); assert.equal(p.cyclesUsed, 3);
});
test('prediction: median of an even count rounds to a whole day', () => {
  assert.equal($('predict')(startsFrom('2026-01-01', [27, 30])).medianUsed, 29); // (27+30)/2 = 28.5 -> 29
  assert.equal($('predict')(startsFrom('2026-01-01', [26, 28, 30, 40])).medianUsed, 29);
});
test('prediction: uses only the last 6 cycles', () => {
  const p = $('predict')(startsFrom('2025-01-01', [60, 60, 60, 28, 28, 28, 29, 29, 29]));
  assert.equal(p.cyclesUsed, 6); assert.equal(p.medianUsed, 29); // (28+29)/2 rounded
});
test('prediction: window spread = round((max-min)/2), min 1, capped at 4', () => {
  const w = p => $('diffDays')(p.windowStart, p.windowEnd) / 2;
  assert.equal(w($('predict')(startsFrom('2026-01-01', [28, 28]))), 1);
  assert.equal(w($('predict')(startsFrom('2026-01-01', [26, 30]))), 2);
  assert.equal(w($('predict')(startsFrom('2026-01-01', [21, 40]))), 4); // 9.5 -> capped
  const p = $('predict')(startsFrom('2026-01-01', [28, 28]));
  assert.equal(p.forCycleStart, '2026-02-26'); assert.equal(p.windowStart, '2026-03-25'); assert.equal(p.windowEnd, '2026-03-27');
});
test('prediction: fewer than 2 cycles = still learning, no default', () => {
  assert.equal($('predict')([]), null);
  assert.equal($('predict')(['2026-01-01']), null);
  assert.equal($('predict')(['2026-01-01', '2026-01-29']), null);
  const st = storeWith(['2026-01-01', '2026-01-29']);
  $('freezePrediction')(st, '2026-02-01');
  assert.equal(st.predictions.length, 0);
  assert.equal($('status')(st, '2026-02-10').line1, 'Still learning');
});
test('prediction: frozen once logged, never rewritten by later edits', () => {
  const st = storeWith(startsFrom('2026-01-01', [28, 28]));
  $('freezePrediction')(st, '2026-02-26');
  const frozen = JSON.stringify(st.predictions);
  assert.equal(st.predictions.length, 1);
  // later: a forgotten earlier start is backfilled and the latest cycle's days are edited
  Object.assign(st.days, storeWith(['2025-12-10']).days);
  st.days['2026-02-27'].flow = 4;
  $('freezePrediction')(st, '2026-03-01');
  assert.equal(JSON.stringify(st.predictions), frozen);
  assert.equal($('currentPrediction')(st).windowStart, '2026-03-25'); // the frozen one is what the UI shows
  // a new latest start appends a new prediction and leaves the old one untouched
  Object.assign(st.days, storeWith(['2026-03-28']).days);
  $('freezePrediction')(st, '2026-03-28');
  assert.equal(st.predictions.length, 2);
  assert.equal(JSON.stringify(st.predictions.slice(0, 1)), frozen);
  assert.equal(st.predictions[1].forCycleStart, '2026-03-28');
});
test('calendar hatches the predicted window', () => {
  const h = $('calHTML')('2026-03', { days: {}, today: '2026-03-01', win: { windowStart: '2026-03-25', windowEnd: '2026-03-27' } });
  assert.deepEqual([...h.matchAll(/class="d pw" data-date="([\d-]+)"/g)].map(m => m[1]), ['2026-03-25', '2026-03-26', '2026-03-27']);
});
test('bomb: five states from a fake today against a fixture cycle', () => {
  // starts Jan 1, Jan 29, Feb 26 -> frozen window Mar 25-27
  const st = storeWith(startsFrom('2026-01-01', [28, 28]));
  $('freezePrediction')(st, '2026-02-26');
  const at = d => { const h = $('status')(st, d); return [h.state, $('bombSVG')(h).match(/data-state="(\w+)" width="(\d+)"/).slice(1).join(':'), h.line1, h.days]; };
  assert.deepEqual(at('2026-03-10'), ['far', 'far:34', 'T-minus 15 days', 15]);
  assert.deepEqual(at('2026-03-17'), ['approaching', 'approaching:40', 'T-minus 8 days', 8]);
  assert.deepEqual(at('2026-03-22'), ['close', 'close:46', 'T-minus 3 days', 3]);
  assert.deepEqual(at('2026-03-26'), ['window', 'window:52', 'In the window', -1]);
  assert.deepEqual(at('2026-02-27'), ['period', 'period:34', 'Day 2', undefined]);
  assert.match($('status')(st, '2026-03-26').line2, /^Expected Mar 25 – Mar 27$/);
  // approaching fills from the bottom with cycle progress; close is solid with an unlit fuse; window lit
  assert.equal($('status')(st, '2026-03-17').fill, 19 / 27);
  assert.doesNotMatch($('bombSVG')($('status')(st, '2026-03-10')), /<path|spark/);
  assert.match($('bombSVG')($('status')(st, '2026-03-22')), /<path/); assert.doesNotMatch($('bombSVG')($('status')(st, '2026-03-22')), /spark/);
  assert.match($('bombSVG')($('status')(st, '2026-03-26')), /spark/);
  // learning state also shows the small outline
  assert.equal($('status')(storeWith(['2026-01-01']), '2026-01-20').state, 'far');
  // logging the next start resets to the small outline for the new cycle
  Object.assign(st.days, storeWith(['2026-03-26']).days);
  assert.equal($('status')(st, '2026-03-26').state, 'period');
});
test('badge: 1-9 days sets a count, window = dot, otherwise cleared; no-op when unsupported', () => {
  const calls = [];
  ctx.navigator = { setAppBadge: (...a) => calls.push(['set', ...a]), clearAppBadge: () => calls.push(['clear']) };
  const b = $('badge');
  b({ state: 'far', days: 15 }); b({ state: 'approaching', days: 9 }); b({ state: 'close', days: 1 }); b({ state: 'window', days: 0 }); b({ state: 'period' }); b({ state: 'past', days: -5 });
  assert.deepEqual(calls, [['clear'], ['set', 9], ['set', 1], ['set'], ['clear'], ['clear']]);
  ctx.navigator = {}; b({ state: 'close', days: 3 }); // unsupported: silently nothing
  ctx.navigator = { setAppBadge: () => { throw new Error('denied'); } }; b({ state: 'close', days: 3 });
  delete ctx.navigator;
});
test('cycles: lengths and period lengths; latest cycle open', () => {
  const cs = $('cycles')(storeWith(startsFrom('2026-01-01', [28, 30])).days);
  assert.equal(JSON.stringify(cs.map(c => [c.start, c.length, c.periodLen])), JSON.stringify([['2026-01-01', 28, 4], ['2026-01-29', 30, 4], ['2026-02-28', null, 4]]));
  assert.deepEqual([...$('rolling')([4, null, 7, 1])], [4, 4, 5.5, 4]);
});
const tagged = () => {
  const e = (x) => ({ ...$('blankEntry')(), ...x });
  return { ...$('blankStore')(), days: {
    '2026-09-03': e({ perimeno: ['Cold flashes / clammy'], flow: 2 }),
    '2026-09-20': e({ symptoms: ['Cramps'], note: 'felt CLAMMY after dinner' }),
    '2026-10-02': e({ perimeno: ['Cold flashes / clammy', 'Night sweats'], moodScore: 4 }),
    '2026-10-05': e({ symptoms: ['Headache'] }),
  } };
};
test('filter: search "clammy" matches the chip "Cold flashes / clammy" and note text', () => {
  assert.equal(JSON.stringify($('labelsLike')('clammy')), '["Cold flashes / clammy"]');
  const st = tagged();
  assert.equal(JSON.stringify($('matchDays')(st.days, null, 'clammy')), '["2026-10-02","2026-09-20","2026-09-03"]');
  assert.equal(JSON.stringify($('matchDays')(st.days, 'Cold flashes / clammy', '')), '["2026-10-02","2026-09-03"]');
  assert.equal(JSON.stringify($('matchDays')(st.days, 'Cold flashes / clammy', 'sweats')), '["2026-10-02"]');
  const h = $('filterHTML')(st, { tag: null, q: 'clammy', month: '2026-10' }, '2026-10-24');
  assert.deepEqual([...h.matchAll(/data-tag="([^"]+)"/g)].map(m => m[1]), ['Cold flashes / clammy']); // chip picker narrows
  assert.match(h, /class="sum">“clammy” — 3 days</);
});
test('filter: full chip picker lists every chip in every group', () => {
  const h = $('filterHTML')(tagged(), { tag: null, q: '', month: '2026-10' }, '2026-10-24');
  assert.equal([...h.matchAll(/data-tag=/g)].length, $('ALL').length);
  assert.equal($('ALL').length, 10 + 8 + 10 + 5 + 27);
});
test('filter: calendar highlights only matching days (period shading kept)', () => {
  const st = tagged(), f = { tag: 'Cold flashes / clammy', q: '', month: '2026-09' };
  const h = $('filterHTML')(st, f, '2026-10-24');
  assert.match(h, /class="sum">Cold flashes \/ clammy — 2 days</);
  const cal = h.slice(h.indexOf('class="cal"'), h.indexOf('class="mhead"'));
  assert.deepEqual([...cal.matchAll(/class="d[^"]*\bm\b[^"]*" data-date="([\d-]+)"/g)].map(m => m[1]), ['2026-09-03']);
  assert.match(cal, /class="d f2 m" data-date="2026-09-03"/); // period shading + filter ring together
  assert.doesNotMatch(cal, /class="[^"]*\bm\b[^"]*" data-date="2026-09-20"/);
});
test('filter: results list grouped by month (newest first), rows jump to the right date', () => {
  const h = $('filterHTML')(tagged(), { tag: 'Cold flashes / clammy', q: '', month: '2026-10' }, '2026-10-24');
  const list = h.slice(h.indexOf('class="mhead"'));
  assert.deepEqual([...list.matchAll(/class="mhead">([^<]+)/g)].map(m => m[1]), ['October 2026', 'September 2026']);
  const rows = [...list.matchAll(/class="res" data-date="([\d-]+)"><b>([^<]+)<\/b><small>([^<]*)/g)].map(m => m.slice(1));
  assert.deepEqual(rows, [['2026-10-02', 'Fri, Oct 2', 'Mood 4 · Cold flashes / clammy · Night sweats'], ['2026-09-03', 'Thu, Sep 3', 'Flow light · Cold flashes / clammy']]);
  const u = { view: 'filter', selected: '2026-10-24', month: '2026-10', back: false };
  $('jump')(u, rows[1][0]);
  assert.deepEqual({ ...u }, { view: 'cal', selected: '2026-09-03', month: '2026-09', back: true });
});
test('import: validates the whole file before anything is written', () => {
  const imp = t => $('parseImport')(t);
  const good = storeWith(startsFrom('2026-01-01', [28, 28]), { '2026-01-10': { ...$('blankEntry')(), moodScore: 6, perimeno: ['Brain fog'], note: 'ok', source: 'voice' } });
  $('freezePrediction')(good, '2026-02-26');
  assert.equal(imp(JSON.stringify(good)).error, undefined, 'valid full store');
  assert.equal(imp(JSON.stringify($('blankStore')())).error, undefined, 'valid blank store');
  assert.equal(JSON.stringify(imp(JSON.stringify(good)).data), JSON.stringify(good), 'round-trips unchanged');
  const bad = (label, mutate) => { const o = JSON.parse(JSON.stringify(good)); mutate(o); assert.ok(imp(JSON.stringify(o)).error, label); };
  assert.match(imp('{not json').error, /not valid JSON/);
  assert.ok(imp('[]').error, 'array'); assert.ok(imp('null').error, 'null'); assert.ok(imp('"x"').error, 'string');
  bad('version 2', o => o.version = 2);
  bad('missing days', o => delete o.days);
  bad('predictions not array', o => o.predictions = {});
  bad('bad date key', o => o.days['2026-13-01'] = o.days['2026-01-10']);
  bad('impossible date', o => o.days['2026-02-30'] = o.days['2026-01-10']);
  bad('flow 5', o => o.days['2026-01-10'].flow = 5);
  bad('mood 11', o => o.days['2026-01-10'].moodScore = 11);
  bad('mood 5.5', o => o.days['2026-01-10'].moodScore = 5.5);
  bad('mood missing', o => delete o.days['2026-01-10'].moodScore);
  bad('cut chip Bloating', o => o.days['2026-01-10'].symptoms = ['Bloating']);
  bad('chip in wrong group', o => o.days['2026-01-10'].symptoms = ['Calm']);
  bad('tags not array', o => o.days['2026-01-10'].feelings = 'Loved');
  bad('note not string', o => o.days['2026-01-10'].note = 3);
  bad('bad source', o => o.days['2026-01-10'].source = 'sync');
  bad('bad mode', o => o.settings.moodCheckMode = 'always');
  bad('bad pause date', o => o.settings.moodCheckPausedUntil = 'tomorrow');
  bad('bad prediction', o => o.predictions[0].windowStart = null);
  bad('prediction median not integer', o => o.predictions[0].medianUsed = 28.5);
});
test('csv export: one row per day, quoted cells', () => {
  const csv = $('toCSV')({ '2026-01-02': { ...$('blankEntry')(), flow: 3, moodScore: 6, symptoms: ['Cramps', 'Tender'], note: 'said "ow", twice' } }).split('\r\n');
  assert.equal(csv[0], 'date,flow,moodScore,moodWords,feelings,symptoms,energyDay,perimeno,note,source');
  assert.equal(csv[1], '"2026-01-02","Medium","6","","","Cramps; Tender","","","said ""ow"", twice","tap"');
});
test('mood check-in banner: modes, evening only, window range, pause, already logged', () => {
  const st = storeWith(startsFrom('2026-01-01', [28, 28])); // frozen window Mar 25-27 after start Feb 26
  $('freezePrediction')(st, '2026-02-26');
  const due = (d, h = 20) => $('checkinDue')(st, d, h);
  assert.equal(due('2026-02-28'), true, 'bleed day 3');
  assert.equal(due('2026-03-01'), false, 'bleed day 4');
  assert.equal(due('2026-03-17'), false, 'window start -8');
  assert.equal(due('2026-03-18'), true, 'window start -7');
  assert.equal(due('2026-03-18', 18), false, 'before 19:00');
  assert.equal(due('2026-04-10'), true, 'window passed, no start yet: still invited, never "overdue"');
  st.days['2026-03-18'] = { ...$('blankEntry')(), moodScore: 7 };
  assert.equal(due('2026-03-18'), false, 'mood already logged today');
  $('pause')(st, '2026-03-19');
  assert.equal(st.settings.moodCheckPausedUntil, '2026-03-26');
  assert.equal(due('2026-03-25'), false, 'paused'); assert.equal(due('2026-03-26'), true, 'pause over');
  st.settings.moodCheckPausedUntil = null; assert.equal(due('2026-03-05'), false, 'window mode, outside range');
  st.settings.moodCheckMode = 'daily'; assert.equal(due('2026-03-05'), true, 'daily');
  st.settings.moodCheckMode = 'off'; assert.equal(due('2026-03-26'), false, 'off');
  const learning = storeWith(['2026-01-01']);
  assert.equal($('checkinDue')(learning, '2026-01-02', 21), true); assert.equal($('checkinDue')(learning, '2026-01-20', 21), false);
});
test('header copy never says "period"', () => {
  const st = storeWith(startsFrom('2026-01-01', [28, 28]));
  for (let i = -5; i < 60; i++) { const s = $('status')(st, $('addDays')('2026-02-26', i)); assert.doesNotMatch(s.line1 + s.line2, /period/i); }
});

console.log(`\n${n} checks passed`);
