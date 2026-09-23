// The game must behave the same at 30fps as at 60.
//
// Unchecked since the original brief, for a reason that was true at the time:
// there was no way to drive the game at a chosen frame rate, and computeDt -
// which normalises everything by real elapsed time - is the thing under test, so
// it cannot be asked to verify itself.
//
// shared/animation.js now installs a debug frame cap under `?fps=N`, wrapping
// requestAnimationFrame rather than touching either game loop (gameLoop is on
// INTERFACE and differs between the builds, so editing it would have been a
// change in two places forever - and a loop that does not know it is throttled
// cannot accidentally compensate).
//
// WHAT IS ACTUALLY COMPARED. Not positions after N frames - that would pass
// trivially for a frame-counting game and prove nothing. The question is whether
// a fixed amount of WALL-CLOCK time produces the same amount of game: give a
// fighter a known velocity, let the same number of milliseconds pass at two
// different frame rates, and compare how far it travelled.
//
// A tolerance is unavoidable: the cap lands on rAF boundaries, so neither arm
// gets exactly the requested duration. 12% is loose enough to absorb that and
// far tighter than the failure it is looking for - frame-rate-dependent motion
// would show as roughly a 2x difference between these two arms.
const H = require('./harness');

const TRAVEL_MS = 2000;
const TOLERANCE = 0.12;

async function travelAt(browser, fps) {
    const page = await H.newPage(browser);
    await H.startServer();
    // Direct goto: the harness's URL builder appends ?debug=1 and cannot carry a
    // second parameter, and ACDebug only exists with debug=1.
    const url = H.GAME_URL.replace('/index.html?debug=1',
        '/local/index.html?debug=1&fps=' + fps);
    await page.goto(url, { waitUntil: 'load' });
    await H.sleep(900);
    await page.evaluate(() => { const c = document.querySelector('#btn-tutorial-close'); if (c) c.click(); });
    await page.evaluate(() => window.ACDebug.setDebugUnlockAll(true));
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
    const live = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    if (!live) { await page.close(); return { fps, failed: 'never reached FIGHT' }; }

    // Count frames as well as distance, so the arms can be shown to have
    // actually run at different rates - otherwise a cap that silently did
    // nothing would produce a perfect, meaningless pass.
    const out = await page.evaluate(async (ms) => {
        const D = window.ACDebug;
        const f = D.player1;
        let frames = 0;
        const tick = () => { frames++; requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        f.z = 0; f.vz = 0;
        const x0 = f.x, y0 = f.y;
        const t0 = performance.now();
        // A constant push, reasserted every frame so friction cannot end it
        // early in one arm and not the other.
        const hold = setInterval(() => { f.vx = 3; f.vy = 0; }, 8);
        await new Promise(r => setTimeout(r, ms));
        clearInterval(hold);
        const elapsed = performance.now() - t0;
        return { dist: Math.hypot(f.x - x0, f.y - y0), elapsed, frames };
    }, TRAVEL_MS);
    await page.close();
    return Object.assign({ fps }, out);
}

(async () => {
    const browser = await H.launch();
    const { check, section, finish } = H.makeChecker();

    section('The same wall-clock time produces the same amount of game:');
    const slow = await travelAt(browser, 20);
    const fast = await travelAt(browser, 60);
    console.log('    ' + JSON.stringify(slow));
    console.log('    ' + JSON.stringify(fast));

    check('both arms reached a fight', !slow.failed && !fast.failed,
        JSON.stringify({ slow: slow.failed, fast: fast.failed }));
    check('the cap actually changed the frame rate',
        fast.frames > slow.frames * 1.5, JSON.stringify({ slow: slow.frames, fast: fast.frames }));

    const rel = Math.abs(slow.dist - fast.dist) / Math.max(slow.dist, fast.dist, 1e-6);
    check(`distance travelled matches within ${TOLERANCE * 100}% (${slow.dist.toFixed(1)} vs ${fast.dist.toFixed(1)})`,
        rel <= TOLERANCE, 'relative difference ' + (rel * 100).toFixed(1) + '%');
    check('and something actually moved', Math.min(slow.dist, fast.dist) > 20,
        JSON.stringify({ slow: slow.dist, fast: fast.dist }));

    await finish(browser, null);
})();
