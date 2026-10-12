// Roadmap 12: a match can be recorded, saved, read back and watched.
//
// WHAT THIS IS REALLY CHECKING. The feature records STATE rather than input,
// because input replay cannot work in this codebase - `dt` is wall-clock
// elapsed time and every position integrates against it, so the same inputs on
// a differently-loaded machine produce a different fight. See the note at the
// top of shared/replay.js.
//
// That choice is what makes this checkable at all: a recording is a list of
// positions, so "does playback reproduce the match" is a question about
// numbers rather than about whether two simulations stayed in step.
//
// The validation half matters as much as the playback half. replayFromJSON
// parses a file chosen off someone's disk, and the failure mode of trusting it
// is a half-built match with undefined coordinates that renders as nothing and
// reports no reason - so every rejection is asserted to produce a message a
// person could act on.
const H = require('./harness');

// The same picks localcombatcheck uses, for the same reason: two fighters that
// are unlocked from the start, so nothing depends on progression.
async function pick(page, side, name) {
    return page.evaluate((s, n) => {
        const grid = document.getElementById(s + '-grid');
        if (!grid) return false;
        const btn = [...grid.querySelectorAll('.fighter-btn')]
            .find(b => (b.textContent || '').includes(n));
        if (!btn) return false;
        btn.click();
        const c = document.querySelector('#' + s + '-detail .btn-confirm');
        if (c) c.click();
        return true;
    }, side, name);
}

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    const { check, section, finish } = H.makeChecker();

    await H.boot(page, { clearStorage: true, path: '/local/index.html' });
    await page.evaluate(() => window.ACDebug.setDebugUnlockAll(true));

    // ----------------------------------------------------------------------
    section('A damaged or foreign file is refused, with a reason:');
    // Pure functions, so no match is needed and nothing here can be flaky.
    const refusals = await page.evaluate(() => {
        const D = window.ACDebug;
        const cases = {
            'not json at all': 'this is not json',
            'json but not an object': '42',
            'an object with no version': JSON.stringify({ frames: [[0]] }),
            'a version from another build': JSON.stringify({ v: 999, frames: [[0], [1]] }),
            'no frames': JSON.stringify({ v: 1, frames: [] }),
            'a frame of the wrong width': JSON.stringify({ v: 1, frames: [[0, 1], [1, 2]] }),
            'a frame carrying something that is not a number':
                JSON.stringify({ v: 1, frames: [new Array(19).fill(0), ['x'].concat(new Array(18).fill(0))] }),
        };
        const out = {};
        for (const k in cases) {
            const r = D.replayFromJSON(cases[k]);
            out[k] = { refused: !!r.error, says: r.error || null };
        }
        return out;
    });
    for (const k of Object.keys(refusals)) {
        const r = refusals[k];
        check(`${k} is refused`, r.refused === true, JSON.stringify(r));
        // A rejection nobody can read is only half a rejection.
        check(`...and says why, in a sentence`,
            typeof r.says === 'string' && /[a-z]/.test(r.says) && r.says.length > 12,
            JSON.stringify(r.says));
    }

    // ----------------------------------------------------------------------
    section('A match records itself:');
    await pick(page, 'p1', 'Kaelen');
    await pick(page, 'p2', 'Lyra');
    const ready = await H.waitInPage(page,
        "(() => { const s = document.getElementById('btn-start-match');"
        + " return s && s.style.display !== 'none'; })()", 30000);
    check('both sides confirmed', ready, 'Start Match stayed hidden');
    await page.evaluate(() => document.getElementById('btn-start-match').click());
    if (!await H.waitInPage(page, "document.querySelectorAll('#mapselect-grid .map-card').length > 0", 30000)) {
        check('the arena picker opens', false, 'no .map-card');
        await finish(browser, page);
        return;
    }
    await page.evaluate(() => document.querySelectorAll('#mapselect-grid .map-card')[0].click());
    const live = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    check('the match starts', live, 'never reached FIGHT');
    if (!live) { await finish(browser, page); return; }

    check('recording began with the match',
        await page.evaluate(() => window.ACDebug.replayIsRecording()), 'not recording');

    // FRAMES, not seconds. The sampler is throttled to the format's rate, so
    // what it needs is rendered frames - and on a software renderer those are
    // the scarce resource, which is the mistake botcheck made at 2130s an arm.
    const grew = await page.evaluate(async () => {
        const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const before = window.ACDebug.replaySaved();   // null while recording
        for (let i = 0; i < 40; i++) await frame();
        const rec = window.ACDebug.replayFinishRecording();
        return {
            wasSavedBefore: !!before,
            frames: rec ? rec.frames.length : 0,
            map: rec ? rec.map : null,
            chars: rec ? rec.chars : null,
            keys: rec ? Object.keys(rec).sort() : [],
        };
    });
    check('nothing was offered to save mid-match', grew.wasSavedBefore === false,
        String(grew.wasSavedBefore));
    check('frames were written', grew.frames >= 2, grew.frames + ' frames');
    check('it knows which arena and who fought',
        !!grew.map && !!grew.chars && grew.chars.p1 === 'Kaelen' && grew.chars.p2 === 'Lyra',
        JSON.stringify({ map: grew.map, chars: grew.chars }));

    // ----------------------------------------------------------------------
    section('NOTHING IN THE FILE IS ABOUT A PERSON:');
    // The same rule as the telemetry tables, and asserted the same way - field
    // by field, because the failure mode is one addition nobody reviewed.
    // A replay is a local file rather than a row on a server, so this is a
    // courtesy rather than a boundary; it is still worth not writing down.
    const ALLOWED = ['at', 'build', 'chars', 'events', 'frames', 'hz', 'map', 'mode', 'names', 'v'];
    check('it carries only the fields it is meant to',
        JSON.stringify(grew.keys) === JSON.stringify(ALLOWED),
        JSON.stringify(grew.keys));
    const when = await page.evaluate(() => {
        const r = window.ACDebug.replaySaved();
        return r ? r.at : null;
    });
    check('the date has no time in it, to the second or otherwise',
        typeof when === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(when), String(when));

    // ----------------------------------------------------------------------
    section('A saved replay reads back as the same match:');
    const round = await page.evaluate(() => {
        const D = window.ACDebug;
        const rec = D.replaySaved();
        const text = D.replayToJSON(rec);
        const back = D.replayFromJSON(text);
        return {
            error: back.error || null,
            sameFrames: back.rec ? back.rec.frames.length === rec.frames.length : false,
            sameFirst: back.rec ? JSON.stringify(back.rec.frames[0]) === JSON.stringify(rec.frames[0]) : false,
            bytes: text.length,
            filename: D.replayFilename(rec),
        };
    });
    check('it survives the round trip', round.error === null && round.sameFrames && round.sameFirst,
        JSON.stringify(round));
    check('the filename names the fighters and the date',
        /kaelen/.test(round.filename) && /lyra/.test(round.filename)
        && /\d{4}-\d{2}-\d{2}/.test(round.filename), round.filename);
    // Not an assertion about compression, just a tripwire: a format that
    // silently became objects-per-frame would show up here as an order of
    // magnitude, and a few hundred bytes a second is the shape to keep.
    check('a frame costs a sensible number of bytes',
        round.bytes / Math.max(1, grew.frames) < 400,
        Math.round(round.bytes / Math.max(1, grew.frames)) + ' bytes/frame');

    // ----------------------------------------------------------------------
    section('Playback drives both fighters from the recording:');
    const played = await page.evaluate(async () => {
        const D = window.ACDebug;
        const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        // A SYNTHETIC recording, so the expected answer is known exactly rather
        // than being whatever the fighters happened to do. Two frames far apart
        // in both position and health.
        const side = (x, y, hp) => [x, y, 0, 1, 0, 0, hp, 0, 1];
        const rec = {
            v: 1, at: '2026-10-11', build: 'local', hz: 30,
            map: '', mode: 'classic',
            chars: { p1: 'Kaelen', p2: 'Lyra' }, names: { p1: 'A', p2: 'B' },
            // THREE frames, the last two identical and the last one far in the
            // future. The target has to arrive EARLY so the easing can
            // converge, and the recording has to LAST longer than this
            // measurement so it cannot end part-way through it.
            //
            // Both numbers were learned the hard way. Two frames 120ms apart
            // ended before the first rendered frame; so did three frames
            // ending at 1500ms - one frame of a live software-rendered fight
            // on a slow machine is longer than that, so the replay finished
            // and exited between replayBegin and the first sample. A minute is
            // past anything a rendered frame can take.
            frames: [
                [0].concat(side(600, 420, 300), side(1100, 520, 250)),
                [120].concat(side(900, 470, 180), side(700, 450, 90)),
                [60000].concat(side(900, 470, 180), side(700, 450, 90)),
            ],
            events: [],
        };
        D.replayBegin(rec);
        const puppets = {
            p1: D.player1.isNetPuppet(), p2: D.player2.isNetPuppet(),
            watch: D.watchView(),
        };
        // SAMPLED WHILE IT PLAYS. Read after the loop, these were both empty -
        // and correctly so: the recording is 120ms long, the loop runs 50
        // rendered frames, so playback reached its end and gameLoop called
        // exitReplay long before the measurement. The caption is taken at once
        // and the progress is the highest seen, so neither depends on catching
        // a particular frame.
        const caption = D.replayCaption();
        // MONOTONIC, not a threshold. How far a replay gets in fifty frames is
        // a fact about the machine; that it gets FURTHER as time passes is the
        // property, and it holds at any frame rate.
        let early = null, late = null;
        // Long enough for both frames to come due and the easing to converge.
        for (let i = 0; i < 50; i++) {
            await frame();
            if (i === 1) early = D.replayProgress();
            if (i === 49) late = D.replayProgress();
        }
        const got = {
            p1: { x: Math.round(D.player1.x), y: Math.round(D.player1.y), hp: Math.round(D.player1.hp) },
            p2: { x: Math.round(D.player2.x), y: Math.round(D.player2.y), hp: Math.round(D.player2.hp) },
        };
        // ...and it should have ended itself by now, which is what sent the
        // first version of this measurement looking at an empty replay.
        // ...and a SECOND, one-frame recording for the other property. A
        // recording that is already over when it starts must end itself on the
        // first tick, which makes this a fact rather than a race against the
        // renderer.
        D.replayBegin({
            v: 1, at: '2026-10-11', build: 'local', hz: 30, map: '', mode: 'classic',
            chars: { p1: 'Kaelen', p2: 'Lyra' }, names: { p1: 'A', p2: 'B' },
            frames: [[0].concat(side(900, 470, 180), side(700, 450, 90)),
                     [1].concat(side(900, 470, 180), side(700, 450, 90))],
            events: [],
        });
        const begun = D.replayActive();
        await frame();
        await frame();
        return { puppets, got, early, late, caption,
                 begun, endedItself: !D.replayActive() };
    });
    check('both fighters become puppets, not just the opponent',
        played.puppets.p1 === true && played.puppets.p2 === true,
        JSON.stringify(played.puppets));
    check('and the view switches to the one that shows a fight nobody is playing',
        played.puppets.watch === true, String(played.puppets.watch));
    // Within a few units: the positions are eased toward, not snapped to, and
    // the last frame is the target.
    const near = (a, b) => Math.abs(a - b) <= 6;
    check('p1 arrives where the recording says',
        near(played.got.p1.x, 900) && near(played.got.p1.y, 470),
        JSON.stringify(played.got.p1));
    check('p2 arrives where the recording says',
        near(played.got.p2.x, 700) && near(played.got.p2.y, 450),
        JSON.stringify(played.got.p2));
    // Health is SNAPPED, not eased - a bar that eases is actively misleading
    // about how close someone is to dying, which is why netApplyState does the
    // same.
    check('health is exact rather than eased toward',
        played.got.p1.hp === 180 && played.got.p2.hp === 90,
        JSON.stringify([played.got.p1.hp, played.got.p2.hp]));
    check('progress advances as the recording plays',
        played.early !== null && played.late !== null && played.late > played.early,
        JSON.stringify({ early: played.early, late: played.late }));
    check('and says whose match it is', /A/.test(played.caption) && /B/.test(played.caption),
        played.caption);
    // A REPLAY ENDS ITSELF. Nothing was checking this, and it is what a viewer
    // depends on: the alternative is a finished recording leaving two fighters
    // frozen on the last frame with no way out but the button.
    check('a recording that is already over starts and then ends itself',
        played.begun === true && played.endedItself === true,
        JSON.stringify({ begun: played.begun, ended: played.endedItself }));

    // ----------------------------------------------------------------------
    section('Leaving a replay early puts you back on a menu:');
    const left = await page.evaluate(() => {
        const D = window.ACDebug;
        // A FRESH ONE, left on purpose. The playback above ran to its end and
        // exited by itself, so exiting "it" would have been a no-op dressed up
        // as an assertion - and quitting part-way through is the case a person
        // actually performs.
        const side = (x, y, hp) => [x, y, 0, 1, 0, 0, hp, 0, 1];
        D.replayBegin({
            v: 1, at: '2026-10-11', build: 'local', hz: 30, map: '', mode: 'classic',
            chars: { p1: 'Kaelen', p2: 'Lyra' }, names: { p1: 'A', p2: 'B' },
            frames: [[0].concat(side(600, 420, 300), side(1100, 520, 250)),
                     [600000].concat(side(900, 470, 180), side(700, 450, 90))],
            events: [],
        });
        const playing = D.replayActive();
        D.exitReplay();
        return {
            playing,
            active: D.replayActive(),
            state: D.gameState,
            puppet: D.player1.isNetPuppet(),
            barOn: !!document.querySelector('#replay-bar.on'),
        };
    });
    check('a replay was actually running to leave', left.playing === true,
        String(left.playing));
    check('the replay ends', left.active === false, String(left.active));
    check('the fighters stop being puppets', left.puppet === false, String(left.puppet));
    check('and the bar goes away', left.barOn === false, String(left.barOn));

    await page.evaluate(() => localStorage.clear());
    await finish(browser, page);
})();
