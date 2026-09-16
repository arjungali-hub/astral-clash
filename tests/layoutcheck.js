// LAYOUT AT SMALL WINDOW SIZES, which is where every layout bug in this project
// has actually been found. Run at the two sizes the playtest reported against
// (1280x529 and 638x528), the 640x530 the fixes were asked to be verified at,
// and one normal desktop size to prove nothing moved there.
//
// Reported, and each asserted below:
//   "at 638x528 the online home h1 is clipped above the game frame"
//   "below ~640px the fighter picker fills only the left half"
//   "the fixed-aspect frame leaves empty bands and a tiny HUD at narrow widths"
//   "Shop/Settings panel content renders outside the panel background"
//   "the room lobby overflows horizontally"
const H = require('./harness');

const SIZES = [
    ['desktop', 1440, 900],
    ['short',   1280, 529],
    ['narrow',   640, 530],
    ['reported', 638, 528],
];

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true });

    for (const [tag, w, h] of SIZES) {
        section(`${tag} — ${w}x${h}:`);
        await page.setViewport({ width: w, height: h });
        await H.boot(page);
        await H.sleep(200);

        const m = await page.evaluate(() => {
            const D = window.ACDebug;
            const box = (sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                const b = el.getBoundingClientRect();
                return { x: Math.round(b.x), y: Math.round(b.y),
                         w: Math.round(b.width), h: Math.round(b.height),
                         bottom: Math.round(b.bottom), right: Math.round(b.right) };
            };
            const out = { home: box('#home-screen h1'), frame: box('#game-container'),
                          vw: innerWidth, vh: innerHeight,
                          bodyOverflowX: document.body.scrollWidth - document.body.clientWidth };
            // The room, hosted, with its code and status showing.
            D.netFakeConnect('host');
            if (D.refreshLobbyUI) D.refreshLobbyUI();
            const ov = document.getElementById('ui-overlay');
            out.overlayOverflowX = ov.scrollWidth - ov.clientWidth;
            out.roomBar = (() => {
                const el = document.querySelector('.room-bar');
                return el ? { over: el.scrollWidth - el.clientWidth } : null;
            })();
            // THE FULLEST ROOM BAR, which is the one that was reported: status
            // pill + room code chip + sandbox pill + Leave Room, all at once.
            // A bar holding only a status pill fits anywhere and proves nothing.
            const chip = document.getElementById('room-code-chip');
            if (chip) chip.style.display = '';
            const codeBox = document.getElementById('room-code-text');
            if (codeBox) codeBox.value = 'WPWVDM';
            const banner = document.getElementById('sandbox-banner');
            if (banner) banner.style.display = '';
            out.roomBarFull = (() => {
                const el = document.querySelector('.room-bar');
                if (!el) return null;
                const b = el.getBoundingClientRect();
                const kids = Array.from(el.querySelectorAll(':scope > *, .room-bar-left > *'))
                    .filter(k => k.offsetParent !== null)
                    .map(k => { const r = k.getBoundingClientRect();
                                return { id: k.id || k.className,
                                         right: Math.round(r.right), top: Math.round(r.top) }; });
                return { over: el.scrollWidth - el.clientWidth,
                         width: Math.round(b.width),
                         widest: kids.reduce((a, k) => Math.max(a, k.right - b.left), 0),
                         rows: new Set(kids.map(k => k.top)).size, kids };
            })();
            out.overlayOverflowXFull = ov.scrollWidth - ov.clientWidth;
            out.bodyOverflowXFull = document.body.scrollWidth - document.body.clientWidth;
            D.netTeardown();
            // The picker, in the state a player first sees it.
            D.setDebugUnlockAll(true);
            D.setMatchMode('classic');
            out.grid = box('#p1-grid');
            out.pickerSide = box('.picker-side');
            return out;
        });

        // 1. THE WORDMARK IS INSIDE THE FRAME THAT CLIPS IT. #game-container has
        //    overflow: hidden, and content pushed ABOVE its top edge by a
        //    centring flexbox is not reachable by scrolling - it is simply gone.
        check('the home wordmark is not above the frame that clips it',
            !!m.home && !!m.frame && m.home.y >= m.frame.y,
            JSON.stringify({ h1: m.home, frame: m.frame }));

        // 2. THE FRAME USES THE WINDOW. A fixed aspect ratio left 189 of a 530px
        //    window empty above and below, which is also what made the HUD tiny.
        check('the frame uses at least 88% of the window height',
            !!m.frame && m.frame.h >= Math.min(650, m.vh * 0.96) * 0.92,
            JSON.stringify({ frame: m.frame, vh: m.vh }));

        // 3. NO HORIZONTAL SCROLL, anywhere. #ui-overlay is the one intended
        //    scroll container and it scrolls vertically only.
        check('the page does not scroll horizontally', m.bodyOverflowX <= 0, String(m.bodyOverflowX));
        check('nor does the overlay', m.overlayOverflowX <= 0, String(m.overlayOverflowX));
        check('nor the room bar', !m.roomBar || m.roomBar.over <= 0, JSON.stringify(m.roomBar));
        // ...and none of that changes with the bar full.
        check('nor a FULL room bar (code + sandbox pill + Leave Room)',
            !!m.roomBarFull && m.roomBarFull.over <= 0
            && m.roomBarFull.widest <= m.roomBarFull.width,
            JSON.stringify(m.roomBarFull));
        check('nor the page, with the room bar full',
            m.bodyOverflowXFull <= 0 && m.overlayOverflowXFull <= 0,
            JSON.stringify({ body: m.bodyOverflowXFull, overlay: m.overlayOverflowXFull }));

        // 4. THE ROSTER FILLS ITS COLUMN. It was 307px inside a 552px column at
        //    640px wide - "the picker fills only the left half".
        check('the roster grid fills its column',
            !!m.grid && !!m.pickerSide && m.grid.w >= m.pickerSide.w - 2,
            JSON.stringify({ grid: m.grid, side: m.pickerSide }));

        // 4b. NO MODAL SCROLLS INSIDE THE PAGE'S SCROLL. #ui-overlay is the one
        //     scroll container; a panel with its own scrollbar hides content
        //     with nothing on screen to say so.
        const inner = await page.evaluate(() => {
            const out = [];
            const open = ['lobby', 'settings', 'tutorial', 'modeselect', 'mapselect'];
            const ids = { lobby: 'btn-open-online', settings: 'btn-open-settings',
                          tutorial: 'btn-open-tutorial', modeselect: 'btn-open-modeselect',
                          mapselect: 'btn-open-mapselect' };
            for (const name of open) {
                const opener = document.getElementById(ids[name]);
                if (!opener || opener.offsetParent === null) continue;
                opener.click();
                const screen = document.getElementById(name + '-screen');
                if (!screen) continue;
                for (const el of [screen, ...screen.querySelectorAll('*')]) {
                    const over = el.scrollHeight - el.clientHeight;
                    const style = getComputedStyle(el);
                    const scrolls = /(auto|scroll)/.test(style.overflowY) && over > 2;
                    if (scrolls && el.id !== 'ui-overlay') {
                        out.push({ modal: name, el: el.id || el.className, over });
                    }
                }
                document.querySelectorAll('#' + name + '-screen .btn-back, #' + name + '-screen .btn-close')
                    .forEach(b => b.click());
            }
            return out;
        });
        check('no modal panel scrolls inside the page scroll',
            inner.length === 0, JSON.stringify(inner));

        // 5. MODAL CONTENT STAYS ON ITS PANEL. A panel with a max-height and
        //    content that ignores it renders text over the arena behind it.
        const panels = await page.evaluate(() => {
            const worstOutside = (panelSel) => {
                const panel = document.querySelector(panelSel);
                if (!panel) return null;
                const pb = panel.getBoundingClientRect();
                let worst = 0, who = null;
                for (const el of panel.querySelectorAll('*')) {
                    const b = el.getBoundingClientRect();
                    if (!b.width && !b.height) continue;
                    const over = Math.max(b.bottom - pb.bottom, pb.top - b.top,
                                          b.right - pb.right, pb.left - b.left);
                    if (over > worst) { worst = over; who = el.className || el.tagName; }
                }
                return { px: Math.round(worst), who, panel: { w: Math.round(pb.width), h: Math.round(pb.height) } };
            };
            const out = {};
            window.ACDebug.openShop('p1');
            out.shop = worstOutside('#shop-screen .shop-panel');
            document.querySelectorAll('#shop-screen .btn-close, #shop-screen .btn-back').forEach(b => b.click());
            document.getElementById('btn-open-settings').click();
            out.settings = worstOutside('#settings-screen .menu-section');
            out.settingsOpen = (() => {
                const el = document.getElementById('settings-screen');
                return !!el && getComputedStyle(el).display !== 'none';
            })();
            document.getElementById('btn-settings-close').click();
            return out;
        });
        // A 2px allowance: a focus ring or a 1px border legitimately sits on the
        // panel's own edge, and rounding a fractional rect can add another.
        check('no shop content renders outside the shop panel',
            !!panels.shop && panels.shop.px <= 2, JSON.stringify(panels.shop));
        check('the settings panel opened, so this measured something',
            panels.settingsOpen === true, JSON.stringify(panels.settings));
        check('no settings content renders outside the settings panel',
            !!panels.settings && panels.settings.px <= 2, JSON.stringify(panels.settings));
    }

    await finish(browser, page);
})();
