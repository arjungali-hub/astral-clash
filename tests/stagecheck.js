// The menu stage: live 3D behind Home, on the game's one renderer.
//
//     node tests/stagecheck.js
//
// WHY THIS FILE EXISTS. Every other checker boots with `stage=poster` (see
// gameUrl in harness.js), which is right for them and means that between them
// they run none of shared/menustage.js past its first `return`. This is the
// one that asks for `stage=live`.
//
// WHAT IT IS REALLY CHECKING is not that a fighter appears - a screenshot does
// that better - but the four promises the stage makes to the rest of the game,
// each of which fails silently:
//
//   * IT GIVES THE CANVAS BACK. On Home the canvas fills the roomy frame, up
//     to 1000px tall. A match is capped at 1170x650 because the field of view
//     is fixed, so a taller canvas simply sees more arena. If the renderer were
//     still stage-sized when a match began, one player would have a bigger
//     window onto the fight than the other, and nothing would look broken.
//   * IT STEPS DOWN AND NEVER BACK UP. Fed slow frames it goes high -> medium
//     -> still; fed fast ones afterwards it stays where it is.
//   * IT STOPS UNDER A MODAL. Nothing can be seen through one.
//   * IT DISPOSES WHAT IT MAKES. Swapping the fighter back and forth must
//     leave the renderer holding what it held after the first swap.
//
// ...and one promise the poster tier makes to the other 54 checkers: that it
// builds nothing at all.
const H = require('./harness');

const VIEW = { width: 1400, height: 1000 };
// What a match gets at that window: min(96vw, 1170) by min(96vh, 650).
const MATCH = { w: 1170, h: 650 };

const stats = (page) => page.evaluate(() => menuStageStats());
const surface = (page) => page.evaluate(() => {
    const c = document.getElementById('gameCanvas').getBoundingClientRect();
    const g = document.getElementById('game-container');
    const v = new THREE.Vector2();
    menuStage.X.renderer.getSize(v);
    return {
        cssW: Math.round(c.width), cssH: Math.round(c.height),
        frameH: g.clientHeight, rendW: v.x, rendH: v.y,
        html: document.documentElement.className,
        opacity: getComputedStyle(document.getElementById('gameCanvas')).opacity,
    };
});

