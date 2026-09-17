// An attack has to move the hand FORWARD, for every character.
//
// Reported twice - "gorgonok's fist swings behind him", then "gorgonok's attack
// still swings behind him" after the re-rig - and both times the fix was
// believed and not measured. This measures it: drive a real attack, then
// project (hand - shoulder) onto the fighter's own forward vector. Positive is
// in front of them. No screenshot can answer that as cleanly, because a fist
// moving away from the camera and a fist moving behind the body look similar in
// a 90-pixel corner of a frame.
//
// It also covers the second half of the same bug: Ignis' jab, whose animation
// bypassed the axis-aware helper entirely and came out as a sideways twitch
// ("a snap that doesn't have a smooth animation"). A snap is asserted against
// directly - the hand must pass through INTERMEDIATE positions, not jump.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true });

    // Every melee attack type on the roster, so a fix for one cannot break
    // another: hammer, punch (both the heavy and the flurry), scythe, whip.
    for (const who of ['Gorgonok', 'Ignis', 'Draven', 'Nyx', 'Thorne']) {
        await H.boot(page);
        await page.evaluate((name) => {
            const D = window.ACDebug;
            // Most of these cost coins, and clicking a LOCKED card opens the
            // shop instead of the detail panel - which is correct behaviour and
            // made the first run of this file crash on a null Confirm button.
            // The sandbox still works offline (see sandboxActive).
            D.setDebugUnlockAll(true);
            D.setMatchMode('classic');
            const pick = (grid, detail, n) => {
                const cards = Array.from(document.querySelectorAll(grid + ' .fighter-btn'));
                (cards.find(c => c.textContent.includes(n)) || cards[0]).click();
                document.querySelector(detail + ' .btn-confirm').click();
            };
            pick('#p1-grid', '#p1-detail', name);
            pick('#p2-grid', '#p2-detail', 'Lyra');
        }, who);
        await H.sleep(350);
        await page.evaluate(() => document.querySelectorAll('#mapselect-grid .map-card')[0].click());
        const live = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 70000);
        if (!live) { check(`${who}: reached a fight`, false, 'never left the menu'); continue; }
        await H.sleep(600);

        const r = await page.evaluate((name) => {
            const D = window.ACDebug, f = D.player1;
            // Face a known direction and stand still, so "forward" is not
            // whatever the AI was doing when the sample was taken.
            f.fx = 1; f.fy = 0; f.vx = 0; f.vy = 0;
            const arms = D.armsOf(f);
            const arm = arms.find(a => a && a.pivot && a.hand);
            if (!arm) return { noArm: true, rigged: !!f.mesh.userData.rigged };
            // FORWARD IS RECOMPUTED EVERY SAMPLE, and the first version of
            // this file did not - which made it accuse Nyx of swinging
            // backwards. Her animation twists the whole body 65 degrees
            // (twistDeg: -65) mid-swing, so a forward vector captured before
            // the attack is measuring against a body that has since turned.
            // Her actual swing is a clean 9 back then 12 forward.
            const reach = () => {
                f.mesh.updateWorldMatrix(true, true);
                const fwd = new THREE.Vector3(1, 0, 0).transformDirection(f.mesh.matrixWorld).normalize();
                const sh = new THREE.Vector3().setFromMatrixPosition(arm.pivot.matrixWorld);
                const hd = new THREE.Vector3().setFromMatrixPosition(arm.hand.matrixWorld);
                return +hd.sub(sh).dot(fwd).toFixed(2);
            };
            const rest = reach();
            // Drive the REAL action pipeline, then sample every frame of it.
            D.debugForceAttack ? D.debugForceAttack(f) : f.tryStartAction('attack');
            // THE WHOLE ACTION, not a fixed 40 frames. Gorgonok's basic is
            // startup 16 + active 6 + recovery 24 = 46, so a 40-frame window
            // cut the last six frames off - and once the contact pose started
            // holding into recovery, those were the frames where the arm came
            // back through the middle of its arc. The check then reported a
            // snap for a motion it had simply stopped watching.
            const fdb = FRAME_DATA[f.name].basic;
            const total = fdb.startup + fdb.active + fdb.recovery + 4;
            const samples = [];
            for (let i = 0; i < total; i++) {
                f.update(D.player2, 1);
                D.animateWeapon(f);
                samples.push(reach());
            }
            return { rest, samples, rigged: !!f.mesh.userData.rigged,
                     max: Math.max(...samples), min: Math.min(...samples),
                     active: FRAME_DATA[f.name].basic.active };
        }, who);

        section(`${who} (${r.rigged ? 'rigged' : 'procedural'}):`);
        if (r.noArm) { check(`${who}: has a weapon arm with a hand`, false, JSON.stringify(r)); continue; }
        // FORWARD, and by a real margin: at some moment during the swing the
        // hand must be well along the fighter's facing from where it started.
        check('the swing reaches FORWARD of where it rested',
            r.max > r.rest + 6, JSON.stringify({ rest: r.rest, max: r.max }));
        // The readability property that actually matters. A heavy attack is
        // SUPPOSED to wind up behind the body - Gorgonok hoists 95 degrees
        // overhead - so "never goes behind" would be wrong. What must hold is
        // that the strike travels further forward than the wind-up went back,
        // or the whole motion reads as a swing behind them, which is what was
        // reported.
        check('and reaches further forward than the wind-up went back',
            (r.max - r.rest) > (r.rest - r.min) * 0.8,
            JSON.stringify({ rest: r.rest, max: r.max, min: r.min,
                             forward: +(r.max - r.rest).toFixed(1),
                             back: +(r.rest - r.min).toFixed(1) }));
        // SMOOTH. A snap is two clusters with nothing between; a real swing
        // passes through the middle. Count distinct sampled positions in the
        // middle third of the travel.
        const span = r.max - r.min;
        const mid = r.samples.filter(v => v > r.min + span * 0.3 && v < r.min + span * 0.7);
        check('and passes through the middle of its travel rather than snapping',
            span < 1 || mid.length >= 3,
            JSON.stringify({ span: +span.toFixed(2), midSamples: mid.length,
                             all: r.samples.map(v => +v.toFixed(1)),
                             samples: r.samples.slice(0, 12) }));
    }

    await finish(browser, page);
})();
