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
        rc.layers.enableAll();
        const rows = [];
        for (const ny of [-0.3, -0.5, -0.7, -0.9]) {
            rc.setFromCamera(new THREE.Vector2(0, ny), cam);
            const hit = rc.intersectObjects(D.scene.children, true)
                .filter((h) => h.object.isMesh && h.object.visible)[0];
            rows.push(hit ? {
                ny,
                dist: Math.round(hit.distance),
                geom: hit.object.geometry && hit.object.geometry.type,
                colour: hit.object.material && hit.object.material.color
                    ? '#' + hit.object.material.color.getHexString() : '?',
                textured: !!(hit.object.material && hit.object.material.map),
                material: hit.object.material && hit.object.material.type,
            } : { ny, hit: null });
        }
        return { rows };
    });
    console.log(JSON.stringify(hits, null, 2));
    await browser.close();
    process.exit(0);
})();
