// Renders a head-and-shoulders portrait of every character to assets/faces/.
//
//     node art/render_faces.js            # all
//     node art/render_faces.js Lyra Nyx   # some
//
// The roster grid, the armory cards and the room's player slots all showed a
// flat disc of the character's accent colour, because until Batch 35 there was
// nothing else to show - the fighters were assembled primitives with no face.
// Now that every character has one, the circles should hold it.
//
// These are baked to PNG rather than rendered live for two reasons: the select
// screen would otherwise have to load fourteen 2 MB GLBs to draw fourteen
// 44-pixel circles (the whole point of Batch 35's lazy loading was NOT doing
// that), and a portrait wants its own framing and lighting rather than whatever
// the arena happens to have.
const H = require('../tests/harness');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', 'assets', 'faces');
const SIZE = 192;   // 2x the largest place it is displayed, for retina

(async () => {
    const names = process.argv.slice(2);
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

    const browser = await H.launch({ defaultViewport: { width: SIZE, height: SIZE } });
    await H.startServer();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true });

    const roster = names.length ? names : await page.evaluate(() => Object.keys(window.ACDebug.CHAR_MODEL_URLS));
    let ok = 0, failed = [];

    for (const name of roster) {
        const out = await page.evaluate(async n => {
            const D = window.ACDebug;
            const m = await D.ensureCharModel(n);
            if (!m) return 'NO MODEL';
            const g = D.buildRiggedCharacter(n);
            if (!g) return 'NO GROUP';

            const scene = new THREE.Scene();
            scene.background = null;                 // transparent: the CSS circle shows through
            // Portrait lighting, not arena lighting: a key from the front-left
            // so the face is modelled rather than flat, a cool rim to separate
            // the silhouette from a dark UI panel, and enough ambient that a
            // deep hood is not a black hole.
            scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x2a3040, 1.05));
            const key = new THREE.DirectionalLight(0xfff6e8, 2.3);
            key.position.set(-40, 55, 60); scene.add(key);
            const rim = new THREE.DirectionalLight(0x8fc0ff, 1.4);
            rim.position.set(55, 25, -45); scene.add(rim);
            scene.add(g);

            const box = new THREE.Box3().setFromObject(g);
            const size = box.getSize(new THREE.Vector3());
            const top = box.max.y;
            // Frame the head: the top ~22% of a humanoid is head and shoulders.
            // Measured from the model rather than assumed, so Karrigos (1.5x)
            // and Grint (0.72x) both frame correctly.
            const headH = size.y * 0.22;
            const centre = new THREE.Vector3(
                (box.min.x + box.max.x) / 2, top - headH * 0.5, (box.min.z + box.max.z) / 2);

            const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 4000);
            const dist = (headH * 1.6) / (2 * Math.tan(Math.PI * 30 / 360));
            // Three-quarter view, slightly above eye level - a straight-on
            // shot of a low-poly face reads as a mugshot.
            cam.position.set(centre.x + dist * 0.52, centre.y + headH * 0.12, centre.z + dist * 0.86);
            cam.lookAt(centre);

            const r = D.renderer;
            const hadAlpha = r.getClearAlpha();
            r.setClearAlpha(0);
            r.setScissorTest(false);
            r.setViewport(0, 0, r.domElement.width, r.domElement.height);
            r.render(scene, cam);
            const url = r.domElement.toDataURL('image/png');
            r.setClearAlpha(hadAlpha);
            return url;
        }, name);

        if (typeof out !== 'string' || !out.startsWith('data:image/png')) {
            failed.push(name + ' (' + out + ')');
            continue;
        }
        fs.writeFileSync(path.join(OUT, name.toLowerCase() + '.png'),
            Buffer.from(out.split(',')[1], 'base64'));
        ok++;
        console.log('  ' + name);
    }

    console.log(`\n${ok} portrait(s) written to assets/faces/`);
    if (failed.length) console.log('FAILED: ' + failed.join(', '));
    console.log('page errors:', JSON.stringify(page.errors.slice(0, 4)));
    H.stopServer();
    await browser.close();
    process.exit(failed.length ? 1 : 0);
})();
