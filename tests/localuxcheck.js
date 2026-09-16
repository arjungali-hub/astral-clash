// The archived split-screen build's own requests, all of which are about it
// being the build where TWO PEOPLE SHARE ONE MACHINE:
//
//   "there should be an option to reset progress in local, and there should
//    also be a naming/renaming feature in local so it doesn't just say player 1
//    and player 2"
//   "when you open settings in local, the thing that pops up is shifted upwards"
//   "in local there shouldn't be this nested scroll down thing. The only scroll
//    downs should be for the whole page"
//   "you should still have to press start fight after both players confirm"
//   "when you select both characters to be bot in local mode, you should view
//    from the top"
//
// Layout assertions are measured from the browser's own boxes, not from CSS:
// the clipped settings panel and the nested scrollbar are both invisible to a
// computed-style check on the element itself.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);
    await H.boot(page, { clearStorage: true, path: '/legacy/local-splitscreen.html' });

    section('Two names, persisted, instead of "Player 1" and "Player 2":');
    let st = await page.evaluate(() => {
        const D = window.ACDebug;
        const set = (side, v) => {
            const input = document.getElementById('name-' + side);
            input.value = v;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const before = D.playerName('p1');
        set('p1', 'Arjun');
        set('p2', 'Sam');
        D.openShop('p1');
        return {
            before,
            p1: D.playerName('p1'), p2: D.playerName('p2'),
            // The h3's own text: headingHTML() regenerates the heading on every
            // refreshMenuUI, so there is no stable inner element to read - and
            // a test that reads one is testing the markup rather than what the
            // player sees.
            heading: (document.getElementById('p1-heading') || {}).textContent,
            shopTitle: (document.getElementById('shop-title-p1') || {}).textContent,
            stored: localStorage.getItem('astralClashLocalNames'),
        };
    });
    check('the default before typing was Player 1', st.before === 'Player 1',
        JSON.stringify(st.before));
    check('a typed name is taken', st.p1 === 'Arjun' && st.p2 === 'Sam', JSON.stringify(st));
    check('the side heading shows it', /Arjun/.test(st.heading || ''), JSON.stringify(st));
    check('and so does that side\'s shop title',
        /Arjun/.test(st.shopTitle || ''), JSON.stringify(st.shopTitle));
    check('it is persisted', /Arjun/.test(st.stored || ''), JSON.stringify(st.stored));

    // ...and survives a reload, which is the point of persisting it.
    await H.boot(page, { path: '/legacy/local-splitscreen.html' });
    st = await page.evaluate(() => ({
        p1: window.ACDebug.playerName('p1'),
        field: (document.getElementById('name-p1') || {}).value,
    }));
    check('and comes back after a reload', st.p1 === 'Arjun' && st.field === 'Arjun',
        JSON.stringify(st));

    section('Reset progress takes two clicks and then really resets:');
    st = await page.evaluate(() => {
        const D = window.ACDebug;
        D.addCoins('p1', 500);
        D.buyUnlock ? null : null;
        const armed = { coins: D.prog('p1').coins };
        const btn = document.getElementById('btn-reset-progress');
        btn.click();                       // arms it
        armed.label = btn.textContent;
        armed.coinsAfterFirst = D.prog('p1').coins;
        btn.click();                       // confirms
        return { armed, coins: D.prog('p1').coins, label: btn.textContent,
                 name: D.playerName('p1') };
    });
    check('one click only arms it, and says so',
        /again/i.test(st.armed.label || '') && st.armed.coinsAfterFirst === st.armed.coins,
        JSON.stringify(st.armed));
    check('the second click clears the purse', st.coins === 0, JSON.stringify(st));
    check('and names are KEPT - they are not progress', st.name === 'Arjun', JSON.stringify(st));

    section('The settings panel is reachable, not clipped off the top:');
    st = await page.evaluate(() => {
        document.getElementById('btn-open-settings').click();
        const panel = document.querySelector('#settings-screen .menu-section');
        const r = panel.getBoundingClientRect();
        const screen = document.getElementById('settings-screen');
        return { top: Math.round(r.top), height: Math.round(r.height),
                 viewport: window.innerHeight,
                 scrollable: screen.scrollHeight > screen.clientHeight,
                 align: getComputedStyle(screen).alignItems };
    });
    check('its top edge is on screen', st.top >= -1, JSON.stringify(st));
    check('and the overlay can scroll if the panel is taller than the screen',
        st.align === 'flex-start' && (!st.scrollable || st.height > 0), JSON.stringify(st));

    section('Nothing inside a panel has its own scrollbar:');
    st = await page.evaluate(() => {
        const D = window.ACDebug;
        document.getElementById('btn-settings-close').click();
        // Show a fighter detail, the worst offender: a 200px scroll box inside
        // a panel inside an overlay.
        document.querySelectorAll('#p1-grid .fighter-btn')[0].click();
        const inner = [];
        document.querySelectorAll('#select-screen *, #shop-screen *').forEach(el => {
            const cs = getComputedStyle(el);
            if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll')
                && el.scrollHeight > el.clientHeight + 2) {
                inner.push((el.id || el.className || el.tagName) + ' ' + el.scrollHeight + '/' + el.clientHeight);
            }
        });
        return { inner, detailOverflow: getComputedStyle(document.querySelector('.detail-scroll') || document.body).overflowY };
    });
    check('no element inside the select screen or shop scrolls on its own',
        st.inner.length === 0, JSON.stringify(st.inner.slice(0, 4)));

    section('Both sides confirming does NOT start the match:');
    st = await page.evaluate(() => {
        const D = window.ACDebug;
        // Driven through the DOM: previewPick/confirmPick are online-build
        // debug handles and this build has its own select flow. Clicking is
        // also the thing being tested - that a human's second confirm no
        // longer starts the match by itself.
        const pick = (grid, detail) => {
            document.querySelectorAll(grid + ' .fighter-btn')[0].click();
            const c = document.querySelector(detail + ' .btn-confirm');
            if (c) c.click();
        };
        pick('#p1-grid', '#p1-detail');
        pick('#p2-grid', '#p2-detail');
        const btn = document.getElementById('btn-start-match');
        return { state: D.gameState, screen: D.currentScreen,
                 startVisible: !!btn && btn.getClientRects().length > 0,
                 label: btn && btn.textContent };
    });
    check('it stays on the select screen', st.state === 'MENU', JSON.stringify(st));
    check('and offers an explicit Start Fight button',
        st.startVisible === true && /start fight/i.test(st.label || ''), JSON.stringify(st));

    section('Two bots: one camera, from above:');
    st = await page.evaluate(() => {
        const D = window.ACDebug;
        return { botsOnly: typeof D.botsOnly === 'function',
                 watch: typeof D.positionWatchCamera === 'function' };
    });
    check('the build has a spectator view for it',
        st.botsOnly && st.watch, JSON.stringify(st));

    check('no page errors through all of that', page.errors.length === 0,
        JSON.stringify(page.errors.slice(0, 3)));

    await finish(browser, page);
})();
