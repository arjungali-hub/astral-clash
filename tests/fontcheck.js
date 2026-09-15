// Batch 41: every piece of visible text renders in the game's own typeface.
//
// Reported with a screenshot of the character select still in the browser
// default. The cause is that `button`, `input`, `select` and `textarea` do NOT
// inherit font-family - the UA stylesheet gives them their own - so setting it
// on `body` reaches paragraphs and misses every control. In this game that is
// most of the text: the roster cards are buttons, the coin counts live in
// buttons, the room code is an input.
//
// This walks the real DOM and fails on anything rendering in a family that is
// not ours, which is the only way to catch the next one of these.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true });

    const audit = () => page.evaluate(() => {
        const OURS = ['AstralDisplay', 'AstralHUD'];
        const bad = [];
        let checked = 0;
        const hasText = el => [...el.childNodes].some(n =>
            n.nodeType === 3 && n.textContent.trim().length > 0);
        document.querySelectorAll('body *').forEach(el => {
            if (!hasText(el)) return;
            // Only what is actually on screen.
            if (!el.getClientRects().length) return;
            checked++;
            const fam = getComputedStyle(el).fontFamily || '';
            if (!OURS.some(f => fam.includes(f))) {
                bad.push({
                    tag: el.tagName.toLowerCase(),
                    cls: (el.className || '').toString().slice(0, 28),
                    id: el.id || '',
                    family: fam.slice(0, 40),
                    text: (el.textContent || '').trim().slice(0, 24),
                });
            }
        });
        return { checked, bad: bad.slice(0, 12), total: bad.length };
    });

    section('The home screen:');
    let a = await audit();
    check('there is visible text to audit', a.checked > 5, 'checked ' + a.checked);
    check('all of it is in the game typeface', a.total === 0,
        a.total + ' element(s): ' + JSON.stringify(a.bad));

    section('The room, where the roster cards are buttons:');
    await page.evaluate(() => {
        const D = window.ACDebug;
        D.netSetTimeout(900000);
        D.netFakeConnect('host');
        D.previewPick('p1', 'Kaelen');
    });
    await H.sleep(300);
    a = await audit();
    check('the roster and detail panel are in the typeface too', a.total === 0,
        a.total + ' element(s): ' + JSON.stringify(a.bad));

    section('The armory:');
    await page.evaluate(() => { window.ACDebug.addCoins('p1', 1200); window.ACDebug.openShop('p1'); });
    await H.sleep(300);
    a = await audit();
    check('shop cards, prices and buttons are in the typeface', a.total === 0,
        a.total + ' element(s): ' + JSON.stringify(a.bad));

    section('Settings and How to Play:');
    await page.evaluate(() => {
        document.getElementById('btn-shop-close').click();
        window.ACDebug.openTutorial(false);
    });
    await H.sleep(300);
    a = await audit();
    check('the tutorial is in the typeface', a.total === 0,
        a.total + ' element(s): ' + JSON.stringify(a.bad));

    section('The canvas HUD uses it as well:');
    const canvasFonts = await page.evaluate(() => ({
        hud: window.ACDebug.hudFont(12, true),
        announce: window.ACDebug.announceFont ? window.ACDebug.announceFont(40, 800) : null,
    }));
    check('hudFont names AstralHUD', /AstralHUD/.test(canvasFonts.hud), canvasFonts.hud);
    check('announceFont names AstralDisplay',
        !!canvasFonts.announce && /AstralDisplay/.test(canvasFonts.announce), canvasFonts.announce);

    await finish(browser, page);
})();
