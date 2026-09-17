// "Thorne's attack freezes the screen and then you can't continue" - and then
// Gorgonok's, and then Kaelen's. Three different weapons and three different
// viewmodel animations, so it is not a character: it is something every melee
// attack does.
//
// This renders REAL frames (the deterministic stepper missed it, because the
// stepper never calls syncViewmodels or the renderer) and reports per-frame
// time plus the shader-program count, which is this project's known stall:
// changing the number of programs makes three.js recompile, and a
// multi-hundred-millisecond hitch is exactly what "freezes" looks like.
const H = require('./harness');
const WHO = (process.env.WHO || 'Kaelen,Gorgonok,Thorne,Lyra').split(',');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    const errs = [];
    page.on('pageerror', e => errs.push(String(e).split('\n')[0]));
    await H.boot(page, { clearStorage: true });
    await page.setViewport({ width: 1266, height: 522 });

    for (const who of WHO) {
        await H.boot(page);
        await page.evaluate((name) => {
            const D = window.ACDebug;
            D.setDebugUnlockAll(true);
            D.setMatchMode('classic');
            const pick = (grid, detail, n) => {
                const cards = Array.from(document.querySelectorAll(grid + ' .fighter-btn'));
                (cards.find(c => c.textContent.includes(n)) || cards[0]).click();
                document.querySelector(detail + ' .btn-confirm').click();
            };
            pick('#p1-grid', '#p1-detail', name);
            pick('#p2-grid', '#p2-detail', name === 'Kaelen' ? 'Lyra' : 'Kaelen');
        }, who);
        await H.sleep(450);
        await page.evaluate(() => document.querySelectorAll('#mapselect-grid .map-card')[0].click());
        const live = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 70000);
        await H.sleep(900);

        const r = await page.evaluate(async () => {
            const D = window.ACDebug;
            const frame = () => new Promise(res => requestAnimationFrame(() => res()));
            const info = () => D.rendererInfo();
            const before = info();
            window.__progsBefore = (D.renderer.info.programs || []).map(pr => pr.cacheKey || '?');
            // Real frames, before the attack, as a baseline.
            const idle = [];
            for (let i = 0; i < 6; i++) { const t = performance.now(); await frame(); idle.push(performance.now() - t); }
            const mid = info();
            // ...then a real attack, driven through the real pipeline.
            const f = D.player1;
            f.fx = 1; f.fy = 0;
            f.tryStartAction('basic', D.player2);
            const swing = [];
            for (let i = 0; i < 30; i++) { const t = performance.now(); await frame(); swing.push(performance.now() - t); }
            const after = info();
            // WHAT compiled, not just how many. A program's cacheKey says which
            // material and which scene state produced it.
            const keys = (window.__progsBefore || []).slice();
            const now = (D.renderer.info.programs || []).map(pr => pr.cacheKey || '?');
            const added = now.filter(k => {
                const i = keys.indexOf(k);
                if (i < 0) return true;
                keys.splice(i, 1);
                return false;
            });
            const worst = a => Math.round(Math.max.apply(null, a));
            const med = a => Math.round(a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]);
            return {
                vm: !!D.vmP1,
                vmKids: D.vmP1 ? D.vmP1.children.length : 0,
                idle: { median: med(idle), worst: worst(idle) },
                swing: { median: med(swing), worst: worst(swing) },
                programs: [before.programs, mid.programs, after.programs],
                atk: f.atkState,
                added: added.map(k => String(k).slice(0, 110)),
            };
        });
        console.log(who.padEnd(9), 'live=' + live, JSON.stringify(r));
    }
    console.log('errors:', JSON.stringify(errs.slice(0, 4)));
    await browser.close();
    process.exit(0);
})();
