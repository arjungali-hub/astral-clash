// Accounts: progression that follows you to another device.
//
// WHAT THIS REPLACED. The roadmap recommended export/import a save - a code you
// copy out and paste back - on the grounds that it needs no server and takes an
// afternoon. That was overruled, and rightly: a save code is cheap for the
// person who BUILDS it and a chore for every person who USES it. You have to
// know it exists, remember to export, and keep the file somewhere. Accounts are
// the thing a player actually wants, and "much easier for the user" is the
// right tiebreaker when the cost is only ours.
//
// ============================================================================
// THE RULE THAT DECIDES EVERYTHING ELSE: localStorage IS STILL THE TRUTH.
// ============================================================================
//
// The game must stay completely playable with no account, no connection, and no
// Supabase script loaded at all. So this is a SYNC TARGET bolted onto the side
// of the existing save, never a replacement for it. Every write still goes to
// localStorage first and every read still comes from there. If the network is
// down, or the CDN is blocked, or the player never signs in, nothing above this
// line notices.
//
// Anything else turns a flaky connection into a lost save, which is strictly
// worse than the problem being solved.
//
// ============================================================================
// CONFLICT RESOLUTION, decided before any of this was written.
// ============================================================================
//
// Two devices both earning coins offline is the NORMAL case, not the edge case,
// so this needed an answer rather than a default. The ones that do not work:
//
//   LAST WRITE WINS, silently. Play on your laptop, then open your phone which
//   has an older save, and the phone's save is now the one that gets uploaded.
//   Progress disappears with nothing on screen having said so.
//
//   MERGE BY MAXIMUM. Tempting, because coins and unlocks only go up. It is
//   also a duplication bug: spend 500 coins on device A, never open device B,
//   and the merge restores the 500 you spent while you keep what you bought.
//
// So: ASK, but only when it actually matters. On sign-in,
//
//   - cloud has no save            -> upload this device's. Nothing to lose.
//   - this device has nothing      -> download the cloud's. Nothing to lose.
//   - they agree                   -> nothing to do.
//   - they differ                  -> SHOW BOTH and let the player choose.
//
// The choice is shown with real numbers on it - coins and fighters unlocked on
// each side - because "cloud save or local save?" is not a question anybody can
// answer without them.
//
// After that, the account is simply where the save lives, and every change is
// pushed (debounced) as it happens.

// Filled in by whoever deploys this; see supabase/migrations/0001_saves.sql for
// the table. Both values are PUBLIC by design - the anon key is shipped inside
// a static page that anybody can read, which is why row level security on that
// table is the actual access control and not a formality.
// `let`, not `const`: a deployment sets these with accountConfigure() rather
// than by editing this file, which keeps a key out of the source history and
// lets the same build point at a different project. Empty means "no accounts",
// which is a supported state and not a broken one.
let SUPABASE_URL = '';
let SUPABASE_ANON_KEY = '';

