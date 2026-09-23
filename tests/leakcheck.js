// Repeated matches must not accumulate GPU resources.
//
// The brief asked for "ten consecutive rematches, no GPU memory growth", and it
// sat unchecked for being un-automatable: headless runs on swiftshader, where
// "GPU memory" is not a number anybody can read.
//
// But GPU memory was never the thing to measure - it is the SYMPTOM. What leaks
// is three.js resources that a teardown forgot to dispose: a geometry, a
// material's texture, a compiled program. renderer.info counts all three
// exactly, and ACDebug.rendererInfo() already exposes them. Counting the things
// that leak is strictly better than watching a number that goes up when they do,
// and it works without a GPU.
//
// The shape to look for is GROWTH PER REMATCH, not an absolute number. An arena
// legitimately holds hundreds of geometries; what must not happen is holding the
// previous arena's as well. So: a baseline after the first match has settled,
// then several rematches, then the same count.
const H = require('./harness');

const REMATCHES = 6;
// One arena's worth of churn is fine; a leak shows as a per-rematch increment
// that never comes back down. Allowing a little slack keeps a lazily-created
// texture (a damage number atlas, say) from reading as a leak.
const SLACK = 12;

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);
    await H.boot(page, { clearStorage: true, path: '/local/index.html' });
    await page.evaluate(() => window.ACDebug.setDebugUnlockAll(true));

    const startMatch = async () => {
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

    // End a match by winning rounds until it is actually over - classic versus
    // is best of three, so one knockout is a round, not the match.
    const endMatch = async () => {
        for (let round = 0; round < 4; round++) {
            const inFight = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 60000);
            if (!inFight) break;
            await page.evaluate(() => {
                const D = window.ACDebug;
                D.player2.takeDamage(D.player2.hp + 50, D.player1);
            });
            if (await H.waitInPage(page, "window.ACDebug.gameState === 'GAMEOVER'", 12000)) return true;
        }
        return false;
    };

    section('GPU resources do not accumulate across rematches:');
    check('the first match starts', await startMatch(), 'never reached FIGHT');
    check('and it can be finished', await endMatch(), 'never reached GAMEOVER');

    const sample = () => page.evaluate(() => {
        const r = window.ACDebug.rendererInfo();
        const m = performance.memory;
        return { geometries: r.geometries, textures: r.textures, programs: r.programs,
                 heapMB: m ? Math.round(m.usedJSHeapSize / 1048576) : null };
    });

    const baseline = await sample();
    const series = [baseline];
    for (let i = 0; i < REMATCHES; i++) {
        const again = await page.evaluate(() => {
            const b = document.getElementById('btn-rematch');
            if (!b) return false;
            b.click();
            return true;
        });
        if (!again) { check('a rematch is offered every time', false, 'no #btn-rematch on pass ' + i); break; }
        if (!await endMatch()) { check('every rematch can be finished', false, 'pass ' + i); break; }
        series.push(await sample());
    }

    const last = series[series.length - 1];
    const grew = k => last[k] - baseline[k];
    for (const k of ['geometries', 'textures', 'programs']) {
        check(`${k}: no growth across ${series.length - 1} rematches (${baseline[k]} -> ${last[k]})`,
            grew(k) <= SLACK, JSON.stringify(series.map(s => s[k])));
    }
    check('enough rematches actually ran to mean anything',
        series.length >= 4, series.length - 1 + ' rematches');
    console.log('    series: ' + JSON.stringify(series));

    await page.evaluate(() => localStorage.clear());
    await finish(browser, page);
})();
