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
// Molten Foundry, not Skyreach Spire. The art direction picked Skyreach by
// NAME, reasoning that a low camera would put the blades against open sky,
// and flagged it as a call made without seeing the arenas. Rendered, it is an
// orange canyon with flat salmon platforms - no sky at that angle, and the
// pink reads as unfinished. The direction's own backup was right.
const MAP = process.env.MAP || 'Molten Foundry';
const A = process.env.A || 'Kaelen';
const B = process.env.B || 'Nyx';
const W = 1920, HGT = 1080;
// Which shoulder the camera sits behind. Both are rendered before
// committing: from one side the near fighter's own torso can cover the
// weapon that is supposed to be making contact.
// RIGHT by default, and this is the thing the direction said to check rather
// than assume: from the other shoulder Kaelen's own torso covers the sword
// that is supposed to be making contact, and the shot is square onto his
// back. Both sides measure identically - 7.0 against 7.3 units of tip gap -
// so the choice between them was never arithmetic.
const SIDE = process.env.SIDE === 'left' ? 1 : -1;
// Which frame of each attack to freeze on, counted in steps from the start of
// the action. Defaults come from contact() below; these override it, because
// the sweep showed the pose worth freezing is not where reasoning put it - the
// HOLD at full extension lives in RECOVERY, not in the active window, and for
// two fighters to meet at the same HEIGHT the two frames are nowhere near each
// other. Run with SWEEP=1 to print the table these come from.
const FRAME_A = Number(process.env.FRAME_A || 12);
const FRAME_B = Number(process.env.FRAME_B || 23);
// THOSE TWO NUMBERS BELONG TO THIS PAIR. 12 is the middle of Kaelen's hold;
// 23 is deep in Nyx's recovery, and it is there because that is where her
// tip is at HIS height. Change A or B and both are meaningless - re-run with
// SWEEP=1 and read the new table.
// Camera distance from the clash, and how far off the fighters' axis it sits.
// Distance is a knob because the pair's separation is set by the LONGEST
// weapon on the roster: Nyx's scythe puts her tip 81 units from her own
// centre, so the two bodies end up ~117 apart and a 120-unit camera cannot
// hold both in frame.
const DIST = Number(process.env.DIST || 150);
const ANGLE = Number(process.env.ANGLE || 28);

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

    // Set BEFORE the staged evaluate, because the sweep runs inside it.
    if (process.env.SWEEP) await page.evaluate(() => { window.__wantSweep = true; });
    const url = await page.evaluate((size) => {
        const D = window.ACDebug;
        const [w, h, SIDE, FRAME_A, FRAME_B, DIST, ANGLE] = size;
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
        // STRICTLY INSIDE THE ACTIVE WINDOW. `startup + active` steps are
        // exactly enough to consume the whole window, so the fighter comes out
        // the far side in RECOVERY with its arm already on the way back -
        // which is what happened: Kaelen reported state "recovery" and a reach
        // of -8.4, his sword trailing behind him. One frame short keeps the
        // held contact pose, which is where the hold lives.
        const contact = (fd) => fd.startup + Math.max(1, Math.min(fd.active - 1, TRAVEL));
        step(a, b, FRAME_A > 0 ? FRAME_A : contact(fdA));
        step(b, a, FRAME_B > 0 ? FRAME_B : contact(fdB));
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
        // THE TIP IS THE FAR END OF THE WEAPON, not the point furthest from the
        // body - and the difference is not academic. Every prop in this game is
        // authored with its local +X running from the grip out along the blade
        // (see shared/props.js), so "the tip" has an exact definition.
        //
        // The first version took the corner of the weapon's bounding box
        // furthest from its owner, which is right for a straight sword and
        // wrong for anything long or curved: on Nyx's scythe it picked the butt
        // of the haft trailing behind her, and reported a reach of MINUS 44
        // with the two tips 93 units apart. The pose was fine; the ruler was
        // measuring the wrong end.
        //
        // Vertices rather than a bounding box, because a box is axis-aligned in
        // world space and a swung weapon is not: its corners are not on the
        // weapon at all.
        const tipOf = (f) => {
            let w = f.mesh.userData.weapon;
            if (Array.isArray(w)) w = w[0];
            if (!w) return null;
            f.mesh.updateWorldMatrix(true, true);
            w.updateWorldMatrix(true, false);
            const toProp = new THREE.Matrix4().copy(w.matrixWorld).invert();
            const m = new THREE.Matrix4(), v = new THREE.Vector3();
            let best = null, bestX = -Infinity;
            w.traverse(o => {
                const g = o.geometry;
                if (!g || !g.attributes || !g.attributes.position) return;
                o.updateWorldMatrix(true, false);
                m.multiplyMatrices(toProp, o.matrixWorld);
                const pos = g.attributes.position;
                for (let i = 0; i < pos.count; i++) {
                    v.fromBufferAttribute(pos, i).applyMatrix4(m);
                    if (v.x > bestX) { bestX = v.x; best = v.clone(); }
                }
            });
            return best ? best.applyMatrix4(w.matrixWorld) : null;
        };
        // Solve along q, the axis the two of them are separated on. Each tip
        // sits some distance along that axis from its owner's centre; the gap
        // between the tips is what is left of the spacing once both of those
        // are taken out, so the spacing that leaves CLASH_GAP between them
        // follows directly. One step, no searching - moving a fighter
        // translates its pose without changing it.
        const CLASH_GAP = 5.5;          // "blade stops 20cm short" - the design canvas
        const qw = new THREE.Vector3(D.worldX(qx) - D.worldX(0), 0, D.worldZ(qy) - D.worldZ(0)).normalize();
        // AIM EACH FIGHTER BY ITS WEAPON, not by its chest.
        //
        // This is the thing that kept the two blades from ever meeting, and it
        // is not a spacing problem. Kaelen's basic is a horizontal cleave with
        // a 60-degree body twist and Nyx's is the mirror of it, so at the hold
        // each blade is sweeping ACROSS its owner's front - roughly
        // perpendicular to the line joining them. Stood face to face they swing
        // PAST each other: measured, the bodies were 48 apart and the tips 82.9
        // apart, which is the geometry saying plainly that the weapons point
        // somewhere other than at the opponent.
        //
        // So turn each fighter until the direction from its centre to its own
        // tip points at the other one. The rotation is rigid in the ground
        // plane, so re-posing after it moves the tip by the same rotation - one
        // correction converges, and a second pass takes out what the re-pose
        // changes. Their chests end up angled away from each other, which is
        // what two people who have swung through each other actually look like.
        const aimByWeapon = () => {
            for (const [f, other] of [[a, b], [b, a]]) {
                const c = f.mesh.getWorldPosition(new THREE.Vector3());
                const tip = tipOf(f);
                if (!tip) continue;
                const have = new THREE.Vector3(tip.x - c.x, 0, tip.z - c.z);
                const oc = other.mesh.getWorldPosition(new THREE.Vector3());
                const want = new THREE.Vector3(oc.x - c.x, 0, oc.z - c.z);
                if (have.lengthSq() < 1e-6 || want.lengthSq() < 1e-6) continue;
                have.normalize(); want.normalize();
                // Signed angle about world +Y, applied to the 2D facing.
                const ang = Math.atan2(have.x * want.z - have.z * want.x,
                                       have.x * want.x + have.z * want.z);
                const cs = Math.cos(ang), sn = Math.sin(ang);
                const fx = f.fx, fy = f.fy;
                f.fx = fx * cs - fy * sn;
                f.fy = fx * sn + fy * cs;
            }
            a.render3D(null, 0); b.render3D(null, 0);
            D.animateWeapon(a); D.animateWeapon(b);
        };
        aimByWeapon();
        aimByWeapon();

        // SOLVE FROM WHERE THE TIPS ACTUALLY ARE, not from a "reach".
        //
        // The reach version projected each tip onto the axis between the two
        // fighters and kept disagreeing with the frame sweep - which projects
        // onto each fighter's OWN forward. Both were right about different
        // things: animateWeapon rotates the whole mesh by up to 65 degrees of
        // twist, so a weapon 30 units along its owner's forward is somewhere
        // else entirely along the axis between the bodies. Two rulers, two
        // answers, and the sign flipped often enough to refuse the solve.
        //
        // The tips are already in world space, so there is nothing to project.
        // Moving the pair apart by d moves the gap between the tips by exactly
        // d, so the correction is one subtraction and cannot disagree with
        // anything.
        const tipA = tipOf(a), tipB = tipOf(b);
        let solved = null;
        if (tipA && tipB) {
            const have = NEAR_A + NEAR_B;
            const gapNow = tipB.clone().sub(tipA).dot(qw);
            const want = have + (CLASH_GAP - gapNow);
            const BODY = 40, MAX_APART = 150;
            const target = Math.max(BODY, Math.min(MAX_APART, want));
            const k = target / have;
            NEAR_A *= k; NEAR_B *= k;
            a.x = stageX - qx * NEAR_A; a.y = stageY - qy * NEAR_A;
            b.x = stageX + qx * NEAR_B; b.y = stageY + qy * NEAR_B;
            a.render3D(null, 0); b.render3D(null, 0);
            D.animateWeapon(a); D.animateWeapon(b);
            solved = { gapBefore: +gapNow.toFixed(1), was: +have.toFixed(1),
                       now: +(NEAR_A + NEAR_B).toFixed(1),
                       clamped: want !== target, usable: true };
        }
        const t2 = { a: tipOf(a), b: tipOf(b) };
        // CONFIRM THE HEIGHT MODEL, because the art direction says in its own
        // words that it is a model: it reads `fwd` as the arm's pitch and
        // predicts a tip height of shoulder - 21*cos(fwd), back-solved from the
        // one measured gap it had. That reproduces 20.9 for Kaelen x Gorgonok,
        // which is why it is worth trusting - and exactly why it is worth
        // checking against a second pair before a whole image is built on it.
        //
        // Measured here as tip height RELATIVE TO THE SHOULDER, which is what
        // the model predicts, rather than absolute height, which also carries
        // how tall the character happens to be.
        const tipDrop = (f) => {
            const arms = D.armsOf ? D.armsOf(f) : [];
            const arm = (arms || []).find(x => x && x.pivot && x.hand);
            const tip = tipOf(f);
            if (!arm || !tip) return null;
            f.mesh.updateWorldMatrix(true, true);
            const sh = new THREE.Vector3().setFromMatrixPosition(arm.pivot.matrixWorld);
            return +(tip.y - sh.y).toFixed(2);
        };
        window.__tableauHeights = {
            a: { name: a.name, dropFromShoulder: tipDrop(a) },
            b: { name: b.name, dropFromShoulder: tipDrop(b) },
            tipAy: t2.a ? +t2.a.y.toFixed(2) : null,
            tipBy: t2.b ? +t2.b.y.toFixed(2) : null,
            verticalGap: (t2.a && t2.b) ? +Math.abs(t2.a.y - t2.b.y).toFixed(2) : null,
        };
        // THE WHOLE ATTACK, FRAME BY FRAME - which is what the art direction
        // actually asked for ("log the weapon-tip positions per frame to
        // confirm") and what a single-frame measurement cannot give.
        //
        // One frame told me the tips sit 1.8 units apart vertically, which is
        // the good news, and that Nyx's reach was MINUS 41: at the frame I had
        // chosen her scythe points away from Kaelen, so no spacing could ever
        // make those two weapons meet. Whether some OTHER frame puts it on his
        // side is not a thing to reason about - it is a table.
        //
        // Recorded per fighter in ITS OWN terms: how far the tip has travelled
        // along that fighter's forward axis (positive is toward the opponent)
        // and how far below its shoulder the tip sits.
        window.__sweep = (who, kind) => {
            const f = who === 'a' ? a : b, o = who === 'a' ? b : a;
            const fd = FD[f.name][kind];
            const total = fd.startup + fd.active + fd.recovery;
            f.invulnFrames = o.invulnFrames = 9999;
            // CLEAR EVERY GATE tryStartAction CHECKS, not just the state.
            //
            // It refuses outright if `attackCooldown > 0` - and by the time
            // this runs both fighters have just completed an attack, so the
            // cooldown is live and the call returns false without a word. The
            // first two sweeps recorded `idle` for all 21 frames and were
            // faithfully reporting a fighter that never swung.
            f.atkState = 'idle'; f.atkKind = null; f.atkStateTimer = 0;
            f.attackCooldown = 0; f.hitstunTimer = 0; f.rootedFrames = 0;
            f.z = 0; f.vz = 0;              // stand it on the floor, not mid-fall
            if (!f.tryStartAction(kind, o)) {
                return [{ f: 0, st: 'REFUSED', along: null, drop: null, y: null }];
            }
            const rows = [];
            for (let i = 1; i <= total; i++) {
                f.update(o, 1); f.render3D(null, 1);
                D.animateWeapon(f);
                f.mesh.updateWorldMatrix(true, true);
                const tip = tipOf(f);
                if (!tip) continue;
                const fwd = new THREE.Vector3(1, 0, 0)
                    .transformDirection(f.mesh.matrixWorld).normalize();
                const c = f.mesh.getWorldPosition(new THREE.Vector3());
                const arms = D.armsOf ? D.armsOf(f) : [];
                const arm = (arms || []).find(x => x && x.pivot && x.hand);
                const sh = arm ? new THREE.Vector3()
                    .setFromMatrixPosition(arm.pivot.matrixWorld) : null;
                rows.push({
                    f: i, st: f.atkState,
                    along: +tip.clone().sub(c).dot(fwd).toFixed(1),
                    drop: sh ? +(tip.y - sh.y).toFixed(1) : null,
                    y: +tip.y.toFixed(1),
                });
            }
            f.invulnFrames = o.invulnFrames = 0;
            return rows;
        };
        // RUN IT HERE, inside the block that still owns the stage.
        //
        // Called from Node after this evaluate returned, every frame came back
        // `idle` with Nyx's tip at y -27, under the floor: by then the game
        // loop had been running for seconds, the round had moved on and both
        // fighters had fallen off the staging ledge. tryStartAction on a
        // fighter the match is no longer holding does nothing, and the table
        // faithfully recorded that nothing.
        window.__sweepData = {};
        if (window.__wantSweep) {
            for (const who of ['a', 'b']) {
                const f = who === 'a' ? a : b, o = who === 'a' ? b : a;
                // Put it back exactly where the pose work had it, each time.
                const nx = who === 'a' ? -NEAR_A : NEAR_B;
                f.x = stageX + qx * nx; f.y = stageY + qy * nx;
                f.vx = f.vy = f.vz = 0;
                f.fx = who === 'a' ? qx : -qx;
                f.fy = who === 'a' ? qy : -qy;
                window.__sweepData[who] = window.__sweep(who, 'basic');
            }
        }
        window.__tableauTips = Object.assign({ gap: (t2.a && t2.b)
            ? +t2.a.distanceTo(t2.b).toFixed(2) : null }, solved || {});

        // THE CAMERA IS AIMED AT THE CLASH, NOT AT THE MIDPOINT OF TWO BODIES.
        //
        // Everything here comes from the art direction, and the governing idea
        // is that the contact is sold by OVERLAP IN FRAME rather than by
        // distance: the on-screen gap between the two weapon tips is the real
        // gap times the sine of the angle off the fighters' axis. At 28 degrees
        // a 5.5-unit gap projects to roughly 38px on a 1920 frame - the tips
        // nearly kiss - while the bodies stay far enough apart to read as two
        // people. Below about 15 degrees the near body eclipses the far one;
        // above 45 the gap reads at its full size and the illusion is gone.
        //
        // This also settles the one place the original brief fought itself:
        // "profile-to-camera" IS 90 degrees, which shows the whole gap. The
        // over-shoulder half of that brief is the half that works.
        const uw = new THREE.Vector3(D.worldX(ux) - D.worldX(0), 0,
                                     D.worldZ(uy) - D.worldZ(0)).normalize();
        // C: the clash point itself, the midpoint of the two solved tips.
        const tA = tipOf(a), tB = tipOf(b);
        const C = (tA && tB) ? tA.clone().add(tB).multiplyScalar(0.5)
                             : new THREE.Vector3(D.worldX(mx), 30, D.worldZ(my));
        // 106 back along the fighter axis and 56 across is 120 units out at
        // 27.8 degrees - the two numbers the direction gives, which agree.
        const rad = ANGLE * Math.PI / 180;
        const BACK = DIST * Math.cos(rad), LATERAL = DIST * Math.sin(rad), CAM_Y = 12;
        const cam = new THREE.PerspectiveCamera(34, w / h, 1, 6000);
        cam.layers.enableAll();
        // NOT the viewmodel layers. Those hold the first-person arm, which is
        // parented to the play camera and belongs in nobody else's shot - it
        // turned up across the bottom of the frame on the first pass.
        for (const L of [3, 4]) cam.layers.disable(L);
        // qw runs from the NEAR fighter to the far one, so -qw is behind the
        // near one's shoulder. Which side is a parameter because it has to be:
        // if the near fighter's weapon is in the hand nearest the camera, his
        // own torso covers it, and that is only visible in a render.
        cam.position.copy(C)
            .addScaledVector(qw, -BACK)
            .addScaledVector(uw, LATERAL * SIDE);
        cam.position.y = CAM_Y;
        cam.lookAt(C);
        // Shifts the principal point WITHOUT changing the angle, so the clash
        // lands at pixel (1100, 520) - 57% across, 48% down - and the left 40%
        // of the frame is left to the title over open sky rather than floor.
        cam.setViewOffset(w, h, -140, 20, w, h);

        // The P1/P2 name sprites are scene objects, not HUD - fine in a match
        // and wrong in a poster.
        // The P1/P2 name sprites and the dash-cooldown rings are scene objects,
        // not HUD: right in a match, wrong in a poster.
        // THE WHOLE SCENE, not just the two fighters. Traversing only a.mesh
        // and b.mesh is why a white cooldown arc and a hexagonal footprint were
        // still lying on the floor of the last render: whatever draws them is
        // not parented to the fighter it belongs to.
        //
        // Ground shadows and weapon glow are deliberately KEPT - they are what
        // sits the pair on the floor and what makes the contact point read as
        // hot - so this only removes sprites and flat ring/torus markers.
        const hidden = [];
        D.scene.traverse(o => {
            if (!o.visible) return;
            const ring = o.geometry && /Torus|Ring/.test(o.geometry.type);
            if (o.isSprite || ring) { o.visible = false; hidden.push(o); }
        });

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
    }, [W, HGT, SIDE, FRAME_A, FRAME_B, DIST, ANGLE]);

    const pose = await page.evaluate(() => window.__tableauPose);
    console.log('pose:', JSON.stringify(pose));
    // DID THEY ACTUALLY MEET - measured between the two weapon tips, which is
    // the thing the image is of. The previous version of this line held the sum
    // of the two hand DISPLACEMENTS against the centre-to-centre DISTANCE and
    // so reported "SHORT" at every spacing that exists; it is replaced rather
    // than tuned. Printed, not asserted, because this script makes art for a
    // person to look at - but a tip gap of 40 units is not a clash whatever the
    // thumbnail suggests.
    // SWEEP=1 prints the frame tables and writes no image. The question
    // "which frame puts both weapons on the side where the other fighter is"
    // is answered by a table, and a table costs one run instead of one run per
    // guess.
    if (process.env.SWEEP) {
        for (const [who, name] of [['a', A], ['b', B]]) {
            const rows = await page.evaluate((w) => window.__sweepData[w] || [], who);
            console.log('');
            console.log('%s - basic   (along = toward the opponent, drop = below the shoulder)', name);
            console.log('  frame  state     along    drop     y');
            for (const r of rows) {
                console.log('  %s  %s  %s  %s  %s',
                    String(r.f).padStart(5), String(r.st).padEnd(8),
                    String(r.along).padStart(7), String(r.drop).padStart(6),
                    String(r.y).padStart(6));
            }
        }
        await browser.close();
        process.exit(0);
    }

    const heights = await page.evaluate(() => window.__tableauHeights);
    if (heights) {
        console.log('tip height below shoulder: %s %s   %s %s   (model predicted'
            + ' -12.0 and -10.5 for Kaelen/Nyx)',
            heights.a.name, heights.a.dropFromShoulder,
            heights.b.name, heights.b.dropFromShoulder);
        console.log('vertical separation of the two tips: ' + heights.verticalGap
            + ' units  (it was ~21, almost all vertical, for Kaelen x Gorgonok)');
    }
    const tips = await page.evaluate(() => window.__tableauTips);
    if (tips) {
        console.log('spacing: tips were ' + tips.gapBefore + ' apart; solved ' + tips.was + ' -> ' + tips.now + (tips.usable ? '' : '  (reach unusable - spacing left alone)')
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
