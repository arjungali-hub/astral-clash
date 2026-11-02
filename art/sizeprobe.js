// What size is everything, actually.
//
//   node art/sizeprobe.js            the online build
//   node art/sizeprobe.js --local    the split-screen build
//   node art/sizeprobe.js --fr       with French loaded (for #41, #30)
//
// Written for the Oct 31 audit's sizing findings, which are all of one kind:
// two controls that sit next to each other and should be the same size are a
// couple of pixels apart, or a panel is taller than the frame that holds it.
// Every one of them is a NUMBER, and the only honest way to fix a number is to
// read it before and after.
//
//   #15 room status pill stretched to 44px; Leave Room 11.84px text
//   #17 Confirm 139 vs Back 141
//   #23 Home card gaps 24/26/22/34/24; Play 47 vs buttons 38
//   #25 the name field has no focus ring
//   #31 How to Play 1,350px of panel in a 960px frame
//   #35 modals pinned to the top with ~600px empty below
//   #36 local sliders 179x16, sandbox checkbox 13x13
//   #37 Back 50.7 against 48px primaries
//   #38 Account placeholders clipped in a 142px box
//   #40 two back controls stacked
//   #41 FR tabs wrap to 58px
//   #43 local pause panel 677px in a 650px overlay
//   #67 local rebind chips at x 530-568
//
// ONE TRAP, which cost the previous round two "fixed" findings that were not:
// a rule can be written against a selector that nothing on the screen has.
// #55 was fixed on `#btn-net-disconnect` - the LOBBY's Disconnect - while the
// button the finding measured is `#btn-room-leave` in the room bar, so the fix
// was real, applied, and landed on the wrong element. Every row here prints the
// count it matched, and a count of 0 is printed as MISSING rather than skipped.
const path = require('path');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

const LOCAL = process.argv.includes('--local');
const FR = process.argv.includes('--fr');

const r2 = n => Math.round(n * 100) / 100;

// Measure a list of selectors in the page, with the gaps between siblings.
async function rects(page, sels) {
    return page.evaluate((list) => {
        const out = [];
        for (const sel of list) {
            const els = Array.from(document.querySelectorAll(sel));
            if (!els.length) { out.push({ sel, count: 0 }); continue; }
            for (const el of els) {
                const b = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                out.push({
                    sel, count: els.length,
                    text: (el.textContent || el.placeholder || '').trim().slice(0, 28),
                    id: el.id || null,
                    x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom,
                    font: cs.fontSize, box: cs.boxSizing,
                    border: cs.borderTopWidth + '/' + cs.borderLeftWidth,
                    pad: cs.paddingTop + ' ' + cs.paddingLeft,
                    align: cs.alignSelf,
                    outline: cs.outlineWidth + ' ' + cs.outlineStyle,
                    shadow: cs.boxShadow === 'none' ? 'none' : 'yes',
                    scrollH: el.scrollHeight, clientH: el.clientHeight,
                    scrollW: el.scrollWidth, clientW: el.clientWidth,
                });
            }
        }
        return out;
    }, sels);
}

function show(title, rows) {
    console.log('\n' + title);
    for (const row of rows) {
        if (!row.count) { console.log('  MISSING  ' + row.sel); continue; }
        const clipped = row.scrollW > row.clientW + 1 ? '  CLIPPED-X' : '';
        const over = row.scrollH > row.clientH + 1 ? '  SCROLLS-Y' : '';
        console.log('  ' + row.sel + (row.id ? '#' + row.id : '')
            + '  ' + r2(row.w) + 'x' + r2(row.h)
            + ' @ ' + r2(row.x) + ',' + r2(row.y)
            + '  font ' + row.font + '  box ' + row.box + '  bd ' + row.border
            + '  self ' + row.align
            + (row.text ? '  "' + row.text + '"' : '') + clipped + over);
    }
}

