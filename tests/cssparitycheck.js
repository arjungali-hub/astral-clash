// What the browser actually computes, before and after moving CSS about.
//
// WHY THIS EXISTS. Extracting shared rules into a stylesheet is not a text
// refactor - it MOVES RULES IN THE CASCADE. Two rules of equal specificity are
// decided by order, so a rule that was winning at line 900 can start losing the
// moment it moves into a file that loads first. That is precisely the trap that
// produced a close button 1040px wide earlier in this project:
//
//     `.menu-section button` (0,2,0) beat a bare `.modal-x` (0,1,0)
//
// and order decides the same way whenever specificity ties.
//
// So this records what the browser computes for every visible element on every
// screen - not the CSS text, the RESULT - and compares two runs. Text can be
// reorganised freely as long as this does not move.
//
//     node tests/cssparitycheck.js --save baseline     before the change
//     node tests/cssparitycheck.js baseline            after it
//
// Comparing the RESULT rather than the rules is the point: it does not care how
// the CSS is organised, only whether the page still looks the same.
const fs = require('fs');
const path = require('path');
const H = require('./harness');

// WHEN THE LAYOUT WAS LAST MEANT TO CHANGE.
//
// Bump this in the same commit as a deliberate layout change, with a word about
// what moved. Any baseline captured under an older epoch is treated as stale
// rather than as a regression: it is reseeded, and the run says it compared
// nothing - the same thing it already does on a first run.
//
// This exists because there was NO way to accept an intended change. The
// baseline is git-ignored and comes from a CI cache, and the checker only wrote
// it when absent, so the first intended change poisoned every later run. The
// two that did it:
//
//   * the account panel became a modal, so #account-screen and its buttons are
//     no longer part of the select-screen flow - reported as "gone", correctly;
//   * the daily challenge panel changed the select screen's height, 936 -> 926
//     online and a menu-section 684 -> 751 in the local build.
//
// Both were asked for. Neither is a cascade accident, which is what this
// checker is for.
//
// Not committed as a file, deliberately: this records what the BROWSER
// computes, and font metrics differ between a Windows dev machine and an Ubuntu
// runner, so a committed snapshot would diff everywhere except where it was
// made. The epoch is the part that belongs in version control; the measurements
// belong to whichever machine took them.
const BASELINE_EPOCH = '2026-10-11: account panel became a modal; daily panel added';

// Enough to catch a cascade change; not so much that noise drowns it.
const PROPS = ['display', 'position', 'width', 'height', 'margin', 'padding',
    'color', 'background-color', 'border', 'border-radius', 'font-size',
    'font-weight', 'text-align', 'flex', 'overflow', 'max-height', 'z-index',
    'opacity', 'top', 'left', 'right', 'bottom'];

const SCREENS = [
    ['select', null],
    ['settings', "document.getElementById('btn-open-settings').click()"],
    ['tutorial', "document.getElementById('btn-open-tutorial').click()"],
    ['rebind', "document.getElementById('btn-open-settings').click(); document.getElementById('btn-open-rebind').click()"],
    ['audio', "document.getElementById('btn-open-settings').click(); document.getElementById('btn-open-audio').click()"],
    ['mapselect', "window.ACDebug.setDebugUnlockAll(true); (function(){const p=(g,d)=>{document.querySelectorAll(g+' .fighter-btn')[0].click();const c=document.querySelector(d+' .btn-confirm');if(c)c.click();};p('#p1-grid','#p1-detail');p('#p2-grid','#p2-detail');})(); document.getElementById('btn-start-match').click()"],
    ['shop', "window.ACDebug.setDebugUnlockAll(true); document.querySelector('[data-shop-side]') && document.querySelector('[data-shop-side]').click()"],
];

// Several widths: a cascade change often only shows where a media query or a
// flex rule takes over, which is where this project's layout bugs have lived.
const SIZES = [[1400, 1000], [1280, 530], [640, 530]];

