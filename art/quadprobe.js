// The pale-pink quad on Twin Ramparts.
//
//   node art/quadprobe.js            reproduce and photograph it
//   node art/quadprobe.js --probe    name what the camera is looking at
//
// REPORTED in a collision sweep: "A large untextured pale-pink quad fills the
// lower half of P2's first-person view while he is standing at the west
// rampart's edge on Twin Ramparts."
//
// REPRODUCED. It is real, it is on both halves of the split screen, and the
// screenshot this takes shows it clearly: a flat pale lavender plane filling
// the lower view with a hard horizontal edge, plus pink bars on the wall
// banners and pink arch shapes. The textured cobblestone floor is visible
// BEYOND it, which is the part that makes it odd - whatever this is sits
// between the camera and a floor that renders correctly.
//
// WHAT IT IS NOT, established and worth not re-testing:
//
//   * NOT an untextured material. 216 meshes in this scene have no map, and
//     every one is a decorative prop with a legitimate flat colour - gold
//     #d9a83c, dark #1c2027. None is pink.
//   * NOT the crush stage. crushRigs exist but both are visible:false and
//     `crushing` is false during an ordinary fight; the stage floor has a map
//     and reads #d8dbde, a pale grey-blue rather than pink.
//
// WHAT IS STILL UNKNOWN: what the camera is actually hitting. The --probe mode
// below raycasts down the lower half of the view and names the mesh, which is
// the question that settles it. It has not been run to completion: this
// machine kept killing the browser inside page.goto at ~595MB available, the
// same wall ROADMAP Tier 2 describes. Run it somewhere with memory.
const path = require('path');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

async function intoTwinRamparts(page) {
    await page.evaluate(() => window.ACDebug.setDebugUnlockAll(true));
    await H.sleep(300);
    await page.evaluate(() => {
        for (const side of ['p1', 'p2']) {
            const b = document.querySelector('#' + side + '-grid .fighter-btn');
            if (b) b.click();
            const c = document.querySelector('#' + side + '-detail .btn-confirm');
            if (c) c.click();
        }
        const s = document.getElementById('btn-start-match');
        if (s) s.click();
        // BY NAME, not by index: the arena order is not a contract and an
        // index would quietly photograph a different map.
        const cards = [...document.querySelectorAll('#mapselect-grid .map-card')];
        (cards.find((c) => /Twin Ramparts/i.test(c.textContent)) || cards[0]).click();
    });
    return H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 60000);
}

// The west rampart's top: the platform is (250, 487) with hw 110, hd 150 and
// height 70, so this is its western lip - where the sweep was standing.
function standOnTheLedge(page) {
    return page.evaluate(() => {
        const D = window.ACDebug;
        D.player2.x = 150; D.player2.y = 487; D.player2.z = 70;
        D.player2.fx = 1; D.player2.fy = 0;
        D.player1.x = 260; D.player1.y = 487; D.player1.z = 70;
        return D.currentMap ? D.currentMap.name : '?';
    });
}

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    await page.setViewport({ width: 1400, height: 1000 });
    await H.boot(page, { clearStorage: true, path: '/local/index.html' });

    if (!await intoTwinRamparts(page)) {
        console.log('never reached FIGHT - this says nothing about the quad.');
        await browser.close();
        process.exit(1);
    }
    console.log('arena: ' + await standOnTheLedge(page));
    await H.sleep(1500);

    if (!process.argv.includes('--probe')) {
        const out = path.join(__dirname, '..', 'tests', 'screenshots', 'twin-ramparts-quad.png');
        await page.screenshot({ path: out });
        console.log('shot: tests/screenshots/twin-ramparts-quad.png');
        await browser.close();
        process.exit(0);
    }

    const hits = await page.evaluate(() => {
        const D = window.ACDebug;
        const cam = D.camP2 || D.camP1;
        if (!cam || !window.THREE) return { err: 'no camera or THREE on the page' };
        const rc = new THREE.Raycaster();
        // THE CAMERA'S LAYERS, NOT ALL OF THEM. enableAll() was asking "what is
        // in front of the camera", and the question is "what does the camera
        // DRAW" - a different thing in this scene, because the first-person
        // viewmodel lives on its own layer that the world camera excludes and a
        // second pass renders. The first run with enableAll() reported Kaelen's
        // own rigged mesh on layer mask 4 at distance 3, which is the viewmodel
        // source sitting where a viewmodel sits: in front of the face, and
        // invisible to this camera.
        rc.layers.mask = cam.layers.mask;
        const rows = [];
        for (const ny of [-0.3, -0.5, -0.7, -0.9]) {
            rc.setFromCamera(new THREE.Vector2(0, ny), cam);
            const hit = rc.intersectObjects(D.scene.children, true)
                .filter((h) => h.object.isMesh && h.object.visible)[0];
            // WHO IT IS, not just what it looks like. The first run of this
            // answered "textured #dbdbdb MeshStandardMaterial at distance 3"
            // for all four rays, which rules out the original report's
            // "untextured pale-pink quad" and puts the thing within arm's
            // reach of the camera - so the useful question became which
            // object, and whose.
            const o = hit && hit.object;
            const chain = [];
            for (let p = o; p; p = p.parent) {
                chain.push((p.name || p.type) + (p.visible ? '' : '[hidden]'));
            }
            const bb = o && o.geometry
                ? (o.geometry.computeBoundingBox(), o.geometry.boundingBox) : null;
            const size = bb ? {
                x: Math.round(bb.max.x - bb.min.x),
                y: Math.round(bb.max.y - bb.min.y),
                z: Math.round(bb.max.z - bb.min.z),
            } : null;
            rows.push(hit ? {
                ny,
                dist: Math.round(hit.distance),
                name: o.name || '(unnamed)',
                chain: chain.join(' < '),
                ownedBy: o === D.player2.mesh ? 'player2.mesh'
                    : o === D.player1.mesh ? 'player1.mesh' : '-',
                layers: o.layers.mask,
                size,
                geom: o.geometry && o.geometry.type,
                colour: o.material && o.material.color
                    ? '#' + o.material.color.getHexString() : '?',
                textured: !!(o.material && o.material.map),
                mapName: o.material && o.material.map
                    ? (o.material.map.name || o.material.map.image
                        && (o.material.map.image.src || 'canvas') || '?') : null,
                material: o.material && o.material.type,
            } : { ny, hit: null });
        }
        return { rows };
    });
    console.log('camera layer mask: ' + await page.evaluate(() => {
        const D = window.ACDebug;
        const cam = D.camP2 || D.camP1;
        return cam ? cam.layers.mask : '?';
    }));
    console.log(JSON.stringify(hits, null, 2));
    await browser.close();
    process.exit(0);
})();
