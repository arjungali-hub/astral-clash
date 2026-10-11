// Roadmap 11 and 21: what the balance actually is, and when it breaks.
//
// ============================================================================
// WHAT IS SENT, AND WHY YOU CAN BE SURE
// ============================================================================
//
// Two rows, both of them tallies:
//
//   "On 2026-10-06, Kaelen beat Lyra in Classic, 2-0."
//   "On 2026-10-06, the online build hit: Cannot read properties of null."
//
// That is the whole payload. The guarantee is STRUCTURAL rather than a promise:
// the tables in supabase/migrations/0005_telemetry.sql have no column for a
// player, an account, a device, a session or a time finer than a date. You
// cannot leak a field that does not exist, whereas a rule saying "do not send
// the user id" lasts exactly as long as the next person who has not read it.
//
// The date is a DATE and not a timestamp on purpose. A timestamp to the second
// is very nearly a unique identifier the moment it is combined with anything
// else, and nothing here needs to know more than which day.
//
// NO SESSION ID, which is the one that would be easy to add and tempting. Two
// rows must not be joinable as "the same person" - the instant they are, a
// sequence of matches becomes a profile.
//
// ============================================================================
// AND IT NEVER GETS IN THE WAY
// ============================================================================
//
// Every send is fire-and-forget: nothing awaits it, nothing retries, nothing
// is queued for later, and a failure changes nothing the player can see. A
// game that stutters because a stats endpoint is slow has traded something
// real for something that was only ever nice to have.
//
// "Swallowed in silence" is what this said, and it was not true of the
// console: fetch() resolves rather than rejects on an HTTP error, so the
// .catch() never fires on a 404, and the browser logs the failed request no
// matter what JS does about it. See telemetryPost - the answer is not to send
// from somewhere the endpoint is not.

const TELEMETRY_KEY = 'astralClashShareStats';

// ON by default, and switchable off. The data is aggregate and carries nothing
// about a person - which is a good argument that a switch is unnecessary, and
// no argument at all for refusing to offer one.
let shareStats = safeLSGet(TELEMETRY_KEY) !== 'off';

function telemetryEnabled() { return shareStats; }

function setShareStats(on) {
    shareStats = !!on;
    safeLSSet(TELEMETRY_KEY, shareStats ? 'on' : 'off');
    refreshShareStatsUI();
}

function toggleShareStats() { setShareStats(!shareStats); }

function refreshShareStatsUI() {
    setOptState('btn-share-stats', shareStats ? 'On' : 'Off', shareStats);
}

// Which build this is, as one of two fixed words. Fixed, so the field cannot
// quietly become a place to put something else.
function telemetryBuild() { return AC_ONE_SIDE_PER_CLIENT ? 'online' : 'local'; }

// ===========================================================================
// WHERE THIS IS ALLOWED TO REPORT FROM
// ===========================================================================
//
// Not from localhost, and not from a file:// page. This is a correctness rule
// about the DATA, not a convenience for tests.
//
// A test suite finishes matches. localmatchcheck plays one and then a rematch,
// leakcheck plays ten, botcheck four, and every one of them ends through the
// same endMatch() that calls reportMatchResult. So every CI run was posting
// dozens of synthetic "Kaelen beat Lyra" rows into the table whose whole
// purpose is to answer "is a fighter too strong" - and they look exactly like
// real rows, because they are the same shape. There is no column that could
// tell them apart afterwards, by design.
//
// That is the failure that matters, and it is the one that would never have
// been noticed: it only surfaced because 0005_telemetry.sql has not been
// applied yet, so PostgREST answered 404 and Chrome logged a failed request -
// which localmatchcheck reads as a console error. Apply the migration and the
// 404 disappears; the pollution does not. The symptom was load-bearing.
//
// Note also that the 404 could not have been handled in code. fetch() does not
// reject on an HTTP error - it resolves with ok:false - so the .catch() below
// never ran, and the browser logs a failed request whatever JS does with it.
// "A failure is swallowed in silence", as the header of this file claimed, was
// never true of the console. The only way not to log it is not to send it.
//
// telemetrycheck opts back in: it replaces window.fetch with a spy and asserts
// the payload shape, so it needs the real code path with nothing leaving the
// machine. An explicit opt-in for the one caller that has made it safe beats a
// rule each of the fifty checkers has to remember.
let telemetryAllowLocal = false;

