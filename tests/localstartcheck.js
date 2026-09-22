// Does the LOCAL build actually get into a fight?
//
// WHY THIS EXISTS. local/index.html:9340 calls ensureCharModel() inside
// startMatch, and nothing in the local build or in any shared module defines
// it. The online build has it; it was never carried across.
//
// That is not a silent difference. The call sits inside the promise chain
// withLoading() waits on:
//
//     .then(() => Promise.all([p1Choice, p2Choice].map(
//         c => c && Promise.resolve(ensureCharModel(c.name)).catch(() => null))))
//
// The `.catch(() => null)` looks like it covers this and cannot: the
// ReferenceError is thrown while EVALUATING ensureCharModel(c.name), before
// there is a promise to attach a catch to. So the .then handler throws, the
// chain rejects, and whatever withLoading does on rejection is what the player
// gets - a loading screen that never lifts, which is "it freezes and then you
// can't continue".
//
// Every other local test drives menus, the store and the UI. None of them takes
// the local build all the way into a live fight, which is how a missing
// definition on the match-start path survived.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);

    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));
    page.on('console', m => {
        if (m.type() === 'error') errors.push('console: ' + m.text());
    });
    // WHICH URL 404s, not just that one did. The console only says "Failed to
    // load resource", and in a build that lives one directory down from the
    // online one, a wrong asset path is the single most likely fault - so the
    // URL is the entire diagnosis.
    const notFound = [];
    page.on('response', r => {
        if (r.status() === 404) notFound.push(r.url());
    });
    page.on('requestfailed', r => notFound.push('failed: ' + r.url()));

    // UNHANDLED REJECTIONS TOO, and this is the whole reason the bug survived.
    // puppeteer's 'pageerror' fires for uncaught EXCEPTIONS only. The
    // ReferenceError from the missing ensureCharModel was thrown inside a .then
    // handler, so it became a rejected promise instead - invisible to every
    // listener above. The symptom was a build that sat at MENU after Start
    // Fight with a clean console, which reads like nothing happened at all.
    page.on('framenavigated', async () => {
        try {
            await page.evaluate(() => {
                if (window.__acRejections) return;
                window.__acRejections = [];
                window.addEventListener('unhandledrejection', ev => {
                    const r = ev && ev.reason;
                    window.__acRejections.push(String((r && r.message) || r));
                });
            });
        } catch (e) { /* navigating away mid-install is not a failure */ }
    });

    await H.boot(page, { clearStorage: true, path: '/local/index.html' });

    section('The local build reaches a live fight:');
    // Driven through the DOM, like localuxcheck: previewPick/confirmPick are
    // online-build debug handles and this build has its own select flow with an
    // explicit Start Fight button.
    const picked = await page.evaluate(() => {
        const D = window.ACDebug;
        D.setDebugUnlockAll(true);
        const pick = (grid, detail) => {
            document.querySelectorAll(grid + ' .fighter-btn')[0].click();
            const c = document.querySelector(detail + ' .btn-confirm');
            if (c) c.click();
        };
        pick('#p1-grid', '#p1-detail');
        pick('#p2-grid', '#p2-detail');
        const btn = document.getElementById('btn-start-match');
        // VISIBLE, not merely present: the button ships with style="display:none"
        // and #btn-start-match's own listener re-checks sideReady() anyway, so
        // clicking a hidden one silently does nothing. Asserting on !!btn made
        // the earlier run report "Start Fight appears" and then fail to start.
        return {
            state: D.gameState,
            startVisible: !!btn && btn.getClientRects().length > 0,
            ready1: D.sideReady ? D.sideReady('p1') : 'no accessor',
            ready2: D.sideReady ? D.sideReady('p2') : 'no accessor',
            p1Choice: (D.p1Choice && D.p1Choice.name) || D.p1Choice || null,
            p2Choice: (D.p2Choice && D.p2Choice.name) || D.p2Choice || null,
        };
    });
    check('both sides confirm and Start Fight appears',
        picked.startVisible && picked.state === 'MENU', JSON.stringify(picked));

    // START FIGHT IS NOT THE START. beginMatch() in this build rolls any bot
    // sides and then calls openMapSelect(); choosing the arena is what calls
    // startMatch(). Stopping at the button and waiting 90 seconds for a fight
    // reported "the local build never starts a match", which was this test
    // missing a step rather than the build being broken.
    await page.evaluate(() => {
        const b = document.getElementById('btn-start-match');
        if (b) b.click();
    });
    const atMapSelect = await page.evaluate(() =>
        document.querySelectorAll('#mapselect-grid .map-card').length);
    check('Start Fight opens the arena picker', atMapSelect > 0, atMapSelect + ' cards');

    await page.evaluate(() => {
        const c = document.querySelectorAll('#mapselect-grid .map-card')[0];
        if (c) c.click();
    });
    const reached = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    const after = await page.evaluate(() => {
        const D = window.ACDebug;
        const ls = document.getElementById('loading-screen');
        const vis = ls && getComputedStyle(ls);
        return {
            state: D.gameState,
            loadingVisible: !!(vis && vis.display !== 'none' && vis.opacity !== '0'),
        };
    });
    check('choosing an arena reaches a live fight', reached, JSON.stringify(after));
    check('the loading screen is not left up', !after.loadingVisible, JSON.stringify(after));
    const rejections = await page.evaluate(() => window.__acRejections || []);
    check('no page errors starting a local match', errors.length === 0,
        errors.slice(0, 3).join(' | ') || 'none');
    check('and no unhandled promise rejections', rejections.length === 0,
        rejections.slice(0, 3).join(' | ') || 'none');
    check('every asset the local build asks for exists', notFound.length === 0,
        notFound.slice(0, 5).join(' | ') || 'none');

    await page.evaluate(() => localStorage.clear());
    await finish(browser, page);
})();
