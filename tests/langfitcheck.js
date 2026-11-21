// French and Spanish FIT: every screen of the menus, in both languages, at a
// desktop window and at a phone both ways up - nothing clipped, nothing wider
// than the screen.
//
// WHY THIS EXISTS. French and Spanish run 20-40% longer than English, and the
// redesign rebuilt every screen around English labels. langcheck says every
// string IS translated; nothing said the translations fit. The redesign's last
// phase measured it once, with a probe, and the probe had a hole this closes:
// it opened each screen by clicking its button and measured whatever was then
// on show, without asking whether the click had opened anything. A button that
// silently did nothing would have measured the screen behind it and passed.
//
// So, per screen, in this order:
//   1. it is the one on show (the screen named on #game-container, or the
//      modal displayed) - a measurement of the wrong screen is not one;
//   2. the page is in the language asked for;
//   3. no visible button or setting value is wider inside than its own box
//      (scrollWidth over clientWidth: text clipped, or pushed out of sight);
//   4. the document is no wider than the screen.
//
// The local build is measured at the desktop size only: it does not play on a
// phone (it shows #desktop-only there), so a phone has nothing to measure.
const H = require('./harness');

const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SIZES = [
    ['desktop', { width: 1400, height: 1000 }, null],
    ['phone', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, PHONE_UA],
    ['phone sideways', { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
        isLandscape: true }, PHONE_UA],
];
const LANGS = { fr: 'French', es: 'Spanish' };

// [name, how to open it (in the page), what is on show once it is]
const ONLINE = [
    ['Home', null, { screen: 'home' }],
    ['the room', () => { window.ACDebug.enterRoom(); document.querySelector('#p1-grid .fighter-btn').click(); },
        { screen: 'select' }],
    ['the lobby', () => document.getElementById('btn-home-play').click(), { modal: 'lobby-screen' }],
    ['Settings', () => document.getElementById('btn-open-settings').click(), { modal: 'settings-screen' }],
    ['How to Play', () => document.getElementById('btn-open-tutorial').click(), { modal: 'tutorial-screen' }],
    ['the Armory', () => document.getElementById('btn-home-armory').click(), { modal: 'shop-screen' }],
    ['mode select', () => { window.ACDebug.netFakeConnect('host');
        document.getElementById('btn-open-modeselect').click(); }, { modal: 'modeselect-screen' }],
    ['arena select', () => { window.ACDebug.netFakeConnect('host');
        document.getElementById('btn-open-mapselect').click(); }, { modal: 'mapselect-screen' }],
    ['the account panel', () => { document.getElementById('btn-open-settings').click();
        document.getElementById('btn-account').click(); }, { modal: 'account-screen' }],
];
const LOCAL = [
    ['the select screen', null, { screen: 'select' }],
    ['Settings', () => document.getElementById('btn-open-settings').click(), { modal: 'settings-screen' }],
    ['How to Play', () => document.getElementById('btn-open-tutorial').click(), { modal: 'tutorial-screen' }],
    ['the Armory', () => document.querySelector('[data-shop-side]').click(), { modal: 'shop-screen' }],
    ['mode select', () => document.getElementById('btn-open-modeselect').click(), { modal: 'modeselect-screen' }],
    ['arena select', () => {
        const pick = (grid, detail) => {
            document.querySelectorAll(grid + ' .fighter-btn')[0].click();
            const c = document.querySelector(detail + ' .btn-confirm');
            if (c) c.click();
        };
        pick('#p1-grid', '#p1-detail');
        pick('#p2-grid', '#p2-detail');
        document.getElementById('btn-start-match').click();
    }, { modal: 'mapselect-screen' }],
];

// Runs in the page.
function measure(want) {
    const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
    const gc = document.getElementById('game-container');
    const onShow = want.screen
        ? !!gc && gc.getAttribute('data-screen') === want.screen
        : shown(document.getElementById(want.modal));
    const clipped = [];
    for (const el of document.querySelectorAll('button, .opt-state')) {
        if (!shown(el) || getComputedStyle(el).visibility === 'hidden') continue;
        if (el.scrollWidth > el.clientWidth + 1) {
            clipped.push((el.id || String(el.className).split(' ')[0] || el.tagName) + ' "'
                + el.textContent.trim().slice(0, 28) + '" ' + el.scrollWidth + '>' + el.clientWidth);
        }
    }
    return {
        onShow,
        lang: document.documentElement.lang,
        clipped,
        wider: document.documentElement.scrollWidth > innerWidth + 1
            ? document.documentElement.scrollWidth + ' in ' + innerWidth : null,
    };
}

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const errors = [];

    const runs = [];
    for (const [size, viewport, ua] of SIZES) {
        for (const [name, open, want] of ONLINE) runs.push({ build: 'online', path: null, size, viewport, ua, name, open, want });
    }
    for (const [name, open, want] of LOCAL) {
        runs.push({ build: 'local', path: '/local/index.html', size: 'desktop', viewport: SIZES[0][1], ua: null,
            name, open, want });
    }

    for (const [lang, language] of Object.entries(LANGS)) {
        const bad = { open: [], lang: [], clipped: [], wider: [] };
        for (const r of runs) {
            const where = `${r.build} ${r.size}, ${r.name}`;
            const page = await H.newPage(browser);
            try {
                if (r.ua) await page.emulate({ userAgent: r.ua, viewport: r.viewport });
                else await page.setViewport(r.viewport);
                await H.boot(page, { clearStorage: true, path: r.path });
                await page.evaluate((l) => localStorage.setItem('astralClashLang', l), lang);
                await H.boot(page, { path: r.path });
                await page.evaluate(() => window.ACDebug.setDebugUnlockAll(true));
                if (r.open) await page.evaluate(r.open);
                await H.sleep(900);
                const m = await page.evaluate(measure, r.want);
                if (!m.onShow) bad.open.push(where);
                if (m.lang !== lang) bad.lang.push(where + ' (' + m.lang + ')');
                if (m.clipped.length) bad.clipped.push(where + ': ' + m.clipped.join(', '));
                if (m.wider) bad.wider.push(where + ': ' + m.wider);
            } catch (e) {
                bad.open.push(where + ' (could not open: ' + String(e.message).split(String.fromCharCode(10))[0].slice(0, 80) + ')');
            }
            // Uncaught exceptions only: the account panel talks to the live
            // accounts service, and what the network says on the console is
            // not this checker's business.
            for (const msg of page.errors || []) {
                if (/^PAGEERROR/.test(msg)) errors.push(lang + ' ' + where + ': ' + msg.slice(0, 120));
            }
            try { await page.close(); } catch (e) { /* already gone */ }
        }
        section(`In ${language}, ${runs.length} views (both builds, three sizes where the build plays at them):`);
        check(`${lang}: every screen opens, and is the one measured`, bad.open.length === 0,
            bad.open.slice(0, 6).join(' | '));
        check(`${lang}: and is in ${language}`, bad.lang.length === 0, bad.lang.slice(0, 6).join(' | '));
        check(`${lang}: no label is clipped by its own button`, bad.clipped.length === 0,
            bad.clipped.slice(0, 4).join(' | '));
        check(`${lang}: nothing is wider than the screen`, bad.wider.length === 0, bad.wider.slice(0, 6).join(' | '));
    }
    check('no uncaught errors on any of them', errors.length === 0, errors.slice(0, 3).join(' | '));
    await finish(browser, null);
})();
