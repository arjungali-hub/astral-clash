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
        const reached = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 30000);
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
