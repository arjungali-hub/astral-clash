// Local-build features, inserted into bootGame() by art/sync_local.py.
//
// These exist only in the local split-screen build, because they only make
// sense there: two people share one machine, so there are two names and two
// purses, and one of them might be a bot.
//
// It lives here as real JavaScript rather than as a string inside the port
// script for the same reason art/local_coop_respawn.js does: a sixty-line
// function embedded in a Python literal is where escaping mistakes come from,
// and this file can be syntax-checked on its own.

// HOISTED, because the load-time menu build reads them: the tutorial
// auto-opens for a first-time visitor and reaches displayName() through
// buildTutorialControls, while the originals sat 7000 lines below. The
// port removes that declaration - see 'bot flags hoisted'.
let p1IsBot = false, p2IsBot = false;

// ---------------------------------------------------------------- names
// "there should also be a naming/renaming feature in local so it doesn't just
// say player 1 and player 2".
//
// Two names, persisted, per SIDE - not per account. The online build has one
// name because it has one player per machine; here both players are at the
// same keyboard, so P1 and P2 each need their own, and the labels that used to
// read "Player 1" read whatever they typed.
const LOCAL_NAME_KEY = 'astralClashLocalNames';
const LOCAL_NAME_MAX = 14;
// The local build has no sanitizeName - that is the online room's helper for
// a name that goes over the wire. These names never leave the machine, so the
// rules are only about fitting the UI and not being blank-but-not-empty.
function cleanLocalName(v) {
    // Control characters are stripped by CODE, not by a literal range in the
    // source. Writing the range as characters is how this regex became /[ -]/
    // on its way through a shell heredoc - which silently deleted every space
    // and hyphen from anybody's name.
    let out = '';
    for (const ch of String(v == null ? '' : v)) {
        if (ch.charCodeAt(0) >= 32) out += ch;
    }
    return out.trim().slice(0, LOCAL_NAME_MAX);
}
try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_NAME_KEY) || '{}');
    if (raw && typeof raw === 'object') {
        localNames.p1 = cleanLocalName(raw.p1);
        localNames.p2 = cleanLocalName(raw.p2);
    }
} catch (e) { /* a corrupt or blocked store just means the defaults */ }

// The label for a side, everywhere a human is named: the select panels, the
// shop title, the HUD, the result screen.
//
// The fallback is a LOOKUP, not the ternary it obviously wants to be, and that
// is load-bearing. The port replaces every `(side === 'p1' ? 'Player 1' :
// 'Player 2')` in the build with `playerLabel(side)` - and the first run of it
// rewrote this function's own body into `return localNames[side] ||
// playerLabel(side)`. The local build died at load with "Maximum call stack
// size exceeded".
// What to PRINT for a side, which is not the same question.
//
// A BOT SIDE IS CALLED "Bot", whatever is in the name field: reported as "Bot
// sides render as 'Krish [BOT]'", and the name belongs to the person rather
// than to the slot the AI is driving.
//
// Separate from playerLabel() because of LOAD ORDER, not taste. playerName runs
// while the menu paints itself - before p1IsBot is declared - and reading a
// `let` in its temporal dead zone throws even through `typeof`. This one is
// only ever called from a match or a menu repaint, both of which happen after
// the flags exist. Eighth instance of that trap in this file.
function setLocalName(side, value) {
    localNames[side] = cleanLocalName(value);
    try { localStorage.setItem(LOCAL_NAME_KEY, JSON.stringify(localNames)); } catch (e) {}
    refreshLocalNames();
}

function refreshLocalNames() {
    for (const side of SIDES) {
        const input = document.getElementById('name-' + side);
        if (input && input.value !== localNames[side]) input.value = localNames[side];
        // The heading keeps its "(keys on cards)" hint, so the name goes in
        // its own span rather than replacing the whole h3's text.
        const head = document.getElementById('side-name-' + side);
        if (head) head.textContent = playerLabel(side);
        const title = document.getElementById('shop-title-' + side);
        if (title) title.textContent = playerLabel(side) + ' — Shop';
    }
}

