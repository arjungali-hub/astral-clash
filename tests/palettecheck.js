// The colourblind palette is actually more distinguishable, not just different.
//
// WHY SIMULATE RATHER THAN TRUST THE HEX. "Blue and orange are colourblind-safe"
// is received wisdom, and received wisdom is how you end up shipping a second
// pair that is just as bad. The claim this setting makes is specific and
// testable: under deuteranopia and protanopia - together the great majority of
// colourblindness - the two side colours must stay further apart than cyan and
// pink do.
//
// THE SIMULATION is the Brettel/Vienot LMS projection, the standard approach:
// convert to long/medium/short cone response, collapse the missing cone onto the
// plane the remaining two span, convert back. Distance is then measured in CIE
// L*a*b*, because RGB distance does not match what anyone sees.
//
// WHAT IS ASSERTED: the alternative pair separates better under both forms, the
// setting survives a reload, and both builds have it. Not that it is beautiful.
const H = require('./harness');

// Separation that counts as "clearly different" in Lab. Cyan against pink
// measures well above this for normal vision and collapses under deuteranopia;
// that collapse is the bug being fixed.
const MIN_DELTA = 25;

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();

    const COLOUR_MATHS = () => {
        const srgb = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
        // Linear RGB -> LMS cone response (Hunt-Pointer-Estevez, as used by
        // Vienot et al for exactly this).
        const toLMS = ([r, g, b]) => [
            17.8824 * r + 43.5161 * g + 4.11935 * b,
            3.45565 * r + 27.1554 * g + 3.86714 * b,
            0.0299566 * r + 0.184309 * g + 1.46709 * b,
        ];
        const fromLMS = ([l, m, s]) => [
            0.080944 * l - 0.130504 * m + 0.116721 * s,
            -0.0102485 * l + 0.0540194 * m - 0.113615 * s,
            -0.000365294 * l - 0.00412163 * m + 0.693513 * s,
        ];
        const simulate = (rgb, kind) => {
            const lin = rgb.map(srgb);
            let [l, m, s] = toLMS(lin);
            if (kind === 'deuteranopia') m = 0.494207 * l + 1.24827 * s;
            else if (kind === 'protanopia') l = 2.02344 * m - 2.52581 * s;
            return fromLMS([l, m, s]).map(v => Math.max(0, Math.min(1, v)));
        };
        // Linear RGB -> XYZ (D65) -> Lab.
        const toLab = ([r, g, b]) => {
            const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
            const Y = (0.2126 * r + 0.7152 * g + 0.0722 * b);
            const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
            const f = (t) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
            const [fx, fy, fz] = [f(X), f(Y), f(Z)];
            return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
        };
        const delta = (a, b, kind) => {
            const [la, aa, ba] = toLab(simulate(hex(a), kind));
            const [lb, ab, bb] = toLab(simulate(hex(b), kind));
            return Math.hypot(la - lb, aa - ab, ba - bb);
        };
        window.__delta = delta;
    };

    for (const [name, path] of [['online', '/index.html'], ['local', '/local/index.html']]) {
        const page = await H.newPage(browser);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message || e)));
        await H.boot(page, { clearStorage: true, path });
        await page.evaluate(COLOUR_MATHS);

        section(name + ' build:');
        const r = await page.evaluate(() => {
            const D = window.ACDebug;
            D.setSidePalette('standard');
            const std = [D.sideColor('p1'), D.sideColor('p2')];
            D.setSidePalette('colourblind');
            const cb = [D.sideColor('p1'), D.sideColor('p2')];
            const label = (document.querySelector('#btn-side-palette .opt-state') || {}).textContent;
            const d = (pair, kind) => +window.__delta(pair[0], pair[1], kind).toFixed(1);
            return {
                std, cb, label,
                normal: { std: d(std, 'none'), cb: d(cb, 'none') },
                deuter: { std: d(std, 'deuteranopia'), cb: d(cb, 'deuteranopia') },
                protan: { std: d(std, 'protanopia'), cb: d(cb, 'protanopia') },
            };
        });
        console.log('    ' + JSON.stringify(r));

        check('the two palettes are different colours',
            r.std[0] !== r.cb[0] && r.std[1] !== r.cb[1], JSON.stringify({ std: r.std, cb: r.cb }));
        check('the state pill says which is on', r.label === 'Colourblind', String(r.label));
        check('under deuteranopia the alternative separates better',
            r.deuter.cb > r.deuter.std, JSON.stringify(r.deuter));
        check('under protanopia the alternative separates better',
            r.protan.cb > r.protan.std, JSON.stringify(r.protan));
        check('and separates CLEARLY, not just more',
            r.deuter.cb >= MIN_DELTA && r.protan.cb >= MIN_DELTA,
            JSON.stringify({ deuter: r.deuter.cb, protan: r.protan.cb, need: MIN_DELTA }));
        check('the standard pair still reads normally - nothing was given up',
            r.normal.std >= MIN_DELTA, JSON.stringify(r.normal));

        // The setting is useless if it does not survive the next launch.
        await page.reload({ waitUntil: 'load' });
        await H.sleep(1800);
        const kept = await page.evaluate(() => window.ACDebug && window.ACDebug.sidePalette);
        check('the choice survives a reload', kept === 'colourblind', String(kept));
        check('no errors thrown', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none');
        await page.close();
    }

    await finish(browser, null);
})();
