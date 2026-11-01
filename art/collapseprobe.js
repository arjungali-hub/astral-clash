// Does fallen geometry stop being solid?
//
//   node art/collapseprobe.js
//
// Audit #6: "Skyreach Spire at 0.52: platform (700,700, h 60) mesh `falling`
// and `visible:false` at y -182, yet it still covers 190x71 units of live
// floor. A fighter dropped there landed and stood at z 60 on nothing."
//
// syncArenaCollapse dropped the MESH and left the entry in PLATFORMS, TERRAIN
// and OBSTACLES, so the physics went on reading geometry the player had
// watched fall away.
//
// The frames are awaited OUTSIDE page.evaluate: software rendering runs this
// at about a frame a second, and looping them inside one call blows
// puppeteer's protocol timeout rather than testing anything.
const path = require('path');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    await page.setViewport({ width: 1000, height: 700 });
    await H.boot(page, { clearStorage: true });

    await page.evaluate(() => {
        const D = window.ACDebug;
        D.setDebugUnlockAll(true);
        for (const side of ['p1', 'p2']) {
            const b = document.querySelector('#' + side + '-grid .fighter-btn');
            if (b) b.click();
            const c = document.querySelector('#' + side + '-detail .btn-confirm');
            if (c) c.click();
        }
        const s = document.getElementById('btn-start-match');
        if (s) s.click();
        const cards = [...document.querySelectorAll('#mapselect-grid .map-card')];
        (cards.find((c) => /Skyreach Spire/i.test(c.textContent)) || cards[0]).click();
    });
    if (!await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 60000)) {
        console.log('FAILED: never reached FIGHT - this says nothing about #6.');
        await browser.close();
        process.exit(1);
    }

    const before = await page.evaluate(() => {
        const D = window.ACDebug;
        if (D.forceCrush) D.forceCrush();
        return { platforms: D.PLATFORMS.length, terrain: D.TERRAIN.length,
                 obstacles: D.OBSTACLES.length };
    });

    // Let the real loop drive the collapse, and stop as soon as something has
    // actually fallen rather than guessing how long that takes.
    const fell = await H.waitInPage(page,
        'window.ACDebug.mapEdgeObjects.some(o => o.falling)', 60000);
    await H.sleep(2500);   // a little further in, so more than one piece has gone

    const out = await page.evaluate(() => {
        const D = window.ACDebug;
        const fallen = D.mapEdgeObjects.filter((o) => o.falling);
        // Of the pieces that have fallen, any still standing somebody up.
        const stillSolid = [];
        for (const o of fallen) {
            if (!o.data) continue;
            const inArray = D.PLATFORMS.includes(o.data)
                || D.TERRAIN.includes(o.data) || D.OBSTACLES.includes(o.data);
            const ground = D.groundLevelAt(o.x, o.y);
            if (inArray || ground > 0.5) {
                stillSolid.push({ x: Math.round(o.x), y: Math.round(o.y),
                                  inArray, ground: Math.round(ground),
                                  meshY: Math.round(o.mesh.position.y) });
            }
        }
        return {
            after: { platforms: D.PLATFORMS.length, terrain: D.TERRAIN.length,
                     obstacles: D.OBSTACLES.length },
            fallen: fallen.length,
            stillSolid: stillSolid.slice(0, 8),
            stillSolidCount: stillSolid.length,
        };
    });

    console.log(JSON.stringify({ before, ...out }, null, 2));
    console.log('');
    if (!fell || !out.fallen) {
        console.log('INCONCLUSIVE: nothing fell, so nothing was tested. '
            + 'Check forceCrush still drives the collapse.');
        await browser.close();
        process.exit(1);
    }
    if (out.stillSolidCount) {
        console.log('FAIL: ' + out.stillSolidCount
            + ' fallen piece(s) are still solid - #6 is not fixed.');
        await browser.close();
        process.exit(1);
    }
    const sum = (o) => o.platforms + o.terrain + o.obstacles;
    console.log('CONFIRMED: ' + out.fallen + ' piece(s) fell and none still holds '
        + 'anybody up (collision entries ' + sum(before) + ' -> ' + sum(out.after) + ').');
    await browser.close();
    process.exit(0);
})();
