// The same measurement that found the online freeze, run against the LOCAL
// build - which is where all the testing actually happens.
//
// Reports, per frame of a real attack: frame time, the scene's live light count
// (lights whose whole ancestor chain is visible - which is what three.js
// counts) and the shader-program count. A program count that moves is a
// recompile; a light count that moves is why.
const H = require('./harness');
const LOCAL = '/legacy/local-splitscreen.html';
const WHO = (process.env.WHO || 'Thorne,Gorgonok,Kaelen,Lyra').split(',');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    const errs = [];
    page.on('pageerror', e => errs.push(String(e).split('\n')[0]));
    await page.setViewport({ width: 1266, height: 522 });

    for (const who of WHO) {
        await H.boot(page, { clearStorage: true, path: LOCAL });
        await page.evaluate(() => window.ACDebug.setDebugUnlockAll(true));
        // One human so the view is a single first-person camera, as the
        // reporter plays it.
        await page.evaluate(() => {
            const b = document.getElementById('btn-toggle-bot');
            if (b) b.click();
        });
        for (const [grid, detail, name] of [['#p1-grid', '#p1-detail', who], ['#p2-grid', '#p2-detail', 'Lyra']]) {
            await page.evaluate((a) => {
                const cards = Array.from(document.querySelectorAll(a[0] + ' .fighter-btn'));
                (cards.find(c => c.textContent.includes(a[2])) || cards[0]).click();
            }, [grid, detail, name]);
            await H.sleep(220);
            await page.evaluate((d) => { const b = document.querySelector(d + ' .btn-confirm'); if (b) b.click(); }, detail);
            await H.sleep(220);
        }
        await page.evaluate(() => { const b = document.getElementById('btn-start-match'); if (b) b.click(); });
        await H.sleep(250);
        await page.evaluate(() => {
            const c = document.querySelectorAll('#mapselect-grid .map-card')[0];
            if (c) c.click();
        });
        const live = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 70000);
        await H.sleep(900);

        const r = await page.evaluate(async () => {
            const D = window.ACDebug;
            const frame = () => new Promise(res => requestAnimationFrame(() => res()));
            // Lights three.js will actually count: visible, with every ancestor
            // visible too.
            const liveLights = () => {
                let n = 0;
                D.scene.traverse(o => {
                    if (!o.isLight) return;
                    for (let p = o; p; p = p.parent) if (!p.visible) return;
                    n++;
                });
                return n;
            };
            const progs = () => (D.renderer.info.programs || []).length;
            const series = [];
            const sample = (tag, ms) => series.push({ tag, ms: Math.round(ms), L: liveLights(), P: progs() });
            for (let i = 0; i < 4; i++) { const t = performance.now(); await frame(); sample('idle', performance.now() - t); }
            const f = D.player1;
            f.fx = 1; f.fy = 0;
            f.tryStartAction('basic', D.player2);
            for (let i = 0; i < 24; i++) { const t = performance.now(); await frame(); sample('atk' + i, performance.now() - t); }
            f.specialMeter = 100;
            f.tryStartAction('special', D.player2);
            for (let i = 0; i < 24; i++) { const t = performance.now(); await frame(); sample('sp' + i, performance.now() - t); }
            const worst = series.reduce((a, b) => (b.ms > a.ms ? b : a), series[0]);
            const lightRange = [Math.min.apply(null, series.map(s => s.L)), Math.max.apply(null, series.map(s => s.L))];
            const progRange = [Math.min.apply(null, series.map(s => s.P)), Math.max.apply(null, series.map(s => s.P))];
            return { worst, lightRange, progRange,
                     spikes: series.filter(s => s.ms > 1200).map(s => s.tag + ':' + s.ms + 'ms L' + s.L + ' P' + s.P) };
        });
        console.log(who.padEnd(9), 'live=' + live, JSON.stringify(r));
    }
    console.log('errors:', JSON.stringify(errs.slice(0, 3)));
    await browser.close();
    process.exit(0);
})();
