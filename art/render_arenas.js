// Renders every arena from above, for the arena picker.
//
// Reported: "the arena previews when you are selecting one don't look like the
// actual arenas... they should literally be the arenas from a top down view."
// They were a procedural plan view - flat rectangles for the platforms on a
// flat floor colour - which says where things are and nothing about what the
// place looks like.
//
// This renders the real arena with its real textures and lighting from the
// spectator camera the game already uses when both sides are bots, so the
// preview is the arena. Same reasoning as the loading tableau: a script, so it
// re-runs when the art changes rather than going stale.
//
//   node art/render_arenas.js
//
// Writes assets/arena/<slug>.jpg for every map in MAPS.
const path = require('path');
const fs = require('fs');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

const OUTDIR = path.join(__dirname, '..', 'assets', 'arena');
const W = 640, HGT = 360;   // card-sized; they are thumbnails, not wallpapers

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    await page.setViewport({ width: 900, height: 600 });
    await H.boot(page, { clearStorage: true });

    const names = await page.evaluate(() => window.ACDebug.MAPS.map(m => m.name));
    fs.mkdirSync(OUTDIR, { recursive: true });

    for (const name of names) {
        const url = await page.evaluate(async (args) => {
            const D = window.ACDebug;
            const [mapName, w, h] = args;
            const map = D.MAPS.find(m => m.name === mapName);
            D.loadMap(map);
            // The photographs, before the shot - or the preview is of the
            // procedural stand-in rather than of the arena.
            await D.themeTexturesReady(D.MAP_THEMES[map.name]);
            await new Promise(r => requestAnimationFrame(() => r()));

            // Straight down, tilted a few degrees so height reads, framed to
            // hold the whole arena with a margin. Same framing the spectator
            // camera uses.
            const left = 60, right = 1755 - 60, top = 60, bottom = 975 - 60;
            const cx = (left + right) / 2, cy = (top + bottom) / 2;
            const span = Math.max((right - left) / Math.max(0.6, w / h), bottom - top) * 1.04;
            const cam = new THREE.PerspectiveCamera(46, w / h, 1, 8000);
            cam.layers.enableAll();
            for (const L of [3, 4]) cam.layers.disable(L);   // no viewmodels
            const dist = span / (2 * Math.tan((46 * Math.PI / 180) / 2));
            cam.position.set(D.worldX(cx), dist, D.worldZ(cy) + dist * 0.20);
            cam.lookAt(D.worldX(cx), 0, D.worldZ(cy));

            const before = { w: D.renderer.domElement.width, h: D.renderer.domElement.height };
            D.renderer.setSize(w, h, false);
            cam.aspect = w / h;
            cam.updateProjectionMatrix();
            const png = D.snapshot(cam);
            D.renderer.setSize(before.w, before.h, false);
            return png;
        }, [name, W, HGT]);

        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const file = path.join(OUTDIR, slug + '.png');
        fs.writeFileSync(file, url.split(',')[1], 'base64');
        console.log(String(name).padEnd(22), '->', path.basename(file),
                    Math.round(fs.statSync(file).size / 1024) + 'KB');
    }
    await browser.close();
    process.exit(0);
})();
