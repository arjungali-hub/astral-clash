// The menus move - and stop moving in the right place.
//
//     node tests/motioncheck.js
//
// WHY THIS FILE EXISTS. Every other checker boots with `motion=off` (see
// gameUrl in harness.js): they measure boxes, and a box part-way through
// scaling in is the wrong size. That is right for them, and it means that
// between them they never see one animation run. This is the one that asks
// for `motion=on`.
//
// WHAT CAN GO WRONG WITH AN ANIMATION is almost never that it fails to play.
// It is what it leaves behind:
//
//   * An entrance starts from opacity 0. If it never runs, or is replaced by
//     another rule before it finishes, the element can be left INVISIBLE - and
//     it is still there, still focusable, still clickable by every checker
//     that uses el.click(). A Play button nobody can see passes smoke.
//   * A state rule that replaces an element's `animation` list plays, and then
//     the entrance plays AGAIN on the way back (see the rule at the head of
//     the MOTION block). The tile fades up from nothing every time it is
//     deselected.
//   * Motion nobody asked for: with the switch off, or reduced motion on,
//     there must be none of it.
//
// So the assertions are about the resting state, and about the off switch.
const H = require('./harness');

// Our own animations, by name: the menu layer's all start `ac-`.
const ours = () => document.getAnimations()
    .filter(a => a.animationName && a.animationName.indexOf('ac-') === 0);

// Finite ones still on their way. The wordmark's glow and Play's sheen loop
// for ever and are not waited for.
const UNFINISHED = `document.getAnimations().filter(a => a.animationName
    && a.animationName.indexOf('ac-') === 0
    && a.effect.getComputedTiming().iterations !== Infinity
    && a.playState !== 'finished').length === 0`;

