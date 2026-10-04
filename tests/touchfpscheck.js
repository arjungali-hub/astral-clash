// The mobile control scheme, on an emulated phone.
//
// TWO CLAIMS, and they are opposites:
//   ONLINE  plays on a phone. One player, one fighter, the whole screen - and
//           now a control scheme built for thumbs instead of a notice telling
//           you to find a computer.
//   LOCAL   does not, and has no touch code left at all. Split screen on a
//           phone gives two people a letterbox each; it was played and reported
//           as "really bad and hard to play".
//
// The local half is asserted as ABSENCE, which is the only honest way to check
// "this cannot happen". A notice over a working mobile mode is one CSS change
// away from being bypassed - and that was the real state of the build before
// this: #desktop-only covered the screen while the entire scheme sat live
// behind it, reachable by a script-driven click, which is exactly how the old
// mobilecheck managed to assert BOTH "local refuses on a phone" and "local
// build on a phone: single-player vs bot" in the same run.
//
// Touch events are dispatched synthetically rather than through
// page.touchscreen, because the scheme is multi-touch by design - a thumb on
// the stick and a thumb on the look area at the same time is the normal case,
// and that is the thing most likely to be wrong.
const H = require('./harness');
const DIR = H.path.resolve(__dirname, 'screenshots') + '/';

const PHONE = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
        + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 844, height: 390, deviceScaleFactor: 2,
                isMobile: true, hasTouch: true, isLandscape: true },
};