// Call before initAccounts(). Returns whether it took, so a deployment script
// can tell the difference between "configured" and "typo".
function accountConfigure(url, key) {
    SUPABASE_URL = String(url || '').trim();
    SUPABASE_ANON_KEY = String(key || '').trim();
    return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// Rows are small (one JSON blob) and a match ends rarely, so this exists to
// collapse the burst of writes a single match-end produces - coins, then
// unlocks, then challenges - into one request, not to ration anything.
const ACCOUNT_PUSH_MS = 2500;

const ACCOUNT_DEVICE_KEY = 'astralClashDevice';
const ACCOUNT_STAMP_KEY = 'astralClashSavedAt';

let sb = null;                  // the Supabase client, or null if unavailable
let accountUser = null;         // { id, email } when signed in
let accountStatus = 'off';      // off | unavailable | signed-out | sending | signed-in | error
let accountDetail = '';
let accountPushTimer = null;
let accountConflict = null;     // { local, cloud } while a choice is pending
let onAccountChange = null;     // the build sets this; see accountNotify

// A human label for "your other device", so a conflict can say WHERE the other
// save came from. Random, stored locally, never derived from anything about the
// machine - a fingerprint would be a worse answer to a smaller question.
function accountDeviceName() {
    let d = safeLSGet(ACCOUNT_DEVICE_KEY);
    if (!d) {
        d = 'device-' + Math.random().toString(36).slice(2, 7);
        safeLSSet(ACCOUNT_DEVICE_KEY, d);
    }
    return d;
}

// When this device last changed its save. Written by accountTouch(), which
// saveProgression() calls, so it tracks the real thing rather than page loads.
function accountLocalStamp() {
    const raw = Number(safeLSGet(ACCOUNT_STAMP_KEY));
    return isFinite(raw) && raw > 0 ? raw : 0;
}

function accountTouch() {
    safeLSSet(ACCOUNT_STAMP_KEY, String(Date.now()));
}

function accountNotify() {
    if (typeof onAccountChange === 'function') {
        try { onAccountChange(); } catch (e) { /* a UI refresh must not break sync */ }
    }
}

function accountSetStatus(status, detail) {
    accountStatus = status;
    accountDetail = detail || '';
    accountNotify();
}

function accountState() {
    return {
        supported: accountSupported(),
        status: accountStatus,
        detail: accountDetail,
        email: accountUser ? accountUser.email : '',
        conflict: accountConflict,
        configured: !!(SUPABASE_URL && SUPABASE_ANON_KEY),
    };
}

// DOES THIS BUILD HAVE ACCOUNTS AT ALL.
//
// Online: one client drives one fighter and owns one purse, so an account is
// one person's save and the mapping is obvious.
//
// Local: two people share a keyboard and one `progression` object with a p1 and
// a p2 side. An account there would mean "this household's two saves", and
// signing out would take both. There is no good answer to "whose account is
// this" on a shared machine, so the honest thing is not to ask the question.
//
// Nothing is lost: the two builds share one progression store, so a split-screen
// player signs in once on the online build and that save syncs.
function accountSupported() { return !!AC_ONE_SIDE_PER_CLIENT; }

// Is this build able to talk to an account RIGHT NOW. Four ways it can be no,
// all ordinary rather than exceptional: the build does not have accounts, no
// project was configured, the CDN script was blocked, or there is no network.
function accountAvailable() {
    return !!(accountSupported() && sb && SUPABASE_URL && SUPABASE_ANON_KEY);
}

// Started once, after the page has loaded. Never throws: a missing script, a
// blocked CDN and an unconfigured deployment all end as a status line, because
// the game behind this has to run regardless.
function initAccounts() {
    if (!accountSupported()) {
        accountSetStatus('off', 'Accounts are managed in the online build');
        return;
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        accountSetStatus('off', 'No account service configured for this build');
        return;
    }
    // LOADED ONLY IF CONFIGURED. The client is ~50KB and the overwhelming
    // majority of page loads never touch an account, so it is fetched on demand
    // rather than sitting in the critical path of a game that has to start
    // fast. A blocked CDN ends as a status line, exactly like the three.js
    // fallback above it.
    accountLoadLib().then(startAccountClient).catch(() => {
        accountSetStatus('unavailable', 'Could not load the account service');
    });
}

function accountLoadLib() {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
        return Promise.resolve(window.supabase);
    }
    return new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
        el.onload = () => {
            if (window.supabase && typeof window.supabase.createClient === 'function') {
                resolve(window.supabase);
            } else {
                reject(new Error('loaded but no createClient'));
            }
        };
        el.onerror = () => reject(new Error('blocked'));
        document.head.appendChild(el);
    });
}

function startAccountClient(lib) {
    try {
        sb = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { persistSession: true, autoRefreshToken: true,
                    detectSessionInUrl: true },
        });
    } catch (e) {
        accountSetStatus('unavailable', 'Could not start the account service');
        return;
    }
    accountSetStatus('signed-out', '');
    sb.auth.onAuthStateChange((_event, session) => {
        accountUser = session && session.user
            ? { id: session.user.id, email: session.user.email }
            : null;
        if (accountUser) {
            accountSetStatus('signed-in', accountUser.email);
            accountSync();
        } else {
            accountSetStatus('signed-out', '');
        }
    });
    // A magic link lands back on the page with the session in the URL; this
    // picks up an existing one on an ordinary load.
    sb.auth.getSession().then(({ data }) => {
        if (data && data.session && data.session.user) {
            accountUser = { id: data.session.user.id, email: data.session.user.email };
            accountSetStatus('signed-in', accountUser.email);
            accountSync();
        }
    }).catch(() => { /* an absent session is the normal case */ });
}

// A LINK, not a password. There is nothing here worth the support burden of
// password resets, and a password is one more thing to lose - which is the
// problem this whole feature exists to solve.
async function accountSignIn(email) {
    // THE ADDRESS FIRST. This is a client-side question, so answering it does
    // not need a backend - and reporting "unavailable" for a typo blames the
    // wrong thing, which is the kind of error message that sends somebody to
    // check their wifi over a missing @.
    const addr = String(email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
        return { ok: false, error: 'That does not look like an email address' };
    }
    if (!accountAvailable()) return { ok: false, error: accountDetail || 'unavailable' };
    accountSetStatus('sending', addr);
    try {
        const { error } = await sb.auth.signInWithOtp({
            email: addr,
            options: { emailRedirectTo: location.origin + location.pathname },
        });
        if (error) {
            accountSetStatus('error', error.message || 'Could not send the link');
            return { ok: false, error: error.message || 'Could not send the link' };
        }
        accountSetStatus('sending', 'Check ' + addr + ' for a sign-in link');
        return { ok: true };
    } catch (e) {
        accountSetStatus('error', 'Could not reach the account service');
        return { ok: false, error: 'Could not reach the account service' };
    }
}

