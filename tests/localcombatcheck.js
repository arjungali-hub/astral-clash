// Every character's attack and special, fired in a real LOCAL match.
//
// WHY THIS EXISTS. "The attacks still freeze the screen, at least in local mode.
// I do all of my testing in local mode." The cause then was three half-ported
// constants - SWING_WINDUP_FRAC, MUZZLE_FLASH_MAX - each throwing a
// ReferenceError on every frame of a swing. The sync now refuses to ship a build
// that references anything nothing defines, and it reports zero.
//
// But that is a STATIC argument: it proves no name is missing, not that pressing
// attack works. The checklist item "every character's attack/special/skill
// fires, connects, shows an effect" has never been ticked, and swingcheck covers
// five characters on the ONLINE build, measuring hand direction rather than
// whether anything throws.
//
// So this fires both actions for the whole playable roster, in the build the
// testing actually happens in, and watches for:
//
//   * page errors        - an uncaught throw, which is the freeze's signature
//   * unhandled rejections - a throw inside a .then, which 'pageerror' misses
//     entirely and which is exactly how the missing ensureCharModel hid
//   * the action actually starting, so a silently-ignored input cannot pass
//
// Two fighters per match, so ten characters take five matches.
const H = require('./harness');

// Paired so each match covers two, and deliberately mixing ranges: the report
// was that short-ranged characters froze, so no pair is all-ranged.
//
// The PLAYABLE roster is ten. Grint, Slagling, Hollowkin and Karrigos are in
// BOSS_MAP - Survival minions and the boss - and have no card on the select
// screen, so asking for them here just reported "not pickable", which is true
// and uninteresting. They are driven by coopcheck/crushcheck instead.
const PAIRS = [
    ['Kaelen', 'Lyra'],
    ['Gorgonok', 'Voss'],
    ['Draven', 'Seraphine'],
    ['Nyx', 'Ignis'],
    ['Aurelia', 'Thorne'],
];

async function pick(page, side, name) {
    return page.evaluate((s, n) => {
        const btns = [...document.querySelectorAll('#' + s + '-grid .fighter-btn')];
        const b = btns.find(x => x.dataset.name === n);
        if (!b) return false;
        b.click();
        const c = document.querySelector('#' + s + '-detail .btn-confirm');
        if (c) c.click();
        return true;
    }, side, name);
}

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);

    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('framenavigated', async () => {
        try {
            await page.evaluate(() => {
                if (window.__acRej) return;
                window.__acRej = [];
                window.addEventListener('unhandledrejection', ev => {
                    const r = ev && ev.reason;
                    window.__acRej.push(String((r && r.message) || r));
                });
            });
        } catch (e) { /* navigating away mid-install is not a failure */ }
    });

    section('Every character attacks and specials without throwing:');
    for (const [a, b] of PAIRS) {
        errors.length = 0;
        await H.boot(page, { clearStorage: true, path: '/local/index.html' });
        await page.evaluate(() => window.ACDebug.setDebugUnlockAll(true));

        const gotA = await pick(page, 'p1', a);
        const gotB = await pick(page, 'p2', b);
        if (!gotA || !gotB) {
            check(`${a} / ${b}: both are pickable`, false, `p1=${gotA} p2=${gotB}`);
            continue;
        }

        // Start Fight opens the arena picker; choosing the arena starts the match.
        await page.evaluate(() => {
            const s = document.getElementById('btn-start-match');
            if (s) s.click();
        });
        await page.evaluate(() => {
            const c = document.querySelectorAll('#mapselect-grid .map-card')[0];
            if (c) c.click();
        });
        const live = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
        if (!live) {
            check(`${a} / ${b}: the match starts`, false, 'never reached FIGHT');
            continue;
        }

        // Fire basic, let it play out, then special with a full meter.
        //
        // WAIT ON FRAMES, NOT ON MILLISECONDS. An attack is measured in frames -
        // startup, active and recovery all count down by `dt` - so how long one
        // takes in WALL CLOCK is entirely a function of frame rate. This loop
        // allowed 80 x 50ms = 4 seconds, which is generous at 60fps and absurd
        // at the ~1fps a CI runner manages software-rendering an arena, where a
        // 60-frame attack can take a minute.
        //
        // Scaling that budget was the first attempt and it was the wrong cure:
        // x3 moved every failure from specialState "startup" to "recovery",
        // which is the same bug reported one stage later - still the BASIC's
        // state, because idle() still gave up while the basic was running and
        // the special was still refused for that reason.
        //
        // rAF is the right clock. It advances exactly once per rendered frame
        // whatever the rate, so a budget counted in frames needs no scaling and
        // cannot be invalidated by a slow machine. It is also generous in the
        // direction that matters: at a low frame rate each frame carries a
        // larger `dt`, so an attack completes in FEWER rendered frames, not
        // more. Same clock botcheck's step() uses, for the same reason.
        const fired = await page.evaluate(async () => {
            const D = window.ACDebug;
            const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            const out = {};
            // tryStartAction RETURNS the answer and sets atkState; there is no
            // `.action` field. Reading a field that does not exist reported
            // every character as failing to attack while the build was fine.
            const idle = async (f) => {
                for (let i = 0; i < 300 && f.atkState !== 'idle'; i++) await frame();
                return f.atkState === 'idle';
            };
            for (const [key, me, foe] of [['p1', D.player1, D.player2], ['p2', D.player2, D.player1]]) {
                if (!me) { out[key] = { missing: true }; continue; }
                // The intro cinematic holds control at match start; wait it out
                // rather than firing into it and calling the refusal a bug.
                const readyForBasic = await idle(me);
                const basicStarted = me.tryStartAction('basic', foe);
                const basicState = me.atkState;
                // REPORTED, not inferred. When this is false the special was
                // refused because the basic had not finished, and that is a
                // budget running out rather than a fighter that cannot attack -
                // which is exactly the distinction the old failure hid.
                const readyForSpecial = await idle(me);
                me.specialMeter = 100;
                const specialStarted = me.tryStartAction('special', foe);
                const specialState = me.atkState;
                await idle(me);
                out[key] = { name: me.name, basicStarted, basicState,
                             specialStarted, specialState,
                             readyForBasic, readyForSpecial };
            }
            return out;
        });

        const rej = await page.evaluate(() => window.__acRej || []);
        for (const [side, name] of [['p1', a], ['p2', b]]) {
            const r = fired[side] || {};
            check(`${name}: basic and special both start`,
                r.basicStarted === true && r.specialStarted === true, JSON.stringify(r));
        }
        check(`${a} / ${b}: no errors while attacking`,
            errors.length === 0, errors.slice(0, 2).join(' | ') || 'none');
        check(`${a} / ${b}: no unhandled rejections while attacking`,
            rej.length === 0, rej.slice(0, 2).join(' | ') || 'none');
    }

    await page.evaluate(() => localStorage.clear());
    await finish(browser, page);
})();