// Dispatched in the page. One helper for every gesture, so a test reads as the
// thumb motion it represents.
const TOUCH_HELPERS = `
window.__t = {
  mk(type, touches) {
    const list = touches.map(t => new Touch({
      identifier: t.id, target: document.body,
      clientX: t.x, clientY: t.y, pageX: t.x, pageY: t.y,
    }));
    return new TouchEvent(type, {
      touches: list, targetTouches: list, changedTouches: list,
      bubbles: true, cancelable: true,
    });
  },
  start(touches) { document.dispatchEvent(this.mk('touchstart', touches)); },
  move(touches)  { document.dispatchEvent(this.mk('touchmove', touches)); },
  end(touches)   { document.dispatchEvent(this.mk('touchend', touches)); },
};
`;

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();

    // ===================================================== ONLINE, ON A PHONE
    const page = await H.newPage(browser);
    await page.emulate(PHONE);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await H.boot(page, { clearStorage: true });
    await page.evaluate(TOUCH_HELPERS);

    section('A DESKTOP is not mistaken for a phone:');
    // Inherited from mobilecheck, which this file replaces. The detection is a
    // coarse pointer or no hover AND real touch points, specifically so a
    // touchscreen laptop - fine pointer, real hover - is not caught and handed
    // thumb controls it has no thumbs for.
    const desk = await H.newPage(browser);
    await H.boot(desk, { clearStorage: true });
    const dk = await desk.evaluate(() => ({
        isTouch: window.ACDebug.IS_TOUCH_DEVICE,
        armed: window.ACDebug.touchActive(),
        pads: getComputedStyle(document.getElementById('touch-fps')).display,
        notice: getComputedStyle(document.getElementById('desktop-only')).display,
    }));
    check('not treated as a touch device', dk.isTouch === false, JSON.stringify(dk));
    check('the touch scheme does not arm', dk.armed === false, JSON.stringify(dk));
    check('no pads on a desktop', dk.pads === 'none', dk.pads);
    check('and no notice either', dk.notice === 'none', dk.notice);
    await desk.close();

    section('Online no longer refuses to run on a phone:');
    const gate = await page.evaluate(() => ({
        isTouch: window.ACDebug.IS_TOUCH_DEVICE,
        notice: getComputedStyle(document.getElementById('desktop-only')).display,
        active: window.ACDebug.touchActive(),
    }));
    check('it knows it is on a touch device', gate.isTouch === true, JSON.stringify(gate));
    check('the "needs a computer" notice is NOT shown', gate.notice === 'none', gate.notice);
    check('the touch scheme initialised', gate.active === true, JSON.stringify(gate));

    section('The pads are hidden in the menus - they would swallow every tap:');
    const inMenu = await page.evaluate(() => {
        window.ACDebug.syncTouchFPS();
        return getComputedStyle(document.getElementById('touch-fps')).display;
    });
    check('hidden outside a fight', inMenu === 'none', inMenu);

    section('Into a fight:');
    await page.evaluate(() => {
        const D = window.ACDebug;
        D.netSetTimeout(900000);
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

    const shown = await page.evaluate(() => {
        window.ACDebug.syncTouchFPS();
        return {
            pads: getComputedStyle(document.getElementById('touch-fps')).display,
            fire: !!document.getElementById('touch-btn-fire'),
        };
    });
    check('the pads appear once the fight starts', shown.pads === 'block',
        JSON.stringify(shown));
    check('and there is a fire button', shown.fire === true, JSON.stringify(shown));

    section('The left thumb is a FLOATING stick - it centres where you touch:');
    const stick = await page.evaluate(() => {
        const D = window.ACDebug;
        D.pollTouch();                                 // drain
        window.__t.start([{ id: 1, x: 150, y: 300 }]);
        const el = document.getElementById('touch-stick');
        const placed = { left: el.style.left, top: el.style.top, display: el.style.display };
        // Push it up and right: forward and strafe-right together, which is the
        // diagonal a player actually holds.
        window.__t.move([{ id: 1, x: 150 + 40, y: 300 - 40 }]);
        const t = D.pollTouch();
        return { placed, moveX: +t.moveX.toFixed(3), moveY: +t.moveY.toFixed(3) };
    });
    check('the stick is drawn where the thumb landed, not at a fixed spot',
        stick.placed.left === '150px' && stick.placed.top === '300px'
        && stick.placed.display === 'block', JSON.stringify(stick.placed));
    check('right-and-up reads as strafe-right and forward',
        stick.moveX > 0.5 && stick.moveY > 0.5, JSON.stringify(stick));

    section('...and it clamps rather than growing past full deflection:');
    const clamp = await page.evaluate(() => {
        const D = window.ACDebug;
        window.__t.move([{ id: 1, x: 150 + 400, y: 300 }]);
        const t = D.pollTouch();
        return { moveX: +t.moveX.toFixed(4), moveY: +t.moveY.toFixed(4) };
    });
    check('a 400px shove is still exactly 1.0, not 6.9',
        Math.abs(clamp.moveX - 1) < 1e-6, JSON.stringify(clamp));

    section('A resting thumb does not walk the fighter (deadzone):');
    const dead = await page.evaluate(() => {
        const D = window.ACDebug;
        window.__t.move([{ id: 1, x: 150 + 4, y: 300 + 3 }]);
        const t = D.pollTouch();
        return { moveX: t.moveX, moveY: t.moveY };
    });
    check('a 5px drift reads as zero', dead.moveX === 0 && dead.moveY === 0,
        JSON.stringify(dead));

    section('Lifting the stick stops the fighter:');
    const lift = await page.evaluate(() => {
        const D = window.ACDebug;
        window.__t.move([{ id: 1, x: 150 + 50, y: 300 }]);
        D.pollTouch();
        window.__t.end([{ id: 1, x: 150 + 50, y: 300 }]);
        const t = D.pollTouch();
        return { moveX: t.moveX, stick: document.getElementById('touch-stick').style.display };
    });
    check('movement returns to zero and the stick is hidden',
        lift.moveX === 0 && lift.stick === 'none', JSON.stringify(lift));

    section('The right thumb aims, as a RELATIVE drag - the mouse-look model:');
    const look = await page.evaluate(() => {
        const D = window.ACDebug;
        D.pollTouch();
        window.__t.start([{ id: 2, x: 600, y: 200 }]);
        window.__t.move([{ id: 2, x: 700, y: 200 }]);   // 100px right
        const a = D.pollTouch();
        // A SECOND move of the same size must report the same delta again. If
        // the scheme measured distance from where the finger started, this
        // would report 200 - and holding still would keep turning.
        window.__t.move([{ id: 2, x: 800, y: 200 }]);
        const b = D.pollTouch();
        const held = D.pollTouch();                     // no movement at all
        window.__t.end([{ id: 2, x: 800, y: 200 }]);
        return {
            first: +a.lookX.toFixed(6), second: +b.lookX.toFixed(6),
            held: +held.lookX.toFixed(6), sens: D.TOUCH_LOOK_SENS,
        };
    });
    check('100px of drag turns by 100 * sensitivity',
        Math.abs(look.first - 100 * look.sens) < 1e-6, JSON.stringify(look));
    check('the next 100px reports the same again - relative, not absolute',
        Math.abs(look.second - look.first) < 1e-9, JSON.stringify(look));
    check('and a thumb held still turns nothing',
        look.held === 0, JSON.stringify(look));

    section('Both thumbs at once, which is the normal case:');
    const both = await page.evaluate(() => {
        const D = window.ACDebug;
        D.pollTouch();
        window.__t.start([{ id: 3, x: 120, y: 320 }]);   // left: move
        window.__t.start([{ id: 4, x: 650, y: 180 }]);   // right: look
        window.__t.move([{ id: 3, x: 120, y: 320 - 50 }]);
        window.__t.move([{ id: 4, x: 650 + 60, y: 180 }]);
        const t = D.pollTouch();
        window.__t.end([{ id: 3, x: 120, y: 270 }]);
        window.__t.end([{ id: 4, x: 710, y: 180 }]);
        return { moveY: +t.moveY.toFixed(3), lookX: +t.lookX.toFixed(5) };
    });
    check('walking forward and aiming right happen together',
        both.moveY > 0.5 && both.lookX > 0, JSON.stringify(both));

    section('A touch that starts on the RIGHT never becomes the stick:');
    // The zone decides at touchstart and is never revisited. Without that, a
    // thumb that drags from the right into the left half would seize the stick
    // mid-aim.
    const zone = await page.evaluate(() => {
        const D = window.ACDebug;
        D.pollTouch();
        window.__t.start([{ id: 5, x: 800, y: 200 }]);
        window.__t.move([{ id: 5, x: 100, y: 200 }]);    // sweeps across the middle
        const t = D.pollTouch();
        window.__t.end([{ id: 5, x: 100, y: 200 }]);
        return { moveX: t.moveX, lookX: t.lookX };
    });
    check('it stays an aim all the way across',
        zone.moveX === 0 && zone.lookX < 0, JSON.stringify(zone));

    section('Tap to fire, which is what a player tries first:');
    const tap = await page.evaluate(async () => {
        const D = window.ACDebug;
        D.pollTouch();
        window.__t.start([{ id: 6, x: 620, y: 220 }]);
        window.__t.end([{ id: 6, x: 622, y: 221 }]);     // quick, barely moved
        const quick = D.pollTouch().attack;
        // A real drag must NOT fire: you aim far more often than you shoot.
        window.__t.start([{ id: 7, x: 620, y: 220 }]);
        window.__t.move([{ id: 7, x: 700, y: 220 }]);
        D.pollTouch();
        window.__t.end([{ id: 7, x: 700, y: 220 }]);
        const dragged = D.pollTouch().attack;
        return { quick, dragged };
    });
    check('a quick tap on the aim area fires', tap.quick === true, JSON.stringify(tap));
    check('a drag does not', tap.dragged === false, JSON.stringify(tap));

    section('The action buttons:');
    const btns = await page.evaluate(() => {
        const D = window.ACDebug;
        D.pollTouch();
        const out = {};
        for (const [id, key] of [['touch-btn-fire', 'attack'],
                                 ['touch-btn-special', 'special'],
                                 ['touch-btn-dash', 'dodge'],
                                 ['touch-btn-jump', 'jump']]) {
            const el = document.getElementById(id);
            const ev = window.__t.mk('touchstart', [{ id: 9, x: 0, y: 0 }]);
            el.dispatchEvent(ev);
            const t = D.pollTouch();
            out[key] = t[key] === true;
            out[key + 'Lit'] = el.classList.contains('pressed');
            el.dispatchEvent(window.__t.mk('touchend', [{ id: 9, x: 0, y: 0 }]));
        }
        return out;
    });
    for (const k of ['attack', 'special', 'dodge', 'jump']) {
        check(k + ' fires on the frame the thumb lands', btns[k] === true,
            JSON.stringify(btns));
    }
    check('and every button lights up while held',
        ['attack', 'special', 'dodge', 'jump'].every(k => btns[k + 'Lit']),
        JSON.stringify(btns));

    section('A button press is not also an aim drag:');
    // The buttons sit inside the look area. Without stopPropagation, pressing
    // fire would also swing the camera.
    const noBleed = await page.evaluate(() => {
        const D = window.ACDebug;
        D.pollTouch();
        const el = document.getElementById('touch-btn-fire');
        el.dispatchEvent(window.__t.mk('touchstart', [{ id: 11, x: 790, y: 330 }]));
        const t = D.pollTouch();
        el.dispatchEvent(window.__t.mk('touchend', [{ id: 11, x: 790, y: 330 }]));
        return { attack: t.attack, lookX: t.lookX };
    });
    check('firing does not move the camera',
        noBleed.attack === true && noBleed.lookX === 0, JSON.stringify(noBleed));

    section('Leaving the fight releases everything:');
    // A fighter that keeps walking while the pause menu is open is the classic
    // version of this bug.
    // releaseTouch() directly, not by faking the match state: gameState is
    // exposed read-only, so assigning to it is a silent no-op - which is what
    // the first version of this assertion did, and it reported moveY still 1
    // as if the release were broken.
    const released = await page.evaluate(() => {
        const D = window.ACDebug;
        window.__t.start([{ id: 12, x: 120, y: 320 }]);
        window.__t.move([{ id: 12, x: 120, y: 240 }]);
        const latched = D.pollTouch().moveY;       // held between frames, by design
        window.__t.move([{ id: 12, x: 120, y: 240 }]);
        D.releaseTouch();
        const t = D.pollTouch();
        return { latched: +latched.toFixed(2), moveY: t.moveY, lookX: t.lookX,
                 stick: document.getElementById('touch-stick').style.display };
    });
    check('movement really was latched on, so there is something to release',
        released.latched > 0.5, JSON.stringify(released));
    check('movement and aim are both zeroed',
        released.moveY === 0 && released.lookX === 0, JSON.stringify(released));
    check('and the stick is taken off the screen',
        released.stick === 'none', JSON.stringify(released));

    await page.screenshot({ path: DIR + 'touch-fps-landscape.png' });

    section('Portrait says so instead of serving an unplayable view:');
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2,
                             isMobile: true, hasTouch: true });
    const portrait = await page.evaluate(() => {
        window.ACDebug.syncTouchOrientation();
        return getComputedStyle(document.getElementById('touch-rotate')).display;
    });
    check('the rotate prompt is shown', portrait === 'flex', portrait);
    await page.setViewport(PHONE.viewport);
    const back = await page.evaluate(() => {
        window.ACDebug.syncTouchOrientation();
        return getComputedStyle(document.getElementById('touch-rotate')).display;
    });
    check('and hidden again in landscape', back === 'none', back);

    // ================================================ THE LOCAL BUILD: NOTHING
    section('The local build has no touch scheme AT ALL, not a hidden one:');
    const local = await H.newPage(browser);
    await local.emulate(PHONE);
    local.on('pageerror', e => errors.push('local: ' + String(e.message || e)));
    await local.goto(H.gameUrl('/local/index.html'), { waitUntil: 'load' });
    await H.sleep(1500);
    const bare = await local.evaluate(() => {
        const D = window.ACDebug || {};
        const ids = ['touch-fps', 'touch-stick', 'touch-buttons', 'touch-btn-fire',
                     'touch-rotate', 'touch-controls', 'touch-p1', 'touch-p2',
                     'orientation-prompt', 'touch-warning', 'joy-p1', 'look-p1'];
        return {
            booted: !!window.ACDebug,
            present: ids.filter(id => !!document.getElementById(id)),
            notice: getComputedStyle(document.getElementById('desktop-only')).display,
            // The module loads here and must refuse to arm.
            armed: typeof D.touchActive === 'function' ? D.touchActive() : 'no fn',
            // The retired scheme's own names must be gone, not merely unused.
            retired: ['touchTurn', 'touchLook', 'syncTouchUI', 'setupTouchJoystick']
                .filter(n => typeof window[n] !== 'undefined' || n in D),
        };
    });
    check('the local build still boots on a phone', bare.booted === true,
        JSON.stringify(dead));
    check('not one touch element exists', bare.present.length === 0,
        bare.present.join(', ') || 'none');
    check('the shared module refuses to arm here', bare.armed === false,
        String(bare.armed));
    check('and the retired scheme leaves no names behind',
        bare.retired.length === 0, bare.retired.join(', ') || 'none');
    check('what a phone gets is the notice, and only that',
        bare.notice === 'flex', bare.notice);
    await local.screenshot({ path: DIR + 'touch-local-refuses.png' });

    check('no errors thrown', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
    await finish(browser, page);
})();