function setTelemetryAllowLocal(on) { telemetryAllowLocal = !!on; }

function telemetryProductionOrigin() {
    try {
        const h = location.hostname;
        if (!h) return false;                 // file://, or something stranger
        return !(h === 'localhost' || h === '127.0.0.1'
                 || h === '::1' || h === '[::1]'
                 || /\.local$/.test(h) || /^192\.168\./.test(h));
    } catch (e) {
        return false;   // cannot tell where we are, so do not report
    }
}

// Straight to PostgREST rather than through supabase-js: this needs one POST
// and no session, and loading a client library for it would mean the stats
// endpoint decides how fast the game starts.
function telemetryPost(table, row) {
    if (!shareStats) return;
    if (!telemetryAllowLocal && !telemetryProductionOrigin()) return;
    if (typeof SUPABASE_URL !== 'string' || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    try {
        fetch(SUPABASE_URL + '/rest/v1/' + table, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_ANON_KEY,
                Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
                // Nothing comes back. The row is write-only to this key anyway -
                // anyone may report, nobody may read - so asking for the
                // inserted row would only fail.
                Prefer: 'return=minimal',
            },
            body: JSON.stringify(row),
            keepalive: true,      // survives the tab closing right after a match
        }).catch(() => { /* a lost stat is not worth a word to the player */ });
    } catch (e) { /* nor is a browser that refuses to fetch at all */ }
}

// ---------------------------------------------------------------------------
// 11: balance
// ---------------------------------------------------------------------------

// Called once at the end of a match. NOT for a draw and NOT for the co-op
// modes: "who beat whom" has no meaning when nobody did, or when both players
// were on the same side.
function reportMatchResult(mode, winnerName, loserName, loserRounds) {
    if (!winnerName || !loserName) return;
    if (mode === 'boss' || mode === 'survival') return;
    telemetryPost('match_results', {
        mode: String(mode || 'classic'),
        winner: String(winnerName),
        loser: String(loserName),
        loser_rounds: Math.max(0, Math.min(9, Number(loserRounds) || 0)),
    });
}

// ---------------------------------------------------------------------------
// 21: errors
// ---------------------------------------------------------------------------

// The same fault fires every frame once the loop is broken, so this remembers
// what it has already said. Per page load, in memory - a persisted list would
// be a small record of what one machine has seen, which is the kind of thing
// this file exists not to keep.
const seenErrors = new Set();
const ERROR_CAP = 5;

function reportError(message, where) {
    const msg = String(message || '').slice(0, 300);
    if (!msg) return;
    if (seenErrors.has(msg)) return;
    if (seenErrors.size >= ERROR_CAP) return;
    seenErrors.add(msg);
    telemetryPost('error_reports', {
        message: msg,
        // A FILE AND A LINE, not a stack. A stack names the functions a player
        // happened to be in, which is a little more about their session than is
        // needed to recognise a bug.
        where_at: String(where || '').slice(0, 300),
        build: telemetryBuild(),
    });
}

// Hooked once, at startup. Both halves: a thrown error and a rejected promise
// that nobody caught - the second is the one that usually goes unnoticed,
// because it prints to the console and breaks nothing visible.
function initTelemetry() {
    refreshShareStatsUI();
    window.addEventListener('error', (e) => {
        const at = e.filename
            ? (String(e.filename).split('/').pop() + ':' + e.lineno)
            : '';
        reportError(e.message, at);
    });
    window.addEventListener('unhandledrejection', (e) => {
        const r = e && e.reason;
        reportError((r && r.message) || String(r), 'promise');
    });
}