async function accountSignOut() {
    if (!accountAvailable()) return;
    try { await sb.auth.signOut(); } catch (e) { /* signing out always succeeds locally */ }
    accountUser = null;
    accountConflict = null;
    accountSetStatus('signed-out', '');
}

// What a save looks like at a glance, for the conflict prompt. Numbers, because
// "cloud save or local save?" is unanswerable without them.
function accountSummary(data, when, device) {
    const side = (s) => (data && data[s]) || {};
    const coins = (side('p1').coins || 0) + (side('p2').coins || 0);
    const chars = new Set([...(side('p1').unlockedChars || []),
                           ...(side('p2').unlockedChars || [])]).size;
    return { coins, chars, when: when || 0, device: device || '' };
}

async function accountPull() {
    const { data, error } = await sb.from('saves')
        .select('data, updated_at, device').eq('user_id', accountUser.id).maybeSingle();
    if (error) throw error;
    return data || null;
}

async function accountPush() {
    const row = {
        user_id: accountUser.id,
        data: progression,
        device: accountDeviceName(),
    };
    const { error } = await sb.from('saves').upsert(row, { onConflict: 'user_id' });
    if (error) throw error;
    accountTouch();
}

// Called on sign-in. Decides pull, push, or ask - see the header for why those
// are the only three answers.
async function accountSync() {
    if (!accountAvailable() || !accountUser) return;
    let cloud;
    try {
        cloud = await accountPull();
    } catch (e) {
        accountSetStatus('error', 'Signed in, but could not read your save');
        return;
    }
    const localStamp = accountLocalStamp();
    const localEmpty = !localStamp;

    if (!cloud) {                       // nothing up there yet
        try { await accountPush(); accountSetStatus('signed-in', accountUser.email); }
        catch (e) { accountSetStatus('error', 'Signed in, but could not save'); }
        return;
    }
    if (localEmpty) {                   // nothing down here
        accountApplyCloud(cloud.data);
        return;
    }
    if (JSON.stringify(cloud.data) === JSON.stringify(progression)) {
        accountSetStatus('signed-in', accountUser.email);   // already agree
        return;
    }
    // They differ and both are real. This is the case that must not be decided
    // quietly: see the header.
    accountConflict = {
        local: accountSummary(progression, localStamp, accountDeviceName()),
        cloud: accountSummary(cloud.data, Date.parse(cloud.updated_at) || 0, cloud.device),
        cloudData: cloud.data,
    };
    accountNotify();
}

function accountApplyCloud(data) {
    if (!data || typeof data !== 'object') return;
    // Through the same repair the local save goes through. It arrived over a
    // network from a row a client wrote, so it is no more trustworthy than
    // localStorage - and repairSideProgress is what everything downstream
    // assumes has already run.
    progression.p1 = repairSideProgress(data.p1);
    progression.p2 = repairSideProgress(data.p2);
    saveProgression();
    accountTouch();
    accountConflict = null;
    accountSetStatus('signed-in', accountUser ? accountUser.email : '');
}

// The player's answer to a conflict. 'cloud' takes what was up there, 'local'
// uploads what is here. Both are explicit; there is no third option that does
// not involve guessing.
async function accountResolveConflict(which) {
    if (!accountConflict) return;
    if (which === 'cloud') {
        accountApplyCloud(accountConflict.cloudData);
        return;
    }
    accountConflict = null;
    try { await accountPush(); accountSetStatus('signed-in', accountUser.email); }
    catch (e) { accountSetStatus('error', 'Could not upload this device’s save'); }
    accountNotify();
}

// Called by saveProgression(). Debounced, so one match-end is one request
// rather than three - and NEVER while a conflict is unanswered, because
// pushing then would silently decide the question being asked.
function accountQueuePush() {
    accountTouch();
    if (!accountAvailable() || !accountUser || accountConflict) return;
    if (accountPushTimer) clearTimeout(accountPushTimer);
    accountPushTimer = setTimeout(() => {
        accountPushTimer = null;
        accountPush().catch(() => accountSetStatus('error', 'Could not save to your account'));
    }, ACCOUNT_PUSH_MS);
}

// ---------------------------------------------------------------------------
// The panel.
//
// Rendered from here rather than built as elements in the build, for the reason
// the daily panel is: written once, identical in both builds, and impossible to
// drift. It is a string of HTML because that is what a screen made entirely of
// text and three buttons actually needs.
// ---------------------------------------------------------------------------

