// Typing in a text field must not play the game, and a modal must open where
// you can see it. Both builds, both window sizes.
//
// From the playtest:
//   "Typing 'z' in P2's name field selected Kaelen for P2. Typing 'Krish' in
//    P1's field selected Draven (R = Random...)"
//   "On a short window you have to scroll down to reach the Settings button.
//    Clicking it then does nothing visible, because #settings-screen is placed
//    at the top of the #ui-overlay scroll area (its top was at -656px)."
//
// The window sizes matter and are the point of this file: both bugs are
// invisible at a comfortable desktop size. 1280x529 and 640x530 are the two
// the playtest actually used.
const H = require('./harness');

const SIZES = [
    { label: 'short  1280x529', width: 1280, height: 529 },
    { label: 'narrow  640x530', width: 640, height: 530 },
    { label: 'desktop 1440x900', width: 1440, height: 900 },
];

const BUILDS = [
    { label: 'online', path: null, nameField: null },
    { label: 'local', path: '/local/index.html', nameField: 'name-p1' },
];

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);

    for (const build of BUILDS) {
        for (const size of SIZES) {
            await page.setViewport({ width: size.width, height: size.height });
            await H.boot(page, { clearStorage: true, path: build.path });
            section(`${build.label} @ ${size.label}`);

            // ---------------------------------------------------- typing
            if (build.nameField) {
                const typed = await page.evaluate(async (id) => {
                    const D = window.ACDebug;
                    const input = document.getElementById(id);
                    input.focus();
                    const before = { p1: D.p1Choice || null, keys: Object.keys(D.keys).filter(k => D.keys[k]) };
                    // Real keyboard events, dispatched at the field the way the
                    // browser would: this is the exact path the bug took.
                    for (const ch of ['z', 'r', 'k', 'c']) {
                        input.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
                        input.value += ch;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
                    }
                    return {
                        before,
                        picked: D.p1Choice || null,
                        preview: D.p1Preview || null,
                        held: Object.keys(D.keys).filter(k => D.keys[k]),
                        value: input.value,
                        name: D.playerName('p1'),
                    };
                }, build.nameField);
                check('typing letters does not pick a fighter',
                    typed.picked === typed.before.p1 && !typed.preview, JSON.stringify(typed));
                check('and does not leave keys held down for the fighter',
                    typed.held.length === 0, JSON.stringify(typed.held));
                check('the characters land in the field instead',
                    /zrkc/.test(typed.value), JSON.stringify(typed.value));
            }

            // ----------------------------------------------------- modals
            const modal = await page.evaluate(() => {
                const ov = document.getElementById('ui-overlay');
                // Scroll the overlay the way a player must to reach the button
                // on a short window - this is what put the panel off-screen.
                ov.scrollTop = ov.scrollHeight;
                const scrolledTo = ov.scrollTop;
                const btn = document.getElementById('btn-open-settings');
                if (btn) btn.click();
                const panel = document.querySelector('#settings-screen .menu-section');
                const r = panel ? panel.getBoundingClientRect() : null;
                const screen = document.getElementById('settings-screen');
                const sr = screen ? screen.getBoundingClientRect() : null;
                return {
                    scrolledTo,
                    overlayScrollAfter: ov.scrollTop,
                    overlayLocked: getComputedStyle(ov).overflowY === 'hidden',
                    panelTop: r ? Math.round(r.top) : null,
                    panelVisible: !!r && r.bottom > 0 && r.top < window.innerHeight,
                    screenTop: sr ? Math.round(sr.top) : null,
                };
            });
            check('opening a modal scrolls the overlay back to the top',
                modal.overlayScrollAfter === 0, JSON.stringify(modal));
            check('so the panel is actually on screen',
                modal.panelVisible === true && modal.panelTop >= -1, JSON.stringify(modal));
            check('and the page underneath cannot scroll it away',
                modal.overlayLocked === true, JSON.stringify(modal));

            // One scrollbar: the modal's own, never a panel inside it.
            const scrollers = await page.evaluate(() => {
                const out = [];
                document.querySelectorAll('#settings-screen *, #tutorial-screen *').forEach(el => {
                    const cs = getComputedStyle(el);
                    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll')
                        && el.scrollHeight > el.clientHeight + 2) {
                        out.push((el.id || el.className || el.tagName) + ' '
                                 + el.scrollHeight + '/' + el.clientHeight);
                    }
                });
                return out;
            });
            check('no panel inside a modal has its own scrollbar',
                scrollers.length === 0, JSON.stringify(scrollers.slice(0, 4)));

            check('no page errors', page.errors.length === 0,
                JSON.stringify(page.errors.slice(0, 2)));
        }
    }

    await finish(browser, page);
})();
