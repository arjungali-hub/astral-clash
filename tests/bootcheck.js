// Do both builds LOAD, and does a FRAME of a real fight run clean?
//
//     node tests/bootcheck.js
//
// WHY THIS EXISTS SEPARATELY FROM smoke.js. smoke boots the online build and
// then plays it, which takes 100-200 seconds; localcombatcheck fires every
// character's attack in the local build and takes 200-500. Both would catch
// what this catches - eventually, and only if you were already planning to run
// them. This is the check you can afford after every edit, and it answers the
// questions that make every other checker meaningless if the answer is no.
//
// IT ASKS TWO, because they fail differently.
//
// DOES IT LOAD. Moving playerName() into shared/common.js left one reference
// behind, in the ACDebug export list: a bare `playerName,` in an object
// literal's shorthand. It is a READ, so the sync's dangling-reference guard
// should have caught it - except that guard is bounded by the ONLINE build's
// vocabulary, and playerName was a local-only name, so it was never a
// candidate. The local build died at load and the sync reported success.
//
// DOES A FRAME RUN. Merging drawHUDInner removed a `const twoHumans` that a
// line ninety further down still read. The build loaded perfectly - the throw
// needs a HUD drawn in FIGHT state - and the first version of this file passed
// it. A function-local const is invisible to a column-0 definition scanner, so
// no static guard here can see that class of bug; running a frame can.
//
// A load check has no vocabulary problem, because it runs the file. A frame
// check has no scope problem, because it runs the frame.
const H = require('./harness');

const BUILDS = [
    ['online', '/index.html'],
    ['local', '/local/index.html'],
];

// Pick two fighters and get into the arena. Deliberately the shortest path that
// reaches gameState FIGHT - this is not a gameplay test, it is "does the frame
// throw", and the fastest way to draw one real frame is the point.
async function enterAFight(page) {
    await page.evaluate(() => window.ACDebug.setDebugUnlockAll(true));
    for (const side of ['p1', 'p2']) {
        const picked = await page.evaluate((s) => {
            const b = document.querySelector('#' + s + '-grid .fighter-btn');
            if (!b) return false;
            b.click();
            const c = document.querySelector('#' + s + '-detail .btn-confirm');
            if (c) c.click();
            return true;
        }, side);
        if (!picked) return 'no fighter card on ' + side;
    }
    // One build starts from a Start Match button, the other may already be in
    // the arena picker; clicking both in order works either way.
    await page.evaluate(() => {
        const s = document.getElementById('btn-start-match');
        if (s) s.click();
    });
    await page.evaluate(() => {
        const c = document.querySelectorAll('#mapselect-grid .map-card')[0];
        if (c) c.click();
    });
    const live = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 60000);
    return live ? null : 'never reached FIGHT';
}

(async () => {
    const browser = await H.launch();
    await H.startServer();
    let failed = 0;
    for (const [name, path] of BUILDS) {
        const page = await H.newPage(browser);
        const errs = [];
        page.on('pageerror', e => errs.push(String(e.stack || e.message || e)));
        page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

        await page.goto(H.GAME_URL.replace('/index.html', path), { waitUntil: 'load' });
        // ACDebug is published at the END of bootGame(), so its presence means
        // the whole closure ran rather than throwing somewhere in the middle.
        await H.sleep(2500);
        const booted = await page.evaluate(() => !!window.ACDebug).catch(() => false);

        let why = booted ? null : 'ACDebug never appeared';
        if (booted) {
            errs.length = 0;          // load is clean; judge the fight on its own
            why = await enterAFight(page).catch(e => 'threw: ' + e.message);
            // Long enough for the intro cinematic to hand over and the combat
            // HUD to draw, which is where the last regression lived.
            if (!why) await H.sleep(4000);
        }

        if (!why && !errs.length) {
            console.log('  ' + name + ' build: loads clean, a fight runs clean');
        } else {
            failed++;
            console.log('  ' + name + ' build: FAILED' + (why ? ' (' + why + ')' : ''));
            for (const e of errs.slice(0, 3)) console.log('      ' + e.split('\n')[0]);
        }
        await page.close();
    }
    await H.closeAllBrowsers();
    // The exact wording tests/run.js grades on.
    console.log(failed ? '\nFAILED (' + failed + ' build(s) did not load)'
                       : '\nALL CHECKS PASSED');
    process.exit(failed ? 1 : 0);
})();
