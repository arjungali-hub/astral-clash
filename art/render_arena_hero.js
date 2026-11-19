// Every arena from where a player would stand, for the map-select tiles.
//
//   node art/render_arena_hero.js                 all ten
//   node art/render_arena_hero.js "Twin Ramparts"  just these
//
// Writes assets/arena/<slug>-hero.webp, 960x540.
//
// WHY A SECOND SET, when render_arenas.js already photographs every arena. That
// set is TOP-DOWN, on purpose: it is a plan, and a plan is what tells two
// arenas apart by layout - where the cover is, where the high ground is. It is
// also a flat grey-brown rectangle seen from above, which is how no player
// ever sees an arena and is not what makes anyone want to fight in one. Map
// select in a shooter shows the PLACE. So the tiles lead with this - the
// arena from a corner at head height, walls and sky and the scenery past
// them - and keep the plan as an inset in the corner, where it still answers
// the question it is good at.
//
// THE CAMERA is the same rule for every arena, not a hand-placed shot per map:
// from just inside the near-left corner, a little above a fighter's eye, aimed
// across the floor at the far side. A per-map table would be ten numbers to
// keep in step with ten layouts that get edited; one rule cannot drift.
//
// WRITTEN AS WEBP from the game canvas, in the same task as the render - the
// renderer keeps no drawing buffer between frames, so a toDataURL any later
// reads a cleared one (the same reason ACDebug.snapshot exists).
const path = require('path');
const fs = require('fs');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

const OUTDIR = path.join(__dirname, '..', 'assets', 'arena');
const W = 960, HGT = 540;

(async () => {
    const only = process.argv.slice(2);
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    await page.setViewport({ width: 1100, height: 700 });
    await H.boot(page, { clearStorage: true });

    const names = only.length ? only : await page.evaluate(() => window.ACDebug.MAPS.map(m => m.name));
    fs.mkdirSync(OUTDIR, { recursive: true });
    let failed = 0;

    for (const name of names) {
        const out = await page.evaluate(async (args) => {
            const D = window.ACDebug;
            const [mapName, w, h] = args;
            const map = D.MAPS.find(m => m.name === mapName);
            if (!map) return { err: 'no such arena' };
            D.loadMap(map);
            await D.themeTexturesReady(D.MAP_THEMES[map.name]);
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));

            // The arena in game units: 1755 across, 975 deep, walls inside.
            const left = 60, right = 1755 - 60, top = 60, bottom = 975 - 60;
            const cam = new THREE.PerspectiveCamera(58, w / h, 1, 9000);
            cam.layers.enableAll();
            for (const L of [3, 4]) cam.layers.disable(L);   // no viewmodels
            const eyeX = left + (right - left) * 0.06, eyeY = bottom - (bottom - top) * 0.07;
            const atX = left + (right - left) * 0.62, atY = top + (bottom - top) * 0.34;
            cam.position.set(D.worldX(eyeX), 112, D.worldZ(eyeY));
            cam.lookAt(D.worldX(atX), 34, D.worldZ(atY));

            const R = D.renderer;
            const before = { w: R.domElement.width, h: R.domElement.height, ratio: R.getPixelRatio() };
            R.setPixelRatio(1);
            R.setSize(w, h, false);
            R.setScissorTest(false);
            R.setViewport(0, 0, w, h);
            cam.aspect = w / h;
            cam.updateProjectionMatrix();
            R.render(D.scene, cam);
            const url = R.domElement.toDataURL('image/webp', 0.84);
            R.setPixelRatio(before.ratio);
            R.setSize(before.w / before.ratio, before.h / before.ratio, false);
            return { url };
        }, [name, W, HGT]);

        if (!out || out.err || !out.url || !out.url.startsWith('data:image/webp')) {
            failed++;
            console.log(String(name).padEnd(22), 'FAILED', out && out.err);
            continue;
        }
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const file = path.join(OUTDIR, slug + '-hero.webp');
        fs.writeFileSync(file, Buffer.from(out.url.split(',')[1], 'base64'));
        console.log(String(name).padEnd(22), '->', path.basename(file),
                    Math.round(fs.statSync(file).size / 1024) + ' KB');
    }
    console.log('page errors: ' + JSON.stringify(page.errors.slice(0, 3)));
    await H.closeAllBrowsers();
    process.exit(failed ? 1 : 0);
})();
