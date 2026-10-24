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
        // These are a STARTING point now, not the answer - see the solve below,
        // which measures where the two weapons actually ended up and closes the
        // gap until they meet. Hand-tuning this pair is what produced "pretty
        // far away from each other" twice: 54/58, then 34/38, then 23/25, each
        // picked by looking at a number rather than at the weapons.
        let NEAR_A = 23, NEAR_B = 25;
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
        // THE FIRST ACTIVE FRAME IS NOT THE CONTACT POSE, which is what the
        // previous `startup + 1` assumed and what left both fighters looking
        // like they were standing there. swingT spends the active window this
        // way: it ENTERS it already at SWING_PRESTRIKE_T, which is -0.35 on a
        // scale where -1 is full extension, then travels the rest over
        // SWING_TRAVEL_FRAMES and HOLDS there for the remainder.
        //
        // So the frame the window opens on is a third of the way into the
        // strike with the arm still coming round - a wind-up, not a blow. The
        // held full-extension pose starts SWING_TRAVEL_FRAMES later, and that
        // is the one the design canvas is describing.
        //
        // Read from shared/animation.js rather than written as 5 here: those
        // constants are top-level in the page, and a copy of the number would
        // be wrong the first time the swing is retuned.
        const TRAVEL = (typeof SWING_TRAVEL_FRAMES !== 'undefined')
            ? SWING_TRAVEL_FRAMES : (D.SWING_TRAVEL_FRAMES || 5);
        // Capped at the window: a six-frame active window spends all of itself
        // travelling, so its most extended frame is its last.
        const contact = (fd) => fd.startup + Math.min(fd.active, TRAVEL);
        step(a, b, contact(fdA));
        step(b, a, contact(fdB));
        // Standing still, facing each other, whatever the AI wanted.
        a.x = stageX - qx * NEAR_A; a.y = stageY - qy * NEAR_A;
        b.x = stageX + qx * NEAR_B; b.y = stageY + qy * NEAR_B;
        a.fx = qx; a.fy = qy; b.fx = -qx; b.fy = -qy;
        a.vx = a.vy = b.vx = b.vy = 0;
        a.invulnFrames = b.invulnFrames = 0;
        a.render3D(null, 0); b.render3D(null, 0);
        D.animateWeapon(a); D.animateWeapon(b);

        // CLOSE THE GAP UNTIL THE WEAPONS MEET, measured from the weapons.
        //
        // The old check compared the sum of the two reaches against the gap and
        // printed "SHORT by 27.05". That verdict could never be anything else:
        // `reach` is how far a hand has TRAVELLED along the fighter's forward
        // axis during the swing - a displacement of a few units - and it was
        // being held against the centre-to-centre DISTANCE between two bodies.
        // No arm displaces itself by the whole distance to the other fighter,
        // so the comparison says SHORT at every spacing including ones where
        // the blades are through each other. A number that cannot distinguish
        // the two cases it exists to distinguish is worse than no number.
        //
        // What the image is about is where the WEAPONS are, so measure those:
        // take each weapon's world bounding box and the corner of it furthest
        // from its owner, which is the tip whichever way the swing is pointing.
        const tipOf = (f) => {
            let w = f.mesh.userData.weapon;
            if (Array.isArray(w)) w = w[0];
            if (!w) return null;
            f.mesh.updateWorldMatrix(true, true);
            const bb = new THREE.Box3().setFromObject(w);
            if (bb.isEmpty()) return null;
            const home = f.mesh.getWorldPosition(new THREE.Vector3());
            let best = null, bestD = -1;
            for (const cx of [bb.min.x, bb.max.x])
                for (const cy of [bb.min.y, bb.max.y])
                    for (const cz of [bb.min.z, bb.max.z]) {
                        const p = new THREE.Vector3(cx, cy, cz), d = p.distanceTo(home);
                        if (d > bestD) { bestD = d; best = p; }
                    }
            return best;
        };
        // Solve along q, the axis the two of them are separated on. Each tip
        // sits some distance along that axis from its owner's centre; the gap
        // between the tips is what is left of the spacing once both of those
        // are taken out, so the spacing that leaves CLASH_GAP between them
        // follows directly. One step, no searching - moving a fighter
        // translates its pose without changing it.
        const CLASH_GAP = 5;            // "blade stops 20cm short" - the design canvas
        const qw = new THREE.Vector3(D.worldX(qx) - D.worldX(0), 0, D.worldZ(qy) - D.worldZ(0)).normalize();
        const tipA = tipOf(a), tipB = tipOf(b);
        let solved = null;
        if (tipA && tipB) {
            const ca = a.mesh.getWorldPosition(new THREE.Vector3());
            const cb = b.mesh.getWorldPosition(new THREE.Vector3());
            const reachA = tipA.clone().sub(ca).dot(qw);    // toward b is +q
            const reachB = cb.clone().sub(tipB).dot(qw);    // toward a is -q
            const want = CLASH_GAP + reachA + reachB;       // NEAR_A + NEAR_B
            const have = NEAR_A + NEAR_B;
            if (want > 8 && want < 200) {
                const k = want / have;
                NEAR_A *= k; NEAR_B *= k;
                a.x = stageX - qx * NEAR_A; a.y = stageY - qy * NEAR_A;
                b.x = stageX + qx * NEAR_B; b.y = stageY + qy * NEAR_B;
                a.render3D(null, 0); b.render3D(null, 0);
                D.animateWeapon(a); D.animateWeapon(b);
            }
            solved = { reachA: +reachA.toFixed(2), reachB: +reachB.toFixed(2),
                       was: +have.toFixed(1), now: +(NEAR_A + NEAR_B).toFixed(1) };
        }
        const t2 = { a: tipOf(a), b: tipOf(b) };
        window.__tableauTips = Object.assign({ gap: (t2.a && t2.b)
            ? +t2.a.distanceTo(t2.b).toFixed(2) : null }, solved || {});

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
    // DID THEY ACTUALLY MEET - measured between the two weapon tips, which is
    // the thing the image is of. The previous version of this line held the sum
    // of the two hand DISPLACEMENTS against the centre-to-centre DISTANCE and
    // so reported "SHORT" at every spacing that exists; it is replaced rather
    // than tuned. Printed, not asserted, because this script makes art for a
    // person to look at - but a tip gap of 40 units is not a clash whatever the
    // thumbnail suggests.
    const tips = await page.evaluate(() => window.__tableauTips);
    if (tips) {
        console.log('spacing: solved ' + tips.was + ' -> ' + tips.now
            + ' from reaches ' + tips.reachA + ' / ' + tips.reachB);
        console.log('tip gap: ' + tips.gap + ' units -> '
            + (tips.gap == null ? 'no weapon to measure'
               : tips.gap < 12 ? 'clashing'
               : 'APART - not a clash'));
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
