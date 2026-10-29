// Is a fighter's name actually as dim as its computed colour says?
//
//   node art/contrastprobe.js
//
// Finding #44: "Draven's name (unlocked) is rgb(107,114,128), 3.8:1, dimmer
// than the locked fighters' rgb(148,163,184), so an owned fighter reads as
// locked. Local: Ignis 3.8:1, Nyx 3.2:1."
//
// rgb(107,114,128) is #6b7280, Draven's identity colour, and it is what
// getComputedStyle() returns. But `.fighter-btn .fname` carries
// `filter: brightness(1.45) saturate(1.15)`, added for this very reason - that
// rule's own comment names Draven and the figure 3.8:1. A filter is a PAINT
// effect and never appears in computed style, so a tool reading `color` sees
// the value from before it and reports a contrast the screen does not have.
//
// So this measures PIXELS: for each name it scrolls the card into view, clips a
// screenshot to the glyph box, and takes the brightest pixel - the glyph core
// rather than an antialiased edge - against the card behind it.
//
// TWO TRAPS, both of which produced wrong numbers on the first run and are
// guarded now rather than remembered:
//
//   * A card below the fold clips to blank background, and the brightest pixel
//     in blank background is the background, which reads as 1.0:1 and looks
//     exactly like a catastrophic contrast failure. Every row is scrolled into
//     view, and any row whose "brightest" pixel is indistinguishable from the
//     background is reported as NO READING instead of as a result.
//   * `[id*="play"]` matches btn-exit-replay, which comes first in the
//     document, so the online build clicked Exit Replay and measured nothing.
//     The button is named outright.
const path = require('path');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

const srgb = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = ([r, g, b]) =>
    0.2126 * srgb(r / 255) + 0.7152 * srgb(g / 255) + 0.0722 * srgb(b / 255);
const ratio = (a, b) => {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const nums = (s, fb) => {
    const m = String(s || '').match(/\d+/g);
    return m && m.length >= 3 ? m.slice(0, 3).map(Number) : fb;
};

async function pixels(page, png) {
    return page.evaluate(async (b64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
    }, png.toString('base64'));
}

async function measure(page, label) {
    await page.evaluate(() => {
        window.ACDebug.setDebugUnlockAll(true);
        // NAMED, not pattern-matched: [id*="play"] also matches
        // btn-exit-replay and btn-save-replay, and btn-exit-replay is first.
        const b = document.getElementById('btn-home-play')
            || document.getElementById('btn-start-local');
        if (b) b.click();
    });
    await H.sleep(800);

    const count = await page.evaluate(
        () => document.querySelectorAll('.fighter-btn .fname').length);
    const rows = [];
    for (let i = 0; i < count; i++) {
        const info = await page.evaluate((idx) => {
            const el = document.querySelectorAll('.fighter-btn .fname')[idx];
            if (!el) return null;
            el.scrollIntoView({ block: 'center', inline: 'center' });
            const r = el.getBoundingClientRect();
            const card = el.closest('.fighter-btn');
            const grid = el.closest('[id$="-grid"]');
            return {
                name: el.textContent.trim(),
                side: grid ? grid.id.replace('-grid', '') : '?',
                locked: card.classList.contains('locked'),
                computed: getComputedStyle(el).color,
                filter: getComputedStyle(el).filter,
                cardBg: getComputedStyle(card).backgroundColor,
                visible: r.width >= 4 && r.height >= 4
                    && r.top >= 0 && r.left >= 0
                    && r.bottom <= window.innerHeight && r.right <= window.innerWidth,
                box: { x: Math.round(r.x), y: Math.round(r.y),
                       width: Math.round(r.width), height: Math.round(r.height) },
            };
        }, i);
        if (!info) continue;
        const bg = nums(info.cardBg, [13, 20, 32]);
        const comp = nums(info.computed, [0, 0, 0]);
        const row = {
            build: label, name: info.name, side: info.side, locked: info.locked,
            computedRatio: ratio(comp, bg), paintedRatio: null,
            filter: info.filter,
        };
        if (info.visible) {
            await H.sleep(60);   // let the scroll settle before clipping
            const px = await pixels(page, await page.screenshot({ clip: info.box }));
            let best = null, bestL = -1;
            for (let k = 0; k < px.length; k += 4) {
                const p = [px[k], px[k + 1], px[k + 2]];
                const l = lum(p);
                if (l > bestL) { bestL = l; best = p; }
            }
            // A blank clip's brightest pixel IS the background. Anything that
            // close to it means no glyph was captured, which is a failed
            // reading and must not be printed as a contrast of 1.0:1.
            row.paintedRatio = ratio(best, bg) > 1.15 ? ratio(best, bg) : null;
        }
        rows.push(row);
    }
    return rows;
}

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const all = [];
    for (const [label, p] of [['online', null], ['local', '/local/index.html']]) {
        const page = await H.newPage(browser);
        await page.setViewport({ width: 1400, height: 1000 });
        await H.boot(page, { clearStorage: true, path: p });
        all.push(...await measure(page, label));
        await page.close();
    }

    const pad = (s, n) => String(s).padEnd(n);
    console.log(pad('build', 8) + pad('side', 6) + pad('fighter', 13) + pad('state', 10)
        + pad('computed', 11) + pad('painted', 11) + 'filter');
    for (const r of all) {
        console.log(pad(r.build, 8) + pad(r.side, 6) + pad(r.name, 13)
            + pad(r.locked ? 'locked' : 'unlocked', 10)
            + pad(r.computedRatio.toFixed(2) + ':1', 11)
            + pad(r.paintedRatio == null ? 'no reading' : r.paintedRatio.toFixed(2) + ':1', 11)
            + (r.filter === 'none' ? 'none' : 'brightened'));
    }

    const read = all.filter(r => !r.locked && r.paintedRatio != null);
    const noRead = all.filter(r => !r.locked && r.paintedRatio == null);
    console.log('');
    if (!read.length) {
        console.log('NO READINGS AT ALL - this says nothing about #44. Fix the probe.');
        await browser.close();
        process.exit(1);
    }
    const wc = read.reduce((a, b) => (b.computedRatio < a.computedRatio ? b : a));
    const wp = read.reduce((a, b) => (b.paintedRatio < a.paintedRatio ? b : a));
    console.log('Unlocked names measured: ' + read.length
        + (noRead.length ? '   (' + noRead.length + ' with no reading, not counted)' : ''));
    console.log('Worst by COMPUTED colour: ' + wc.name + ' '
        + wc.computedRatio.toFixed(2) + ':1   <- the kind of number #44 reports');
    console.log('Worst as PAINTED:         ' + wp.name + ' '
        + wp.paintedRatio.toFixed(2) + ':1');
    console.log('');
    console.log(wp.paintedRatio >= 4.5
        ? 'ARTEFACT: every unlocked name that could be read clears 4.5:1 on screen. '
          + 'The brightness filter is doing its job, and computed colour cannot see it.'
        : 'REAL: ' + wp.name + ' is below 4.5:1 in the actual pixels.');
    await browser.close();
    process.exit(0);
})();