async function capture(page, build) {
    const out = {};
    for (const [w, h] of SIZES) {
        await page.setViewport({ width: w, height: h });
        for (const [name, open] of SCREENS) {
            await H.boot(page, { path: build });
            const snap = await page.evaluate(async (openJs, props) => {
                const wait = ms => new Promise(r => setTimeout(r, ms));
                if (openJs) { try { eval(openJs); } catch (e) { /* screen absent in this build */ } await wait(350); }
                const out = {};
                for (const el of document.querySelectorAll('button, .menu-section, .shop-panel, .tutorial-panel, [id$="-screen"], .opt, .fighter-btn, .map-card, .modal-x')) {
                    if (el.getClientRects().length === 0) continue;
                    // A stable key: id if it has one, else selector + index.
                    const key = el.id || (el.className && String(el.className).split(' ')[0] + '#' +
                        [...document.querySelectorAll('.' + String(el.className).split(' ')[0])].indexOf(el));
                    if (!key || out[key]) continue;
                    const cs = getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    const rec = { box: [Math.round(r.width), Math.round(r.height)] };
                    for (const p of props) rec[p] = cs.getPropertyValue(p);
                    out[key] = rec;
                }
                return out;
            }, open, PROPS);
            out[`${w}x${h}/${name}`] = snap;
        }
    }
    return out;
}

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);

    const save = process.argv[2] === '--save';
    const file = path.join(__dirname, '.css-baseline.json');

    const data = { epoch: BASELINE_EPOCH };
    for (const [label, build] of [['online', null], ['local', '/local/index.html']]) {
        data[label] = await capture(page, build);
    }

    if (save) {
        fs.writeFileSync(file, JSON.stringify(data));
        // Only the two builds; `epoch` is a string and has no screens to count.
        const n = ['online', 'local'].reduce((a, label) =>
            a + Object.values(data[label] || {})
                .reduce((x, y) => x + Object.keys(y).length, 0), 0);
        console.log('baseline saved: %d element snapshots across %d screens x %d sizes',
            n, SCREENS.length, SIZES.length);
        await H.closeAllBrowsers();
        process.exit(0);
    }

    const { check, section, finish } = H.makeChecker();
    if (!fs.existsSync(file)) {
        // A MISSING BASELINE IS A FIRST RUN, NOT A REGRESSION. This used to
        // fail, which meant CI - where the baseline is git-ignored and so never
        // present on a fresh checkout - failed on every single run regardless
        // of the code. A tick that is always red reports nothing.
        //
        // So: seed it, say plainly that nothing was compared, and pass. CI
        // caches the file between runs, so the run after this one does compare.
        fs.writeFileSync(file, JSON.stringify(data));
        section('No baseline existed, so one was established:');
        check('baseline written - this run compared NOTHING', true,
            'subsequent runs will diff against it');
        await finish(browser, page);
        return;
    }
    const base = JSON.parse(fs.readFileSync(file, 'utf8'));

    // A BASELINE FROM BEFORE A DECLARED CHANGE IS STALE, NOT A REGRESSION.
    // Same treatment as a missing one: reseed, say that nothing was compared,
    // and let the next run do the comparing. The alternative is what happened
    // before - an intended change failing this checker on every run until
    // somebody gave up and stopped reading it.
    if (base.epoch !== BASELINE_EPOCH) {
        fs.writeFileSync(file, JSON.stringify(data));
        section('The baseline predates a declared layout change:');
        check('baseline reseeded - this run compared NOTHING', true,
            'was ' + JSON.stringify(base.epoch || '(none)')
            + ', now ' + JSON.stringify(BASELINE_EPOCH));
        await finish(browser, page);
        return;
    }

    section('Computed styles are unchanged:');
    for (const build of ['online', 'local']) {
        const diffs = [];
        for (const scene of Object.keys(base[build] || {})) {
            const was = base[build][scene], now = (data[build] || {})[scene] || {};
            for (const key of Object.keys(was)) {
                if (!now[key]) { diffs.push(`${scene} ${key}: gone`); continue; }
                for (const p of Object.keys(was[key])) {
                    const a = JSON.stringify(was[key][p]), b = JSON.stringify(now[key][p]);
                    if (a !== b) diffs.push(`${scene} ${key}.${p}: ${a} -> ${b}`);
                }
            }
        }
        check(`${build}: nothing the browser computes has moved`,
            diffs.length === 0, diffs.slice(0, 6).join(' | ') || 'identical');
    }

    await finish(browser, page);
})();
