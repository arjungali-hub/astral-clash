// Repeated matches must not accumulate GPU resources.
//
// The brief asked for "ten consecutive rematches, no GPU memory growth", and it
// sat unchecked for being un-automatable: headless runs on swiftshader, where
// "GPU memory" is not a number anybody can read.
//
// But GPU memory was never the thing to measure - it is the SYMPTOM. What leaks
// is three.js resources that a teardown forgot to dispose: a geometry, a
// material's texture, a compiled program. renderer.info counts all three
// exactly, and ACDebug.rendererInfo() already exposes them. Counting the things
// that leak is strictly better than watching a number that goes up when they do,
// and it works without a GPU.
//
// The shape to look for is GROWTH PER REMATCH, not an absolute number. An arena
// legitimately holds hundreds of geometries; what must not happen is holding the
// previous arena's as well. So: a baseline after the first match has settled,
// then several rematches, then the same count.
const H = require('./harness');

const REMATCHES = 6;
// One arena's worth of churn is fine; a leak shows as a per-rematch increment
// that never comes back down. Allowing a little slack keeps a lazily-created
// texture (a damage number atlas, say) from reading as a leak.
const SLACK = 12;

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);
    await H.boot(page, { clearStorage: true, path: '/local/index.html' });
    await page.evaluate(() => window.ACDebug.setDebugUnlockAll(true));

    const startMatch = async () => {
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
        return H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    };

    // End a match by winning rounds until it is actually over - classic versus
    // is best of three, so one knockout is a round, not the match.
    //
    // CLEAR THE INVULNERABILITY FIRST. A fighter has invuln frames at the start
    // of a round, and takeDamage honours them, so a kill fired the instant
    // FIGHT arrives is silently dropped - the round never ends, and after four
    // passes this reported "never reached GAMEOVER", which reads as a
    // lifecycle bug rather than a swing that never landed. netcheck zeroes
    // invulnFrames before its damage for the same reason and says so; this
    // copy of the idea was missing it.
    //
    // The loop also reports WHAT it was looking at when it gave up. "never
    // reached GAMEOVER" names the symptom and hides every cause, and this is a
    // slow checker whose failures arrive from CI an hour after the fact.
    // What the game was actually doing when a wait ran out. Every failure in
    // endMatch ends with one of these, because "never reached X" names the
    // symptom and hides every cause - and this checker reports from CI an hour
    // later.
    //
    // DECLARED BEFORE its caller, not merely before its first call. A `const`
    // used inside a function defined above it works only as long as nobody
    // reorders the calls, and this file is one of several here that has had a
    // TDZ regression land exactly that way.
    const describe = () => page.evaluate(() => {
        const D = window.ACDebug;
        // `?? null` because the LOCAL build's ACDebug does not export roundWins
        // or currentRound, so these were undefined - and JSON.stringify drops
        // undefined, which is why the reported diagnostic was quietly missing
        // half the fields it claimed to carry. An explicit null says "this
        // build does not tell us" rather than saying nothing.
        return JSON.stringify({
            state: D.gameState,
            wins: D.roundWins ?? null,
            round: D.currentRound ?? null,
            p1hp: Math.round(D.player1.hp),
            p2hp: Math.round(D.player2.hp),
        });
    });

    let endWhy = '';
    const endMatch = async () => {
        for (let round = 0; round < 6; round++) {
            const inFight = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
            if (!inFight) {
                endWhy = 'never got back to FIGHT for round ' + (round + 1)
                    + ' ' + await describe();
                break;
            }
            await page.evaluate(() => {
                const D = window.ACDebug;
                D.player2.invulnFrames = 0;      // see above
                D.player2.takeDamage(D.player2.hp + 50, D.player1);
            });
            // WAIT FOR SOMETHING THAT WAS NOT ALREADY TRUE.
            //
            // A knockout is not instant: there is a death sequence, and on the
            // deciding one the crush cinematic, all counted in FRAMES - so its
            // wall-clock length is a function of frame rate, and at the ~1fps
            // of a CI runner it outlasts any fixed window written on a desktop.
            // The first attempt at that waited 12s for GAMEOVER, gave up, and
            // went back to waiting for FIGHT, which was never coming because
            // the match was over.
            //
            // The second attempt - "GAMEOVER or FIGHT" - was worse, and was my
            // mistake: the kill happens while the state is ALREADY FIGHT, so
            // the wait returned immediately, every time, having waited for
            // nothing. Six iterations in sixty seconds, reporting "rounds kept
            // resetting {state: FIGHT, p2hp: 0}" - the diagnostic accurately
            // describing a test that never waited.
            //
            // So: wait for a thing that is false at the moment of asking.
            // Either the match ended, or the next round restored the loser's
            // health. p2 at 0 hp in FIGHT is the knockout still being
            // processed; p2 above 0 is a new round genuinely under way.
            const settled = await H.waitInPage(page,
                "window.ACDebug.gameState === 'GAMEOVER'"
                + " || window.ACDebug.player2.hp > 0", 90000);
            if (!settled) {
                endWhy = 'the knockout in round ' + (round + 1)
                    + ' led to neither a next round nor a result ' + await describe();
                break;
            }
            if (await page.evaluate(() => window.ACDebug.gameState === 'GAMEOVER')) return true;
        }
        if (!endWhy) endWhy = 'rounds kept resetting ' + await describe();
        return false;
    };


    // WHERE DID IT COME FROM. Installed before the first match, so every
    // texture the game makes from here on carries the call site that made it.
    //
    // Constructors are wrapped rather than the base class, because three.js
    // builds textures through these four and there is no single hook: the
    // wrapper keeps the original prototype, so instanceof and everything
    // downstream behave exactly as before. dispose() is patched on the base
    // prototype, which all of them inherit.
    //
    // Textures created before this point are deliberately not tracked - the
    // question is growth across rematches, not the fixed cost of booting.
    await page.evaluate(() => {
        const T = window.THREE;
        if (!T || window.__acTexReg) return;
        const reg = window.__acTexReg = [];
        for (const name of ['CanvasTexture', 'DataTexture', 'Texture', 'WebGLRenderTarget']) {
            const Orig = T[name];
            if (typeof Orig !== 'function') continue;
            const Wrapped = function (...args) {
                const made = new Orig(...args);
                // Four frames is enough to name the builder without turning the
                // report into a stack dump.
                const stack = (new Error().stack || '').split('\n').slice(2, 6)
                    .map(l => l.trim().replace(/^at\s+/, '').replace(/\s*\(.*$/, ''))
                    .filter(Boolean).join(' < ');
                reg.push({ obj: made.texture || made, kind: name, where: stack });
                return made;
            };
            Wrapped.prototype = Orig.prototype;
            T[name] = Wrapped;
        }
        const origDispose = T.Texture.prototype.dispose;
        T.Texture.prototype.dispose = function () {
            this.__acDisposed = true;
            return origDispose.apply(this, arguments);
        };
        // WHO UPLOADED IT. A Proxy on renderer.info.memory, which is the exact
        // object the failing assertion reads.
        //
        // three.js does `info.memory.textures++` on every upload - a get then
        // a set - so this sees all of them regardless of who constructed the
        // texture. That is the difference from the constructor wrappers above,
        // which only see `new THREE.X` from game code and reported "none grew".
        // Watching the effect cannot miss a path; watching the cause can.
        // ACDebug READ HERE, not borrowed from an outer scope. This evaluate
        // runs in the page and had no `D` - the name belongs to other
        // evaluates in this file - so the trap threw ReferenceError on install
        // and the whole checker reported NO VERDICT in 11 seconds. A diagnostic
        // that cannot install is worse than none: it took the checker with it.
        const D = window.ACDebug;
        const renderer = D && D.renderer;
        if (renderer && renderer.info && renderer.info.memory
            && !renderer.info.memory.__acTrapped) {
            const real = renderer.info.memory;
            const tally = window.__acUploadTally = {};
            real.__acTrapped = true;
            const trapped = new Proxy(real, {
                set(target, prop, value) {
                    if (prop === 'textures' && value > target[prop]) {
                        // Frames 2..8: frame 0 is this trap and frame 1 the
                        // property set, identical for every upload. Frame 2
                        // IS three's own counter line, and it is kept - in
                        // minified three.js the name there is the only thing
                        // telling a loader upload from a render-target one.
                        const where = (new Error().stack || '').split('\n').slice(2, 8)
                            .map(l => l.trim().replace(/^at\s+/, '').replace(/\s*\(.*$/, ''))
                            .filter(Boolean).join(' < ') || '(no stack)';
                        tally[where] = (tally[where] || 0) + (value - target[prop]);
                    }
                    target[prop] = value;
                    return true;
                },
            });
            try {
                renderer.info.memory = trapped;
                window.__acUploads = () => Object.assign({}, window.__acUploadTally);
            } catch (e) {
                // A build where info.memory is read-only: the census below and
                // the constructor wrappers above still report.
                window.__acUploads = () => null;
            }
        } else if (!window.__acUploads) {
            window.__acUploads = () => null;
        }

        // WHAT THE SCENE CAN REACH, by description. Independent of how a
        // texture was constructed, which is the whole point: the constructor
        // wrappers above can only see the game's own `new THREE.X` calls.
        window.__acTexCensus = () => {
            const seen = new Set();
            const out = {};
            const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap',
                           'aoMap', 'emissiveMap', 'alphaMap', 'envMap',
                           'lightMap', 'bumpMap', 'displacementMap', 'specularMap'];
            const note = (tex) => {
                if (!tex || typeof tex !== 'object' || seen.has(tex.uuid)) return;
                seen.add(tex.uuid);
                const img = tex.image;
                const size = img && (img.width || img.videoWidth)
                    ? (img.width || img.videoWidth) + 'x' + (img.height || img.videoHeight)
                    : 'no-image';
                const k = (tex.constructor && tex.constructor.name || 'Texture')
                    + ' ' + (tex.name || '(unnamed)') + ' ' + size;
                out[k] = (out[k] || 0) + 1;
            };
            const D = window.ACDebug;
            const scene = D && D.scene;
            if (scene) {
                scene.traverse(node => {
                    const mats = !node.material ? []
                        : (Array.isArray(node.material) ? node.material : [node.material]);
                    for (const m of mats) {
                        if (!m) continue;
                        for (const slot of SLOTS) note(m[slot]);
                    }
                });
                note(scene.environment);
                note(scene.background);
            }
            return out;
        };
        window.__acTexLive = () => {
            const out = {};
            for (const r of window.__acTexReg) {
                if (r.obj && r.obj.__acDisposed) continue;
                const k = r.kind + ' @ ' + (r.where || '(no stack)');
                out[k] = (out[k] || 0) + 1;
            }
            return out;
        };
    });

    section('GPU resources do not accumulate across rematches:');
    check('the first match starts', await startMatch(), 'never reached FIGHT');
    check('and it can be finished', await endMatch(), endWhy || 'never reached GAMEOVER');
    // The baseline for the origin comparison: one match's worth of textures is
    // the legitimate cost, and anything that keeps growing after it is not.
    const liveAfterFirst = await page.evaluate(() => window.__acTexLive ? window.__acTexLive() : null);
    const censusFirst = await page.evaluate(() => window.__acTexCensus ? window.__acTexCensus() : null);
    const upFirst = await page.evaluate(() => window.__acUploads ? window.__acUploads() : null);

    const sample = () => page.evaluate(() => {
        const r = window.ACDebug.rendererInfo();
        const m = performance.memory;
        return { geometries: r.geometries, textures: r.textures, programs: r.programs,
                 heapMB: m ? Math.round(m.usedJSHeapSize / 1048576) : null };
    });

    const runStart = Date.now();
    const baseline = await sample();
    const series = [baseline];
    for (let i = 0; i < REMATCHES; i++) {
        const again = await page.evaluate(() => {
            const b = document.getElementById('btn-rematch');
            if (!b) return false;
            b.click();
            return true;
        });
        if (!again) { check('a rematch is offered every time', false, 'no #btn-rematch on pass ' + i); break; }
        if (!await endMatch()) {
            check('every rematch can be finished', false, 'pass ' + i + ': ' + endWhy);
            break;
        }
        series.push(await sample());
        // SAY WHERE IT GOT TO, per pass. Seven matches, each with two knockouts
        // and their frame-counted death sequences, is the bulk of this
        // checker's wall clock - so if the watchdog ever fires, the question is
        // which pass, and a timeout cannot answer it after the fact. The
        // per-pass seconds are also the number that says whether the budget is
        // close, which no amount of reasoning from a desktop can supply.
        console.log(`    (rematch ${i + 1}/${REMATCHES} done`
            + ` at ${Math.round((Date.now() - runStart) / 1000)}s)`);
    }

    // The undisposed-by-origin picture, first match against last. Reported
    // whatever the verdict: when the counts are flat this is one quiet line,
    // and when they are not it is the name of the thing to go and fix.
    const liveEnd = await page.evaluate(() => window.__acTexLive ? window.__acTexLive() : null);
    const censusEnd = await page.evaluate(() => window.__acTexCensus ? window.__acTexCensus() : null);
    const upEnd = await page.evaluate(() => window.__acUploads ? window.__acUploads() : null);
    let originNote = '';

    // THE REACHABLE CENSUS, first match against last. This is the half that can
    // see textures the game did not construct itself.
    if (censusFirst && censusEnd) {
        const keys = new Set(Object.keys(censusFirst).concat(Object.keys(censusEnd)));
        const grew = [...keys]
            .map(k => ({ k, from: censusFirst[k] || 0, to: censusEnd[k] || 0 }))
            .filter(r => r.to > r.from)
            .sort((a, b) => (b.to - b.from) - (a.to - a.from));
        const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
        section('Textures the scene can reach, first match vs last:');
        console.log(`    reachable: ${total(censusFirst)} -> ${total(censusEnd)}`);
        for (const g of grew.slice(0, 8)) {
            console.log(`    +${g.to - g.from}  (${g.from} -> ${g.to})  ${g.k}`);
        }
        originNote += `  REACHABLE: ${total(censusFirst)} -> ${total(censusEnd)}`;
        originNote += grew.length
            ? '  GREW: ' + grew.slice(0, 3).map(g => `+${g.to - g.from} ${g.k}`).join(' || ')
            : '  GREW: nothing reachable grew, so the leaked textures are ORPHANED'
              + ' - unreferenced and undisposed, which points at a loader or a'
              + ' render target held inside three.js rather than at game code';
    }
    if (!liveEnd || !liveAfterFirst) {
        // SAYS SO, rather than skipping in silence. This exact condition was
        // true for two full CI rounds - the install sat 22 lines after the
        // snapshot that reads it, so __acTexLive was undefined and the section
        // below never ran - and the report looked identical to one where the
        // tracker had simply found nothing.
        originNote = '  ORIGINS: tracker unavailable'
            + ` (afterFirst=${liveAfterFirst ? 'ok' : 'null'},`
            + ` end=${liveEnd ? 'ok' : 'null'}) - window.THREE missing at install time?`;
    } else {
        const growers = Object.keys(liveEnd)
            .map(k => ({ k, from: liveAfterFirst[k] || 0, to: liveEnd[k] }))
            .filter(r => r.to > r.from)
            .sort((a, b) => (b.to - b.from) - (a.to - a.from));
        section('Undisposed textures, by where they were created:');
        if (!growers.length) {
            console.log('    nothing grew');
        } else {
            for (const g of growers.slice(0, 6)) {
                console.log(`    +${g.to - g.from}  (${g.from} -> ${g.to})  ${g.k}`);
            }
        }
        // INTO THE FAILING DETAIL, which is the only place that reaches anyone.
        //
        // The first version of this printed the list with console.log beside a
        // check that always passed. CI's annotations carry FAILING checks only,
        // so the report that came back was the same bare "50 -> 74" as before
        // and a thirty-minute run bought nothing. A diagnostic nobody can read
        // is not a diagnostic.
        originNote = growers.length
            ? '  ORIGINS: ' + growers.slice(0, 4)
                .map(g => `+${g.to - g.from} ${g.k}`).join('  ||  ')
            : '  ORIGINS: none grew (so the growth is in textures created before'
              + ' the first match, or outside the four wrapped constructors)';
    }

    // WHERE THE UPLOADS CAME FROM, first match against the rest. This is the
    // one diagnostic that watches the counter itself, so a path it does not
    // name is a path that did not upload anything.
    if (upFirst && upEnd) {
        const rows = Object.keys(upEnd)
            .map(k => ({ k, from: upFirst[k] || 0, to: upEnd[k] }))
            .filter(r => r.to > r.from)
            .sort((a, b) => (b.to - b.from) - (a.to - a.from));
        section('Texture uploads by call path, first match vs last:');
        for (const r of rows.slice(0, 8)) {
            console.log(`    +${r.to - r.from}  (${r.from} -> ${r.to})  ${r.k}`);
        }
        if (!rows.length) console.log('    nothing uploaded after the first match');
        originNote += rows.length
            ? '  UPLOADS: ' + rows.slice(0, 3)
                .map(r => `+${r.to - r.from} ${r.k}`).join(' || ')
            : '  UPLOADS: no path uploaded a texture after the first match,'
              + ' so the count is growing without an upload - which would mean'
              + ' the dispose side, not the create side';
    } else {
        originNote += '  UPLOADS: trap unavailable (info.memory not writable?)';
    }

    const last = series[series.length - 1];
    const grew = k => last[k] - baseline[k];
    for (const k of ['geometries', 'textures', 'programs']) {
        check(`${k}: no growth across ${series.length - 1} rematches (${baseline[k]} -> ${last[k]})`,
            grew(k) <= SLACK,
            JSON.stringify(series.map(s => s[k])) + (k === 'textures' ? originNote : ''));
    }
    check('enough rematches actually ran to mean anything',
        series.length >= 4, series.length - 1 + ' rematches');
    console.log('    series: ' + JSON.stringify(series));

    await page.evaluate(() => localStorage.clear());
    await finish(browser, page);
})();
