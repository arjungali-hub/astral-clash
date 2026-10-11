// The frame cap must throttle the page without starving anyone on it.
//
// WHY THIS EXISTS. AC_FPS_CAP replaces window.requestAnimationFrame, and the
// first version of that wrapper gave every callback its own re-queueing step()
// consulting ONE shared timestamp. Whichever callback happened to run first in
// a frame set that timestamp, and every other callback pending in the same
// frame then measured a zero gap against it and re-queued. The game loop
// re-registers itself every frame, so it won that race every time and nothing
// else ever ran.
//
// That is not a slow path, it is a dead one, and it broke the GAME rather than
// the measurement: afterPaint() is a nested double rAF, withLoading() runs its
// work inside one, and startMatch() does its asset loading inside that. So
// with ?fps= set, the work was never invoked - matchAssetsReady never started,
// startMatchNow never ran, and gameState stayed MENU indefinitely. Both arms of
// framerateccheck reported "never reached FIGHT (stuck in MENU)", which reads
// as a frame-cap bug in a frame-cap checker and was one, and had been since the
// cap was written.
//
// NO BROWSER. The bug is pure scheduling, so a fake window and a fake 60Hz
// clock reproduce it exactly - which means this runs in milliseconds and costs
// no memory, on a machine where the browser checkers have had under 1GB free
// all week. It evaluates the REAL shared/animation.js rather than a paraphrase
// of the wrapper, because a paraphrase cannot catch a typo in the thing it
// paraphrases.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const H = require('./harness');

const SRC = fs.readFileSync(
    path.join(__dirname, '..', 'shared', 'animation.js'), 'utf8');

// A fake 60Hz rAF: one queue, drained once per simulated frame in registration
// order, which is what a browser does.
function fakeHost(search) {
    let q = [];
    let now = 0;
    let nextHandle = 1;
    const win = {
        requestAnimationFrame(cb) { const h = nextHandle++; q.push({ h, cb }); return h; },
        cancelAnimationFrame(h) { q = q.filter(e => e.h !== h); },
    };
    const sandbox = { window: win, location: { search }, console };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(SRC, sandbox, { filename: 'shared/animation.js' });
    return {
        win,
        tick() { now += 1000 / 60; const b = q; q = []; for (const e of b) e.cb(now); },
        get now() { return now; },
        get depth() { return q.length; },
    };
}

// One capped page: a self-re-registering game loop, a nested double rAF beside
// it, and a callback cancelled before its slot.
function drive(cap, frames) {
    const host = fakeHost('?fps=' + cap);
    const rAF = host.win.requestAnimationFrame;
    const cAF = host.win.cancelAnimationFrame;

    let loopFrames = 0;
    (function gameLoop() { loopFrames++; rAF(gameLoop); })();

    let painted = false;
    rAF(() => rAF(() => { painted = true; }));

    let cancelledRan = false;
    cAF(rAF(() => { cancelledRan = true; }));

    let paintedAfterMs = null;
    for (let i = 0; i < frames; i++) {
        host.tick();
        if (painted && paintedAfterMs === null) paintedAfterMs = Math.round(host.now);
    }
    return { cap, painted, cancelledRan, loopFrames, paintedAfterMs,
             ms: Math.round(host.now) };
}

(async () => {
    const { check, section, finish } = H.makeChecker();

    section('A capped page still runs every rAF caller, not just the loop:');
    // 600 simulated frames is ten seconds at 60Hz - four orders of magnitude
    // more than the two slots this needs, so a pass here is not a near miss.
    for (const cap of [20, 30, 60]) {
        const r = drive(cap, 600);
        check(`fps=${cap}: a nested double rAF beside the game loop still fires`,
            r.painted === true,
            `never ran in ${r.ms}ms while the loop took ${r.loopFrames} frames`);
        check(`fps=${cap}: and it fires promptly, in about two slots`,
            r.painted && r.paintedAfterMs <= Math.ceil(3 * (1000 / cap)) + 34,
            `took ${r.paintedAfterMs}ms, two slots is ${Math.round(2000 / cap)}ms`);
    }

    section('The cap actually caps:');
    // 60 simulated frames is one second of wall clock, so the loop should get
    // about `cap` frames - never more, and not wildly fewer.
    for (const cap of [20, 30]) {
        const r = drive(cap, 60);
        check(`fps=${cap}: the loop gets no more frames than the cap allows`,
            r.loopFrames <= cap + 1, `${r.loopFrames} frames in ${r.ms}ms`);
        check(`fps=${cap}: and is not throttled far below it either`,
            r.loopFrames >= cap - 3, `${r.loopFrames} frames in ${r.ms}ms`);
    }

    section('A cancelled callback stays cancelled:');
    // The wrapper hands out its own handles, so it owes cancelAnimationFrame a
    // real answer. three.js keeps the handle from requestAnimationFrame and
    // cancels it in WebGLAnimation.stop() - the game drives its own loop and may
    // never reach that, which is no reason to install a rAF that lies.
    for (const cap of [20, 60]) {
        const r = drive(cap, 120);
        check(`fps=${cap}: a callback cancelled before its slot does not run`,
            r.cancelledRan === false, 'it ran anyway');
    }

    section('Without ?fps= the wrapper is not installed at all:');
    const plain = fakeHost('');
    const before = plain.win.requestAnimationFrame;
    check('the shipped game keeps the browser’s own requestAnimationFrame',
        typeof before === 'function' && !/pending/.test(String(before)),
        String(before).slice(0, 60));

    await finish(null, null);
})();