// The vertical gaps down a container, which is what #23 is about.
async function gaps(page, sel) {
    return page.evaluate((s) => {
        const host = document.querySelector(s);
        if (!host) return null;
        const kids = Array.from(host.children)
            .filter(k => k.getBoundingClientRect().height > 0);
        const out = [];
        for (let i = 1; i < kids.length; i++) {
            const a = kids[i - 1].getBoundingClientRect();
            const b = kids[i].getBoundingClientRect();
            out.push({
                from: (kids[i - 1].className || kids[i - 1].id || kids[i - 1].tagName) + '',
                to: (kids[i].className || kids[i].id || kids[i].tagName) + '',
                gap: Math.round((b.top - a.bottom) * 100) / 100,
            });
        }
        return out;
    }, sel);
}

// What a placeholder NEEDS against the box it has (#38): measureText in the
// input's own font, because the clipping is invisible to scrollWidth on an
// <input> that is not focused.
async function placeholders(page) {
    return page.evaluate(() => {
        const ctx = document.createElement('canvas').getContext('2d');
        return Array.from(document.querySelectorAll('input[placeholder]'))
            .filter(el => el.getBoundingClientRect().width > 0)
            .map(el => {
                const cs = getComputedStyle(el);
                ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize
                    + ' ' + cs.fontFamily;
                const need = ctx.measureText(el.placeholder).width;
                const have = el.clientWidth
                    - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
                return { id: el.id, ph: el.placeholder,
                         need: Math.round(need), have: Math.round(have),
                         clipped: need > have };
            });
    });
}

async function frame(page) {
    return page.evaluate(() => {
        const g = document.getElementById('game-container');
        const b = g.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height),
                 top: Math.round(b.top), bottom: Math.round(b.bottom),
                 roomy: g.classList.contains('menu-roomy') };
    });
}

