// Touch controls, the way shipping mobile shooters actually do it.
//
// ONLINE ONLY, AND THAT IS THE POINT. This module refuses to initialise unless
// AC_ONE_SIDE_PER_CLIENT, so the local split-screen build loads the file and
// gets nothing. The local build HAD a mobile mode; it was played on a phone and
// was "really bad and hard to play", and the reason is structural rather than a
// matter of polish: split screen puts two 844x195 letterboxes on a phone and
// asks two people to share one sheet of glass, and the one-player-vs-bot mode
// behind it inherited a control scheme built for that. Online is the build that
// wants a phone - one player, one fighter, the whole screen - and it is the
// build that was refusing to run on one.
//
// WHAT THE OLD SCHEME GOT WRONG, which is worth stating because this is a
// rewrite and not a port. It drove TURN RATE from a joystick's absolute
// deflection: hold the stick a third of the way right and you rotate at a third
// of top speed, forever. No shooter has worked that way since dual-analog
// arrived, because aiming becomes an integration problem - you steer toward a
// target and then have to steer back to stop. Phones solved it differently from
// consoles: the look input is the DRAG ITSELF. Your thumb moves an inch, the
// view moves a fixed amount, you stop and it stops. It is a mouse made of skin,
// and it maps onto the mouse path this game already has:
//
//     mouseDX  -> f.turnBy(dx * sensitivity)      a displacement, not a rate
//     lookDX   -> f.turnBy(dx * sensitivity)      the same thing
//
// So the layout is the one every mobile FPS converged on:
//
//     LEFT THUMB   a floating analog stick. Where you put your thumb down
//                  becomes the centre, so you never hunt for a fixed circle you
//                  cannot see under your own hand.
//     RIGHT THUMB  drag anywhere to look. Relative, not absolute.
//     BUTTONS      fire, special, dash, jump - bottom right, under the right
//                  thumb's natural arc, and fire is the biggest because it is
//                  pressed the most.
//     TAP TO FIRE  a tap on the look area that barely moves also fires. Standard,
//                  and it is what a player tries first.
//
// Nothing here is a second input path. It fills in the same {moveX, moveY,
// lookX, lookY, attack, special, dodge, jump} shape pollGamepad returns, and
// readSoloInput consumes it beside the gamepad with the same strafe basis. A
// parallel movement path is how the local build ended up with a dead right
// stick for several batches.

// Fraction of the screen width that belongs to the movement stick. The right
// side is look + buttons. 0.44 rather than a half: thumbs are not symmetric
// about the centre line of a phone held in landscape, and the buttons need the
// outer corner.
const TOUCH_MOVE_ZONE = 0.44;

// Radius in CSS pixels at which the stick reads full deflection. About a
// thumb's comfortable travel; past it the vector clamps rather than growing.
const TOUCH_STICK_RADIUS = 58;

// Below this fraction of the radius the stick reads zero. A thumb resting on
// glass drifts, and a fighter that creeps while you are aiming is worse than
// one that needs a deliberate push.
const TOUCH_STICK_DEADZONE = 0.16;

// Radians of rotation per CSS pixel of drag. Tuned so a 300px sweep - roughly
// the width of a thumb's comfortable arc on a phone in landscape - turns about
// 160 degrees, which is the "flick to check behind you" motion a shooter needs
// to be possible in one gesture.
const TOUCH_LOOK_SENS = 0.0093;

// A touch that lifts within this long, having moved less than TOUCH_TAP_SLOP,
// is a shot rather than an aim. Generous on time and tight on distance: a slow
// deliberate tap is still a tap, but a drag that happens to be short is not.
const TOUCH_TAP_MS = 260;
const TOUCH_TAP_SLOP = 16;

// Live state. Accumulated by the listeners, drained by pollTouch() - the same
// contract mouseDX/mouseDY have, so a frame that does not step the simulation
// cannot apply the same drag twice.
let touchLookDX = 0;
let touchLookDY = 0;
let touchMoveX = 0;         // -1..1, screen-right
let touchMoveY = 0;         // -1..1, screen-forward (up on the stick)
let touchBtn = { attack: false, special: false, dodge: false, jump: false };
let touchJumpHeld = false;
let touchReady = false;

