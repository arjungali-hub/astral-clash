// Renders one fighter, third-person, against the arena - for looking at the
// character itself rather than at the game.
//
//   node art/render_fighter.js                 Kaelen, front
//   WHO=Gorgonok VIEW=side node art/render_fighter.js
//
// Writes art/raw/fighter-<who>-<view>.png, which is git-ignored.
//
// Two things this has to get right, both learned the hard way against the live
// site. A fighter's rig is on its OWN LAYER so the owning player's camera does
// not draw it in first person - a camera that forgets to enable that layer
// photographs an empty arena and looks exactly like a camera pointed the wrong
// way. And layers 3 and 4 are the first-person VIEWMODELS, which are parented
// to the play camera and belong in nobody else's shot.
const path = require('path');
const fs = require('fs');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

const WHO = process.env.WHO || 'Kaelen';
const FOE = process.env.FOE || 'Lyra';
const VIEW = process.env.VIEW || 'front';
const W = 900, HGT = 1100;
const OUT = path.join(__dirname, 'raw', `fighter-${WHO.toLowerCase()}-${VIEW}.png`);

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    await page.setViewport({ width: 1000, height: 760 });
    await H.boot(page, { clearStorage: true, models: true });

    await page.evaluate((who) => {
        const D = window.ACDebug;
        D.setDebugUnlockAll(true);
        D.setMatchMode('classic');
        const pick = (grid, detail, n) => {
            const cards = Array.from(document.querySelectorAll(grid + ' .fighter-btn'));
            (cards.find(c => c.textContent.includes(n)) || cards[0]).click();
            document.querySelector(detail + ' .btn-confirm').click();
        };
        pick('#p1-grid', '#p1-detail', who[0]);
        pick('#p2-grid', '#p2-detail', who[1]);
    }, [WHO, FOE]);
    await H.sleep(450);
    await page.evaluate(() => {
        const c = document.querySelector('#mapselect-grid .map-card');
        if (c) c.click();
    });
    const live = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    if (!live) { console.error('never reached a fight'); process.exit(1); }
    await H.sleep(1200);

    const url = await page.evaluate((args) => {
        const [w, h, view] = args;
        const D = window.ACDebug;
        const f = D.player1, root = f.mesh;
        // Still, upright, facing +X, and not being hit by anything.
        f.vx = f.vy = f.vz = 0;
        f.fx = 1; f.fy = 0; f.pitch = 0;
        f.hitstunTimer = 0; f.rootedFrames = 0;
        f.invulnFrames = 9999;
        f.render3D(null, 0);
        root.updateMatrixWorld(true);

        // The rings on the ground and the name plate above the head are scene
        // objects, not HUD: right in a match, wrong in a portrait.
        const hidden = [];
        root.traverse(o => {
            const ring = o.geometry && /Torus|Ring/.test(o.geometry.type);
            if ((o.isSprite || ring) && o.visible) { o.visible = false; hidden.push(o); }
        });
        if (D.mapGroup) D.mapGroup.visible = false;   // a plain backdrop reads the silhouette

        const p = root.getWorldPosition(new THREE.Vector3());
        const centre = p.clone().setY(25);
        const dist = 110;
        const dir = { front: [1, 0], back: [-1, 0], side: [0, 1],
                      quarter: [0.75, 0.66] }[view] || [1, 0];
        const cam = new THREE.PerspectiveCamera(30, w / h, 1, 4000);
        cam.layers.enableAll();
        for (const L of [3, 4]) cam.layers.disable(L);   // viewmodels
        cam.position.set(centre.x + dir[0] * dist, 30, centre.z + dir[1] * dist);
        cam.lookAt(centre);

        const before = { w: D.renderer.domElement.width, h: D.renderer.domElement.height };
        D.renderer.setSize(w, h, false);
        cam.aspect = w / h;
        cam.updateProjectionMatrix();
        const png = D.snapshot(cam);
        D.renderer.setSize(before.w, before.h, false);
        for (const o of hidden) o.visible = true;
        if (D.mapGroup) D.mapGroup.visible = true;
        return png;
    }, [W, HGT, VIEW]);

    if (!url || url.length < 5000) {
        console.error('render produced nothing usable');
        process.exit(1);
    }
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, url.split(',')[1], 'base64');
    console.log('wrote', OUT, Math.round(fs.statSync(OUT).size / 1024) + 'KB');
    await browser.close();
    process.exit(0);
})();
