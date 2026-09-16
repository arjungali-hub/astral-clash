// Batch 37: a movement special has to LOOK like travel to the player using it.
//
// Batch 34 added a visual lag offset and a motion streak and applied both to
// the fighter's MESH - which in first person is the one thing you never see.
// The camera kept reading the raw simulation position, so the world still
// jumped in a single frame and the smear was visible only to the opponent.
// These assertions are about the CAMERA, because that is what the player looks
// through.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true });

    await page.evaluate(() => {
        const D = window.ACDebug;
        D.netSetTimeout(900000);
        D.goHome();
        D.netFakeConnect('host');
        D.previewPick('p1', 'Kaelen'); D.confirmPick('p1');
        D.netFeed({ t: 'PICK', side: 'p2', name: 'Lyra', stage: 'confirmed' });
        D.selectedMap = D.MAPS[0].name;
        D.startOnline();
    });
    await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    await H.sleep(800);

    section('A dash moves the simulation instantly - that must not change:');
    const sim = await page.evaluate(() => {
        const D = window.ACDebug;
        const f = D.player1;
        f.visOffX = 0; f.visOffY = 0;
        f.dodgeCooldown = 0;
        const before = { x: f.x, y: f.y };
        f.teleportTo(70, 0);
        return {
            before, after: { x: f.x, y: f.y },
            moved: Math.hypot(f.x - before.x, f.y - before.y),
            offset: Math.hypot(f.visOffX, f.visOffY),
        };
    });
    check('the fighter arrives in one step', sim.moved > 30, JSON.stringify(sim));
    check('and a visual offset was created to lag the VIEW behind it',
        sim.offset > 20, JSON.stringify(sim));

    section('The camera travels rather than cutting:');
    // ---------------------------------------------------------------------
    // MEASURED FRAMERATE-INDEPENDENTLY, deliberately.
    //
    // The first version of this section sampled the camera per animation frame
    // and required that no single frame cover half the distance. That assertion
    // fails in the harness for a reason that is not a bug: `dt` is REAL ELAPSED
    // TIME in frame-units, clamped to 3, and this page runs at ~20fps under
    // software WebGL - so one rendered frame here is three frame-units, and
    // 0.82^3 = 0.55 of the offset goes in a single sample. On a 60fps machine
    // the same code takes ~18 frames. The smear is correct; the measurement was
    // tied to the harness's framerate.
    //
    // So: assert the two things that do not depend on it.
    section('The camera lags the simulation the instant you teleport:');
    const lag = await page.evaluate(() => {
        const D = window.ACDebug;
        const f = D.player1;
        f.visOffX = 0; f.visOffY = 0;
        const c = D.localCamera();
        // Position it ONCE first. Earlier sections left the camera wherever the
        // render loop last put it, which is not necessarily this fighter's
        // current position - measuring from a stale camera reported 38 units of
        // "movement" that was really it catching up, not the teleport.
        D.positionFpsCamera(c, f, 1);
        const before = { x: c.position.x, z: c.position.z };
        f.teleportTo(90, 0);
        // Position the camera by hand, with no frame in between, so this is
        // purely "where would the view be on the very next draw".
        D.positionFpsCamera(c, f, 1);
        const after = { x: c.position.x, z: c.position.z };
        const simX = D.worldX(f.x + f.width / 2);
        return {
            camMoved: Math.hypot(after.x - before.x, after.z - before.z),
            camToSim: Math.abs(after.x - simX),
            offset: Math.hypot(f.visOffX, f.visOffY),
        };
    });
    check('the camera barely moves on the teleport frame', lag.camMoved < 12, JSON.stringify(lag));
    check('because it is held back near where the fighter came from',
        lag.camToSim > 60, JSON.stringify(lag));

    section('The ramp is long enough to read as motion:');
    const ramp = await page.evaluate(() => {
        const D = window.ACDebug;
        const decay = D.TELEPORT_VIS_DECAY;
        // Frame-units for a 90-unit offset to fall under the 0.35 snap floor.
        const frames = Math.log(0.35 / 90) / Math.log(decay);
        return { decay, frames, ms: (frames / 60) * 1000 };
    });
    check('the decay constant gives a multi-frame ramp, not a cut',
        ramp.frames >= 12, JSON.stringify(ramp));
    check('which is roughly a fifth to half a second at 60fps',
        ramp.ms >= 180 && ramp.ms <= 600, JSON.stringify(ramp));

    section('And it always finishes - the view never trails permanently:');
    const settled = await page.evaluate(() => new Promise(resolve => {
        const D = window.ACDebug;
        const f = D.player1;
        f.visOffX = 0; f.visOffY = 0;
        f.teleportTo(90, 0);
        let n = 0;
        const tick = () => {
            if (++n < 30 && (f.visOffX || f.visOffY)) { requestAnimationFrame(tick); return; }
            const c = D.localCamera();
            resolve({
                frames: n,
                offset: Math.hypot(f.visOffX, f.visOffY),
                camToSim: Math.abs(c.position.x - D.worldX(f.x + f.width / 2)),
            });
        };
        requestAnimationFrame(tick);
    }));
    check('the offset reaches zero', settled.offset === 0, JSON.stringify(settled));
    check('and the camera ends on the simulation position',
        settled.camToSim < 2, JSON.stringify(settled));

    // Batch 47 REVERSED this assertion, deliberately. It used to require that a
    // sub-26-unit shove got NO smear at all, which is what "knockbacks... snap
    // you into a spot" was describing. A shove slides now; what keeps it from
    // feeling mushy is that it catches up in a few frames instead of the ~300ms
    // a dash gets.
    section('A small shove slides too - it just catches up fast:');
    const nudge = await page.evaluate(() => {
        const D = window.ACDebug;
        const f = D.player1;
        // A SPAWN POINT, not the arena centre: this map has a platform dead
        // centre (Voltaic Nexus), so teleportTo was silently eaten by the
        // collision test and every assertion here read zero.
        f.x = D.matchMap.spawn1.x; f.y = D.matchMap.spawn1.y;
        f.visOffX = 0; f.visOffY = 0;
        const before = f.x;
        f.teleportTo(8, 0);
        const moved = f.x - before;
        const start = Math.hypot(f.visOffX, f.visOffY);
        // Step the decay by hand, one frame at a time, and count.
        let frames = 0;
        while ((f.visOffX || f.visOffY) && frames < 60) { f.decayVisualOffset(1); frames++; }
        return { moved: +moved.toFixed(2), start: +start.toFixed(2), frames,
                 min: D.TELEPORT_VIS_MIN };
    });
    const dash = await page.evaluate(() => {
        const D = window.ACDebug;
        const f = D.player1;
        f.x = D.matchMap.spawn1.x; f.y = D.matchMap.spawn1.y;
        f.visOffX = 0; f.visOffY = 0;
        f.teleportTo(70, 0);
        const start = Math.hypot(f.visOffX, f.visOffY);
        let frames = 0;
        while ((f.visOffX || f.visOffY) && frames < 120) { f.decayVisualOffset(1); frames++; }
        return { start: +start.toFixed(2), frames };
    });
    check('the shove actually moved the fighter', nudge.moved > 7, JSON.stringify(nudge));
    check('and it IS drawn as travel rather than a snap',
        nudge.start > 5, JSON.stringify(nudge));
    check('it catches up quickly - a shove is impact, not lag',
        nudge.frames > 0 && nudge.frames <= 9, JSON.stringify(nudge));
    check('while a full dash is allowed to take longer',
        dash.frames > nudge.frames, JSON.stringify({ nudge: nudge.frames, dash: dash.frames }));

    section('The streak that sells the travel is spawned:');
    const streak = await page.evaluate(() => {
        const D = window.ACDebug;
        const f = D.player1;
        f.effects.length = 0;
        f.teleportTo(0, 90);
        return { streaks: f.effects.filter(e => e.type === 'streak').length };
    });
    check('a motion streak is pushed along the path', streak.streaks >= 1, JSON.stringify(streak));

    await finish(browser, page);
})();