// identifier -> what that finger is doing. Phones deliver every finger in one
// event, so the role has to be remembered from touchstart; deciding per-move
// would hand the look zone a finger that started on the stick.
const touchRoles = new Map();

function touchActive() {
    return touchReady && IS_TOUCH_DEVICE && AC_ONE_SIDE_PER_CLIENT;
}

// Reads like pollGamepad, and is consumed in the same place for the same
// reason. look* are DISPLACEMENTS in radians, already scaled, because a drag is
// a displacement; move* are axes, because a stick is an axis.
function pollTouch() {
    if (!touchActive()) return null;
    const out = {
        moveX: touchMoveX,
        moveY: touchMoveY,
        lookX: touchLookDX * TOUCH_LOOK_SENS,
        lookY: touchLookDY * TOUCH_LOOK_SENS,
        attack: touchBtn.attack,
        special: touchBtn.special,
        dodge: touchBtn.dodge,
        jump: touchBtn.jump,
        jumpHeld: touchJumpHeld,
    };
    // Drained: the drag and the button presses are edge events and belong to
    // exactly one frame.
    touchLookDX = 0; touchLookDY = 0;
    touchBtn = { attack: false, special: false, dodge: false, jump: false };
    return out;
}

function touchStickEl() { return document.getElementById('touch-stick'); }

function moveTouchStick(cx, cy, kx, ky) {
    const el = touchStickEl();
    if (!el) return;
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.display = 'block';
    const knob = document.getElementById('touch-stick-knob');
    if (knob) {
        knob.style.transform = 'translate(' + (kx - 50) + '%, ' + (ky - 50) + '%)';
    }
}

function hideTouchStick() {
    const el = touchStickEl();
    if (el) el.style.display = 'none';
}

// Every finger that is not on a button. Buttons stop propagation, so by the
// time a touch reaches here it is either movement or aim, decided by where it
// started and never revisited.
function onTouchStart(e) {
    if (!touchActive()) return;
    for (const t of e.changedTouches) {
        const onLeft = t.clientX < window.innerWidth * TOUCH_MOVE_ZONE;
        const haveStick = [...touchRoles.values()].some(r => r.kind === 'move');
        if (onLeft && !haveStick) {
            // FLOATING ORIGIN: wherever the thumb landed is now the centre.
            touchRoles.set(t.identifier, { kind: 'move', ox: t.clientX, oy: t.clientY });
            moveTouchStick(t.clientX, t.clientY, 50, 50);
        } else {
            touchRoles.set(t.identifier, {
                kind: 'look', lx: t.clientX, ly: t.clientY,
                startX: t.clientX, startY: t.clientY, at: performance.now(),
            });
        }
    }
    // Only once a role was taken: a touch on a button has already stopped here,
    // and preventDefault on a button would eat its own press.
    if (e.cancelable) e.preventDefault();
}

function onTouchMove(e) {
    if (!touchActive()) return;
    for (const t of e.changedTouches) {
        const role = touchRoles.get(t.identifier);
        if (!role) continue;
        if (role.kind === 'move') {
            let dx = (t.clientX - role.ox) / TOUCH_STICK_RADIUS;
            let dy = (t.clientY - role.oy) / TOUCH_STICK_RADIUS;
            const mag = Math.hypot(dx, dy);
            if (mag > 1) { dx /= mag; dy /= mag; }       // clamp, do not grow
            if (mag < TOUCH_STICK_DEADZONE) { dx = 0; dy = 0; }
            touchMoveX = dx;
            touchMoveY = -dy;                             // up on glass is forward
            moveTouchStick(role.ox, role.oy, 50 + dx * 50, 50 + dy * 50);
        } else {
            // RELATIVE: the delta since the last event, not the distance from
            // where the finger started. Absolute would make the view snap back
            // when the thumb is lifted and replaced.
            touchLookDX += t.clientX - role.lx;
            touchLookDY += t.clientY - role.ly;
            role.lx = t.clientX;
            role.ly = t.clientY;
        }
    }
    if (e.cancelable) e.preventDefault();
}