// bootcheck's path into the arena: the shortest one that reaches FIGHT.
async function intoAFight(page) {
    await page.evaluate(() => {
        window.ACDebug.setDebugUnlockAll(true);
        for (const s of ['p1', 'p2']) {
            const b = document.querySelector('#' + s + '-grid .fighter-btn');
            if (b) b.click();
            const c = document.querySelector('#' + s + '-detail .btn-confirm');
            if (c) c.click();
        }
        const st = document.getElementById('btn-start-match');
        if (st) st.click();
        const card = document.querySelectorAll('#mapselect-grid .map-card')[0];
        if (card) card.click();
    });
    return H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 70000);
}

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();

    // ---------------------------------------------------------------- poster
    section('The poster tier builds nothing (what every other checker runs)');
    const poster = await H.newPage(browser);
    await poster.setViewport(VIEW);
    await H.boot(poster, { clearStorage: true });
    await H.sleep(1500);
    let s = await stats(poster);
    check('tier is poster', s && s.tier === 'poster', JSON.stringify(s));
    check('no scene was built', s && s.built === false);
    check('nothing was drawn', s && s.drawn === 0);
    const p = await poster.evaluate(() => {
        const g = document.getElementById('game-container');
        return {
            bg: getComputedStyle(g).backgroundImage,
            canvasH: Math.round(document.getElementById('gameCanvas').getBoundingClientRect().height),
            opacity: getComputedStyle(document.getElementById('gameCanvas')).opacity,
            html: document.documentElement.className,
        };
    });
    check('the frame shows the baked shot', /stage-home/.test(p.bg), p.bg);
    check('the canvas is hidden behind it', p.opacity === '0', 'opacity ' + p.opacity);
    check('the canvas keeps its match size', p.canvasH === MATCH.h, 'height ' + p.canvasH);
    check('nothing claims the canvas', !/stage-live|stage-on/.test(p.html), p.html);
    check('poster page logged no errors', poster.errors.length === 0, JSON.stringify(poster.errors.slice(0, 2)));
    await poster.close();

    // ------------------------------------------------------------------ live
    section('Asked for, the stage draws a fighter on Home');
    const page = await H.newPage(browser);
    await page.setViewport(VIEW);
    await H.boot(page, { clearStorage: true, query: 'stage=live' });
    const drew = await H.waitInPage(page, 'menuStageStats() && menuStageStats().drawn > 0', 120000);
    s = await stats(page);
    check('it drew', drew, JSON.stringify(s));
    check('with the default fighter standing on it', s && s.fighter === 'Kaelen', s && s.fighter);
    // WAITED FOR, not slept past. The fade is a 320ms CSS transition, and a
    // transition is measured in frames the compositor actually gets: on a
    // software rasteriser doing three or four a second, 700ms later it read
    // 0.17. A sleep here was a claim about how fast the runner is.
    const faded = await H.waitInPage(page,
        "getComputedStyle(document.getElementById('gameCanvas')).opacity === '1'", 30000);
    let sf = await surface(page);
    check('the canvas fills the roomy frame', sf.cssH === sf.frameH && sf.cssH > MATCH.h,
        'canvas ' + sf.cssH + ', frame ' + sf.frameH);
    check('the renderer is that size too', sf.rendH === sf.cssH && sf.rendW === sf.cssW,
        'renderer ' + sf.rendW + 'x' + sf.rendH + ', canvas ' + sf.cssW + 'x' + sf.cssH);
    check('and has faded in', faded && /stage-on/.test(sf.html), sf.html + ' opacity ' + sf.opacity);

    // -------------------------------------------------------------- watchdog
    // Fed by hand rather than left to the runner. Whether THIS machine is slow
    // enough to demote is a fact about the machine; whether the rule demotes
    // when it should is a fact about the code, and only the second is ours.
    section('The watchdog steps down, and never back up');
    const w = await page.evaluate(() => {
        const fresh = (tier) => ({ tier, watch: { sum: 0, n: 0, slow: 0 }, dirty: false, surface: false });
        const feed = (st, ms, frames) => { for (let i = 0; i < frames; i++) menuStageWatch(st, ms); return st.tier; };
        const out = {};
        let st = fresh('high');
        out.fastStaysHigh = feed(st, 16.7, 200);
        st = fresh('high');
        out.oneSlowWindow = feed(st, 30, 20);      // one window is a hiccup
        out.threeSlowWindows = feed(st, 30, 40);   // three running is a machine
        st = fresh('high');
        out.verySlowFromHigh = feed(st, 70, 20);
        st = fresh('medium');
        out.verySlowFromMedium = feed(st, 70, 20);
        out.fastAfterStill = feed(st, 16.7, 400);  // never promoted
        st = fresh('medium');
        out.fastOnMedium = feed(st, 16.7, 400);
        return out;
    });
    check('fast frames stay high', w.fastStaysHigh === 'high', w.fastStaysHigh);
    check('one slow window is forgiven', w.oneSlowWindow === 'high', w.oneSlowWindow);
    check('three in a row drop to medium', w.threeSlowWindows === 'medium', w.threeSlowWindows);
    check('under 20fps drops straight to still, from high', w.verySlowFromHigh === 'still', w.verySlowFromHigh);
    check('and from medium', w.verySlowFromMedium === 'still', w.verySlowFromMedium);
    check('fast frames afterwards do not promote still', w.fastAfterStill === 'still', w.fastAfterStill);
    check('nor medium', w.fastOnMedium === 'medium', w.fastOnMedium);

    // ----------------------------------------------------------------- modal
    section('A modal stops it');
    await page.evaluate(() => document.getElementById('btn-open-settings').click());
    await H.sleep(500);
    const before = (await stats(page)).drawn;
    // Asked to draw, repeatedly, while covered. If the cover did not stop it
    // this is what would get through.
    for (let i = 0; i < 6; i++) {
        await page.evaluate(() => { menuStage.dirty = true; });
        await H.sleep(250);
    }
    const during = (await stats(page)).drawn;
    check('nothing is drawn under Settings', during === before, before + ' -> ' + during);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { menuStage.dirty = true; });
    const resumed = await H.waitInPage(page, 'menuStageStats().drawn > ' + during, 30000);
    check('and it resumes when Settings closes', resumed);

    // ------------------------------------------------------------------ leak
    section('Swapping the fighter leaves nothing behind');
    const mem = () => page.evaluate(() => {
        const m = menuStage.X.renderer.info.memory;
        return { geometries: m.geometries, textures: m.textures };
    });
    const swap = async (name) => {
        const ok = await page.evaluate((n) => menuStageSetFighter(n), name);
        const d = (await stats(page)).drawn;
        await page.evaluate(() => { menuStage.dirty = true; });
        await H.waitInPage(page, 'menuStageStats().drawn > ' + d, 30000);
        return ok;
    };
    // Once round first: the first Lyra uploads her model's own textures, which
    // the model cache keeps on purpose. The baseline is taken after that.
    check('Lyra takes the dais', await swap('Lyra') === true);
    check('and Kaelen takes it back', await swap('Kaelen') === true);
    const base = await mem();
    for (let i = 0; i < 3; i++) { await swap('Lyra'); await swap('Kaelen'); }
    const after = await mem();
    check('geometries are flat over three more swaps', after.geometries === base.geometries,
        base.geometries + ' -> ' + after.geometries);
    check('textures are flat over three more swaps', after.textures === base.textures,
        base.textures + ' -> ' + after.textures);

    // -------------------------------------------------------------- hand-back
    section('A match gets the canvas back at match size');
    const homeWas = await page.evaluate(() => ({
        display: getComputedStyle(document.getElementById('home-screen')).display,
        y: Math.round(document.querySelector('#home-screen h1').getBoundingClientRect().top),
    }));
    const homeY = homeWas.y;
    if (!await intoAFight(page)) {
        check('reached a fight', false, 'never left the menu');
    } else {
        sf = await surface(page);
        check('the stage has let go of it', !/stage-live|stage-on/.test(sf.html), sf.html);
        check('the canvas is match-sized', sf.cssW === MATCH.w && sf.cssH === MATCH.h,
            sf.cssW + 'x' + sf.cssH);
        check('and so is the renderer', sf.rendW === MATCH.w && sf.rendH === MATCH.h,
            sf.rendW + 'x' + sf.rendH);
        const drawnInFight = (await stats(page)).drawn;
        await H.sleep(1200);
        check('the stage draws nothing during a fight', (await stats(page)).drawn === drawnInFight);

        section('...and Home is the same place when you come back to it');
        await page.evaluate(() => window.ACDebug.goHome());
        const back = await H.waitInPage(page, 'menuStageStats().drawn > ' + drawnInFight, 60000);
        check('the stage picks up again', back);
        const h = await page.evaluate(() => ({
            display: getComputedStyle(document.getElementById('home-screen')).display,
            y: Math.round(document.querySelector('#home-screen h1').getBoundingClientRect().top),
        }));
        // showScreen() used to stamp Home `display: block` on every visit after
        // the first, dropping its flex centring: the wordmark sat at y171 on
        // load and y38 after goHome(). The whole menu, 133px up the frame.
        // Compared with what a first visit had, not with a literal: the
        // point is that the two agree, and Home has already been a flex
        // column and a grid in the life of this assertion.
        check('Home is laid out as it was on first load', h.display === homeWas.display,
            homeWas.display + ' -> ' + h.display);
        check('the wordmark is where it was on first load', h.y === homeY, homeY + ' -> ' + h.y);
    }

    // ----------------------------------------------------------------- local
    section('The local build has no Home, so it builds no stage');
    const local = await H.newPage(browser);
    await local.setViewport(VIEW);
    await H.boot(local, { clearStorage: true, path: '/local/index.html', query: 'stage=live' });
    await H.sleep(2500);
    s = await stats(local);
    check('it initialised', !!s, JSON.stringify(s));
    check('no screen there asks for a shot', s && s.wants === 'none', s && s.wants);
    check('so nothing was built', s && s.built === false && s.drawn === 0, JSON.stringify(s));
    check('local page logged no errors', local.errors.length === 0, JSON.stringify(local.errors.slice(0, 2)));
    await local.close();

    await finish(browser, page);
})();
