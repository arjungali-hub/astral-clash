// Every visible label clears WCAG AA against what is actually behind it.
//
// WHY A CHECKER AND NOT AN AUDIT. A one-off measurement is true on the day it is
// taken. Colors get adjusted - a muted grey here, a dimmer secondary there -
// and nothing notices until somebody cannot read a button. This walks every
// visible text leaf on every screen it can open and computes the real ratio.
//
// IT ACCOUNTS FOR `filter`, which is the whole reason the first pass of this
// reported a false failure. `.fighter-btn .fname` takes its color from the
// fighter's identity accent, and Draven's is #6b7280 - a grey that lands at
// 3.8:1. Both builds brighten it with `filter: brightness(1.45) saturate(1.15)`,
// which is a rendering effect: getComputedStyle().color still reports the
// ORIGINAL. Measuring that number alone says the text fails when on screen it
// does not, and a check that cries wolf gets switched off rather than fixed.
//
// AA, not AAA: 4.5:1 for body text, 3:1 for large or bold-large. Decorative and
// disabled text is exempt by specification, and `:disabled` is skipped for that
// reason rather than to make the number look better.
const H = require('./harness');

// Opened by id, each with the button that reveals it. A screen that cannot be
// opened is reported rather than skipped silently.
const SCREENS = [
    ['menu', null],
    ['settings', 'btn-open-settings'],
    ['audio', 'btn-open-audio'],
    ['rebind', 'btn-open-rebind'],
    ['tutorial', 'btn-open-tutorial'],
];

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);
    await H.boot(page, { clearStorage: true, path: '/local/index.html' });
    await page.evaluate(() => {
        const c = document.querySelector('#btn-tutorial-close');
        if (c) c.click();
    });

    const failures = [];
    const opened = [];
    for (const [name, opener] of SCREENS) {
        if (opener) {
            const ok = await page.evaluate((id) => {
                const b = document.getElementById(id);
                if (!b) return false;
                b.click();
                return true;
            }, opener);
            if (!ok) { failures.push({ screen: name, text: '(could not open)' }); continue; }
            await H.sleep(250);
        }
        opened.push(name);
        const rows = await page.evaluate((screen) => {
            const lum = (c) => {
                const [r, g, b] = c.map(v => {
                    v /= 255;
                    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
                });
                return 0.2126 * r + 0.7152 * g + 0.0722 * b;
            };
            const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
            // A brightness() filter multiplies each channel before it is drawn.
            // Reading only the declared color is how this check first reported
            // a failure that is not visible on screen.
            const applyFilter = (rgb, filter) => {
                const m = /brightness\(([\d.]+)\)/.exec(filter || '');
                if (!m) return rgb;
                const k = parseFloat(m[1]);
                return rgb.map(v => Math.max(0, Math.min(255, v * k)));
            };
            const bgOf = (el) => {
                let n = el;
                while (n && n !== document.documentElement) {
                    const c = getComputedStyle(n).backgroundColor;
                    const a = (c.match(/[\d.]+/g) || [])[3];
                    if (c && c !== 'rgba(0, 0, 0, 0)' && (a === undefined || Number(a) > 0.6)) {
                        return parse(c);
                    }
                    n = n.parentElement;
                }
                return [10, 13, 20];      // the page ground
            };
            const out = [];
            for (const el of document.querySelectorAll('button, p, span, h1, h2, h3, h4, label, div, li, a')) {
                if (el.children.length) continue;
                const t = (el.textContent || '').trim();
                if (t.length < 2) continue;
                if (!el.getClientRects().length) continue;
                if (el.disabled || el.closest('[disabled]')) continue;
                const cs = getComputedStyle(el);
                if (parseFloat(cs.opacity) < 0.6) continue;   // deliberately faded
                const fg = applyFilter(parse(cs.color), cs.filter);
                const bg = bgOf(el);
                if (fg.length < 3 || bg.length < 3) continue;
                const L1 = lum(fg), L2 = lum(bg);
                const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
                const px = parseFloat(cs.fontSize);
                const large = px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
                const need = large ? 3 : 4.5;
                if (ratio < need) {
                    out.push({ screen, text: t.slice(0, 26),
                               cls: String(el.className || el.tagName).slice(0, 24),
                               color: cs.color, px: +px.toFixed(1),
                               ratio: +ratio.toFixed(2), need });
                }
            }
            const seen = new Map();
            for (const r of out) {
                const k = r.cls + r.color;
                if (!seen.has(k)) seen.set(k, r);
            }
            return [...seen.values()];
        }, name);
        failures.push(...rows);
        if (opener) {
            await page.evaluate(() => {
                window.dispatchEvent(new KeyboardEvent('keydown',
                    { key: 'Escape', code: 'Escape', bubbles: true }));
            });
            await H.sleep(200);
        }
    }

    section('Every fighter name is readable on an Armory card:');
    // THE RULE, NOT A SAMPLE. This checker measures what rendered, and the
    // Armory shows one card per fighter - so Nyx at 3.21:1 and Karrigos at
    // 1.51:1 were never in a frame it looked at. Five of the fourteen failed
    // and a hands-on pass caught three.
    //
    // A fighter's accent is their identity, so the fix was a derived text
    // variant (accentTextColor) rather than a new accent. This asserts the
    // derivation over the WHOLE roster: arithmetic over fourteen values, so it
    // cannot be flaky, and a fifteenth fighter with an unlucky colour fails
    // here instead of shipping.
    const accents = await page.evaluate(() => {
        const D = window.ACDebug;
        if (!D || typeof D.accentTextColor !== 'function') return null;
        const names = (typeof CHARACTERS !== 'undefined' ? CHARACTERS : [])
            .map(c => ({ name: c.name, color: c.color }));
        return names.map(c => {
            const text = D.accentTextColor(c.color);
            return {
                name: c.name, accent: c.color, text,
                before: +D.contrastRatio(c.color, D.ACCENT_TEXT_BG).toFixed(2),
                after: +D.contrastRatio(text, D.ACCENT_TEXT_BG).toFixed(2),
            };
        });
    });
    if (!accents) {
        check('the accent/text helpers are exported', false, 'ACDebug.accentTextColor missing');
    } else {
        const failing = accents.filter(a => a.after < 4.5);
        check(`every one of the ${accents.length} fighters clears 4.5:1 as card text`,
            failing.length === 0,
            JSON.stringify(failing.map(a => [a.name, a.text, a.after])));
        // ...and the accent itself is untouched for the ones that already
        // passed, because changing a colour that was fine would be a redesign
        // nobody asked for.
        const needed = accents.filter(a => a.before < 4.5);
        const changedAnyway = accents.filter(a => a.before >= 4.5 && a.text !== a.accent);
        check('only the fighters that needed lifting were changed',
            changedAnyway.length === 0,
            JSON.stringify(changedAnyway.map(a => [a.name, a.accent, a.text])));
        console.log(`    lifted ${needed.length} of ${accents.length}: `
            + needed.map(a => `${a.name} ${a.before}->${a.after}`).join(', '));
    }

    section('Every visible label clears WCAG AA:');
    console.log('    screens read: ' + opened.join(', '));
    for (const f of failures.slice(0, 8)) console.log('    ' + JSON.stringify(f));
    check('no text below its AA threshold', failures.length === 0,
        failures.length ? failures.length + ' below AA' : 'none');

    await finish(browser, page);
})();
