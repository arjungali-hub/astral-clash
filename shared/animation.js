// Astral Clash - how an attack is TIMED, shared by both builds.
//
// Loaded as a plain script by index.html and local/index.html, before either
// defines bootGame(). Classic scripts share one global scope, so everything
// here is visible inside both games with no import and no call-site change -
// the same arrangement shared/roster.js uses, for the same reason.
//
// WHY THIS FILE EXISTS
//
// It used to live in index.html and reach the local build through
// art/sync_local.py, one guarded edit at a time. That produced three separate
// crashes in one week, all the same shape: the script carried swingT across
// without every constant it uses, so the local build ran a function calling
// names that did not exist and threw "SWING_WINDUP_FRAC is not defined" on
// every frame of every swing. An exception in the animation path takes the
// frame with it, which is what "the attack freezes the screen and then you
// can't continue" was.
//
// A porting script cannot be made safe by adding more guards. There is one copy
// now, and nothing to port.
//
// RULES
//   1. PURE FUNCTIONS OF STATE. No DOM, no THREE, no renderer, no closure
//      variables - these take a fighter and its frame data and return numbers.
//      Anything that touches a mesh belongs with the meshes (see _swingArm,
//      which stays in the builds).
//   2. Neither build may re-declare these names: a `const` inside bootGame()
//      shadows the global and quietly restores the drift this file removes.
//      tests/consistencycheck.js asserts that both builds agree.

// How much of the active window a swing spends TRAVELLING; the rest is spent
// held at full extension. See swingT.
// A swing's travel is measured in FRAMES, not as a fraction of the window -
// the same reasoning as readableJabs. A fraction means a character with a
// six-frame active window (Gorgonok) gets three frames of movement and the arm
// never draws an intermediate position, which swingcheck caught directly: one
// sample in the middle of the travel out of forty. Five frames is what it takes
// to see a limb move; a window shorter than that spends all of itself
// travelling, which is the best it can do.
const SWING_TRAVEL_FRAMES = 5;
// THE STRIKE STARTS BEFORE THE ACTIVE WINDOW DOES, which is how a real swing
// works: the arm is already travelling when the blow becomes dangerous, not
// standing still until the frame it does.
//
// Forced by measurement. Gorgonok's active window is six frames; a travel that
// lives entirely inside it crosses the whole arc in five steps, and swingcheck
// found one sampled position in the middle 40% of the travel out of forty
// samples - a snap, not a swing. His STARTUP is sixteen frames, all of it spent
// holding a wind-up pose. Spending the last 30% of it accelerating into the
// blow gives the travel eleven frames instead of five and costs the fight
// nothing: hitboxes key off atkState, which is untouched.
const SWING_WINDUP_FRAC = 0.7;      // of startup spent winding up
// Where the arm has got to by the time the active window opens, on swingT's own
// scale: 0 is rest, -1 is full extension.
//
// It has to be expressed on that scale rather than as "80% of the way", because
// the scale is NOT linear in angle. For Gorgonok, t from +1 to 0 is the wind-up
// and covers backDeg = 12 degrees; t from 0 to -1 is the strike and covers
// fwdDeg = 115. A pre-strike that ran from t=1 to t=0.2 therefore moved the arm
// about two degrees and the measurement said so: the strike still crossed its
// whole arc in three sampled frames. Starting the active window already a third
// of the way down splits the 115 degrees across about ten frames.
const SWING_PRESTRIKE_T = -0.35;
// ...and how much of RECOVERY is spent still at full extension before the arm
// starts coming back.
//
// Measured against the report: "the hold is only about 50-100ms. For the most
// committal attack on the roster, consider about 150ms." Gorgonok's basic is
// startup 16 / active 6 / recovery 24, so the active window is 100ms and the
// 45% of it left after the travel is 45ms of hold. The remaining 105ms has to
// come from somewhere that is not the frame data - changing that would change
// the fight - so it comes from the first quarter of recovery, which is animation
// only: 0.26 * 24 frames is 104ms, for a total of ~149ms.
//
// A FRACTION, not a frame count, so every swing keeps its own weight: Voss's
// 14-frame recovery buys him 61ms of hold, which is right for a dagger.
// 0.34, not 0.26. With the travel now taking five of Gorgonok's six active
// frames there is almost nothing left of that window to hold, so the hold comes
// almost entirely from recovery: 0.34 * 24 frames = 136ms, plus the ~17ms left
// in the active window, for the ~150ms the report asked for.
const SWING_HOLD_RECOVERY_FRAC = 0.34;

