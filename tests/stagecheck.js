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

    // --------------------------------------------------------------- results
    // THE MATCH IS OVER: the winner stands, the loser falls - and gets up
    // again when the next screen loads, because the room after a lost match
    // must not show your fighter lying on the dais you are about to pick from.
    section('At the end of a match the winner stands and the loser falls');
    if (!await intoAFight(page)) {
        check('reached a fight to finish', false, 'never left the menu');
    } else {
        const names = await page.evaluate(() => [player1.name, player2.name]);
        await page.evaluate(() => { winner = player1; isDraw = false; window.ACDebug.endMatch(); });
        const both = await H.waitInPage(page,
            "menuStageStats().wants === 'results' && menuStageStats().actors[1] !== null && menuStageStats().drawn > 0", 90000);
        s = await stats(page);
        check('the results screen asks for the results shot', s && s.wants === 'results', s && s.wants);
        check('the winner stands in front, the loser behind', both
            && s.actors[0] === names[0] && s.actors[1] === names[1], JSON.stringify(s && s.actors));
        check('the loser is down and the winner is not', s && s.down[0] === false && s.down[1] === true,
            JSON.stringify(s && s.down));
        // THE MENUS' OWN CLIPS (art/menu_clips.py), not a fight's borrowed:
        // the winner celebrates on a loop, the loser's knees go.
        check('the winner celebrates (Victory) and the loser is beaten (Defeat)',
            s && s.clips && s.clips[0] === 'Victory' && s.clips[1] === 'Defeat', JSON.stringify(s && s.clips));
        // After a DRAW, not after the fall: the grounding happens as the
        // frame is drawn, and on a slow machine the stage draws on demand.
        // The first version measured straight away and caught the body in
        // the air between the fall starting and the frame that lays it down.
        const d0 = (await stats(page)).drawn;
        await page.evaluate(() => { menuStage.dirty = true; });
        await H.waitInPage(page, 'menuStageStats().drawn > ' + d0, 30000);
        // THE BODY, not the bones: every vertex skinned as the GPU skins it
        // (SkinnedMesh.boneTransform), and the lowest of them. Defeat is
        // planted on the floor by its mesh, so this is the measure that means
        // "resting on the dais" - a knee joint sits a knee's thickness above it.
        const lowest = await page.evaluate(() => {
            const a = menuStage.actors[1];
            a.fighter.updateMatrixWorld(true);
            let low = Infinity;
            const v = new THREE.Vector3();
            a.fighter.traverse(o => {
                if (!o.isSkinnedMesh) return;
                const n = o.geometry.attributes.position.count;
                for (let k = 0; k < n; k++) {
                    o.boneTransform(k, v);
                    v.applyMatrix4(o.matrixWorld);
                    if (v.y < low) low = v.y;
                }
            });
            const top = new THREE.Vector3().setFromMatrixPosition(a.holder.matrixWorld).y;
            return { low: Math.round(low * 10) / 10, top: Math.round(top * 10) / 10, clip: menuStageStats().clips[1] };
        });
        // Resting on the dais, neither hung above it - the Death clip alone left
        // a fallen fighter forty pixels in the air - nor sunk into it.
        check('and rests on their dais, neither above it nor through it', Math.abs(lowest.low - lowest.top) < 1.5,
            JSON.stringify(lowest));

        section('...and gets up again when the screen changes');
        await page.evaluate(() => window.ACDebug.goHome());
        await H.waitInPage(page, "menuStageStats().wants === 'home'", 30000);
        s = await stats(page);
        check('nobody is still down on Home', s && s.down.every(d => !d), JSON.stringify(s && s.down));
        check('...or still celebrating', s && s.clips && s.clips.every(c => c !== 'Victory' && c !== 'Defeat'),
            JSON.stringify(s && s.clips));
    }

    // ----------------------------------------------------------------- local
    section('The local build has no Home; its stage is the pair between the panels');
    const local = await H.newPage(browser);
    await local.setViewport(VIEW);
    await H.boot(local, { clearStorage: true, path: '/local/index.html', query: 'stage=live' });
    const localDrew = await H.waitInPage(local, 'menuStageStats() && menuStageStats().drawn > 0', 120000);
    s = await stats(local);
    check('the select screen asks for the duel', s && s.wants === 'duel', s && s.wants);
    check('and it draws', localDrew, JSON.stringify(s));
    check('with nobody standing on it yet', s && s.actors.every(n => n === null), JSON.stringify(s && s.actors));
    // Player 1 looks at a fighter; player 2 has not.
    const looked = await local.evaluate(() => {
        const b = document.querySelector('#p1-grid .fighter-btn');
        b.click();
        return b.dataset.name;
    });
    check('P1 looking at a fighter puts them on the left dais',
        await H.waitInPage(local, 'menuStageStats().actors[0] === ' + JSON.stringify(looked), 60000),
        JSON.stringify(await stats(local)));
    check('and leaves the right one empty', (await stats(local)).actors[1] === null);
    check('local page logged no errors', local.errors.length === 0, JSON.stringify(local.errors.slice(0, 2)));
    await local.close();

    // ------------------------------------------------------------- the room
    section('In the online room, left is you and right is them');
    await page.evaluate(() => window.ACDebug.enterRoom());
    await H.waitInPage(page, "menuStageStats().wants === 'duel'", 10000);
    const mine = await page.evaluate(() => {
        const b = document.querySelector('#p1-grid .fighter-btn');
        b.click();
        return b.dataset.name;
    });
    check('your pick stands on the left',
        await H.waitInPage(page, 'menuStageStats().actors[0] === ' + JSON.stringify(mine), 60000),
        JSON.stringify(await stats(page)));
    const slots = await page.evaluate(() => {
        const st = menuStage;
        st.slotsRead = false; st.dirty = true;
        return new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done({
            a: st.actors[0].slot, b: st.actors[1].slot,
            ax: st.actors[0].group.position.x, bx: st.actors[1].group.position.x,
        }))));
    });
    check('both slots were found on the page', !!slots.a && !!slots.b, JSON.stringify(slots));
    check('and the fighters stand apart, yours to the left', slots.ax < -1 && slots.bx > 1,
        'x ' + Math.round(slots.ax) + ' and ' + Math.round(slots.bx));
    await page.evaluate(() => window.ACDebug.goHome());

    await finish(browser, page);
})();
