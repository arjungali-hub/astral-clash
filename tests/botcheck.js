// "The bot plays a competent match" - the last item on the original brief that
// no assertion could settle, because competent is a judgement.
//
// SO IT IS MADE MEASURABLE, against the one opponent whose behaviour is fully
// known: a human who does nothing. This test presses no keys. P1 stands on open
// ground and never moves, never blocks, never retaliates. Against that, a bot
// that works at all must do two things, and they fail separately:
//
//   APPROACH   close the distance. A bot that cannot find its opponent looks
//              identical, from the health bar, to one that cannot fight - and
//              the fix is in a different function.
//   CONNECT    land hits once it is there.
//
// AND THE DIAL MUST DO SOMETHING. Four difficulties that play the same is worse
// than one, because the menu then lies.
//
// MEASURED IN FRAMES, NOT SECONDS, and that is the whole reason the first
// version of this file reported a bot that did nothing at all. BOT_DIFFICULTY
// is written in frames - `easy` thinks every 30-60 of them - and this machine
// renders a live match at 2.1fps through swiftshader. A seven-SECOND window
// gave `easy` about fourteen frames: less than one decision. The bot was fine;
// the clock was measuring the renderer.
//
// The budget below is therefore in frames and is machine-independent: ~4 to 8
// decisions for the slowest setting. On a real display that is three seconds
// per arm. Here it is minutes, which is why this belongs in the slow half of CI.
//
// WHAT THIS DELIBERATELY DOES NOT CLAIM. Not that the bot is fun, fair, or good
// against someone who fights back - that still needs a person. It says the bot
// finds its opponent, hits it, and gets meaningfully better across the four
// settings. Those are the parts that could silently rot.
const H = require('./harness');

const APPROACH_FRAMES = 150;   // from ~500 units out
const FIGHT_FRAMES = 180;      // placed in range: 3-6 decisions even on `easy`
const CHUNK = 15;              // frames per CDP call, so none runs long enough to time out
const START_GAP = 500;
const DIFFICULTIES = ['easy', 'normal', 'hard', 'insane'];

const CX = 877, CY = 487;      // open ground in the first arena

