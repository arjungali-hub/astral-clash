// The remote fighter is EASED toward the wire, and eased the same amount of
// REAL TIME per second whatever the framerate.
//
// WHY THIS EXISTS. The roadmap claimed this game had "no interpolation and no
// prediction" and listed adding it as the highest-payoff item on the list. That
// was wrong, and wrong in an embarrassing way: I searched for `interpolat`,
// `prediction` and `rollback`, got nothing, and concluded the behaviour was
// absent. The code calls it easing.
//
// Writing the test then found a real bug under it. The easing was
//
//     const k = Math.min(1, NET_LERP * dt);
//
// and `0.35 * dt` reaches 1.0 at dt = 2.857 - about 21fps - so from there down
// the "easing" was a plain snap on every frame, with the clamp making it look
// deliberate. Now `1 - (1 - NET_LERP)^dt`: the same smoothing applied dt times,
// identical at dt = 1 so the 60fps tuning is untouched, asymptotic below.
//
// WHY THIS DRIVES netApplyRemote DIRECTLY instead of counting frames. The first
// version of this file stepped requestAnimationFrame and measured how far the
// puppet moved. It failed - and not because the easing was broken the second
// time. This machine software-renders at about 2fps, so every frame arrives at
// the dt clamp of 3, where one frame legitimately closes 72% of the gap and the
// two-rAF step closed 92%. At two frames per second, easing is indistinguishable
// from a snap, and SHOULD be: you cannot smooth motion you only sample twice a
// second. The frame loop was measuring the renderer, exactly as botcheck's first
// version did.
//
// So the contract is asserted at known values of dt, which is both exact and
// the thing that was actually wrong. One rAF check at the end confirms the
// frame loop really calls it, which is the only part frames can tell us.
const H = require('./harness');

const NET_LERP = 0.35;        // must match shared/common.js
const SNAP = 220;             // NET_SNAP_DIST

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));

    await H.boot(page, { clearStorage: true });

    section('The easing curve is frame-rate independent:');
    // The whole bug lived here, in one expression, and it is pure arithmetic -
    // so it is checked as arithmetic rather than through a browser frame.
    const k = await page.evaluate(() =>
        [0.25, 0.5, 1, 2, 3, 6].map(dt => +window.ACDebug.netEaseK(dt).toFixed(6)));
    const want = [0.25, 0.5, 1, 2, 3, 6].map(dt => +(1 - Math.pow(1 - NET_LERP, dt)).toFixed(6));
    check('k(dt) = 1 - (1-r)^dt at every dt',
        JSON.stringify(k) === JSON.stringify(want), JSON.stringify({ got: k, want }));
    check('k(1) is exactly the old 60fps value, so the tuned feel is unchanged',
        Math.abs(k[2] - NET_LERP) < 1e-9, String(k[2]));
    check('k never reaches 1, so easing never degenerates into a snap',
        k.every(v => v < 1) && k[5] < 1, JSON.stringify(k));
    // The regression guard. The OLD expression gave exactly 1.0 here.
    check('k(3) - the dt clamp, and where the bug lived - is well under 1',
        k[4] > 0.6 && k[4] < 0.8, String(k[4]));

    section('A match with a puppet opponent, so the eased path is the live one:');
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
    check('a match is running', live, 'never reached FIGHT');
    if (!live) { await finish(browser, page); return; }

    const isPuppet = await page.evaluate(() => window.ACDebug.player2.isNetPuppet());
    check('the opponent is a puppet', isPuppet === true, String(isPuppet));

    // Place the puppet, declare a wire position, apply ONE step of a known dt.
    const step = (gap, dt) => page.evaluate(([gap, dt]) => {
        const D = window.ACDebug, f = D.player2;
        f.x = 800; f.y = 480; f.z = 0; f.vx = 0; f.vy = 0;
        D.net.remoteState = { x: 800 + gap, y: 480, z: 0, fx: 1, fy: 0, pitch: 0 };
        D.netApplyRemote(dt);
        return { x: f.x, closed: (f.x - 800) / gap };
    }, [gap, dt]);

    section('A sub-threshold gap closes by exactly k(dt), at any dt:');
    for (const dt of [0.25, 1, 3]) {
        const r = await step(80, dt);
        const expect = 1 - Math.pow(1 - NET_LERP, dt);
        check('dt=' + dt + ': closes ' + (expect * 100).toFixed(1) + '% of the gap',
            Math.abs(r.closed - expect) < 0.002,
            JSON.stringify({ closed: +r.closed.toFixed(4), expect: +expect.toFixed(4) }));
    }

    section('A gap beyond NET_SNAP_DIST snaps, so a real teleport stays instant:');
    // Kaelen dashes, Voss blinks, Nyx pulls. Sliding a fighter across the arena
    // to catch up with a teleport looks far worse than arriving instantly.
    const far = await step(SNAP + 180, 1);
    check('one step covers the whole distance', Math.abs(far.closed - 1) < 1e-6,
        JSON.stringify(far));
    const justUnder = await step(SNAP - 20, 1);
    check('and a gap just UNDER the threshold still eases',
        Math.abs(justUnder.closed - NET_LERP) < 0.002, JSON.stringify(justUnder));

    section('Facing is NOT eased - aim must not read as laggy:');
    const facing = await page.evaluate(() => {
        const D = window.ACDebug, f = D.player2;
        f.x = 800; f.y = 480; f.fx = 1; f.fy = 0; f.pitch = 0;
        D.net.remoteState = { x: 800, y: 480, z: 0, fx: -1, fy: 0, pitch: 0.25 };
        D.netApplyRemote(1);
        return { fx: +f.fx.toFixed(4), fy: +f.fy.toFixed(4), pitch: +(f.pitch || 0).toFixed(4) };
    });
    check('facing arrives whole in one step', Math.abs(facing.fx + 1) < 1e-6,
        JSON.stringify(facing));
    check('and so does pitch', Math.abs(facing.pitch - 0.25) < 1e-6, JSON.stringify(facing));

    section('The frame loop really calls it - the one thing only frames can say:');
    // Deliberately loose. All this asserts is that SOMETHING in the live loop
    // moves the puppet toward the wire without the test calling netApplyRemote
    // itself. How far it gets in a frame is this machine's business.
    const loop = await page.evaluate(async () => {
        const D = window.ACDebug, f = D.player2;
        f.x = 800; f.y = 480; f.z = 0;
        D.net.remoteState = { x: 900, y: 480, z: 0, fx: 1, fy: 0, pitch: 0 };
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return f.x;
    });
    check('the puppet moved toward the wire on its own', loop > 800.5 && loop <= 900.5,
        String(+loop.toFixed(1)));

    check('no errors thrown', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none');
    await finish(browser, page);
})();
