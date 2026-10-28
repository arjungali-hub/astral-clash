// Does "Start Match" on the local select screen do anything?
//
//   node art/startmatchprobe.js
//
// Reported from a collision sweep: "With both players locked in, clicking it
// (real click and .click()) leaves the game in MENU with no console error. The
// match only starts by clicking an arena card in Choose Your Arena below."
//
// The handler is not empty - it calls beginMatch(), which offline falls through
// to openMapSelect() -> openModal('mapselect'). So the question is not whether
// anything happens but WHERE it happens: #ui-overlay is a fixed-height frame
// that scrolls its contents (UI review finding #1), and a modal opened below
// the fold is indistinguishable from a dead button. This measures that
// directly - is the panel displayed, and is it inside the frame the player can
// see - rather than asking whether the click "worked".
const path = require('path');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    // The viewport the sweep used, so a "below the fold" verdict means the
    // same thing here as it did there.
    await page.setViewport({ width: 1280, height: 529 });
    await H.boot(page, { clearStorage: true, path: '/local/index.html' });

    const out = await page.evaluate(() => {
        const D = window.ACDebug;
        D.setDebugUnlockAll(true);
        for (const side of ['p1', 'p2']) {
            const b = document.querySelector('#' + side + '-grid .fighter-btn');
            if (b) b.click();
            const c = document.querySelector('#' + side + '-detail .btn-confirm');
            if (c) c.click();
        }
        const btn = document.getElementById('btn-start-match');
        const before = {
            state: D.gameState,
            btnShown: btn ? getComputedStyle(btn).display !== 'none' : null,
            mapOpen: getComputedStyle(document.getElementById('mapselect-screen')).display,
        };

        if (btn) btn.click();

        const ov = document.getElementById('ui-overlay');
        const panel = document.querySelector('#mapselect-screen .mapselect-panel')
                   || document.getElementById('mapselect-screen');
        const pr = panel.getBoundingClientRect();
        const or_ = ov.getBoundingClientRect();
        return {
            before,
            after: {
                state: D.gameState,
                mapOpen: getComputedStyle(document.getElementById('mapselect-screen')).display,
                cards: document.querySelectorAll('#mapselect-grid .map-card').length,
            },
            // Is what it opened actually where the player is looking?
            geometry: {
                overlay: { top: Math.round(or_.top), bottom: Math.round(or_.bottom) },
                panel: { top: Math.round(pr.top), bottom: Math.round(pr.bottom),
                         height: Math.round(pr.height) },
                overlayScrollTop: ov.scrollTop,
                overlayScrollHeight: ov.scrollHeight,
                overlayClientHeight: ov.clientHeight,
                panelStartsBelowFold: pr.top > or_.bottom,
                panelRunsPastFold: pr.bottom > or_.bottom,
            },
        };
    });

    console.log(JSON.stringify(out, null, 2));

    const g = out.geometry;
    console.log('');
    if (out.before.btnShown === false) {
        console.log('INCONCLUSIVE: Start Match was hidden, so both sides were not locked in.');
    } else if (out.after.mapOpen === 'none') {
        console.log('CONFIRMED DEAD: the click left the arena picker closed.');
    } else if (g.panelStartsBelowFold) {
        console.log('EXPLAINED: the arena picker opened ENTIRELY below the visible frame '
            + '(panel top ' + g.panel.top + ' vs frame bottom ' + g.overlay.bottom + '). '
            + 'The button works; UI finding #1 hides its effect.');
    } else if (g.panelRunsPastFold) {
        console.log('PARTLY EXPLAINED: the picker opened and is visible, but runs '
            + (g.panel.bottom - g.overlay.bottom) + 'px past the frame.');
    } else {
        console.log('WORKS AND IS VISIBLE: the arena picker opened inside the frame with '
            + out.after.cards + ' cards. The report’s "does nothing" is not reproducing here.');
    }
    await browser.close();
    process.exit(0);
})();