// ------------------------------------------------------- reset progress
// "there should be an option to reset progress in local".
//
// Two clicks, not one: the button arms itself and says what it is about to do,
// and a second click inside five seconds carries it out. A confirm() dialog
// would do the same job, but this build is played fullscreen with a gamepad or
// two keyboards, where a modal browser prompt is a worse interruption than an
// inline one.
let resetArmed = 0;
function resetProgressClicked() {
    const btn = document.getElementById('btn-reset-progress');
    const now = performance.now();
    if (!resetArmed || now - resetArmed > 5000) {
        resetArmed = now;
        if (btn) btn.textContent = 'Erase everything? Click again';
        setTimeout(() => {
            if (resetArmed && performance.now() - resetArmed > 4900) {
                resetArmed = 0;
                if (btn) btn.textContent = 'Reset Progress';
            }
        }, 5100);
        return;
    }
    resetArmed = 0;
    // Both sides' coins, unlocks, upgrades and double jump, back to a new save.
    // Names are kept deliberately: they are not progress, and retyping them
    // after every reset is a chore rather than a safeguard.
    for (const side of SIDES) {
        progression[side] = freshSideProgress();
    }
    saveProgression();
    refreshGridLocks();
    refreshCoinDisplays();
    buildShop();
    if (btn) btn.textContent = 'Progress reset';
    setTimeout(() => { if (btn) btn.textContent = 'Reset Progress'; }, 2500);
}

// ------------------------------------------------- one human, one bot
// "if there is only one person playing in local mode (because of bot), the
// controls should be the same as for online mode."
//
// With a bot on the other side there is exactly one human, so there is no
// reason to keep the split-keyboard scheme that exists to fit two people on
// one board. `soloHumanSide()` returns that side, and the input code uses it
// to switch to the online scheme: mouse look, WASD strafing, left click to
// attack, on whichever side the human is actually playing.
// soloHumanSide() itself is in shared/common.js: both flags it reads were
// already there, and wantsPointerLock() has to ask it. This fragment keeps
// only what is genuinely local-build-only.

// ------------------------------------------------------ bots only: watch
// "When you select both characters to be bot in local mode, you should view
// from the top."
//
// With no human there is no first-person view to be in, and two split-screen
// halves of a fight nobody is playing is the least useful way to show it. One
// camera, looking straight down at the whole arena, is a spectator view - and
// it is the only mode in this game where you can see the whole layout at once.
// botsOnly() itself is in shared/common.js: drawHUDInner asks it in both
// builds, and both flags it reads were already shared.

const watchCam = new THREE.PerspectiveCamera(46, 1, 1, 6000);
watchCam.layers.enableAll();
// Batch 52: IT FRAMES THE FIGHT, not the building.
//
// Reported: from above the fighters are "tiny and pale". They are ~40 units
// across in a 1635x855 arena, so a camera that holds the whole arena makes
// each of them about 2% of the frame - a view that is technically complete and
// practically useless. It frames the two fighters instead: a minimum span so a
// clinch cannot push the camera into their heads, and a maximum of the arena
// so it never shows the void outside.
//
// The framing EASES toward its target. A camera that jumps every time somebody
// dashes is the same complaint as a fighter that teleports - "there should
// always be a smooth animation" - and this is the one view where the whole
// frame moves at once.
const WATCH_SPAN_MIN = 640;   // closest the camera will ever get
const WATCH_SPAN_PAD = 360;   // breathing room around the pair
const WATCH_EASE = 0.06;
// Not initialised from ARENA_CX: this fragment is injected ABOVE those
// constants, so reading one here would be a load-time TDZ throw. The first
// frame seeds them instead (see `seed` below), which is also what a new match
// in a different arena needs.
let watchSpan = 0, watchCx = 0, watchCy = 0;