// How everything inside `root` looks when nothing is moving: one line per
// visible element, in document order.
//
// COMPARED WITH THE SAME SCREEN WITH MOTION OFF, not with "opacity 1, no
// transform". The first version asserted exactly that and failed on its first
// run against a correct page: the rule under the wordmark is drawn at 85%
// opacity on purpose. What an animation must not do is leave an element
// looking different from how it looks with no animation at all - and that is
// a comparison, which needs something to compare with.
function resting(rootSel) {
    const root = document.querySelector(rootSel);
    const out = [];
    let n = 0;
    for (const el of [root, ...root.querySelectorAll('*')]) {
        n++;
        const cs = getComputedStyle(el);
        if (cs.display === 'none') continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const t = (cs.transform === 'matrix(1, 0, 0, 1, 0, 0)') ? 'none' : cs.transform;
        out.push(n + ' ' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
            + ' opacity ' + Number(cs.opacity).toFixed(2) + ' transform ' + t);
    }
    return out;
}
const differences = (now, base) => {
    const want = new Set(base);
    return now.filter(line => !want.has(line));
};

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();

    // ------------------------------------------------------------------ off
    section('With the switch off there is no motion (what every other checker runs)');
    const still = await H.newPage(browser);
    await still.setViewport({ width: 1400, height: 1000 });
    await H.boot(still, { clearStorage: true });
    await H.sleep(600);
    let r = await still.evaluate(() => ({
        cls: document.documentElement.className,
        ours: document.getAnimations().filter(a => a.animationName && a.animationName.indexOf('ac-') === 0).length,
        flag: typeof UI_MOTION !== 'undefined' ? UI_MOTION : 'missing',
    }));
    check('UI_MOTION is false', r.flag === false, String(r.flag));
    check('<html> does not carry ac-motion', !/ac-motion/.test(r.cls), r.cls);
    check('none of the menu animations is running', r.ours === 0, r.ours + ' running');
    await still.evaluate(() => document.getElementById('btn-open-settings').click());
    await H.sleep(300);
    r = await still.evaluate(() => document.getAnimations()
        .filter(a => a.animationName && a.animationName.indexOf('ac-') === 0).length);
    check('nor when a panel opens', r === 0, r + ' running');
    // What each screen looks like at rest, to hold the moving version to.
    const restSettings = await still.evaluate(resting, '#settings-screen');
    await still.keyboard.press('Escape');
    await H.sleep(300);
    const restHome = await still.evaluate(resting, '#home-screen');
    await still.close();

    section('Nor when the system asks for reduced motion, whatever the URL says');
    const calm = await H.newPage(browser);
    await calm.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await H.boot(calm, { clearStorage: true, query: 'motion=on' });
    await H.sleep(400);
    r = await calm.evaluate(() => ({
        cls: document.documentElement.className,
        ours: document.getAnimations().filter(a => a.animationName && a.animationName.indexOf('ac-') === 0).length,
    }));
    check('<html> does not carry ac-motion', !/ac-motion/.test(r.cls), r.cls);
    check('none of the menu animations is running', r.ours === 0, r.ours + ' running');
    await calm.close();

    // ------------------------------------------------------------------- on
    section('Asked for, Home builds in');
    const page = await H.newPage(browser);
    await page.setViewport({ width: 1400, height: 1000 });
    await H.boot(page, { clearStorage: true, query: 'motion=on' });
    check('<html> carries ac-motion', await page.evaluate(() => document.documentElement.classList.contains('ac-motion')));
    // Home's entrances played at load, before this could look. Leaving for the
    // room and coming back plays them again - display:none to anything
    // restarts an element's animations - and this time something is watching.
    const started = await page.evaluate(() => {
        window.ACDebug.enterRoom();
        window.ACDebug.goHome();
        const run = document.getAnimations().filter(a => a.animationName && a.animationName.indexOf('ac-') === 0);
        const home = document.getElementById('home-screen');
        return {
            total: run.length,
            inHome: run.filter(a => a.effect.target && home.contains(a.effect.target)).length,
            names: [...new Set(run.map(a => a.animationName))].sort(),
        };
    });
    check('entrances are running on Home', started.inHome >= 6, started.inHome + ' of ' + started.total);
    check('the frame is crossed by the screen-change wipe', started.names.includes('ac-wipe'), started.names.join(' '));
    check('the wordmark is breathing', started.names.includes('ac-breathe'), started.names.join(' '));
    check('Play catches the light', started.names.includes('ac-sheen'), started.names.join(' '));

    section('...and comes to rest with nothing left half-way');
    check('every finite animation finishes', await H.waitInPage(page, UNFINISHED, 30000));
    let bad = differences(await page.evaluate(resting, '#home-screen'), restHome);
    check('Home looks exactly as it does with motion off', bad.length === 0, bad.slice(0, 4).join(' | '));
    check('the wipe has cleaned up after itself',
        await page.evaluate(() => !document.getElementById('game-container').classList.contains('ac-swap')));

    section('A panel pops');
    const pop = await page.evaluate(() => {
        document.getElementById('btn-open-settings').click();
        const panel = document.querySelector('#settings-screen .menu-section');
        const run = document.getAnimations().filter(a => a.animationName && a.animationName.indexOf('ac-') === 0);
        return {
            panel: run.some(a => a.effect.target === panel && a.animationName === 'ac-pop'),
            backdrop: run.some(a => a.effect.target && a.effect.target.id === 'settings-screen'),
            rows: run.filter(a => a.effect.target && a.effect.target.closest
                && a.effect.target.closest('.settings-list') && a.animationName === 'ac-rise').length,
        };
    });
    check('the Settings panel is popping', pop.panel);
    check('its backdrop is fading in', pop.backdrop);
    check('its rows arrive one after another', pop.rows >= 5, pop.rows + ' rows');
    check('and it all finishes', await H.waitInPage(page, UNFINISHED, 30000));
    bad = differences(await page.evaluate(resting, '#settings-screen'), restSettings);
    check('Settings looks exactly as it does with motion off', bad.length === 0, bad.slice(0, 4).join(' | '));

    section('A setting that changes is seen to');
    const bumped = await page.evaluate(() => {
        const row = document.getElementById('btn-hud-scale');
        const pill = row.querySelector('.opt-state');
        const before = pill.textContent;
        row.click();
        return { changed: pill.textContent !== before, bump: pill.classList.contains('ac-bump') };
    });
    check('the value changed', bumped.changed);
    check('and its pill is bumping', bumped.bump);
    await H.waitInPage(page, UNFINISHED, 30000);
    check('the bump class is gone afterwards', await page.evaluate(() =>
        !document.querySelector('#btn-hud-scale .opt-state').classList.contains('ac-bump')));
    // Put it back: this is a stored setting, and the next section reloads.
    await page.evaluate(() => document.getElementById('btn-hud-scale').click());
    await page.keyboard.press('Escape');
    await H.sleep(300);

    section('A button gives under the pointer');
    const box = await page.evaluate(() => {
        const b = document.getElementById('btn-home-armory').getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    const pressed = await H.waitInPage(page,
        "(() => { const m = getComputedStyle(document.getElementById('btn-home-armory')).transform;"
        + " const a = /matrix\\(([^,]+)/.exec(m); return !!a && Number(a[1]) < 0.985; })()", 10000);
    check('held down, it is scaled in', pressed);
    // Moved off before release, so the press is feedback and not a click:
    // releasing over it would open the Armory.
    await page.mouse.move(box.x, 4);
    await page.mouse.up();
    check('released, it comes back to rest', await H.waitInPage(page,
        "(() => { const m = getComputedStyle(document.getElementById('btn-home-armory')).transform;"
        + " return m === 'none' || m === 'matrix(1, 0, 0, 1, 0, 0)'; })()", 10000));

    // ---------------------------------------------------------------- stage
    section('The fighter answers a tap, and goes back to standing');
    const live = await H.newPage(browser);
    await live.setViewport({ width: 1400, height: 1000 });
    await H.boot(live, { clearStorage: true, query: 'stage=live&motion=on' });
    if (!await H.waitInPage(live, 'menuStageStats() && menuStageStats().drawn > 0', 120000)) {
        check('the stage drew', false, JSON.stringify(await live.evaluate(() => menuStageStats())));
    } else {
        // The runner is a software rasteriser and the watchdog will have
        // stepped the stage down to `still`, where there is no clock to play a
        // clip on - correctly. Put it back for the length of the tap.
        const tapped = await live.evaluate(() => { menuStage.tier = 'high'; return menuStageReact(); });
        check('a tap starts a clip', tapped === true);
        check('the stage says it is reacting', await live.evaluate(() => menuStageStats().reacting === true));
        // It ends one of two ways and both are right: the clip runs out, or
        // the watchdog steps down again and the stage settles it.
        check('and it settles', await H.waitInPage(live, 'menuStageStats().reacting === false', 90000));
        const idle = await live.evaluate(() => {
            const rig = menuStage.fighter.userData.rig;
            return { current: rig.current, running: rig.actions.Idle.isRunning() };
        });
        check('back in Idle', idle.current === 'Idle' && idle.running, JSON.stringify(idle));
    }
    check('stage page logged no errors', live.errors.length === 0, JSON.stringify(live.errors.slice(0, 2)));
    await live.close();

    await finish(browser, page);
})();