function accountWhen(ms) {
    if (!ms) return 'unknown';
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' minute' + (mins === 1 ? '' : 's') + ' ago';
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + ' hour' + (hrs === 1 ? '' : 's') + ' ago';
    const days = Math.round(hrs / 24);
    return days + ' day' + (days === 1 ? '' : 's') + ' ago';
}

function accountSaveLine(s, label) {
    return '<div class="account-save-line"><b>' + label + '</b> \u2014 '
        + s.coins + ' coins, ' + s.chars + ' fighter' + (s.chars === 1 ? '' : 's')
        + ' unlocked, saved ' + accountWhen(s.when)
        + (s.device ? ' on ' + s.device : '') + '</div>';
}

// FIRST AND ALONE. Two real saves that disagree is the only thing on this
// screen that cannot wait, and showing the sign-out button beside it would
// invite somebody to make the choice by accident.
function accountConflictHTML(c) {
    return '<div class="account-conflict">'
        + '<h4>Two saves, and they do not match</h4>'
        + '<p class="account-status">Pick the one to keep. The other is '
        + 'replaced, so choose the one with the progress you recognise.</p>'
        + accountSaveLine(c.cloud, 'In your account')
        + accountSaveLine(c.local, 'On this device')
        + '<div class="account-choices">'
        + '<button id="btn-account-use-cloud">Use my account\u2019s save</button>'
        + '<button id="btn-account-use-local" class="btn-secondary">'
        + 'Use this device\u2019s save</button>'
        + '</div></div>';
}

function accountPanelHTML() {
    const st = accountState();
    // ORDER IS URGENCY. A pending conflict is a decision about whose save
    // survives and outranks everything; "not set up" is the least urgent thing
    // here and used to be checked first, which made every state behind it
    // unreachable.
    if (st.conflict) return accountConflictHTML(st.conflict);
    if (!st.configured) {
        return '<p class="account-status">Accounts are not set up for this build. '
            + 'Your progress is still saved on this device.</p>';
    }
    if (st.status === 'unavailable') {
        return '<p class="account-status err">' + st.detail + '. '
            + 'Your progress is still saved on this device.</p>';
    }
    if (st.status === 'signed-in') {
        return '<p class="account-status ok">Signed in as <b>' + st.email + '</b>. '
            + 'Your progress is saved here and to your account.</p>'
            + '<button id="btn-account-signout" class="btn-secondary">Sign out</button>';
    }
    const sending = st.status === 'sending';
    return '<div class="account-row">'
        + '<input id="input-account-email" type="email" autocomplete="email" '
        + 'spellcheck="false" placeholder="you@example.com" aria-label="Your email address">'
        + '<button id="btn-account-send"' + (sending ? ' disabled' : '') + '>'
        + (sending ? 'Sent' : 'Send link') + '</button>'
        + '</div>'
        + '<p class="account-status' + (st.status === 'error' ? ' err' : '') + '">'
        + (st.detail || 'We email you a link instead of a password \u2014 there is '
           + 'nothing to remember and nothing to lose.')
        + '</p>';
}

function refreshAccountUI() {
    // The row is REMOVED from the local build by the sync, not merely hidden -
    // see MARKUP_INTERFACE. This guard is for the build that has it.
    if (!accountSupported()) return;
    const el = document.getElementById('account-body');
    if (!el) return;
    el.innerHTML = accountPanelHTML();
    wireAccountPanel();
    const st = accountState();
    // The settings row says enough to be worth reading without opening it.
    // CONFLICT OUTRANKS SIGNED-IN. It used to be the other way round, so a
    // signed-in player with two disagreeing saves saw a reassuring "On" at
    // exactly the moment they had a decision to make about which one survives.
    setOptState('btn-account',
        st.conflict ? 'Action needed' : (st.status === 'signed-in' ? 'On' : 'Off'),
        !!st.conflict || st.status === 'signed-in');
}

// Re-wired on every render, because the panel replaces its own contents and
// the buttons that were there are gone.
function wireAccountPanel() {
    const on = (id, fn) => {
        const b = document.getElementById(id);
        if (b) b.addEventListener('click', fn);
    };
    on('btn-account-send', () => {
        const input = document.getElementById('input-account-email');
        accountSignIn(input ? input.value : '').then(refreshAccountUI);
    });
    on('btn-account-signout', () => { accountSignOut().then(refreshAccountUI); });
    on('btn-account-use-cloud', () => {
        accountResolveConflict('cloud').then(refreshAccountUI);
    });
    on('btn-account-use-local', () => {
        accountResolveConflict('local').then(refreshAccountUI);
    });
    const input = document.getElementById('input-account-email');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            accountSignIn(input.value).then(refreshAccountUI);
        });
    }
}
