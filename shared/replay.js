// Roadmap 12: replays, and spectating, without needing determinism.
//
// ===========================================================================
// WHY THIS RECORDS STATE AND NOT INPUT
// ===========================================================================
//
// The obvious design is to record what the players pressed and replay it
// through the simulation. It cannot work here, and the reason is one line:
//
//     let dt = (now - lastFrameTime) / (1000 / 60);   // computeDt
//
// `dt` is how long that frame actually took. Every position, cooldown and
// attack phase is integrated against it, so the same inputs on a machine
// rendering at 58fps instead of 60 - or the same machine under different load -
// produce a different fight. A few units at first, then a missed hit, then a
// different winner. Input replay needs "same inputs, same fight", and the
// simulation is wired to wall-clock time instead.
//
// There are two smaller reasons on top. The bot's decisions come from
// Math.random() (strafe direction, jump chance, think timer, attack and special
// rolls), so a replayed bot would choose differently; and Math.sin, Math.cos
// and Math.pow are not specified to bit precision in JavaScript, so even a
// fixed timestep can drift between two browsers over a couple of minutes of
// collisions.
//
// So this records the ANSWER rather than the question: where both fighters
// were, what they were doing, how much health they had. No determinism is
// required, because nothing is re-simulated.
//
// ===========================================================================
// WHICH IS ALMOST ENTIRELY ALREADY BUILT
// ===========================================================================
//
// The reconnect work did the hard part. isNetPuppet() already makes a fighter
// stop running its own physics and take its transform from somewhere else, and
// netApplyRemote already eases a fighter toward a buffered state with a
// teleport-snap for the big jumps. A replay is just both fighters being
// puppets, with the states coming from a file instead of a peer - and
// spectating is the same mechanism with the states coming from a live peer.
//
// What this file deliberately does NOT do is hook the netcode. Sampling both
// fighters directly means a replay records a split-screen match exactly as
// well as an online one, in a build that has no netcode at all.
//
// ===========================================================================
// WHAT GOES IN THE FILE
// ===========================================================================
//
// Same privacy rule as the telemetry tables, for the same reason: a date and no
// finer. A recording is a file on the player's own machine, so this is a
// courtesy rather than a boundary - but a timestamp to the second is very
// nearly an identifier the moment it is combined with anything else, and
// nothing in a replay needs one.
//
// Frames are FLAT ARRAYS of numbers, not objects. 30Hz for two minutes is
// 3,600 frames; as `{x: 1, y: 2, ...}` the key names alone are most of the
// file. Nineteen numbers per frame, rounded exactly as netTick rounds them -
// a tenth of a unit of position is far below what a pixel can show.

const REPLAY_VERSION = 1;

// The rate states are written at. The netcode sends at 30Hz and the easing in
// netApplyRemote was tuned against that, so a replay played back through the
// same easing wants the same cadence.
const REPLAY_HZ = 30;
const REPLAY_MS = 1000 / REPLAY_HZ;

// Nine numbers per fighter per frame: position, facing, pitch, health, meter,
// grounded. Everything a viewer can see, and nothing else.
const REPLAY_FIELDS = 9;

// A sane ceiling, so a match left running overnight cannot grow a recording
// until the tab dies. Twenty minutes at 30Hz.
const REPLAY_MAX_FRAMES = REPLAY_HZ * 60 * 20;

// Events are discrete - an attack, a special, a dodge. Interpolating a state
// stream cannot reproduce them, because a swing that starts and finishes
// between two samples leaves no trace in either one.
const REPLAY_EVENTS = ['attack', 'special', 'dodge'];

const REPLAY = {
    rec: null,          // the recording being written, or null
    last: null,         // the most recently finished one, for "save this"
    play: null,         // the recording being played, or null
    playing: false,
    cursor: 0,          // index of the next frame to deliver
    eventCursor: 0,
    startedAt: 0,       // performance.now() when playback began
    sampledAt: 0,       // performance.now() of the last recorded frame
    recStartedAt: 0,
    prev: { p1: { atk: 'idle', dodge: 0 }, p2: { atk: 'idle', dodge: 0 } },
    // The buffered state each fighter is being eased toward, per side. The
    // netcode keeps ONE of these (net.remoteState) because exactly one fighter
    // is ever remote; a replay drives both.
    buf: { p1: null, p2: null },
};

