// Every control must DO something.
//
// WHY THIS EXISTS. Two of the five faults reported from actually playing were
// controls that were simply inert, and neither was covered by anything here:
//
//   #btn-back-to-online   in the markup with no listener at all. Clicking it
//                         did nothing, and a sync step had been renaming its
//                         destination for weeks, reporting "ok" every run.
//   #btn-bloom            wired to a real function, in a build whose bloom
//                         renderer is `renderer.render(scn, cam)`. The flag
//                         flipped, the arena reloaded, nothing changed.
//
// Every other checker here drives the controls it already knows about, so a
// control nobody wrote a test for is invisible to all of them. This one goes
// the other way round: it enumerates what is on screen and presses it.
//
// WHAT COUNTS AS "SOMETHING HAPPENED". Deliberately broad, because a dead
// control changes NOTHING and almost any real one changes at least one of:
//
//   * gameState or currentScreen
//   * which modals are visible
//   * localStorage (a setting that persists)
//   * the button's own label or class (a toggle reporting its new state)
//   * how many controls are on screen (a panel opened or closed)
//
// A control that moves none of those either does nothing, or does something so
// invisible that a player cannot tell it worked - which is the same complaint.
//
// EXEMPTIONS carry a reason each. A control that legitimately does nothing in
// the state we can test it from is not a bug; a control exempted because it
// kept failing would be.
const H = require('./harness');

// Reason required. "It kept failing" is not one.
const EXEMPT = {
    'btn-start-match': 'starts a match and leaves the menu; localuxcheck and localmatchcheck drive it',
    'btn-rematch': 'only live on the gameover screen; localmatchcheck drives it',
    'btn-quit-to-menu': 'only live in a match',
    'btn-resume': 'only live while paused',
    'btn-play-again': 'only live on the gameover screen',
    'btn-reset-progress': 'ARMS on the first click and wipes progression on the second; deliberately not pressed twice here',
    'btn-map-random': 'starts a match from the arena picker',
    'btn-reroll-map': 'only live in a match',
};

// The panels to walk, and how to open each. Opened fresh for every button,
// because a click can close the panel it was in.
// name, how to open it, and WHICH ELEMENT IT IS. The third matters: enumerating
// every visible button reported the button that OPENED the panel as inert
// (pressing it again while its modal is up does nothing, correctly), and the
// select screen's own controls as inert while a modal covered them. Both are
// right answers to the wrong question. Only controls inside the panel under
// test are that panel's controls.
const PANELS = [
    ['the select screen', null, '#select-screen'],
    ['Settings', "document.getElementById('btn-open-settings').click()", '#settings-screen'],
    ['How to Play', "document.getElementById('btn-open-tutorial').click()", '#tutorial-screen'],
    ['Rebind Keys', "document.getElementById('btn-open-settings').click(); document.getElementById('btn-open-rebind').click()", '#rebind-screen'],
    ['Audio', "document.getElementById('btn-open-settings').click(); document.getElementById('btn-open-audio').click()", '#audio-screen'],
    ['the arena picker', "window.ACDebug.setDebugUnlockAll(true); (function(){const p=(g,d)=>{document.querySelectorAll(g+' .fighter-btn')[0].click();const c=document.querySelector(d+' .btn-confirm');if(c)c.click();};p('#p1-grid','#p1-detail');p('#p2-grid','#p2-detail');})(); document.getElementById('btn-start-match').click()", '#mapselect-screen'],
];

const SNAPSHOT = `(() => {
    const vis = el => el.getClientRects().length > 0;
    const modals = [...document.querySelectorAll('[id$="-screen"]')]
        .filter(vis).map(e => e.id).sort().join(',');
    let store = '';
    try { store = JSON.stringify(Object.entries(localStorage).sort()); } catch (e) { store = 'blocked'; }
    const D = window.ACDebug || {};
    return {
        state: D.gameState || '',
        screen: D.currentScreen || '',
        modals,
        store,
        controls: [...document.querySelectorAll('button')].filter(vis).length,
    };
})()`;

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);

    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));

    const build = process.argv[2] === 'online' ? null : '/local/index.html';
    await H.boot(page, { clearStorage: true, path: build });

    for (const [label, open, within] of PANELS) {
        section(`Controls in ${label}:`);
        // Which buttons are here? Enumerated fresh, so a panel that gains a
        // control gets tested without anyone remembering to add it.
        const ids = await page.evaluate(async (openJs, sel) => {
            const wait = ms => new Promise(r => setTimeout(r, ms));
            if (openJs) { eval(openJs); await wait(400); }
            const vis = el => el.getClientRects().length > 0;
            const root = document.querySelector(sel);
            if (!root) return [];
            return [...root.querySelectorAll('button')]
                .filter(b => vis(b) && b.id && !b.disabled)
                .map(b => b.id);
        }, open, within);

        if (!ids.length) { check(`${label}: has controls to test`, false, 'none visible'); continue; }

        const dead = [];
        const threw = [];
        for (const id of ids) {
            if (EXEMPT[id]) continue;
            errors.length = 0;
            // A control that NAVIGATES destroys the execution context, which
            // puppeteer reports as an error. That is the loudest possible
            // "something happened" - #btn-back-to-online leaves for the online
            // build - so it is caught and counted as alive, not as a crash.
            const urlBefore = page.url();
            let moved;
            try {
                moved = await page.evaluate(async (bid, openJs, snapJs) => {
                    const wait = ms => new Promise(r => setTimeout(r, ms));
                // Re-open from a clean boot state each time: the previous click
                // may have closed this panel or opened another.
                if (openJs) { eval(openJs); await wait(300); }
                const el = document.getElementById(bid);
                if (!el || el.getClientRects().length === 0) return { skipped: 'not visible' };
                const before = eval(snapJs);
                const html = el.outerHTML;
                el.click();
                await wait(350);
                const after = eval(snapJs);
                const el2 = document.getElementById(bid);
                return {
                    changed: JSON.stringify(before) !== JSON.stringify(after)
                        || (el2 && el2.outerHTML !== html),
                };
                }, id, open, SNAPSHOT);
            } catch (e) {
                const navigated = /context was destroyed|Target closed|detached/i.test(String(e.message));
                if (!navigated) throw e;
                moved = { changed: true, navigated: true };
            }
            if (page.url() !== urlBefore) moved = { changed: true, navigated: true };

            if (errors.length) threw.push(id + ': ' + errors[0].slice(0, 70));
            else if (moved && moved.changed === false) dead.push(id);

            // Back to a known state before the next one.
            await H.boot(page, { path: build });
        }

        check(`${label}: nothing throws when pressed`, threw.length === 0, threw.join(' | ') || 'none');
        check(`${label}: every control does something`, dead.length === 0,
            dead.length ? 'inert: ' + dead.join(', ') : 'all ' + (ids.length - Object.keys(EXEMPT).filter(k => ids.includes(k)).length) + ' respond');
    }

    await page.evaluate(() => localStorage.clear());
    await finish(browser, page);
})();