(async () => {
    const browser = await H.launch();
    const page = await H.newPage(browser);
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
    await H.boot(page, { clearStorage: true, path: LOCAL ? '/local/index.html' : null });
    if (FR) {
        await page.evaluate(() => { if (window.setLang) window.setLang('fr'); });
        await H.sleep(300);
    }
    await page.evaluate(() => window.ACDebug.setDebugUnlockAll(true));
    console.log((LOCAL ? 'LOCAL' : 'ONLINE') + (FR ? ' / FR' : '')
        + '  frame ' + JSON.stringify(await frame(page)));

    // ---- Home: #23 the gaps, #25 the focus ring -------------------------
    if (!LOCAL) {
        show('HOME (#23 sizes)', await rects(page, [
            '#btn-home-play', '.home-row button', '#input-name',
            '.home-card',
        ]));
        console.log('HOME gaps (#23): ' + JSON.stringify(await gaps(page, '.home-card')));
        // A REAL focus, not .focus(): :focus-visible only matches when the
        // browser decides the focus came from the keyboard.
        await page.evaluate(() => document.getElementById('btn-home-play').focus());
        for (let i = 0; i < 6; i++) {
            await page.keyboard.press('Tab');
            const at = await page.evaluate(() => {
                const a = document.activeElement;
                const cs = getComputedStyle(a);
                return { id: a.id, tag: a.tagName,
                         outline: cs.outlineWidth + ' ' + cs.outlineStyle,
                         shadow: cs.boxShadow === 'none' ? 'none' : 'yes' };
            });
            console.log('  TAB -> ' + JSON.stringify(at));
            if (at.id === 'input-name') break;
        }
    }

    // ---- Modals: #35 where they sit, #37 heights, #38, #40, #41 ---------
    const modals = LOCAL
        ? [['settings', 'btn-open-settings'], ['rebind', 'btn-open-rebind'], ['audio', 'btn-open-audio']]
        : [['settings', 'btn-open-settings'], ['account', 'btn-account'],
           ['audio', 'btn-open-audio'], ['rebind', 'btn-open-rebind']];
    for (const [name, opener] of modals) {
        const opened = await page.evaluate((o) => {
            const b = document.getElementById(o);
            if (!b) return false;
            b.click();
            return true;
        }, opener);
        if (!opened) { console.log('\n' + name + ': no opener #' + opener); continue; }
        await H.sleep(350);
        show('MODAL ' + name + ' (#35 placement, #37 heights)', await rects(page, [
            '#' + name + '-screen .menu-section',
            '#' + name + '-screen .btn-back',
            '#' + name + '-screen button.opt',
            '#' + name + '-screen .slider, #' + name + '-screen input[type=range]',
            '#' + name + '-screen input[type=checkbox]',
            '#' + name + '-screen .rebind-row', '#' + name + '-screen .rebind-key',
            '#' + name + '-screen .account-tab',
        ]));
        if (name === 'account') {
            await page.evaluate(() => {
                const b = document.getElementById('btn-account-mode-up');
                if (b) b.click();
            });
            await H.sleep(300);
            show('  account / create (#38, #41)', await rects(page, [
                '#account-screen .account-tab', '#account-screen .account-row',
                '#account-screen .account-row input', '#account-screen .account-row label',
                '#account-screen #btn-account-go', '#account-screen .account-link',
                '#account-screen .account-status',
            ]));
            console.log('  placeholders (#38): '
                + JSON.stringify(await placeholders(page), null, 1));
            // #40: Forgot password opens a pane with its own back LINK on top
            // of the panel's back BUTTON.
            await page.evaluate(() => {
                const el = Array.from(document.querySelectorAll('#account-screen a, #account-screen button'))
                    .find(e => /forgot/i.test(e.textContent || ''));
                if (el) el.click();
            });
            await H.sleep(250);
            show('  account / forgot (#40)', await rects(page, [
                '#account-screen .btn-back', '#account-screen a',
                '#account-screen .auth-link', '#account-screen button',
            ]));
        }
        await page.keyboard.press('Escape');
        await H.sleep(250);
        await page.evaluate(() => {
            // Escape may have left an outer modal up; close whatever is open.
            for (let i = 0; i < 4; i++) {
                const x = document.querySelector('.menu-overlay:not([style*="none"]) .modal-x');
                if (x) x.click(); else break;
            }
        });
        await H.sleep(200);
    }

    // ---- How to Play: #31 ------------------------------------------------
    await page.evaluate(() => {
        const b = document.getElementById('btn-open-tutorial');
        if (b) b.click();
    });
    await H.sleep(400);
    show('HOW TO PLAY (#31)', await rects(page, [
        '#tutorial-screen .menu-section', '#btn-tutorial-close',
        '#tutorial-screen .tut-grid', '#tutorial-screen .tut-card',
    ]));
    await page.evaluate(() => {
        const b = document.getElementById('btn-tutorial-close');
        if (b) b.click();
    });
    await H.sleep(250);

    // ---- The room (online) / select (local) -----------------------------
    if (!LOCAL) {
        await page.evaluate(() => window.ACDebug.netFakeConnect('host'));
        await H.sleep(600);
        show('ROOM BAR (#15)', await rects(page, [
            '#room-status-pill', '#btn-room-leave', '#room-code-chip', '#btn-room-copy',
        ]));
        // Pick a fighter so the detail panel exists (#17).
        await page.evaluate(() => {
            const c = document.querySelector('#p1-grid .fighter-btn:not(.roster-locked)');
            if (c) c.click();
        });
        await H.sleep(400);
        show('DETAIL ACTIONS (#17)', await rects(page, [
            '.detail-actions button',
        ]));
        // #16: what the badge on a locked card says.
        await page.evaluate(() => window.ACDebug.setDebugUnlockAll(false));
        await H.sleep(400);
        console.log('LOCKED BADGES (#16): ' + await page.evaluate(() =>
            JSON.stringify(Array.from(document.querySelectorAll('#p1-grid .fighter-btn'))
                .map(b => ({ name: b.dataset.name,
                             locked: b.classList.contains('roster-locked'),
                             badge: (b.querySelector('.fkey, .fcost') || {}).textContent,
                             cls: (b.querySelector('.fkey, .fcost') || {}).className })))));
    } else {
        await page.evaluate(() => {
            const b = document.getElementById('btn-start-local')
                || document.querySelector('#home-screen button');
            if (b) b.click();
        });
        await H.sleep(600);
        show('LOCAL SELECT', await rects(page, [
            '.mode-current', '.detail-actions button',
        ]));
    }

    console.log('\nConsole errors: ' + JSON.stringify(page.errors.slice(0, 5)));
    H.stopServer();
    await browser.close();
    H.closeAllBrowsers();
})().catch(e => { console.error(e); H.stopServer(); H.closeAllBrowsers(); process.exit(1); });
