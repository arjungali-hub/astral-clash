// Renders the loading screen's tableau FROM THE GAME.
//
// The design canvas specifies a painted scene and leaves an image-slot for it:
// "PAINTED TABLEAU - low camera, three-quarter over-shoulder from Kaelen's
// left, both fighters in profile-to-camera clash... Blade stops 20cm short of
// the fist - impact implied, not landed."
//
// Painting that by hand is one option. Rendering it out of the game is the
// better one for this game: the fighters, the arena, the lighting and the bloom
// are all here and already correct, so the loading screen shows the actual
// thing you are waiting for. It is a script, so a roster or lighting change
// cannot leave the art stale - it re-runs.
//
//   node art/render_tableau.js
//
// A REAL MATCH is started rather than the pieces being assembled by hand. Two
// attempts at hand-placing put the camera inside a platform and photographed
// the inside of a metal box, twice: the game knows where its fighters stand and
// what is clear around them, and this borrows that instead of guessing.
//
// Writes assets/loading-tableau.png.
const path = require('path');
const fs = require('fs');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

const OUT = path.join(__dirname, '..', 'assets', 'loading-tableau.png');
const MAP = process.env.MAP || 'Molten Foundry';
const A = process.env.A || 'Kaelen';
const B = process.env.B || 'Gorgonok';
const W = 1920, HGT = 1080;

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    await page.setViewport({ width: 1280, height: 720 });
    await H.boot(page, { clearStorage: true, models: true });

    // Pick the two fighters and the arena the way a player does.
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
    }, [A, B]);
    await H.sleep(450);
    await page.evaluate((m) => {
        const cards = Array.from(document.querySelectorAll('#mapselect-grid .map-card'));
        (cards.find(c => c.textContent.includes(m)) || cards[0]).click();
    }, MAP);
    const live = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    if (!live) { console.error('never reached a fight'); process.exit(1); }
    await H.sleep(1200);

    const url = await page.evaluate((size) => {
        const D = window.ACDebug;
        const [w, h] = size;
        const a = D.player1, b = D.player2;

        // STAGED BESIDE ONE SPAWN, not at the midpoint between the two.
        //
        // Every arena is built around its centre, and the midpoint between the
        // spawns is therefore usually standing on something - Molten Foundry
        // has a large central platform exactly there, which is how three
        // attempts in a row photographed the inside of a metal box. A spawn is
        // guaranteed clear (assertSpawnsClear), and the ground just inside it is
        // the open approach to the middle.
        const cxA = D.currentMap.spawn1, cxB = D.currentMap.spawn2;
        const tx = cxB.x - cxA.x, ty = cxB.y - cxA.y;
        const tlen = Math.hypot(tx, ty) || 1;
        const ux = tx / tlen, uy = ty / tlen;          // spawn1 -> spawn2
        const stageX = cxA.x + ux * 120, stageY = cxA.y + uy * 120;
        const mx = stageX, my = stageY;
        // ACROSS the camera rather than away from it: a second fighter placed
        // further along the spawn line stands behind the first and, in Molten
        // Foundry, inside the wall the line runs into. Perpendicular puts them
        // shoulder to shoulder in frame, still facing each other.
        const qx = -uy, qy = ux;
        // WEAPONS CROSSING, not a stride apart.
        //
        // This was 34/38 - 72 units centre to centre, and a fighter's collision
        // circle is 40 wide, so a full body-width of daylight sat between them.
        // Reported as "pretty far away from each other", which it was; the
        // comment this replaces had already tightened it once from 54/58 and
        // stopped too early.
        //
        // 23/25 is 48 apart: close enough that two arms at full extension
        // overlap, which is what makes it read as a clash rather than as two
        // people having a disagreement across a room. reach() below measures
        // the pose and the script prints it, so this number is checkable
        // against what the fighters actually do instead of being taken on
        // trust - the weapons meet while reach(a) + reach(b) > 48.
        const NEAR_A = 23, NEAR_B = 25;
        a.x = stageX - qx * NEAR_A; a.y = stageY - qy * NEAR_A;
        b.x = stageX + qx * NEAR_B; b.y = stageY + qy * NEAR_B;
        a.fx = qx; a.fy = qy;
        b.fx = -qx; b.fy = -qy;
        a.vx = a.vy = b.vx = b.vy = 0;

        // THE POSE, driven by the real animation rather than hand-set angles:
        // freeze each of them on a frame of their own attack. `a` is one frame
        // from full extension, `b` is mid wind-up with the guard arm coming up.
        // FRAME_DATA lives in shared/roster.js, which is a top-level const in
        // the page rather than a field on ACDebug.
        const FD = (typeof FRAME_DATA !== 'undefined') ? FRAME_DATA : (D.FRAME_DATA || {});
        // STEPPED, not assigned. Setting atkState by hand left both of them
        // standing with their arms down: the pose comes from animateWeapon
        // reading a whole action's worth of state, not from the two fields that
        // name it. So the attacks are STARTED and the simulation stepped to the
        // frame wanted - the same thing swingcheck does to measure a swing.
        const fdA = FD[a.name].basic, fdB = FD[b.name].basic;
        // render3D, NOT animateWeapon alone. For a RIGGED character the attack
        // pose comes from the baked clip, and the clip is advanced by
        // updateRigAnimation(dt) -> mixer.update(dt / 60), which only render3D
        // calls. Stepping with animateWeapon alone left the mixer at t=0, so
        // every rigged fighter stood in its idle pose while its atkState said
        // it was mid-swing, and animateWeapon could only nudge the few bones it
        // drives on top of that. Reported as "they aren't really fighting, just
        // standing" - which was exactly right.
        const step = (f, o, n) => {
            for (let i = 0; i < n; i++) { f.update(o, 1); f.render3D(null, 1); }
        };
        // NEITHER MAY HIT THE OTHER WHILE POSING. `a` is stepped to its ACTIVE
        // frame, which is a live hitbox - it connected, put `b` in hitstun and
        // cancelled b's wind-up, so b came out of this standing. Measured:
        // b.atkState was 'idle' when it should have been 'startup'.
        a.invulnFrames = b.invulnFrames = 9999;
        a.tryStartAction('basic', b);
        b.tryStartAction('basic', a);
        // BOTH ON THEIR FIRST ACTIVE FRAME - the contact pose for each.
        //
        // `b` used to be stepped to 60% of its startup, still winding up. One
        // fighter extended and one with its arm half-raised is a strike, not a
        // clash, and at this distance the half-raised one simply looked like it
        // was not participating. Both at contact puts the two weapons in the
        // same place at the same moment, which is the whole image.
        //
        // Neither can hit the other while this happens - invulnFrames is 9999
        // just above - which matters more now that both have a live hitbox on
        // the frame they are being held at.
        step(a, b, fdA.startup + 1);
        step(b, a, fdB.startup + 1);
        // Standing still, facing each other, whatever the AI wanted.
        a.x = stageX - qx * NEAR_A; a.y = stageY - qy * NEAR_A;
        b.x = stageX + qx * NEAR_B; b.y = stageY + qy * NEAR_B;
        a.fx = qx; a.fy = qy; b.fx = -qx; b.fy = -qy;
        a.vx = a.vy = b.vx = b.vy = 0;
        a.invulnFrames = b.invulnFrames = 0;
        a.render3D(null, 0); b.render3D(null, 0);
        D.animateWeapon(a); D.animateWeapon(b);

        // The camera: low, three-quarter, off to one side. The perpendicular
        // offset is small on purpose - a wide one walks into the arena's
        // platforms, which is how the first two attempts ended up inside one.
        // Behind the near fighter and out to the side, high enough to clear the
        // low cover an arena puts near its spawns, angled down at the pair.
        // Low and three-quarter: back from the pair along the spawn line, with a
        // little perpendicular bias so neither of them is dead-on.
        const camX = stageX - ux * 150 - qx * 46;
        const camY = stageY - uy * 150 - qy * 46;
        const cam = new THREE.PerspectiveCamera(36, w / h, 1, 6000);
        cam.layers.enableAll();
        // NOT the viewmodel layers. Those hold the first-person arm, which is
        // parented to the play camera and belongs in nobody else's shot - it
        // turned up across the bottom of the frame on the first pass.
        for (const L of [3, 4]) cam.layers.disable(L);
        cam.position.set(D.worldX(camX), 58, D.worldZ(camY));
        cam.lookAt(D.worldX(mx), 32, D.worldZ(my));

        // The P1/P2 name sprites are scene objects, not HUD - fine in a match
        // and wrong in a poster.
        // The P1/P2 name sprites and the dash-cooldown rings are scene objects,
        // not HUD: right in a match, wrong in a poster.
        const hidden = [];
        for (const f of [a, b]) {
            f.mesh.traverse(o => {
                const ring = o.geometry && /Torus|Ring/.test(o.geometry.type);
                if ((o.isSprite || ring) && o.visible) { o.visible = false; hidden.push(o); }
            });
        }

        const before = { w: D.renderer.domElement.width, h: D.renderer.domElement.height };
        D.renderer.setSize(w, h, false);
        cam.aspect = w / h;
        cam.updateProjectionMatrix();
        // Measured, not assumed: how far each fighter's hand has travelled along
        // its own forward axis. Standing is ~0; a strike is clearly positive.
        // Same projection tests/weaponcheck.js uses.
        const reach = (f) => {
            const arms = D.armsOf ? D.armsOf(f) : [];
            const arm = (arms || []).find(x => x && x.pivot && x.hand);
            if (!arm) return null;
            f.mesh.updateWorldMatrix(true, true);
            const fwd = new THREE.Vector3(1, 0, 0).transformDirection(f.mesh.matrixWorld).normalize();
            const sh = new THREE.Vector3().setFromMatrixPosition(arm.pivot.matrixWorld);
            const hd = new THREE.Vector3().setFromMatrixPosition(arm.hand.matrixWorld);
            return +hd.sub(sh).dot(fwd).toFixed(2);
        };
        window.__tableauPose = { a: { name: a.name, state: a.atkState, reach: reach(a) },
                                 b: { name: b.name, state: b.atkState, reach: reach(b) } };

        const png = D.snapshot(cam);
        D.renderer.setSize(before.w, before.h, false);
        for (const o of hidden) o.visible = true;
        return png;
    }, [W, HGT]);

    const pose = await page.evaluate(() => window.__tableauPose);
    console.log('pose:', JSON.stringify(pose));
    // DID THEY ACTUALLY MEET. The gap is 48 units and each reach is measured
    // from its own shoulder, so the weapons cross while the two reaches add up
    // to more than that. Printed rather than asserted because this script
    // produces art for a person to look at - but a negative margin means the
    // image cannot be a clash, whatever it looks like at a glance.
    if (pose && pose.a && pose.b && pose.a.reach != null && pose.b.reach != null) {
        const gap = 48, total = pose.a.reach + pose.b.reach;
        console.log(`reach: ${pose.a.reach} + ${pose.b.reach} = ${total.toFixed(2)}`
            + ` against a ${gap}-unit gap -> `
            + (total > gap ? `crossing by ${(total - gap).toFixed(2)}`
                           : `SHORT by ${(gap - total).toFixed(2)} - not a clash`));
    }

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