function positionWatchCamera(aspect) {
    const arenaW = ARENA_RIGHT - ARENA_LEFT, arenaH = ARENA_BOTTOM - ARENA_TOP;
    const wide = Math.max(arenaW / Math.max(0.6, aspect), arenaH) * 1.12;
    const pair = [player1, player2].filter(f => f && f.hp > 0);
    let tx = ARENA_CX, ty = ARENA_CY, want = wide;
    if (pair.length) {
        const xs = pair.map(f => f.x + f.width / 2), ys = pair.map(f => f.y + f.height / 2);
        const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
        const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
        tx = (x0 + x1) / 2; ty = (y0 + y1) / 2;
        want = Math.max(WATCH_SPAN_MIN,
                        (x1 - x0 + WATCH_SPAN_PAD) / Math.max(0.6, aspect),
                        y1 - y0 + WATCH_SPAN_PAD);
        want = Math.min(want, wide);   // never wider than the arena itself
    }
    // Seed on the first frame, and again whenever the target is a whole arena
    // away - a new match, or a different map. Easing across that would be a
    // long slow drift from somewhere that no longer exists.
    const seed = !watchSpan || Math.hypot(tx - watchCx, ty - watchCy) > arenaW * 0.5;
    if (seed) { watchSpan = want; watchCx = tx; watchCy = ty; }
    else {
        watchSpan += (want - watchSpan) * WATCH_EASE;
        watchCx += (tx - watchCx) * WATCH_EASE;
        watchCy += (ty - watchCy) * WATCH_EASE;
    }
    const dist = watchSpan / (2 * Math.tan((watchCam.fov * Math.PI / 180) / 2));
    watchCam.aspect = aspect;
    watchCam.position.set(worldX(watchCx), dist, worldZ(watchCy) + dist * 0.22);
    watchCam.lookAt(worldX(watchCx), 0, worldZ(watchCy));
    watchCam.updateProjectionMatrix();
}

// A ring on the ground under each fighter, in that fighter's own colour. The
// other half of "tiny and pale": from overhead a fighter is a few dozen pixels
// of mostly-dark mesh against a lit floor, and which one is which is the first
// thing a spectator needs. Built on demand (a spectator match is the only
// thing that ever needs them) and hidden the moment the view is not the watch
// view, which is why renderViews calls this every frame rather than only
// inside its watch branch.
const WATCH_RING_INNER = 26, WATCH_RING_OUTER = 34;
let watchRings = null;
function syncWatchRings(on) {
    if (!watchRings) {
        if (!on) return;                       // nothing built, nothing to hide
        const mk = () => {
            const m = new THREE.Mesh(
                new THREE.RingGeometry(WATCH_RING_INNER, WATCH_RING_OUTER, 40),
                new THREE.MeshBasicMaterial({
                    color: 0xffffff, transparent: true, opacity: 0.9,
                    side: THREE.DoubleSide, depthWrite: false,
                }));
            m.rotation.x = -Math.PI / 2;       // flat on the floor
            m.layers.enableAll();
            m.visible = false;
            scene.add(m);
            return m;
        };
        watchRings = [mk(), mk()];
    }
    const pair = [player1, player2];
    for (let i = 0; i < watchRings.length; i++) {
        const f = pair[i], ring = watchRings[i];
        ring.visible = !!(on && f && f.hp > 0);
        if (!ring.visible) continue;
        // Just above the floor: coplanar with it would z-fight.
        ring.position.set(worldX(f.x + f.width / 2), 1.5, worldZ(f.y + f.height / 2));
        ring.material.color.set(f.color);
    }
}

// The solo human's controls used to live here: soloMouse and
// applySoloControls, a second copy of the one-player scheme and a second set
// of mouse listeners beside the shared ones. Both builds call readSoloInput()
// now, which is the same text in each and kept in step by the sync.
