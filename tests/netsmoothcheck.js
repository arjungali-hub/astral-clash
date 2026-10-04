// The remote fighter is EASED toward the wire, not snapped to it.
//
// WHY THIS EXISTS. The roadmap claimed this game had "no interpolation and no
// prediction" and listed adding it as the highest-payoff item on the list. That
// was wrong, and wrong in an embarrassing way: I searched for the words
// `interpolat`, `prediction` and `rollback`, got nothing, and concluded the
// behaviour was absent. The code calls it easing.
//
//     const k = Math.min(1, NET_LERP * dt);
//     f.x += (st.x - f.x) * k;
//
// netApplyRemote has eased position for some time, snaps when the gap exceeds
// NET_SNAP_DIST so a genuine dash teleport stays instant, and sets FACING
// outright on purpose - easing a direction makes aim read as laggy in exactly
// the moment you are judging where somebody points.
//
// None of which was tested. netcheck asserts the puppet does not fall under
// gravity between packets, which is a different claim, and netcheck needs two
// browsers and 2.2GB so it has never run here anyway. This needs ONE browser
// and a loopback connection, so it runs on the development machine - which is
// the whole reason it is worth writing separately.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));

    await H.boot(page, { clearStorage: true, models: true });
    // A loopback link: netActive() is true, so the opponent is a puppet, and
    // nothing is actually sent anywhere.
    await page.evaluate(() => {
        const D = window.ACDebug;
        D.netSetTimeout(900000);      // the silence timeout would drop the link
        D.netFakeConnect('host');
        D.previewPick('p1', 'Kaelen');
        D.confirmPick('p1');
        D.netFeed({ t: 'PICK', side: 'p2', name: 'Lyra' });
        D.selectedMap = D.MAPS[0].name;
        D.startOnline();
    });
    const live = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    check('a match is running with a puppet opponent', live, 'never reached FIGHT');
    if (!live) { await finish(browser, page); return; }

    const isPuppet = await page.evaluate(() => window.ACDebug.player2.isNetPuppet());
    check('the opponent is a puppet, so the eased path is the live one',
        isPuppet === true, String(isPuppet));

    // One frame at a time, outside the evaluate, for the reason controlscheck
    // splits its sweeps: a software renderer makes a long frame loop outrun
    // puppeteer's protocol timeout.
    const step = (n) => page.evaluate(async (k) => {
        const one = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        for (let i = 0; i < k; i++) await one();
    }, n);

    // Place the puppet, then declare it somewhere NEARER than the snap
    // threshold so the eased path is the one under test.
    async function approach(gap, frames) {
        await page.evaluate((gap) => {
            const D = window.ACDebug, f = D.player2;
            f.x = 800; f.y = 480; f.z = 0; f.vx = 0; f.vy = 0;
            // The buffer is what netApplyRemote eases toward.
            D.net.remoteState = { x: 800 + gap, y: 480, z: 0, fx: 1, fy: 0, pitch: 0 };
            window.__x0 = f.x;
        }, gap);
        await step(1);
        const after1 = await page.evaluate(() => window.ACDebug.player2.x);
        await step(frames);
        const settled = await page.evaluate(() => window.ACDebug.player2.x);
        const x0 = await page.evaluate(() => window.__x0);
        return { x0, target: x0 + gap, after1, settled };
    }

    section('A short gap is closed gradually, not in one jump:');
    const near = await approach(80, 14);
    const firstStep = near.after1 - near.x0;
    check('the first frame moves part of the way, not all of it',
        firstStep > 0.5 && firstStep < 80 * 0.95,
        JSON.stringify({ moved: +firstStep.toFixed(1), gap: 80 }));
    check('and it converges on where the wire said',
        Math.abs(near.settled - near.target) < 6,
        JSON.stringify({ settled: +near.settled.toFixed(1), target: near.target }));

    section('A large gap SNAPS, so a real teleport stays instant:');
    // NET_SNAP_DIST is 220: a dash that crosses more than that is a teleport,
    // and sliding a fighter across the arena would look far worse than a jump.
    const far = await approach(400, 2);
    check('one frame covers the whole distance',
        Math.abs(far.after1 - far.target) < 2,
        JSON.stringify({ after1: +far.after1.toFixed(1), target: far.target }));

    section('Facing is NOT eased - aim must not read as laggy:');
    const facing = await page.evaluate(async () => {
        const D = window.ACDebug, f = D.player2;
        f.x = 800; f.y = 480; f.fx = 1; f.fy = 0;
        D.net.remoteState = { x: 800, y: 480, z: 0, fx: -1, fy: 0, pitch: 0.25 };
        const one = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        await one();
        return { fx: +f.fx.toFixed(3), fy: +f.fy.toFixed(3), pitch: +(f.pitch || 0).toFixed(3) };
    });
    check('facing arrives whole on the first frame',
        Math.abs(facing.fx - -1) < 0.001, JSON.stringify(facing));
    check('and so does pitch', Math.abs(facing.pitch - 0.25) < 0.001, JSON.stringify(facing));

    check('no errors thrown', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none');
    await finish(browser, page);
})();
