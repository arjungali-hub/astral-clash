// Smoke test: the page boots, the debug handle exists, the roster/shop/mode
// plumbing is present, and a match in every mode reaches a live FIGHT state.
// This is the check to run first when anything looks broken — a load-time
// exception (usually a temporal-dead-zone reference; this file has had four)
// takes the whole script down and every other checker fails confusingly.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    const page = await H.newPage(browser);
    const { check, section, finish } = H.makeChecker();

    await H.boot(page, { clearStorage: true });

    section('Boot:');
    const base = await page.evaluate(() => {
        const D = window.ACDebug;
        return {
            chars: D.CHARACTERS.length,
            modes: D.MATCH_MODES.map(m => m.id),
            starters: D.STARTER_CHARS.length,
            gridCards: document.querySelectorAll('#p1-grid .fighter-btn').length,
            order: D.CHARACTERS.map(c => D.UNLOCK_COST[c.name] || 0),
        };
    });
    check('ten characters registered', base.chars === 10, String(base.chars));
    check('roster grid rendered', base.gridCards === 10, String(base.gridCards));
    check('three starters', base.starters === 3, String(base.starters));
    check('roster is in price order', base.order.every((c, i) => i === 0 || c >= base.order[i - 1]), JSON.stringify(base.order));
    check('all five modes registered', base.modes.length === 5, JSON.stringify(base.modes));

    // Start a match in each mode and confirm it reaches FIGHT.
    for (const mode of base.modes) {
        await H.boot(page);
        await page.evaluate(m => window.ACDebug.setMatchMode(m), mode);
        await page.evaluate(() => {
            document.querySelectorAll('#p1-grid .fighter-btn')[0].click();
            document.querySelector('#p1-detail .btn-confirm').click();
            document.querySelectorAll('#p2-grid .fighter-btn')[1].click();
            document.querySelector('#p2-detail .btn-confirm').click();
        });
        await H.sleep(350);
        await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('#mapselect-grid .map-card'));
            cards[0].click();
        });
        // Batch 41: the budget depends on how many MODELS the mode needs.
        //
        // startMatch now waits for the fighters' GLBs before building them,
        // because starting early meant the fighters were built from procedural
        // placeholders for the whole round. That wait is real time: a versus
        // mode loads two ~2MB models, Boss Fight adds Karrigos and Survival
        // adds four creatures - and this harness decodes them under software
        // WebGL at roughly 20fps.
        //
        // This check was failing with `state: "FIGHT"` in its own failure
        // detail, which is the signature of a budget that expired rather than
        // a broken mode: the match arrived correctly, just after the wait gave
        // up. Attributing it to the mode would have been wrong.
        const extraModels = mode === 'survival' ? 4 : mode === 'boss' ? 1 : 0;
        // Batch 45: +20s across the board, because BLOOM made every frame more
        // expensive and this harness renders through swiftshader. The failure
        // it caused was honest and worth recording: classic and timeattack
        // reported `state: "INTRO"` - the match started fine, but the drop
        // cinematic is frame-paced, so a slower renderer stretches it in
        // wall-clock time and the wait expired mid-intro.
        //
        // Not a reason to turn bloom off: five extra full-screen passes on a
        // software rasteriser is not evidence about a real GPU. It IS a reason
        // the effect has a settings toggle.
        const budget = 50000 + extraModels * 20000;
        const reached = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", budget);
        const st = await page.evaluate(() => {
            const D = window.ACDebug;
            return { state: D.gameState, enemies: D.coopEnemies.length, coop: D.isCoopMode() };
        });
        check(`${mode}: reaches a live fight`, reached && st.state === 'FIGHT', JSON.stringify(st));
        if (st.coop) check(`${mode}: has at least one enemy`, st.enemies >= 1, String(st.enemies));
        else check(`${mode}: has no co-op enemies`, st.enemies === 0, String(st.enemies));
    }

    await page.evaluate(() => localStorage.clear());
    await finish(browser, page);
})();
