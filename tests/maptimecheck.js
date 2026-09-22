// How long each arena actually takes to reach a live fight.
//
// WHY THIS EXISTS. mapscheck waits 30s for gameState === 'FIGHT' and reports a
// boolean, so "the arena is stuck" and "the arena took 31 seconds" are the same
// failure to it. Those need completely different fixes, and the failure moved
// with machine load - three arenas failed while another test run was competing
// for the CPU, two on a quiet machine - which is the signature of a timeout
// rather than a hang.
//
// It also matters on its own terms. startMatch now waits for the models, the
// theme textures AND one rendered frame before it hands over, precisely so that
// nothing pops in afterwards; the cost of that promise is that a slow arena
// spends the whole wait on the loading screen. This prints that cost per arena
// so it can be looked at rather than guessed at.
//
// Times here are from headless software rendering (swiftshader) and are several
// times slower than a real GPU. Read them against each other, not as seconds a
// player would see.
const H = require('./harness');

const MAPS = ['Sundered Stair', 'Skyreach Spire', 'Overgrown Sanctuary', 'Skyward Temple'];
const LIMIT_MS = 90000;

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);

    section('Time from map click to a live fight:');
    const times = [];
    for (const name of MAPS) {
        await H.boot(page, { clearStorage: true });
        const idx = await page.evaluate(n => {
            const D = window.ACDebug;
            document.querySelectorAll('#p1-grid .fighter-btn')[0].click();
            document.querySelector('#p1-detail .btn-confirm').click();
            document.querySelectorAll('#p2-grid .fighter-btn')[1].click();
            document.querySelector('#p2-detail .btn-confirm').click();
            return D.MAPS.findIndex(m => m.name === n);
        }, name);
        await H.sleep(350);
        const t0 = Date.now();
        await page.evaluate(i => {
            const cards = document.querySelectorAll('#mapselect-grid .map-card');
            (cards[i] || cards[0]).click();
        }, idx);
        const ok = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", LIMIT_MS);
        const ms = Date.now() - t0;
        times.push({ name, ok, ms });
        // padEnd, not a %-22s width: Node's console.log formats with
        // util.format, which knows %s and %d but leaves a width specifier in
        // the output verbatim.
        console.log('    ' + (ok ? ' ' : '!') + ' ' + name.padEnd(22)
            + String(ms).padStart(7) + ' ms');
    }

    for (const t of times) {
        check(`${t.name} reaches a fight within ${LIMIT_MS / 1000}s`, t.ok, `${t.ms} ms`);
    }

    // The question mapscheck could not answer: stuck, or merely slow? If every
    // arena arrives when given room, the 30s limit was the problem.
    const slowest = times.reduce((a, b) => (a.ms > b.ms ? a : b));
    check('no arena is stuck — all four arrive',
        times.every(t => t.ok),
        times.filter(t => !t.ok).map(t => t.name).join(', ') || 'all arrived');
    console.log('\n    slowest: ' + slowest.name + ' at ' + slowest.ms + ' ms');

    await page.evaluate(() => localStorage.clear());
    await finish(browser, page);
})();
