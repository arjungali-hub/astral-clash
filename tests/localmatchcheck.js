// A match played to its end, and then played again.
//
// WHY THIS EXISTS. Two lines have sat unchecked on the original brief since
// Batch 0, both marked "requires an actual browser session":
//
//     [ ] No console errors across a full match, including death sequence and
//         a rematch
//     [ ] Correct winner declared, including when the winner is hit during the
//         death sequence
//
// Neither needs a human. The death sequence and the rematch are the two moments
// a match tears down and rebuilds its state, which is exactly where a
// half-ported definition or a stale reference surfaces - and the local build is
// where that kept happening. Everything else drives menus or a live fight and
// stops before either.
//
// The winner-hit-during-death case is the interesting half: the loser's death
// plays out over frames, and a hit landing on the WINNER during those frames
// used to be able to change who the game thought had won.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);

    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('framenavigated', async () => {
        try {
            await page.evaluate(() => {
                if (window.__acRej) return;
                window.__acRej = [];
                window.addEventListener('unhandledrejection', ev => {
                    const r = ev && ev.reason;
                    window.__acRej.push(String((r && r.message) || r));
                });
            });
        } catch (e) { /* navigating away mid-install is not a failure */ }
    });

    await H.boot(page, { clearStorage: true, path: '/local/index.html' });
    await page.evaluate(() => window.ACDebug.setDebugUnlockAll(true));

    const start = async () => {
        await page.evaluate(() => {
            const pick = (grid, detail) => {
                document.querySelectorAll(grid + ' .fighter-btn')[0].click();
                const c = document.querySelector(detail + ' .btn-confirm');
                if (c) c.click();
            };
            pick('#p1-grid', '#p1-detail');
            pick('#p2-grid', '#p2-detail');
            const s = document.getElementById('btn-start-match');
            if (s) s.click();
            const card = document.querySelectorAll('#mapselect-grid .map-card')[0];
            if (card) card.click();
        });
        return H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    };

    section('A match plays to a finish:');
    check('the first match starts', await start(), 'never reached FIGHT');

    // Kill player 2 through the real damage path, then keep hitting player ONE
    // while the death plays out. That is the case the brief singles out: a hit
    // on the winner during the loser's death sequence must not change the result.
    // Driven from Node in short steps rather than one long in-page evaluate.
    // A single evaluate that sat in the page for ten seconds tripped puppeteer's
    // protocol timeout on a loaded machine, and the failure looked like the game
    // hanging rather than the checker over-reaching.
    // CLASSIC VERSUS IS BEST OF THREE. One KO ends a ROUND, not the match, so
    // waiting for GAMEOVER after a single kill waited through the round break
    // and into the next round - and then read state FIGHT with no winner, which
    // reported as three separate failures rather than as "this test does not
    // know the match format".
    //
    // So: keep winning rounds until the match itself ends.
    await page.evaluate(() => { window.__hp0 = window.ACDebug.player1.hp; });
    for (let round = 0; round < 4; round++) {
        const inFight = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 60000);
        if (!inFight) break;
        await page.evaluate(() => {
            const D = window.ACDebug;
            D.player2.takeDamage(D.player2.hp + 50, D.player1);
        });
        // Hit the WINNER while the loser's death plays out - the case the brief
        // singles out.
        for (let i = 0; i < 8; i++) {
            await page.evaluate(() => {
                const D = window.ACDebug;
                if (D.player1 && D.gameState !== 'GAMEOVER') D.player1.takeDamage(2, D.player2);
            });
            await H.sleep(60);
        }
        const over = await H.waitInPage(page, "window.ACDebug.gameState === 'GAMEOVER'", 12000);
        if (over) break;
    }

    const ended = await page.evaluate(() => {
        // PRIMITIVES ONLY. `winner` is a Fighter, which holds THREE objects and
        // therefore cycles; returning it made puppeteer serialise the whole
        // result as undefined, and the failure read as "the match never ended"
        // rather than "this value cannot cross the boundary".
        const D = window.ACDebug, p1 = D.player1, who = D.winner;
        return {
            state: D.gameState,
            winner: who ? (who.name || String(who)) : null,
            winnerIsP1: !!who && who === p1,
            isDraw: !!D.isDraw,
            p1Alive: !!p1 && p1.hp > 0,
            p1Took: p1 ? window.__hp0 - p1.hp : 0,
        };
    });
    check('the match reaches GAMEOVER', ended.state === 'GAMEOVER', JSON.stringify(ended));
    check('the winner survived being hit during the death sequence',
        ended.p1Alive && ended.p1Took > 0, JSON.stringify(ended));
    check('and player 1 is declared the winner, not a draw',
        ended.isDraw === false && ended.winnerIsP1 === true, JSON.stringify(ended));

    section('And then again, from the gameover screen:');
    const again = await page.evaluate(() => {
        const b = document.getElementById('btn-rematch');
        if (!b) return false;
        b.click();
        return true;
    });
    check('the gameover screen offers a rematch', again, 'no #btn-rematch');
    const back = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    check('the rematch reaches a live fight', back, 'never returned to FIGHT');

    const rej = await page.evaluate(() => window.__acRej || []);
    check('no page errors across the whole match, death and rematch',
        errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
    check('and no unhandled rejections',
        rej.length === 0, rej.slice(0, 3).join(' | ') || 'none');

    await page.evaluate(() => localStorage.clear());
    await finish(browser, page);
})();
