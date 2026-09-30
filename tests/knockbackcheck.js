// Getting hit pushes you AWAY, by an amount that scales with the damage.
//
// WHY THIS EXISTS. The checklist claimed knockback was covered by the teleport
// sweep "insofar as knockback routes through the same displacement path". That
// is an argument, not a test: it says the plumbing is shared, and says nothing
// about whether the right vector goes into it. The direction could be inverted,
// or taken from the victim's facing instead of the attacker's, and every
// teleport assertion would still pass.
//
// WHAT THE CODE ACTUALLY DOES, so the test asserts the real contract:
//
//     const kb = Math.min(18, 4 + amount * 0.4);
//     const kdx = dir ? dir.dx : attacker.fx, kdy = dir ? dir.dy : attacker.fy;
//     this.teleportTo(kdx * kb, kdy * kb);
//
// Three claims, each checked separately: the direction is the ATTACKER's facing
// when no explicit direction is given, an explicit `dir` overrides it, and the
// distance scales with damage up to a hard cap of 18.
//
// SWEPT OVER FOUR FACINGS, for the reason controlscheck sweeps: a single
// heading can be blocked by arena geometry, and "it did not move" then reads as
// "knockback is broken" when it is really "knockback is obstructed".
// teleportTo resolves against pillars and platforms deliberately, so a test
// that does not sweep is testing the map as much as the code.
const H = require('./harness');

// Open ground in the first arena: clear of the four pillars at (660|1094,
// 300|674) and of the two terrain steps at y 210 and 764.
const CX = 877, CY = 487;

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);

    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));

    await H.boot(page, { clearStorage: true, path: '/local/index.html', models: true });
    await page.evaluate(() => window.ACDebug.setDebugUnlockAll(true));
    for (const side of ['p1', 'p2']) {
        await page.evaluate((s) => {
            const b = document.querySelector('#' + s + '-grid .fighter-btn');
            if (b) b.click();
            const c = document.querySelector('#' + s + '-detail .btn-confirm');
            if (c) c.click();
        }, side);
    }
    // Let the menu repaint before pressing Start - doing both in one tick is
    // what left mobilecheck and framerateccheck stuck on the select screen.
    await H.sleep(500);
    await page.evaluate(() => {
        const s = document.getElementById('btn-start-match');
        if (s) s.click();
    });
    await H.sleep(300);
    await page.evaluate(() => {
        const c = document.querySelectorAll('#mapselect-grid .map-card')[0];
        if (c) c.click();
    });
    const live = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    check('a match is running to be hit in', live, 'never reached FIGHT');
    if (!live) { await finish(browser, page); return; }

    // One hit per call, so no single CDP evaluate runs long enough to hit
    // puppeteer's protocol timeout on a software renderer.
    async function hit(fx, fy, amount, useDir) {
        return page.evaluate(async (fx, fy, amount, useDir, cx, cy) => {
            const D = window.ACDebug;
            const a = D.player1, v = D.player2;
            const step = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            a.x = cx - 60; a.y = cy; a.z = 0; a.vx = 0; a.vy = 0; a.vz = 0;
            a.fx = fx; a.fy = fy;
            v.x = cx; v.y = cy; v.z = 0; v.vx = 0; v.vy = 0; v.vz = 0;
            v.invulnFrames = 0; v.hitstunTimer = 0; v.hp = v.maxHp;
            await step();
            const x0 = v.x, y0 = v.y;
            // An explicit dir is deliberately the OPPOSITE of the facing, so a
            // pass cannot come from the code quietly ignoring the argument.
            v.takeDamage(amount, a, useDir ? { dx: -fx, dy: -fy } : undefined);
            for (let i = 0; i < 3; i++) await step();
            const dx = v.x - x0, dy = v.y - y0;
            const dist = Math.hypot(dx, dy);
            const wx = useDir ? -fx : fx, wy = useDir ? -fy : fy;
            return {
                dist: +dist.toFixed(2),
                // 1 means pushed exactly the way the hit pointed, -1 the reverse.
                along: dist > 0.01 ? +((dx * wx + dy * wy) / dist).toFixed(3) : 0,
            };
        }, fx, fy, amount, useDir, CX, CY);
    }

    const FACINGS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    section('A hit pushes the victim along the ATTACKER\'s facing:');
    const swept = [];
    for (const [fx, fy] of FACINGS) swept.push(await hit(fx, fy, 40, false));
    const moved = swept.filter(r => r.dist > 1);
    check('the victim is displaced, from most facings',
        moved.length >= 3, JSON.stringify(swept));
    check('and always AWAY from the attacker, never toward',
        moved.length >= 3 && moved.every(r => r.along > 0.9), JSON.stringify(swept));

    section('An explicit hit direction overrides the facing:');
    const dirSwept = [];
    for (const [fx, fy] of FACINGS) dirSwept.push(await hit(fx, fy, 40, true));
    const dirMoved = dirSwept.filter(r => r.dist > 1);
    check('a projectile\'s own direction is used, not the shooter\'s facing',
        dirMoved.length >= 3 && dirMoved.every(r => r.along > 0.9), JSON.stringify(dirSwept));

    section('Distance scales with damage, up to a cap:');
    // Along +x from open ground, so nothing obstructs the comparison.
    const light = await hit(1, 0, 10, false);
    const heavy = await hit(1, 0, 40, false);
    const huge = await hit(1, 0, 400, false);
    check('a heavier hit knocks further than a light one',
        heavy.dist > light.dist + 1, `${light.dist} -> ${heavy.dist}`);
    // kb = min(18, 4 + amount * 0.4): 400 damage would be 164 without the cap.
    check('and the cap holds - a huge hit does not launch you across the arena',
        huge.dist <= 22, `400 damage moved ${huge.dist}`);
    check('the cap is reached, not just approached',
        huge.dist >= heavy.dist - 0.5, `${heavy.dist} vs ${huge.dist}`);

    check('no errors thrown while being hit', errors.length === 0,
        errors.slice(0, 2).join(' | ') || 'none');

    await finish(browser, page);
})();
