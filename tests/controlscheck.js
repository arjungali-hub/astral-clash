// Batch 31 checker: one local player, strafe instead of turn, mouse look,
// left-click attack, a single full-screen view, and no touch support.
//
// Every assertion here is about a behaviour change a "nothing threw" check
// would sail straight past: A/D used to TURN the fighter, there was no mouse
// input in the game at all, and the renderer drew the scene twice into two
// scissored halves.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    const page = await H.newPage(browser);
    const { check, section, finish } = H.makeChecker();
    await H.boot(page, { clearStorage: true, models: true });

    section('Bindings are a single local set, mouse-first:');
    const b = await page.evaluate(() => {
        const D = window.ACDebug;
        return {
            actions: Object.keys(D.DEFAULT_BINDINGS),
            attack: D.DEFAULT_BINDINGS.attack,
            special: D.DEFAULT_BINDINGS.special,
            jump: D.DEFAULT_BINDINGS.jump,
            dodge: D.DEFAULT_BINDINGS.dodge,
            arrows: D.ARROW_ALTS,
            perSide: !!(D.BINDINGS.p1 || D.BINDINGS.p2),
            localSide: D.LOCAL_SIDE,
        };
    });
    check('no per-side binding sets remain', b.perSide === false, b.actions.join(','));
    check('strafe actions replaced the turn actions',
        b.actions.includes('strafeLeft') && b.actions.includes('strafeRight')
        && !b.actions.includes('left') && !b.actions.includes('right'), b.actions.join(','));
    check('attack is left click', b.attack === 'mouse0', b.attack);
    check('special is right click', b.special === 'mouse2', b.special);
    check('jump is Space', b.jump === ' ', JSON.stringify(b.jump));
    check('dash is Shift', b.dodge === 'shift', b.dodge);
    check('arrow keys alternate for all four move actions',
        ['forward', 'back', 'strafeLeft', 'strafeRight'].every(a => b.arrows[a]),
        JSON.stringify(b.arrows));
    check('this client starts as p1', b.localSide === 'p1', b.localSide);

    // A bot opponent, so there is something to fight. Bot mode is sandbox-gated.
    await page.evaluate(() => {
        window.ACDebug.setDebugUnlockAll(true);
        document.getElementById('btn-toggle-bot').click();   // p2 = bot
    });
    await H.sleep(300);
    await page.evaluate(() => {
        document.querySelectorAll('#p1-grid .fighter-btn')[0].click();
        document.querySelector('#p1-detail .btn-confirm').click();
    });
    await H.sleep(400);
    await page.evaluate(() => document.querySelectorAll('#mapselect-grid .map-card')[0].click());
    await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 40000);
    await H.sleep(600);
    // Stand the opponent down. It was enabled only so the match would start
    // with two fighters; an ACTIVE bot lands hits mid-measurement, which puts
    // the subject in hitstun and zeroes its movement - that is what made the
    // forward-movement sample read dx=0.
    await page.evaluate(() => { window.ACDebug.player2.isBot = false; });
    await H.sleep(200);

    section('One full-screen view, not two scissored halves:');
    const view = await page.evaluate(() => {
        const D = window.ACDebug;
        return {
            hudViewports: D.hudViewports().length,
            localCamIsP1: D.localCamera() === D.camP1,
            localIsPlayer1: D.localFighter() === D.player1,
            remoteIsPlayer2: D.remoteFighter() === D.player2,
        };
    });
    check('the HUD projects into a single viewport', view.hudViewports === 1, String(view.hudViewports));
    check('local camera and fighter resolve to p1',
        view.localCamIsP1 && view.localIsPlayer1 && view.remoteIsPlayer2, JSON.stringify(view));

    // Both movement tests sweep FOUR facings rather than one fixed direction.
    // A single direction depends on that heading happening to be clear of map
    // geometry: an earlier version faced +x at the arena centre, walked into a
    // column and measured dx=0, which looked like "forward is broken" when it
    // was really "forward is blocked". Sweeping and requiring that motion is
    // always PARALLEL (or always PERPENDICULAR) to the facing tests the actual
    // claim, and tolerates any one heading being obstructed.
    async function sweep(page, action) {
        return page.evaluate(async (act) => {
            const D = window.ACDebug, f = D.player1;
            const step = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            const facings = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            const out = [];
            for (const [fx, fy] of facings) {
                f.x = D.ARENA_CX; f.y = D.ARENA_CY; f.z = 0;
                f.fx = fx; f.fy = fy; f.vx = 0; f.vy = 0;
                f.hitstunTimer = 0; f.rootedFrames = 0; f.atkState = 'idle';
                await step();
                const x0 = f.x, y0 = f.y, yaw0 = Math.atan2(f.fy, f.fx);
                D.keys[D.BINDINGS[act]] = true;
                for (let i = 0; i < 10; i++) {
                    f.hitstunTimer = 0; f.rootedFrames = 0;   // keep it un-stunned
                    await step();
                }
                D.keys[D.BINDINGS[act]] = false;
                const dx = f.x - x0, dy = f.y - y0;
                const dist = Math.hypot(dx, dy);
                // Component of the displacement along the facing, and across it.
                const along = dist > 0.001 ? (dx * fx + dy * fy) / dist : 0;
                const across = dist > 0.001 ? (dx * fy - dy * fx) / dist : 0;
                out.push({ facing: [fx, fy], dist: +dist.toFixed(2),
                           along: +along.toFixed(3), across: +across.toFixed(3),
                           yawDelta: +(Math.atan2(f.fy, f.fx) - yaw0).toFixed(4) });
            }
            return out;
        }, action);
    }

    section('A/D strafe sideways instead of turning:');
    const strafe = await sweep(page, 'strafeRight');
    const strafeMoved = strafe.filter(r => r.dist > 2);
    check('strafing produces movement in most directions', strafeMoved.length >= 2,
        JSON.stringify(strafe));
    check('strafing never rotates the fighter',
        strafe.every(r => Math.abs(r.yawDelta) < 0.001),
        strafe.map(r => r.yawDelta).join(','));
    // The whole point of the change: A/D used to turn, and now must translate
    // ACROSS the facing rather than along it.
    check('strafe displacement is perpendicular to the facing',
        strafeMoved.every(r => Math.abs(r.across) > 0.9 && Math.abs(r.along) < 0.3),
        JSON.stringify(strafeMoved));

    section('Forward still moves along the facing:');
    const fwd = await sweep(page, 'forward');
    const fwdMoved = fwd.filter(r => r.dist > 2);
    check('forward produces movement in most directions', fwdMoved.length >= 2,
        JSON.stringify(fwd));
    check('forward displacement is parallel to the facing',
        fwdMoved.every(r => r.along > 0.9 && Math.abs(r.across) < 0.3),
        JSON.stringify(fwdMoved));

    section('Mouse look drives yaw and pitch:');
    const look = await page.evaluate(async () => {
        const D = window.ACDebug, f = D.player1;
        const step = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        f.fx = 1; f.fy = 0; f.pitch = 0;
        await step();
        const yaw0 = Math.atan2(f.fy, f.fx);
        D.injectMouseLook(200, 0);            // mouse right
        await step();
        const yawRight = Math.atan2(f.fy, f.fx);
        D.injectMouseLook(-400, 0);           // back left, twice as far
        await step();
        const yawLeft = Math.atan2(f.fy, f.fx);
        const pitch0 = f.pitch;
        D.injectMouseLook(0, -150);           // mouse up
        await step();
        const pitchUp = f.pitch;
        for (let i = 0; i < 12; i++) { D.injectMouseLook(0, -400); await step(); }  // past the clamp
        return { yaw0, yawRight, yawLeft, pitch0, pitchUp, pitchMax: f.pitch, limit: D.PITCH_LIMIT };
    });
    check('moving the mouse right turns right', look.yawRight > look.yaw0,
        `${look.yaw0.toFixed(3)} -> ${look.yawRight.toFixed(3)}`);
    check('moving it back left turns past the start', look.yawLeft < look.yaw0,
        `${look.yawRight.toFixed(3)} -> ${look.yawLeft.toFixed(3)}`);
    check('moving the mouse up raises the aim', look.pitchUp > look.pitch0,
        `${look.pitch0.toFixed(3)} -> ${look.pitchUp.toFixed(3)}`);
    check('pitch stays clamped to PITCH_LIMIT', look.pitchMax <= look.limit + 1e-6,
        `${look.pitchMax.toFixed(4)} vs limit ${look.limit.toFixed(4)}`);

    section('Mouse buttons act through the normal input path:');
    const click = await page.evaluate(async () => {
        const D = window.ACDebug, f = D.player1;
        const step = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        f.atkState = 'idle'; f.attackCooldown = 0; f.hitstunTimer = 0;
        await step();
        f.hitstunTimer = 0; f.rootedFrames = 0;
        const before = f.atkState;
        // A real event, so the listener and consumePress both run.
        window.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
        const keyHeld = D.keys['mouse0'] === true;
        // Poll: at ~3fps dt is clamped to 3 frame-units, so a single sample can
        // land before the action starts or after it has already finished.
        let after = 'idle';
        for (let i = 0; i < 8 && after === 'idle'; i++) { await step(); after = f.atkState; }
        window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
        await step();
        return { before, after, keyHeld, released: D.keys['mouse0'] };
    });
    check('mousedown registers as a held key named mouse0', click.keyHeld === true);
    check('left click starts an attack', click.before === 'idle' && click.after !== 'idle',
        `${click.before} -> ${click.after}`);
    check('mouseup releases it', click.released === false, String(click.released));

    section('Touch/mobile support is gone:');
    const touch = await page.evaluate(() => ({
        controls: !!document.getElementById('touch-controls'),
        orientation: !!document.getElementById('orientation-prompt'),
        warning: !!document.getElementById('touch-warning'),
        pauseBtn: !!document.getElementById('touch-pause-btn'),
        debugTouch: 'touchTurn' in window.ACDebug,
    }));
    check('no touch DOM remains',
        !touch.controls && !touch.orientation && !touch.warning && !touch.pauseBtn,
        JSON.stringify(touch));
    check('no touch state is exported', touch.debugTouch === false);

    await page.evaluate(() => { window.ACDebug.setDebugUnlockAll(false); localStorage.clear(); });
    await finish(browser, page);
})();