function swingT(f, fd) {
    // 0 at rest -> 1 wind-up extreme -> -1 full extension (HELD) -> back to 0.
    if (f.atkState === 'startup') {
        const p = fd.startup > 0 ? (1 - f.atkStateTimer / fd.startup) : 1;   // 0 -> 1 through startup
        if (p <= SWING_WINDUP_FRAC) return p / SWING_WINDUP_FRAC;            // ...the wind-up, 0 -> 1
        // ...then the arm is already coming forward when the window opens.
        const q = (p - SWING_WINDUP_FRAC) / (1 - SWING_WINDUP_FRAC);
        return 1 - q * (1 - SWING_PRESTRIKE_T);   // +1 -> SWING_PRESTRIKE_T
    }
    if (f.atkState === 'active') {
        // THE CONTACT POSE IS HELD. A linear 1 -> -1 across the window puts the
        // arm at full extension for exactly one frame - the last one - and
        // already returning on the next, which is why a hammer landing read as
        // a wipe rather than a hit ("lengthen Gorgonok's hold at full
        // extension"). The travel is front-loaded and the remainder is the
        // hold. The window, the hitbox and the damage are untouched.
        const p = fd.active > 0 ? (1 - f.atkStateTimer / fd.active) : 1;
        // The travel takes SWING_TRAVEL_FRAMES, or the whole window if it is
        // shorter than that - never a fixed fraction of it.
        const frac = Math.min(1, SWING_TRAVEL_FRAMES / Math.max(1, fd.active));
        const travel = Math.min(1, p / frac);
        // Continues from where the pre-strike left off, rather than jumping
        // back to the wind-up extreme the moment the window opens.
        const from = SWING_PRESTRIKE_T;
        return from - travel * (from + 1);   // SWING_PRESTRIKE_T -> -1
    }
    // `r` is the fraction of recovery still to run: 1 at the start, 0 at the end.
    const r = fd.recovery > 0 ? (f.atkStateTimer / fd.recovery) : 0;
    // Still holding the contact pose (see SWING_HOLD_RECOVERY_FRAC).
    if (r > 1 - SWING_HOLD_RECOVERY_FRAC) return -1;
    // Then the return EASES OUT: the arm leaves the pose slowly and finishes
    // quickly, instead of retracting at a constant rate.
    const back = r / Math.max(0.001, 1 - SWING_HOLD_RECOVERY_FRAC);
    return -Math.sin(back * Math.PI / 2);
}
function actionPhase(f, fd) {
    // 0..1 across the whole startup+active+recovery window — for driving
    // repeated-jab oscillation.
    const total = fd.startup + fd.active + fd.recovery;
    let elapsed;
    if (f.atkState === 'startup') elapsed = fd.startup - f.atkStateTimer;
    else if (f.atkState === 'active') elapsed = fd.startup + (fd.active - f.atkStateTimer);
    else elapsed = fd.startup + fd.active + (fd.recovery - f.atkStateTimer);
    return total > 0 ? Math.max(0, Math.min(1, elapsed / total)) : 0;
}
// How many jabs will actually READ inside an attack's active window.
//
// "ignis's attack is a snap that doesn't have a smooth animation" - and his
// data asks for FOUR jabs inside a six-frame active window. That is four full
// sine cycles in a tenth of a second: at 60fps each jab gets one and a half
// frames, so the arm never draws an intermediate position and the whole thing
// renders as a vibration. Voss is the same shape of problem (five jabs, four
// active frames).
//
// A jab needs about five frames to be seen out and back, so the count is
// clamped to what the window can show. The DATA is left alone deliberately -
// `jabs: 4` still says "this is a flurry character" and still drives the sound
// and the hit count; it just stops promising motion the frame budget cannot
// deliver.
const JAB_MIN_FRAMES = 5;
function readableJabs(want, activeFrames) {
    return Math.max(1, Math.min(want || 1, Math.floor((activeFrames || 1) / JAB_MIN_FRAMES)));
}


// ---------------------------------------------------------------------------
// A DEBUG FRAME CAP: ?fps=30 runs the whole game at 30fps.
//
// "Identical behaviour at 30fps, 60fps and uncapped" has been unchecked since
// the original brief, for the honest reason that there was no way to drive the
// game at a chosen rate - and computeDt, which normalises everything by real
// elapsed time, is precisely the thing under test, so it cannot be trusted to
// verify itself.
//
// This wraps requestAnimationFrame rather than touching either game loop. That
// matters twice over: gameLoop is on INTERFACE and differs between the builds,
// so editing it would have been a change in two places forever; and a loop that
// does not know it is being throttled cannot accidentally compensate.
//
// Inert unless ?fps= is present - no wrapper is installed at all - so the shipped
// game runs on the browser's own rAF exactly as before.
const AC_FPS_CAP = (function () {
    const m = /[?&]fps=(\d+)/.exec(typeof location !== 'undefined' ? location.search : '');
    const n = m ? parseInt(m[1], 10) : 0;
    return (n > 0 && n <= 240) ? n : 0;
})();

