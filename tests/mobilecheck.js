// Verifies both halves of the mobile story, on a real emulated phone:
//   1. the desktop build tells you to switch to a computer,
//   2. the archived build is single-player vs bot there, one full-screen view.
const H = require('./harness');
const DIR = H.path.resolve(__dirname, 'screenshots') + '/';

const IPHONE = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
        + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true },
};

(async () => {
    const b = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();

    section('Desktop build: no notice on a desktop:');
    const desk = await H.newPage(b);
    await desk.goto(H.gameUrl(), { waitUntil: 'load' });
    await H.sleep(1200);
    const d = await desk.evaluate(() => ({
        detected: window.ACDebug.IS_TOUCH_DEVICE,
        shown: getComputedStyle(document.getElementById('desktop-only')).display,
    }));
    check('not treated as a touch device', d.detected === false, JSON.stringify(d));
    check('the notice stays hidden', d.shown === 'none', d.shown);

    section('Desktop build on a phone: tells you to use a computer:');
    const mob = await H.newPage(b);
    await mob.emulate(IPHONE);
    await mob.goto(H.gameUrl(), { waitUntil: 'load' });
    await H.sleep(1500);
    const m = await mob.evaluate(() => ({
        detected: window.ACDebug.IS_TOUCH_DEVICE,
        shown: getComputedStyle(document.getElementById('desktop-only')).display,
        heading: document.querySelector('#desktop-only h3').textContent.trim(),
        hasLegacyBtn: !!document.getElementById('btn-mobile-legacy'),
        hasAnywayBtn: !!document.getElementById('btn-mobile-anyway'),
    }));
    check('detected as a touch device', m.detected === true, JSON.stringify(m));
    check('the notice is shown', m.shown === 'flex', m.shown);
    check('it offers the touch build and an override',
        m.hasLegacyBtn && m.hasAnywayBtn, JSON.stringify(m));
    await mob.screenshot({ path: DIR + 'b33-mobile-notice.png' });

    const dismissed = await mob.evaluate(() => {
        document.getElementById('btn-mobile-anyway').click();
        return getComputedStyle(document.getElementById('desktop-only')).display;
    });
    check('continue-anyway dismisses it, for a mis-detected hybrid device',
        dismissed === 'none', dismissed);

    section('Archived build on a phone: single-player vs bot:');
    await mob.goto(H.gameUrl().replace('/index.html', '/legacy/local-splitscreen.html'), { waitUntil: 'load' });
    await H.sleep(1800);
    await mob.evaluate(() => { const c = document.querySelector('#btn-tutorial-close'); if (c) c.click(); });
    await H.sleep(300);
    const solo = await mob.evaluate(() => {
        const D = window.ACDebug;
        const t1 = document.getElementById('btn-toggle-bot-p1');
        const t2 = document.getElementById('btn-toggle-bot');
        return {
            mobileSolo: D.MOBILE_SOLO,
            p1IsBot: D.p1IsBot, p2IsBot: D.p2IsBot,
            toggle1Hidden: getComputedStyle(t1).display === 'none',
            toggle2Hidden: getComputedStyle(t2).display === 'none',
            hint: (document.getElementById('touch-warning') || {}).textContent || '',
        };
    });
    check('the archived build knows it is on a phone', solo.mobileSolo === true, JSON.stringify(solo));
    check('P2 is forced to a bot and P1 stays human',
        solo.p2IsBot === true && solo.p1IsBot === false, JSON.stringify(solo));
    check('both bot toggles are hidden - there is nothing to choose',
        solo.toggle1Hidden && solo.toggle2Hidden, JSON.stringify(solo));
    check('the hint says single-player rather than split-screen',
        /single-player/i.test(solo.hint) && !/split the screen/i.test(solo.hint), solo.hint.slice(0, 90));

    // Start a match and confirm it is ONE full-screen view, not two halves.
    await mob.evaluate(() => {
        document.querySelectorAll('#p1-grid .fighter-btn')[0].click();
        const c = document.querySelector('#p1-detail .btn-confirm');
        if (c) c.click();
    });
    await H.sleep(600);
    await mob.evaluate(() => { const c = document.querySelectorAll('#mapselect-grid .map-card'); if (c.length) c[0].click(); });
    const reached = await H.waitInPage(mob, "window.ACDebug.gameState === 'FIGHT'", 60000);
    const view = await mob.evaluate(() => {
        const D = window.ACDebug;
        const p2pad = document.getElementById('touch-p2');
        return {
            state: D.gameState,
            p2IsBot: D.p2IsBot,
            viewports: D.hudViewports ? D.hudViewports().length : null,
            p2PadHidden: p2pad ? getComputedStyle(p2pad).display === 'none' : null,
        };
    });
    check('a solo match starts', reached && view.state === 'FIGHT', JSON.stringify(view));
    check('one full-screen view, not a split', view.viewports === 1, JSON.stringify(view));
    check('the second player\'s touch pad is not shown', view.p2PadHidden === true, JSON.stringify(view));
    await mob.screenshot({ path: DIR + 'b33-mobile-solo.png' });

    // Coins must not be farmable here.
    const coins = await mob.evaluate(() => {
        const D = window.ACDebug;
        const before = D.prog('p1').coins;
        D.addCoins('p1', 100);
        return { before, after: D.prog('p1').coins };
    });
    check('bot matches on mobile pay no coins',
        coins.after === coins.before, JSON.stringify(coins));

    await finish(b, mob);
})();
