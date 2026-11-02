// Does the local pause panel fit the frame it is drawn in?
//
//   node art/pauseheight.js
//
// Finding #43: "The pause panel is 677px tall inside a 650px overlay
// (scrollHeight 757). At 1400x1000 Return to Menu sits at y 795-845 and the
// frame ends at 825: 20px cut, and it needs a scroll. Same at all three sizes."
//
// This is the local build's finding and only the local build's: it lists BOTH
// players' keys in that panel, which is the thing that was tall. The online
// build shows one side and has never overflowed.
//
// TWO EARLIER ATTEMPTS AT #43 WERE REVERTED, which is why this exists as a
// measurement rather than a screenshot:
//
//   * an overlay class, which the markup porter stripped while leaving its CSS
//     rule behind - so the rule was live, matched nothing, and looked fixed.
//   * sticky actions, which measured as a clear win (Return to Menu from y1009
//     to y771) and looked wrong in a screenshot, with the buttons floating over
//     the stat bars.
//
// So the assertion is not "the button is high enough". It is: the panel's own
// height fits inside the overlay, at all three sizes the finding names. A panel
// that fits cannot clip its last button wherever that button happens to sit.
const path = require('path');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

const SIZES = [[1400, 1000], [1280, 800], [1000, 700]];

async function intoAFight(page) {
    await page.evaluate(() => {
        window.ACDebug.setDebugUnlockAll(true);
        const b = document.getElementById('btn-start-local')
            || document.querySelector('#home-screen button');
        if (b) b.click();
    });
    await H.sleep(700);
    await page.evaluate(() => {
        for (const side of ['p1', 'p2']) {
            const c = document.querySelector('#' + side + '-grid .fighter-btn');
            if (c) c.click();
            const ok = document.querySelector('#' + side + '-detail .btn-confirm');
            if (ok) ok.click();
        }
        const s = document.getElementById('btn-start-match');
        if (s) s.click();
        const cards = [...document.querySelectorAll('#mapselect-grid .map-card')];
        if (cards[0]) cards[0].click();
    });
    return H.waitInPage(page, "['INTRO','FIGHT'].includes(window.ACDebug.gameState)", 60000);
}

(async () => {
    const browser = await H.launch();
    const page = await H.newPage(browser);
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
    await H.boot(page, { clearStorage: true, path: '/local/index.html' });

    if (!await intoAFight(page)) {
        console.log('never reached a fight - this says nothing about #43.');
        H.stopServer(); await browser.close(); H.closeAllBrowsers();
        process.exit(1);
    }
    // Two players' key lists is the whole point of the finding, so the names
    // are set: a 14-character name is what made the section headers long.
    await page.evaluate(() => {
        try {
            localStorage.setItem('astralClashNames',
                JSON.stringify({ p1: 'Christophorius', p2: 'Christophorius' }));
        } catch (e) { /* a private window; the default names still measure */ }
    });

    const { makeChecker } = H;
    const { check, finish } = makeChecker();
    for (const [w, h] of SIZES) {
        await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
        await H.sleep(400);
        // Esc through the real dispatcher, not togglePause(), so the panel is
        // built the way a player builds it.
        await page.keyboard.press('Escape');
        await H.sleep(500);
        const m = await page.evaluate(() => {
            const scr = document.getElementById('pause-screen');
            const panel = scr && scr.querySelector('.menu-section');
            const frame = document.getElementById('game-container');
            const quit = document.getElementById('btn-quit-to-menu');
            if (!panel || !frame) return null;
            const p = panel.getBoundingClientRect();
            const f = frame.getBoundingClientRect();
            const q = quit ? quit.getBoundingClientRect() : null;
            const cols = scr.querySelector('.ctl-cols');
            return {
                state: window.ACDebug.gameState,
                panelH: Math.round(p.height * 10) / 10,
                panelScrollH: panel.scrollHeight,
                frameH: Math.round(f.height),
                frameBottom: Math.round(f.bottom),
                quitBottom: q ? Math.round(q.bottom) : null,
                columns: cols ? cols.children.length : 0,
                colDir: cols ? getComputedStyle(cols).flexDirection : '-',
            };
        });
        if (!m) { check(w + 'x' + h + ': panel found', false, 'no pause panel'); continue; }
        console.log('  ' + w + 'x' + h + '  ' + JSON.stringify(m));
        check(w + 'x' + h + ': the panel fits the frame',
            m.panelH <= m.frameH, m.panelH + ' in ' + m.frameH);
        check(w + 'x' + h + ': Return to Menu is inside the frame',
            m.quitBottom != null && m.quitBottom <= m.frameBottom,
            m.quitBottom + ' against a frame ending at ' + m.frameBottom);
        check(w + 'x' + h + ": both players' keys are side by side",
            m.columns === 2 && m.colDir === 'row',
            m.columns + ' column(s), ' + m.colDir);
        await page.keyboard.press('Escape');
        await H.sleep(400);
    }
    await finish(browser, page);
})().catch(e => {
    console.error(e);
    H.stopServer(); H.closeAllBrowsers();
    process.exit(1);
});