// ONE QUEUE, FLUSHED ONCE PER SLOT - not a gate each callback races.
//
// The first version of this wrapper gave every callback its own re-queueing
// step() that consulted one SHARED `lastAt`. Whichever callback happened to run
// first in a frame set that timestamp, and every other callback pending in the
// same frame then measured a zero gap against it and re-queued. The game loop
// re-registers itself every frame, so it won that race every time - and nothing
// else ever ran.
//
// That is not a slow path, it is a dead one, and it broke the game rather than
// the measurement. afterPaint() is a nested double rAF and withLoading() runs
// its work inside one, so with ?fps= set, startMatch's work was never invoked:
// matchAssetsReady never started, startMatchNow never ran, and gameState stayed
// MENU indefinitely. Both arms of framerateccheck reported exactly that, which
// read as a frame-cap bug in a frame-cap checker and this time WAS one.
//
// Batching is the fix and it is also the more honest model of a frame: real rAF
// delivers every callback registered before the frame, together, once. So does
// this - just less often. A callback registered DURING a flush lands in the
// next slot, which is what makes afterPaint's two ticks take two slots (100ms
// at 20fps) instead of never.
//
// REAL HANDLES, because a replacement for requestAnimationFrame has to keep
// its contract. The project itself never calls cancelAnimationFrame - but
// three.js does: WebGLAnimation keeps the handle from requestAnimationFrame and
// cancels it in stop(). The game drives its own loop rather than
// renderer.setAnimationLoop, so that path may never be reached here, which is
// not a reason to install a rAF that quietly ignores a cancel.
if (AC_FPS_CAP && typeof window !== 'undefined' && window.requestAnimationFrame) {
    const raf = window.requestAnimationFrame.bind(window);
    const nativeCancel = typeof window.cancelAnimationFrame === 'function'
        ? window.cancelAnimationFrame.bind(window) : null;
    const minGap = 1000 / AC_FPS_CAP;
    let lastAt = -1e9;
    let pending = new Map();      // handle -> callback, in insertion order
    let nextHandle = 1;
    let scheduled = 0;            // the UNDERLYING handle, so this can cancel too

    const schedule = () => {
        if (scheduled) return;
        scheduled = raf(flush) || -1;
    };

    function flush(now) {
        scheduled = 0;
        if (now - lastAt < minGap) { schedule(); return; }   // too soon; wait
        // ADVANCE BY WHOLE SLOTS, rather than snapping to now.
        //
        // Snapping carries the leftover between the display's frame interval
        // and minGap into the next comparison, where it accumulates: asked for
        // 30fps on a 60Hz source - which should be exactly every other frame -
        // it aliased down to 24, because each slot started its countdown a
        // fraction of a frame late and every so often lost a whole one.
        //
        // Unless we are more than a slot behind, which means the page was not
        // being painted at all (a backgrounded tab, a long stall). Catching up
        // on that by firing a burst of slots would be worse than the drift, so
        // that case resets to now.
        lastAt = (now - lastAt > minGap * 2) ? now : lastAt + minGap;
        // Taken before the loop: a callback that registers another one during
        // the flush must land in the NEXT slot, not extend this one into an
        // unbounded loop. Map preserves insertion order, which is the order a
        // real rAF would deliver them in.
        const batch = Array.from(pending.values());
        pending = new Map();
        for (let i = 0; i < batch.length; i++) {
            // One throwing callback must not swallow the rest, and must still
            // reach window.onerror the way an uncaught rAF callback would -
            // which is where reportError is hooked.
            try { batch[i](now); }
            catch (e) { setTimeout(() => { throw e; }, 0); }
        }
    }

    window.requestAnimationFrame = function (cb) {
        const handle = nextHandle++;
        pending.set(handle, cb);
        schedule();
        return handle;
    };

    window.cancelAnimationFrame = function (handle) {
        // A handle this wrapper issued, or one from the native rAF that was
        // taken before the wrapper was installed - try ours first, and only
        // fall through when it is not one of ours.
        if (pending.delete(handle)) return;
        if (nativeCancel) nativeCancel(handle);
    };
}