function replayActive() { return !!REPLAY.playing && !!REPLAY.play; }

function replayIsRecording() { return !!REPLAY.rec; }

function replaySaved() { return REPLAY.last; }

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

// `meta` carries what the frames cannot: which arena, which mode, who was
// fighting. Without it a recording is a list of coordinates with no scene to
// put them in.
function replayStartRecording(meta) {
    REPLAY.rec = {
        v: REPLAY_VERSION,
        // A DATE, not a timestamp. See the note at the top of this file.
        at: new Date().toISOString().slice(0, 10),
        build: (typeof AC_ONE_SIDE_PER_CLIENT !== 'undefined' && AC_ONE_SIDE_PER_CLIENT)
            ? 'online' : 'local',
        hz: REPLAY_HZ,
        map: (meta && meta.map) || '',
        mode: (meta && meta.mode) || 'classic',
        chars: { p1: (meta && meta.p1) || '', p2: (meta && meta.p2) || '' },
        names: { p1: (meta && meta.n1) || '', p2: (meta && meta.n2) || '' },
        frames: [],
        events: [],
    };
    REPLAY.recStartedAt = 0;
    REPLAY.sampledAt = 0;
    REPLAY.prev = { p1: { atk: 'idle', dodge: 0 }, p2: { atk: 'idle', dodge: 0 } };
}

// Rounded the way netTick rounds the same numbers: a tenth of a unit of
// position and a thousandth of a facing component are both far below anything
// a pixel can show, and the difference in file size is most of the file.
function replayPackSide(f) {
    return [
        Math.round(f.x * 10) / 10,
        Math.round(f.y * 10) / 10,
        Math.round(f.z * 10) / 10,
        Math.round(f.fx * 1000) / 1000,
        Math.round(f.fy * 1000) / 1000,
        Math.round((f.pitch || 0) * 1000) / 1000,
        Math.round(f.hp),
        Math.round(f.specialMeter || 0),
        f.grounded ? 1 : 0,
    ];
}

function replayUnpackSide(frame, offset) {
    return {
        x: frame[offset], y: frame[offset + 1], z: frame[offset + 2],
        fx: frame[offset + 3], fy: frame[offset + 4], pitch: frame[offset + 5],
        hp: frame[offset + 6], meter: frame[offset + 7],
        g: frame[offset + 8] === 1,
    };
}

// Called every frame while a match is being recorded. Throttled to REPLAY_HZ
// internally rather than by the caller, so the cadence is a property of the
// format and not of whoever remembered to rate-limit.
function replaySample(now, p1, p2) {
    const rec = REPLAY.rec;
    if (!rec || !p1 || !p2) return;
    if (rec.frames.length >= REPLAY_MAX_FRAMES) return;
    if (!REPLAY.recStartedAt) REPLAY.recStartedAt = now;

    // EVENTS FIRST, and every frame rather than on the sample tick. A swing
    // that starts and ends between two state samples leaves no trace in
    // either, so catching the transition is the only way it survives - which
    // means watching at full rate, not at 30Hz.
    for (const side of ['p1', 'p2']) {
        const f = side === 'p1' ? p1 : p2;
        const prev = REPLAY.prev[side];
        const t = Math.round(now - REPLAY.recStartedAt);
        if (prev.atk === 'idle' && f.atkState !== 'idle') {
            rec.events.push([t, side === 'p1' ? 0 : 1,
                             f.atkKind === 'special' ? 1 : 0]);
        }
        if (prev.dodge <= 0 && f.dodgeCooldown > 0) {
            rec.events.push([t, side === 'p1' ? 0 : 1, 2]);
        }
        prev.atk = f.atkState;
        prev.dodge = f.dodgeCooldown;
    }

    if (REPLAY.sampledAt && now - REPLAY.sampledAt < REPLAY_MS) return;
    REPLAY.sampledAt = now;
    rec.frames.push([Math.round(now - REPLAY.recStartedAt)]
        .concat(replayPackSide(p1), replayPackSide(p2)));
}

