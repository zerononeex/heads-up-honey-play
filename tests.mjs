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
test('pot: five fill states from a fake today against a fixture cycle', () => {
  // starts Jan 1, Jan 29, Feb 26 -> frozen window Mar 25-27 (same fixture and dates as the v1 bomb test)
  const st = storeWith(startsFrom('2026-01-01', [28, 28]));
  $('freezePrediction')(st, '2026-02-26');
  const pot = d => $('potSVG')($('status')(st, d));
  const at = d => { const h = $('status')(st, d), svg = pot(d); return [h.state, svg.match(/data-level="([\d.]+)"/)[1], /class="dipper"/.test(svg), /class="drip"/.test(svg), h.line1, h.days]; };
  assert.deepEqual(at('2026-03-10'), ['far', '0.00', false, false, 'T-minus 15 days', 15]);
  assert.deepEqual(at('2026-03-17'), ['approaching', '0.33', false, false, 'T-minus 8 days', 8]);
  assert.deepEqual(at('2026-03-22'), ['close', '0.67', true, false, 'T-minus 3 days', 3]);
  assert.deepEqual(at('2026-03-26'), ['window', '1.00', true, true, 'In the window', -1]);
  assert.deepEqual(at('2026-02-27'), ['period', '0.00', false, false, 'Day 2', undefined]);
  assert.match($('status')(st, '2026-03-26').line2, /^Expected Mar 25 – Mar 27$/);
  // honey is clipped to the pot's inner shape and has the deeper top edge; empty pot draws no honey at all
  assert.match(pot('2026-03-17'), /<clipPath id="pf"><path d="M21 19[^"]*Z"\/><\/clipPath>/);
  assert.match(pot('2026-03-17'), /<g clip-path="url\(#pf\)"><rect[^>]*fill="#F59E0B"\/><rect[^>]*fill="#D97706"\/><\/g>/);
  assert.doesNotMatch(pot('2026-03-10'), /#F59E0B|clip-path=/);
  // past the window with nothing logged stays full (no "late" state)
  assert.match(pot('2026-04-05'), /data-state="past" data-level="1.00"/);
  // learning state also shows the empty outline
  assert.match($('potSVG')($('status')(storeWith(['2026-01-01']), '2026-01-20')), /data-state="far" data-level="0.00"/);
  // logging the next start resets to the empty outline for the new cycle
  Object.assign(st.days, storeWith(['2026-03-26']).days);
  assert.match(pot('2026-03-26'), /data-state="period" data-level="0.00"/);
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

// ---- skins: tokens per skin, toggle, separate UI key (fake document + localStorage; init() never runs here)
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const skinVars = sel => Object.fromEntries([...css.slice(css.indexOf(sel + '{')).match(/\{([^}]*)\}/)[1].matchAll(/(--[\w]+):([^;}]+)/g)].map(m => [m[1], m[2].trim()]));
const SKIN_CSS = { midnight: skinVars(':root'), cream: skinVars(':root[data-skin="cream"]') };
const lum = hex => { const c = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
test('skins: both define the same tokens; flow deepens; selected ring, filter ring and shading stay distinct', () => {
  assert.deepEqual(Object.keys(SKIN_CSS.cream).sort(), Object.keys(SKIN_CSS.midnight).sort());
  assert.match(html, /<html lang="en" data-skin="midnight">/); // Honey Midnight is the first-run default
  for (const [skin, v] of Object.entries(SKIN_CSS)) {
    const away = [1, 2, 3, 4].map(f => Math.abs(lum(v['--f' + f]) - lum(v['--bg'])));
    assert.ok(away.every((x, i) => !i || x > away[i - 1]), skin + ': each flow level sits further from the background');
    const rings = [v['--ink'], v['--match'], v['--f1'], v['--f2'], v['--f3'], v['--f4']].map(x => x.toLowerCase()); // .sel ring, .m ring, shading
    assert.equal(new Set(rings).size, rings.length, skin + ': rings and shading all differ');
    assert.notEqual(v['--on'].toLowerCase(), v['--chip'].toLowerCase(), skin + ': selected chips differ from unselected');
  }
  assert.equal(SKIN_CSS.midnight['--bg'], '#221A14'); assert.equal(SKIN_CSS.midnight['--f3'], '#8B2E4A'); assert.equal(SKIN_CSS.midnight['--match'], '#F59E0B');
  assert.equal(SKIN_CSS.cream['--bg'], '#FFF7E6'); assert.equal(SKIN_CSS.cream['--f2'], '#E8A0B4'); assert.equal(SKIN_CSS.cream['--f4'], '#C14A6E'); assert.equal(SKIN_CSS.cream['--match'], '#D97706');
  // the CSS still draws the selected day and the filter match with different tokens and widths
  assert.match(css, /\.cal \.d\.sel\{box-shadow:inset 0 0 0 2px var\(--ink\)\}/);
  assert.match(css, /\.cal \.d\.m\{[^}]*box-shadow:inset 0 0 0 3px var\(--match\)/);
});
const memStorage = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
test('skin toggle: switches the root attribute, round-trips through the UI key, never touches the data bytes', () => {
  const meta = {}, root = { dataset: {} };
  ctx.document = { documentElement: root, querySelector: () => meta }; ctx.localStorage = memStorage();
  const v1 = storeWith(startsFrom('2026-01-01', [28, 28]), { '2026-01-10': { ...$('blankEntry')(), moodScore: 6, note: 'v1 day' } });
  $('freezePrediction')(v1, '2026-02-26');
  const raw = JSON.stringify(v1); // exactly what v1's save() writes
  ctx.localStorage.setItem($('KEY'), raw);
  assert.equal($('loadSkin')(), 'midnight', 'missing UI key');
  for (const bad of ['{oops', 'null', '[]', '{"skin":"neon"}', '{"skin":"constructor"}']) { ctx.localStorage.setItem($('UI_KEY'), bad); assert.equal($('loadSkin')(), 'midnight', bad); }
  $('setSkin')('cream', true);
  assert.equal(root.dataset.skin, 'cream'); assert.equal(meta.content, '#FFF7E6');
  assert.equal(ctx.localStorage.getItem($('UI_KEY')), '{"skin":"cream"}'); assert.equal($('loadSkin')(), 'cream');
  $('setSkin')('midnight', true);
  assert.equal(root.dataset.skin, 'midnight'); assert.equal(meta.content, '#221A14'); assert.equal($('loadSkin')(), 'midnight');
  $('setSkin')('cream', true);
  assert.equal(ctx.localStorage.getItem($('KEY')), raw, 'data bytes identical after skin changes');
  // a v1-format store loads unchanged and saves back byte-identical; the skin never enters it (so never into exports)
  vm.runInContext('store = load(); save()', ctx);
  assert.equal($('readOnly'), false); assert.equal(JSON.stringify($('store')), raw); assert.equal(ctx.localStorage.getItem($('KEY')), raw);
  assert.doesNotMatch(raw, /skin|cream|midnight/);
  assert.notEqual($('UI_KEY'), $('KEY'));
  // Settings shows the segmented toggle with the current skin selected
  const h = $('settingsHTML')($('store'), { pendingImport: null, resetStep: 0, msg: '' }, '2026-03-01', 'cream');
  assert.match(h, /<div class="lbl">Skin<\/div>\n<div class="row"><button class="seg" data-skin="midnight">Honey Midnight<\/button><button class="seg on" data-skin="cream">Honey Cream<\/button><\/div>/);
  // Reset this app only removes the data key, never the UI key
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.match(script, /'reset' in t\) \{ localStorage\.removeItem\(KEY\);/);
  assert.doesNotMatch(script, /removeItem\(UI_KEY\)|localStorage\.clear/);
  delete ctx.document; delete ctx.localStorage;
});

test('.ics: one discreet all-day event over the predicted window; refused while still learning', () => {
  const st = storeWith(startsFrom('2026-01-01', [28, 28])); // frozen window Mar 25-27
  $('freezePrediction')(st, '2026-02-26');
  const ics = $('icsFor')($('currentPrediction')(st), '2026-03-01');
  assert.equal(ics, ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Heads-Up Honey//EN', 'BEGIN:VEVENT', 'UID:20260226@heads-up-honey', 'DTSTAMP:20260301T000000Z',
    'DTSTART;VALUE=DATE:20260325', 'DTEND;VALUE=DATE:20260328', 'SUMMARY:🍯', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.doesNotMatch(ics, /period|cycle|DESCRIPTION|LOCATION/i);
  // month rollover: window ending on the 31st ends the day after, in the next month
  assert.match($('icsFor')({ forCycleStart: '2026-12-01', windowStart: '2026-12-29', windowEnd: '2026-12-31' }, '2026-12-01'), /DTEND;VALUE=DATE:20270101\r\n/);
  const ui = { pendingImport: null, resetStep: 0, msg: '' };
  assert.match($('settingsHTML')(st, ui, '2026-03-01', 'midnight'), /<button class="seg" data-ics>Add predicted window to calendar \(\.ics\)<\/button>/);
  const learning = storeWith(['2026-01-01', '2026-01-29']);
  assert.equal($('icsFor')($('currentPrediction')(learning), '2026-02-01'), null);
  const h = $('settingsHTML')(learning, ui, '2026-02-01', 'midnight');
  assert.match(h, /<button class="seg" data-ics disabled>Add predicted window to calendar \(\.ics\)<\/button>/);
  assert.match(h, /No prediction yet — the calendar file appears once the app can predict a window\./);
});

console.log(`\n${n} checks passed`);
