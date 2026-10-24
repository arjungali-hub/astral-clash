// The texture leak, measured per ROUND instead of per match.
//
//   node art/roundprobe.js
//
// art/texprobe.js answers the same question but plays whole matches out to get
// there, and on a machine software-rendering a 3D scene at about a frame a
// second that is half an hour per run. The leak is per ROUND - leakcheck's
// stack said `startRound < stepRoundEnd < gameLoop` - so there is no need to
// win any fights to provoke it. Calling startRound() directly does the same
// teardown and rebuild in a second.
//
// It carries the instrument texprobe ended up with, which is the only one that
// both sees every upload and knows WHICH texture it was: three.js registers its
// 'dispose' listener on a texture at exactly the moment it creates a GL texture
// for it, inside the same function that increments info.memory.textures, and
// there `this` is the texture. The constructor wrappers miss anything three.js
// builds internally; a Proxy on info.memory sees a number, not an object; and a
// reachability census cannot find what nothing references any more.
const path = require('path');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

const ROUNDS = Number(process.env.ROUNDS || 4);

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    await page.setViewport({ width: 900, height: 700 });
    await H.boot(page, { clearStorage: true, path: '/local/index.html' });
    await page.evaluate(() => window.ACDebug.setDebugUnlockAll(true));

    await page.evaluate(() => {
        const pick = (grid, detail) => {
            document.querySelectorAll(grid + ' .fighter-btn')[0].click();
            const c = document.querySelector(detail + ' .btn-confirm');
            if (c) c.click();
        };
        pick('#p1-grid', '#p1-detail');
        pick('#p2-grid', '#p2-detail');
        const s = document.getElementById('btn-start-match');
        if (s) s.click();
        const card = document.querySelectorAll('#mapselect-grid .map-card')[0];
        if (card) card.click();
    });
    if (!await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 300000)) {
        console.error('never reached FIGHT');
        process.exit(1);
    }

    await page.evaluate(() => {
        const T = window.THREE;
        window.__born = Object.create(null);
        window.__round = 0;
        const stack = (skip) => (new Error().stack || '').split('\n').slice(skip, skip + 8)
            .map(l => l.trim().replace(/^at\s+/, '').replace(/\s*\(.*$/, ''))
            .filter(Boolean).join(' < ');

        for (const name of ['Texture', 'CanvasTexture', 'DataTexture']) {
            const Orig = T[name];
            if (typeof Orig !== 'function') continue;
            const W = function (...a) {
                const made = new Orig(...a);
                window.__born[made.uuid] = 'new ' + name + '  <<  ' + stack(2);
                return made;
            };
            W.prototype = Orig.prototype;
            T[name] = W;
        }
        const oc = T.Texture.prototype.clone;
        T.Texture.prototype.clone = function () {
            const made = oc.apply(this, arguments);
            window.__born[made.uuid] = 'CLONE of ' + (this.name || this.uuid.slice(0, 8))
                + '  <<  ' + stack(2);
            return made;
        };
        const od = T.Texture.prototype.dispose;
        T.Texture.prototype.dispose = function () { this.__disposed = true; return od.apply(this, arguments); };
        // The upload hook - see the file header.
        const oa = T.Texture.prototype.addEventListener;
        T.Texture.prototype.addEventListener = function (type, fn) {
            if (type === 'dispose' && !this.__up) {
                this.__up = true;
                this.__upRound = window.__round;
                (window.__uploaded = window.__uploaded || []).push(this);
            }
            return oa.apply(this, arguments);
        };
        window.__live = () => {
            const out = Object.create(null);
            for (const t of (window.__uploaded || [])) {
                if (t.__disposed) continue;
                const img = t.image;
                const size = img && (img.width || img.videoWidth)
                    ? (img.width || img.videoWidth) + 'x' + (img.height || img.videoHeight)
                    : 'no-image';
                // THE CLASS NAME IS MINIFIED and tells you nothing: the leak
                // came back as "ii 16x16". three.js's own flags are not
                // minified, so they are what identifies the thing - plus the
                // numeric format/type/mapping, which separate a depth texture
                // from a colour one and a cube from a 2D.
                const flags = ['isDataTexture', 'isDepthTexture', 'isCubeTexture',
                               'isCanvasTexture', 'isCompressedTexture', 'isVideoTexture',
                               'isDataTexture2DArray', 'isDataTexture3D']
                    .filter(f => t[f]).join(',') || 'plain Texture';
                const k = flags + ' ' + size
                    + '  fmt ' + t.format + ' type ' + t.type + ' map ' + t.mapping
                    + ' min ' + t.minFilter + ' gen ' + t.generateMipmaps
                    + '  data ' + (t.image && t.image.data
                        ? (t.image.data.constructor && t.image.data.constructor.name) : 'none')
                    + '  << ' + (window.__born[t.uuid] || '(not seen being made)');
                out[k] = (out[k] || 0) + 1;
            }
            return out;
        };
    });

    // A render has to happen between rounds, or nothing is uploaded and the
    // counter cannot move: the upload is lazy, at first use by a draw call.
    const settle = async () => {
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        await H.sleep(500);
    };
    await settle();

    const snaps = [];
    const snap = async (tag) => {
        snaps.push({
            tag,
            n: await page.evaluate(() => window.ACDebug.rendererInfo().textures),
            live: await page.evaluate(() => window.__live()),
        });
    };
    await snap('before');
    for (let i = 1; i <= ROUNDS; i++) {
        await page.evaluate((n) => {
            window.__round = n;
            window.ACDebug.startRound(false);
        }, i);
        await settle();
        await snap('round ' + i);
        console.log('  round %d: textures %d', i, snaps[snaps.length - 1].n);
    }

    console.log('');
    // Node's console.log has no %-10s: it is a printf form that util.format
    // does not implement, so it printed the literal text once per line.
    for (const s of snaps) console.log('  ' + s.tag.padEnd(10) + ' textures ' + s.n);
    const a = snaps[0].live, b = snaps[snaps.length - 1].live;
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    const grew = [...keys].map(k => ({ k, from: a[k] || 0, to: b[k] || 0 }))
        .filter(r => r.to > r.from).sort((x, y) => (y.to - y.from) - (x.to - x.from));
    const sum = (o) => Object.values(o).reduce((p, q) => p + q, 0);
    console.log('');
    console.log('UPLOADED AND NOT FREED: %d -> %d', sum(a), sum(b));
    if (!grew.length) console.log('  nothing grew');
    for (const g of grew) {
        console.log('  +%d  (%d -> %d)', g.to - g.from, g.from, g.to);
        console.log('      %s', g.k);
    }
    await browser.close();
    process.exit(0);
})();