// Hands back the finished recording and keeps it as `last` so the result
// screen can offer to save it. A recording with no frames is not one.
function replayFinishRecording() {
    const rec = REPLAY.rec;
    REPLAY.rec = null;
    if (!rec || rec.frames.length < 2) { REPLAY.last = null; return null; }
    REPLAY.last = rec;
    return rec;
}

function replayDiscardRecording() { REPLAY.rec = null; }

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

function replayToJSON(rec) { return JSON.stringify(rec); }

// VALIDATED, not trusted. This parses a file the user chose off their own
// disk, and the failure mode of trusting it is a half-built match with
// undefined coordinates that renders as nothing and reports no reason. Every
// check here turned into a message a person can act on.
function replayFromJSON(text) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) { return { error: 'That file is not a readable replay.' }; }
    if (!data || typeof data !== 'object') return { error: 'That file is not a replay.' };
    // IS IT A REPLAY AT ALL, before asking which version it is.
    //
    // The version test came first, so any JSON file without a `v` field - which
    // is every JSON file in the world except a replay - was refused as "made by
    // a different version of the game". Reported from a file containing
    // {"not":"a replay"}: readable, translated, and about the wrong thing.
    //
    // Shape first, then version. The version message is worth keeping for the
    // case it was written for: a real replay from a build that is genuinely not
    // this one.
    if (typeof data.v !== 'number' || !Array.isArray(data.frames)) {
        return { error: 'That file is not a replay.' };
    }
    if (data.v !== REPLAY_VERSION) {
        return { error: 'That replay was made by a different version of the game.' };
    }
    if (!Array.isArray(data.frames) || data.frames.length < 2) {
        return { error: 'That replay has no match in it.' };
    }
    const width = 1 + REPLAY_FIELDS * 2;
    for (const fr of data.frames) {
        if (!Array.isArray(fr) || fr.length !== width) {
            return { error: 'That replay is damaged.' };
        }
        for (const n of fr) if (typeof n !== 'number' || !isFinite(n)) {
            return { error: 'That replay is damaged.' };
        }
    }
    if (!Array.isArray(data.events)) data.events = [];
    return { rec: data };
}

