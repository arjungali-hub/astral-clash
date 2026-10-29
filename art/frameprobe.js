// How much window does the menu frame waste, and what scrolls inside it?
//
//   node art/frameprobe.js [--shots]
//
// UI review finding #1: "Frame is 1170x650 / 960x650 regardless of viewport,
// leaving 350px / 50px unused, yet content scrolls inside it: Armory 1,402px,
// Tutorial 1344px, character select 855px, Settings 678px, match-end 688px,
// lobby while hosting 699px."
//
// #game-container is height: min(96vh, 650px) and #ui-overlay is absolute
// inside it, so every menu is boxed at 650px however tall the window is. This
// measures that directly - frame height against viewport, and each screen's
// scrollHeight against the frame - so the fix has a before to be judged
// against, and so the figures in the report are confirmed on this machine
// rather than taken on faith.
//
// --shots writes a PNG per screen per viewport into tests/screenshots/, which
// is the only way to answer the part no number can: whether letting the menus
// out of the frame looks right.
const path = require('path');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

const VIEWPORTS = [
    ['1400x1000', 1400, 1000],
    ['1000x700', 1000, 700],
    ['400x800', 400, 800],
];

// Each entry opens one screen and names it. Kept to what the finding lists,
// and to what is reachable without a peer or a running match.
const SCREENS = [
    ['home', () => {}],
    // NAMED. [id*="play"] also matches btn-exit-replay and btn-save-replay,
    // and btn-exit-replay comes first in the document - which in another probe
    // meant the online build clicked Exit Replay and measured nothing.
    ['select', () => { const b = document.getElementById('btn-home-play'); if (b) b.click(); }],
    ['armory', () => { const b = document.getElementById('btn-open-shop'); if (b) b.click(); }],
    ['tutorial', () => { const b = document.getElementById('btn-open-tutorial'); if (b) b.click(); }],
    ['settings', () => { const b = document.getElementById('btn-open-settings'); if (b) b.click(); }],
];

(async () => {
    const shots = process.argv.includes('--shots');
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    const rows = [];

    for (const [vlabel, w, h] of VIEWPORTS) {
        await page.setViewport({ width: w, height: h });
        await H.boot(page, { clearStorage: true });
        for (const [slabel, open] of SCREENS) {
            const m = await page.evaluate((src) => {
                // Back to a known state, then open the one screen.
                if (window.ACDebug && window.ACDebug.closeAllModals) window.ACDebug.closeAllModals();
                // eslint-disable-next-line no-new-func
                new Function('return (' + src + ')')()();
                const gc = document.getElementById('game-container');
                const ov = document.getElementById('ui-overlay');
                const gr = gc.getBoundingClientRect();
                return {
                    viewportH: window.innerHeight,
                    frameH: Math.round(gr.height),
                    frameW: Math.round(gr.width),
                    unused: Math.round(window.innerHeight - gr.height),
                    contentH: ov.scrollHeight,
                    visibleH: ov.clientHeight,
                    scrolls: ov.scrollHeight > ov.clientHeight + 1,
                    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
                };
            }, open.toString());
            rows.push(Object.assign({ viewport: vlabel, screen: slabel }, m));
            if (shots) {
                await page.screenshot({
                    path: path.join(__dirname, '..', 'tests', 'screenshots',
                                    'frame-' + vlabel + '-' + slabel + '.png'),
                });
            }
        }
    }

    const pad = (s, n) => String(s).padEnd(n);
    console.log(pad('viewport', 11) + pad('screen', 10) + pad('frame', 12)
        + pad('unused', 8) + pad('content', 9) + pad('visible', 9) + 'scrolls');
    for (const r of rows) {
        console.log(pad(r.viewport, 11) + pad(r.screen, 10)
            + pad(r.frameW + 'x' + r.frameH, 12)
            + pad(r.unused + 'px', 8) + pad(r.contentH, 9) + pad(r.visibleH, 9)
            + (r.scrolls ? 'YES' : '-') + (r.overflowX ? '   +X-OVERFLOW' : ''));
    }
    const worst = rows.reduce((a, b) => (b.unused > a.unused ? b : a));
    console.log('');
    console.log('Most wasted window: ' + worst.unused + 'px on ' + worst.viewport
        + ' (' + worst.screen + '), frame ' + worst.frameH + ' in a '
        + worst.viewportH + ' viewport.');
    console.log('Screens that scroll inside the frame: '
        + rows.filter(r => r.scrolls).map(r => r.screen + '@' + r.viewport).join(', '));
    if (shots) console.log('Screenshots in tests/screenshots/frame-*.png');
    await browser.close();
    process.exit(0);
})();