// FRAME-UNITS OF GAME TIME, not rendered frames.
//
// This used to await one rendered frame per unit, and arm "easy" took 2130
// SECONDS on CI - the runner rasterises one full-screen arena in software at
// about a third of a frame per second, so rendered frames are the scarce
// resource and 350 of them per arm is unaffordable. Four arms would not have
// finished inside any budget worth setting.
//
// They are also the wrong unit. The bot thinks in frame-units: aiThinkTimer
// and every cooldown count down by `dt`, and computeDt clamps dt at 3 - so at
// a low frame rate each rendered frame carries up to three units of game time.
// Accumulating dt the way computeDt does means "150 frames of approach" gets
// the 150 units of bot thinking it always meant, in a third of the renders.
//
// The clamp is replicated rather than read from the page because computeDt
// lives inside bootGame() and a shared module cannot see in - and because the
// number that matters here is what the SIMULATION advanced by, which is the
// clamped one.
async function step(page, units) {
    return page.evaluate(async (target) => {
        let acc = 0;
        let last = performance.now();
        // A hard ceiling on renders as well, so a page that has stopped
        // painting fails the assertion that follows instead of hanging here.
        for (let renders = 0; acc < target && renders < target * 2 + 60; renders++) {
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            const now = performance.now();
            acc += Math.min(3, (now - last) / (1000 / 60));
            last = now;
        }
        return acc;
    }, units);
}

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();

    // A fresh page per difficulty: botDifficulty is read when the AI thinks, but
    // a match carries momentum - hp, cooldowns, positions - and reusing one
    // would let an earlier arm color the next.
    async function run(difficulty) {
        const page = await H.newPage(browser);
        // SMALLER THAN THE HARNESS DEFAULT. Software rasterisation costs per
        // pixel, and 1400x1000 is 1.4 megapixels of arena per frame; nothing
        // about a bot's decisions depends on resolution. Kept comfortably
        // above the ~400px the layout is responsive down to, so every button
        // this checker clicks is still where it expects.
        await page.setViewport({ width: 900, height: 700 });
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message || e)));
        await H.boot(page, { clearStorage: true, path: '/local/index.html', models: true });
        await page.evaluate(() => window.ACDebug.setDebugUnlockAll(true));
        // P2 becomes the bot. The toggle is the only route - refreshBotUI owns
        // the flag and would clear a value poked in directly.
        await page.evaluate(() => {
            const t = document.getElementById('btn-toggle-bot');
            if (t) t.click();
        });
        await H.sleep(200);
        const isBot = await page.evaluate(() => window.ACDebug.p2IsBot);
        await page.evaluate((d) => window.ACDebug.setBotDifficulty(d), difficulty);
        // Only P1 is picked by hand; a bot side chooses for itself.
        // CONDITIONS, not durations - the same change framerateccheck needed and
        // for the same reason. A 500ms gap after Confirm and 300ms after Start
        // Match are both bets that the menu repaints inside a fixed wall-clock
        // window, and this is a checker that may spend ninety minutes before
        // reporting, so a lost bet costs an entire CI run to say "never reached
        // FIGHT" without saying why. Start Match only unhides once both sides
        // are ready, which is exactly the precondition for clicking it.
        await page.evaluate(() => {
            const b = document.querySelector('#p1-grid .fighter-btn');
            if (b) b.click();
            const c = document.querySelector('#p1-detail .btn-confirm');
            if (c) c.click();
        });
        const ready = await H.waitInPage(page,
            "(() => { const s = document.getElementById('btn-start-match');"
            + " return s && s.style.display !== 'none'; })()", 30000);
        if (!ready) {
            await page.close();
            return { difficulty, isBot, failed: 'Start Match stayed hidden after P1 confirmed' };
        }
        await page.evaluate(() => document.getElementById('btn-start-match').click());
        if (!await H.waitInPage(page, "document.querySelectorAll('#mapselect-grid .map-card').length > 0", 30000)) {
            await page.close();
            return { difficulty, isBot, failed: 'the arena picker never rendered' };
        }
        await page.evaluate(() => document.querySelectorAll('#mapselect-grid .map-card')[0].click());
        const live = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
        if (!live) {
            const where = await page.evaluate(() => window.ACDebug.gameState);
            await page.close();
            return { difficulty, isBot, failed: 'never reached FIGHT (stuck in ' + where + ')' };
        }
        // The drop-in cinematic holds control at the start of a match; firing
        // into it and calling the refusal a bad bot would be the same mistake
        // localcombatcheck documents.
        await H.waitInPage(page, "window.ACDebug.player1 && window.ACDebug.player1.hp > 0", 20000);
        await step(page, 20);

        // --- APPROACH: placed 500 apart, does it come to you? ---------------
        await page.evaluate((cx, cy, gap) => {
            const D = window.ACDebug, h = D.player1, b = D.player2;
            h.x = cx; h.y = cy; h.z = 0; h.vx = 0; h.vy = 0;
            b.x = cx + gap; b.y = cy; b.z = 0; b.vx = 0; b.vy = 0;
            b.hitstunTimer = 0; b.rootedFrames = 0;
            window.__acClosest = gap;
            window.__acHold = setInterval(() => {
                h.vx = 0; h.vy = 0;                       // the human never moves
                const d = Math.hypot(b.x - h.x, b.y - h.y);
                if (d < window.__acClosest) window.__acClosest = d;
            }, 16);
        }, CX, CY, START_GAP);
        for (let i = 0; i < APPROACH_FRAMES; i += CHUNK) await step(page, CHUNK);
        const closest = await page.evaluate(() => {
            clearInterval(window.__acHold);
            return Math.round(window.__acClosest);
        });

        // --- CONNECT: placed in range, does it hit you? ---------------------
        const dmg = await page.evaluate((cx, cy) => {
            const D = window.ACDebug, h = D.player1, b = D.player2;
            h.x = cx; h.y = cy; h.z = 0; h.vx = 0; h.vy = 0;
            h.hp = h.maxHp; h.invulnFrames = 0; h.hitstunTimer = 0;
            b.x = cx + 55; b.y = cy; b.z = 0; b.vx = 0; b.vy = 0;
            b.hitstunTimer = 0; b.rootedFrames = 0; b.specialMeter = 100;
            window.__acHp0 = h.hp;
            // Re-zeroed every tick so knockback cannot drift the target out of
            // reach and end the sample somewhere the bot cannot follow.
            window.__acHold = setInterval(() => { h.vx = 0; h.vy = 0; }, 16);
            return h.hp;
        }, CX, CY);
        for (let i = 0; i < FIGHT_FRAMES; i += CHUNK) await step(page, CHUNK);
        const out = await page.evaluate(() => {
            clearInterval(window.__acHold);
            const D = window.ACDebug;
            return { damage: +(window.__acHp0 - D.player1.hp).toFixed(1) };
        });

        await page.close();
        return Object.assign({ difficulty, isBot, startGap: START_GAP, closest,
                               errors: errors.slice(0, 2) }, out, { hp0: dmg });
    }

    const results = [];
    // SAY WHERE IT GOT TO. This is the longest checker in the suite - four
    // fresh pages, each stepping 350 frames of a software-rendered match - and
    // when its watchdog fired at 900s the report was "NO VERDICT" and nothing
    // else. A timeout that cannot say which of four arms it died on costs a
    // whole CI round to narrow down. The elapsed time per arm is also the
    // number needed to judge whether the budget is near, which no amount of
    // reasoning from a desktop can supply.
    const t0 = Date.now();
    for (const d of DIFFICULTIES) {
        const armStart = Date.now();
        console.log(`    (arm ${d}: starting at ${Math.round((armStart - t0) / 1000)}s)`);
        results.push(await run(d));
        console.log(`    (arm ${d}: done in ${Math.round((Date.now() - armStart) / 1000)}s)`);
    }
    for (const r of results) console.log('    ' + JSON.stringify(r));

    section('The bot takes the field at all:');
    check('every difficulty put a bot on P2',
        results.every(r => r.isBot === true),
        JSON.stringify(results.map(r => [r.difficulty, r.isBot])));
    const started = results.filter(r => !r.failed);
    check('every difficulty reached a fight',
        started.length === DIFFICULTIES.length,
        JSON.stringify(results.map(r => r.failed || 'ok')));
    if (started.length !== DIFFICULTIES.length) { await finish(browser, null); return; }

    section('It comes to you:');
    check('every difficulty closed most of a 500-unit gap',
        results.every(r => r.closest < START_GAP * 0.45),
        JSON.stringify(results.map(r => [r.difficulty, r.closest])));

    section('It connects, and the difficulty dial does something:');
    check('every difficulty damaged a target that never fights back',
        results.every(r => r.damage > 0),
        JSON.stringify(results.map(r => [r.difficulty, r.damage])));
    const easy = results.find(r => r.difficulty === 'easy');
    const insane = results.find(r => r.difficulty === 'insane');
    check('insane out-damages easy over the same number of frames',
        insane.damage > easy.damage,
        `easy ${easy.damage} vs insane ${insane.damage} over ${FIGHT_FRAMES} frames`);

    check('no errors thrown while the bot played',
        results.every(r => !r.errors || r.errors.length === 0),
        JSON.stringify(results.map(r => r.errors).filter(e => e && e.length)) || 'none');

    await finish(browser, null);
})();
