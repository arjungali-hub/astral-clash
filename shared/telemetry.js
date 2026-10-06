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
// is queued for later, and a failure is swallowed in silence. A game that
// stutters because a stats endpoint is slow has traded something real for
// something that was only ever nice to have.

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

// Straight to PostgREST rather than through supabase-js: this needs one POST
// and no session, and loading a client library for it would mean the stats
// endpoint decides how fast the game starts.
function telemetryPost(table, row) {
    if (!shareStats) return;
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
