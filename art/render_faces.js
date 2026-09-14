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

            // FRAME THE HEAD BONE, not the top 22% of the bounding box.
            //
            // Reported as "these pictures should all have the head centered and
            // facing forward, and nothing should be stretched". The box
            // heuristic produced all three faults: Grint's ears push his box
            // upward so the crop landed on an ear, Gorgonok's shoulders are
            // wider than his head so he framed in profile, and a
            // three-quarter camera on a head that is not where the crop
            // assumed put several of them off-centre.
            //
            // The rig has a Head bone and it is exactly where the head is, on
            // every character, whatever their proportions. Aim at that.
            let head = null;
            g.traverse(o => {
                if (head || !o.isBone) return;
                if (/^Head/.test(o.name || '')) head = o;
            });
            g.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(g);
            const size = box.getSize(new THREE.Vector3());
            const centre = new THREE.Vector3();
            let headH;
            if (head) {
                head.updateWorldMatrix(true, false);
                centre.setFromMatrixPosition(head.matrixWorld);
                // A head is roughly an eighth of a humanoid's height; frame a
                // little more than that so the shoulders anchor it.
                headH = size.y * 0.15;
                // The bone sits at the base of the skull, so lift the aim to
                // the middle of the face.
                centre.y += headH * 0.45;
            } else {
                // No rig (a procedural fallback): the old heuristic, which is
                // still better than nothing.
                headH = size.y * 0.22;
                centre.set((box.min.x + box.max.x) / 2, box.max.y - headH * 0.5,
                           (box.min.z + box.max.z) / 2);
            }

            const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 4000);
            const dist = (headH * 2.6) / (2 * Math.tan(Math.PI * 30 / 360));
            // STRAIGHT ON, not three-quarter. The model faces local +X (see
            // buildRiggedCharacter), so the camera goes out along +X - and
            // because that is derived from the convention rather than guessed,
            // every character faces the viewer instead of some of them turning
            // away. A slight lift keeps it from being a passport photo.
            const fwd = new THREE.Vector3(1, 0, 0).transformDirection(g.matrixWorld).normalize();
            cam.position.copy(centre).addScaledVector(fwd, dist);
            cam.position.y += headH * 0.18;
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
