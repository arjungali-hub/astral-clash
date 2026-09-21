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