function onTouchEnd(e) {
    if (!touchActive()) return;
    for (const t of e.changedTouches) {
        const role = touchRoles.get(t.identifier);
        touchRoles.delete(t.identifier);
        if (!role) continue;
        if (role.kind === 'move') {
            touchMoveX = 0; touchMoveY = 0;
            hideTouchStick();
        } else {
            // TAP TO FIRE. Short, and it barely moved.
            const quick = performance.now() - role.at < TOUCH_TAP_MS;
            const still = Math.hypot(t.clientX - role.startX, t.clientY - role.startY)
                < TOUCH_TAP_SLOP;
            if (quick && still) touchBtn.attack = true;
        }
    }
}

// The action buttons. Edge-triggered on touchstart - a shooter fires when your
// thumb lands, not when it lifts - and stopPropagation keeps the look layer
// from treating the same finger as a drag.
//
// Jump is the exception: it reports HELD as well as pressed, because the double
// jump upgrade needs a second press while airborne and a hold reads better for
// the first.
const TOUCH_BUTTONS = [
    ['touch-btn-fire', 'attack'],
    ['touch-btn-special', 'special'],
    ['touch-btn-dash', 'dodge'],
    ['touch-btn-jump', 'jump'],
];

function wireTouchButtons() {
    for (const [id, action] of TOUCH_BUTTONS) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            if (e.cancelable) e.preventDefault();
            touchBtn[action] = true;
            if (action === 'jump') touchJumpHeld = true;
            el.classList.add('pressed');
        }, { passive: false });
        const up = (e) => {
            e.stopPropagation();
            if (action === 'jump') touchJumpHeld = false;
            el.classList.remove('pressed');
        };
        el.addEventListener('touchend', up, { passive: false });
        el.addEventListener('touchcancel', up, { passive: false });
    }
}

// Shown only during a live fight, so the menus stay touchable: the pads are
// fixed over the whole screen, and a transparent layer that swallows taps on
// the fighter grid would make the game unstartable.
// The one-line hint fades once, a few seconds into the first fight. A player
// who has used a phone shooter needs confirmation, not instruction - and a
// label that stays on screen through every round is clutter in the one place
// the view matters most.
const TOUCH_HINT_MS = 4200;
let touchHintShownAt = 0;

function syncTouchFPS() {
    const root = document.getElementById('touch-fps');
    if (!root) return;
    const want = touchActive() && inLiveMatch();
    root.style.display = want ? 'block' : 'none';
    const hint = document.getElementById('touch-hint');
    if (want && hint && !hint.classList.contains('gone')) {
        if (!touchHintShownAt) touchHintShownAt = performance.now();
        if (performance.now() - touchHintShownAt > TOUCH_HINT_MS) hint.classList.add('gone');
    }
    if (!want) releaseTouch();
}

// Drop every finger. Called whenever the pads go away, because a thumb that
// was mid-drag when the round ended would otherwise leave movement latched on:
// the axes are held between frames by design, so nothing clears them on its
// own and the fighter walks into the pause menu.
//
// A named function rather than a block inside syncTouchFPS so that the thing
// being relied on can be asserted directly. gameState is exposed read-only, so
// a test cannot fake its way out of a match to observe this.
function releaseTouch() {
    touchMoveX = 0; touchMoveY = 0;
    touchLookDX = 0; touchLookDY = 0;
    touchJumpHeld = false;
    touchBtn = { attack: false, special: false, dodge: false, jump: false };
    touchRoles.clear();
    hideTouchStick();
}

// PORTRAIT IS UNPLAYABLE, and saying so is better than serving it. A 390x844
// viewport gives a first-person view the shape of a letterbox stood on end,
// and both thumbs land in the middle of it.
function syncTouchOrientation() {
    const el = document.getElementById('touch-rotate');
    if (!el) return;
    const portrait = window.innerHeight > window.innerWidth;
    el.style.display = (touchActive() && portrait) ? 'flex' : 'none';
}

function initTouchFPS() {
    // THE GATE. Not a preference: the local build has no business offering this,
    // and a typeof check inside bootGame() could not see this module anyway.
    if (!AC_ONE_SIDE_PER_CLIENT) return;
    if (!IS_TOUCH_DEVICE) return;
    touchReady = true;
    document.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: false });
    document.addEventListener('touchcancel', onTouchEnd, { passive: false });
    wireTouchButtons();
    window.addEventListener('resize', syncTouchOrientation);
    window.addEventListener('orientationchange', syncTouchOrientation);
    syncTouchOrientation();
}