// A name a person can recognise in a downloads folder: who fought, and when.
function replayFilename(rec) {
    const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'fighter';
    return 'astral-clash-' + slug(rec.chars.p1) + '-vs-' + slug(rec.chars.p2)
        + '-' + (rec.at || 'replay') + '.acr.json';
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

function replayDurationMs() {
    const r = REPLAY.play;
    if (!r || !r.frames.length) return 0;
    return r.frames[r.frames.length - 1][0];
}

function replayElapsedMs() {
    if (!replayActive()) return 0;
    return Math.min(replayDurationMs(), performance.now() - REPLAY.startedAt);
}

function replayProgress() {
    const d = replayDurationMs();
    return d > 0 ? Math.min(1, replayElapsedMs() / d) : 0;
}

function replayBegin(rec) {
    REPLAY.play = rec;
    REPLAY.playing = true;
    REPLAY.cursor = 0;
    REPLAY.eventCursor = 0;
    REPLAY.startedAt = performance.now();
    REPLAY.buf = { p1: null, p2: null };
}

function replayEnd() {
    REPLAY.playing = false;
    REPLAY.play = null;
    REPLAY.buf = { p1: null, p2: null };
}

function replayFinished() {
    return replayActive() && replayElapsedMs() >= replayDurationMs();
}

// Everything the recording owes us by now.
//
// Returns the newest state per side rather than every state crossed, because
// the fighters are eased toward a target and only the latest target matters -
// delivering four superseded ones first would just be four discarded writes.
// Events are different and ALL of them are returned: each is a thing that
// happened, and skipping one loses a swing.
function replayAdvance(now) {
    const r = REPLAY.play;
    if (!r) return { p1: null, p2: null, events: [] };
    const t = now - REPLAY.startedAt;

    let latest = null;
    while (REPLAY.cursor < r.frames.length && r.frames[REPLAY.cursor][0] <= t) {
        latest = r.frames[REPLAY.cursor];
        REPLAY.cursor++;
    }
    if (latest) {
        REPLAY.buf.p1 = replayUnpackSide(latest, 1);
        REPLAY.buf.p2 = replayUnpackSide(latest, 1 + REPLAY_FIELDS);
    }

    const events = [];
    while (REPLAY.eventCursor < r.events.length && r.events[REPLAY.eventCursor][0] <= t) {
        const e = r.events[REPLAY.eventCursor];
        events.push({ side: e[1] === 0 ? 'p1' : 'p2', kind: REPLAY_EVENTS[e[2]] || 'attack' });
        REPLAY.eventCursor++;
    }

    return { p1: REPLAY.buf.p1, p2: REPLAY.buf.p2, events };
}

// Ease a fighter toward its buffered state, with the same rules the netcode
// uses on a puppet: positions eased so 30Hz does not read as 30Hz, facing set
// outright because easing a direction makes aim look laggy exactly when you
// are judging where someone points, and health snapped because a bar that
// eases is actively misleading about how close someone is to dying.
//
// Shares netEaseK and NET_SNAP_DIST deliberately. Two easing curves that are
// meant to look the same are two numbers free to drift apart.
function replayApplyTo(f, st, dt) {
    if (!f || !st) return;
    const k = netEaseK(dt);
    if (Math.hypot(st.x - f.x, st.y - f.y) > NET_SNAP_DIST) {
        f.x = st.x; f.y = st.y; f.z = st.z;
    } else {
        f.x += (st.x - f.x) * k;
        f.y += (st.y - f.y) * k;
        f.z += (st.z - f.z) * k;
    }
    f.fx = st.fx; f.fy = st.fy;
    f.pitch = st.pitch || 0;
    f.hp = st.hp;
    if (f.hpGhost < f.hp) f.hpGhost = f.hp;
    f.specialMeter = st.meter;
    f.grounded = st.g;
}

// What the recording says the fight was, for the overlay. Built here rather
// than in the UI so the two builds cannot describe a replay differently.
function replayCaption() {
    const r = REPLAY.play;
    if (!r) return '';
    const who = (side) => (r.names && r.names[side]) || (r.chars && r.chars[side]) || side;
    return who('p1') + ' vs ' + who('p2') + (r.map ? ' · ' + r.map : '');
}

// ---------------------------------------------------------------------------
// The two controls, owned here on purpose
// ---------------------------------------------------------------------------
//
// These could live in index.html beside the listeners, and then they would
// only ever exist in the online build. art/sync_local.py's markup porter
// carries an element across only when something in the destination - or in
// shared/ - actually reaches for its id (see the "THIS BUILD MUST ACTUALLY
// WANT IT" note in markup_inserts, added after the online lobby was dragged
// over wholesale). getElementById, a `#id` reference and setOptState are the
// three patterns it recognises.
//
// So the row and the file input are reached for from here, which is both why
// they travel and the honest place for them: a replay is a shared feature and
// neither build has a different idea of what these two do.

function replayFileEl() { return document.getElementById('replay-file'); }

// Opens the browser's own picker. Nothing may read a file off someone's disk
// without them choosing it, so this only asks - the input's change handler
// does the reading.
function replayOpenPicker() {
    const input = replayFileEl();
    if (!input) return;
    input.value = '';      // so choosing the same file twice still fires change
    input.click();
}

function refreshReplayRow() {
    setOptState('btn-watch-replay', replayActive() ? 'Watching' : 'Open', replayActive());
}
