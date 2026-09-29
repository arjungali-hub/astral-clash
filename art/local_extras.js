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

// The spectator camera used to live here too: watchCam, positionWatchCamera
// and syncWatchRings. It is in index.html now and travels to this build as an
// ordinary shared definition, which is also how the online build gained an
// overhead view for a sandbox match between two bots.

// The solo human's controls used to live here: soloMouse and
// applySoloControls, a second copy of the one-player scheme and a second set
// of mouse listeners beside the shared ones. Both builds call readSoloInput()
// now, which is the same text in each and kept in step by the sync.
