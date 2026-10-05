// Accounts: a username, a display name, and a password.
//
// ============================================================================
// THE RULE THAT DECIDES EVERYTHING ELSE: THE SERVER IS THE TRUTH.
// ============================================================================
//
// In the ONLINE build, progress belongs to an account and lives in the
// database. Nothing is written to this machine - no coins, no unlocks, no
// upgrades. Sign in and your progress is there; sign out and there is nothing
// on the device to find.
//
// So a signed-out player EARNS NOTHING. There is no purse to credit. That is
// the design rather than a gap, and the panel says so plainly instead of
// letting coins appear and then vanish on the next reload.
//
// The SPLIT-SCREEN build is untouched and still uses localStorage. Two people
// share one keyboard and one progression object with a p1 and a p2 side, so
// there is nobody for a single account to belong to - the same reason
// accountSupported() is false there.
//
// ============================================================================
// WHY THERE IS NO EMAIL
// ============================================================================
//
// Supabase Auth is built around an address, so each account gets a synthetic
// one derived from its username: `<username>@users.astral-clash.invalid`.
// `.invalid` is reserved by RFC 2606 so it can never resolve - which is the
// point. Nothing is ever sent there. It exists because auth.users needs a
// unique key; the username is the identity.
//
// THE COST, because it is real and should not be discovered later: there is no
// password reset. With no address to mail, a forgotten password cannot be
// recovered by the player. The honest fix is an OPTIONAL recovery address on
// the profile - optional, because requiring one puts back exactly what this
// avoids.

// Set by the build with accountConfigure(). Both are PUBLIC by design - this
// page is static and anyone can read it - which is why the row level security
// in supabase/migrations/ is the actual access control.
let SUPABASE_URL = '';
let SUPABASE_ANON_KEY = '';

function accountConfigure(url, key) {
    SUPABASE_URL = String(url || '').trim();
    SUPABASE_ANON_KEY = String(key || '').trim();
    return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// The domain the synthetic addresses live under. Never contacted.
const ACCOUNT_EMAIL_DOMAIN = '@users.astral-clash.invalid';

// Collapses the burst of writes one match-end produces - coins, then unlocks,
// then challenges - into a single request. Not a rate limit; a tidy-up.
const ACCOUNT_PUSH_MS = 2000;

// Matches the CHECK constraint on profiles.username deliberately: a rule
// enforced in one place and described in another drifts, and a player should
// hear about a bad username before a round trip rather than after one.
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const DISPLAY_MAX = 14;

let sb = null;
let accountUser = null;        // { id, username, displayName } when signed in
let accountStatus = 'off';     // off | unavailable | signed-out | busy | signed-in | error
let accountDetail = '';
let accountPushTimer = null;
let accountMode = 'in';        // which half of the panel is showing: 'in' | 'up'
let onAccountChange = null;    // the build sets this; see accountNotify

function accountNotify() {
    if (typeof onAccountChange === 'function') {
        try { onAccountChange(); } catch (e) { /* a repaint must not break sync */ }
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
        configured: !!(SUPABASE_URL && SUPABASE_ANON_KEY),
        status: accountStatus,
        detail: accountDetail,
        username: accountUser ? accountUser.username : '',
        displayName: accountUser ? accountUser.displayName : '',
        signedIn: !!accountUser,
        mode: accountMode,
    };
}

// DOES THIS BUILD HAVE ACCOUNTS AT ALL.
//
// Online: one client drives one fighter and owns one purse, so an account is
// one person's progress and the mapping is obvious.
//
// Local: two people, one keyboard, one progression object. "Whose account is
// this" has no good answer, so the question is not asked - that build keeps its
// save on the machine, as it always has.
function accountSupported() { return !!AC_ONE_SIDE_PER_CLIENT; }

function accountAvailable() {
    return !!(accountSupported() && sb && SUPABASE_URL && SUPABASE_ANON_KEY);
}

function accountSignedIn() { return !!(accountUser && accountAvailable()); }

// The synthetic address for a username. One function, used by sign-up and
// sign-in alike, so the two can never disagree about what an account is called.
function accountEmailFor(username) {
    return String(username || '').trim().toLowerCase() + ACCOUNT_EMAIL_DOMAIN;
}

// Checked here as well as in the database. The constraint is what makes it
// true; this is what makes it quick to hear about.
function usernameProblem(username) {
    const u = String(username || '').trim().toLowerCase();
    if (!u) return 'Pick a username';
    if (u.length < 3) return 'Usernames are at least 3 characters';
    if (u.length > 20) return 'Usernames are at most 20 characters';
    if (!USERNAME_RE.test(u)) return 'Letters, numbers and underscores only';
    return null;
}

function passwordProblem(pw) {
    const p = String(pw || '');
    // Supabase's own floor is 6. Eight here, because this password cannot be
    // reset and a weak one is not recoverable from.
    if (p.length < 8) return 'Passwords are at least 8 characters';
    if (p.length > 72) return 'Passwords are at most 72 characters';
    return null;
}

function displayProblem(name) {
    const d = String(name || '').trim();
    if (!d) return 'Pick a display name';
    if (d.length > DISPLAY_MAX) return 'Display names are at most ' + DISPLAY_MAX + ' characters';
    return null;
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

function initAccounts() {
    if (!accountSupported()) {
        accountSetStatus('off', 'Split-screen build - progress stays on this machine');
        return;
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        accountSetStatus('off', 'No account service configured for this build');
        return;
    }
    // Fetched on demand: the client is ~50KB and most page loads never touch an
    // account, so it stays out of the critical path of a game that has to start
    // quickly. A blocked CDN ends as a status line, like the three.js fallback.
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
            // detectSessionInUrl off: nothing arrives by link any more, and
            // leaving it on makes the client parse every page load's hash
            // looking for a token that is never there.
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        });
    } catch (e) {
        accountSetStatus('unavailable', 'Could not start the account service');
        return;
    }
    accountSetStatus('signed-out', '');
    sb.auth.onAuthStateChange((_event, session) => {
        if (session && session.user) accountAfterSignIn(session.user.id);
        else { accountUser = null; accountForgetProgress(); accountSetStatus('signed-out', ''); }
    });
    sb.auth.getSession().then(({ data }) => {
        if (data && data.session && data.session.user) accountAfterSignIn(data.session.user.id);
    }).catch(() => { /* no session is the normal case */ });
}

// ---------------------------------------------------------------------------
// Sign up / in / out
// ---------------------------------------------------------------------------

async function accountSignUp(username, displayName, password) {
    // THE FIELDS FIRST. These are client-side rules and answering them needs no
    // backend - reporting "accounts are unavailable" for a username with a
    // punctuation mark in it blames the wrong thing, and sends somebody to
    // check their connection over a typo.
    const u = String(username || '').trim().toLowerCase();
    const d = String(displayName || '').trim();
    const bad = usernameProblem(u) || displayProblem(d) || passwordProblem(password);
    if (bad) { accountSetStatus('error', bad); return { ok: false, error: bad }; }
    if (!accountAvailable()) return { ok: false, error: accountDetail || 'Accounts are unavailable' };

    accountSetStatus('busy', 'Creating your account…');
    try {
        // ASKED BEFORE TRYING, so a taken name is a clear sentence rather than
        // a unique-constraint violation surfacing as "duplicate key value".
        const { data: free, error: checkErr } =
            await sb.rpc('username_available', { candidate: u });
        if (checkErr) throw checkErr;
        if (free === false) {
            accountSetStatus('error', 'That username is taken');
            return { ok: false, error: accountDetail };
        }

        const { data, error } = await sb.auth.signUp({
            email: accountEmailFor(u), password: String(password),
        });
        if (error) throw error;
        const id = data && data.user && data.user.id;
        if (!id) throw new Error('no user came back');

        // The profile row is what makes the username real. If this fails the
        // auth user exists without one - recoverable, because accountAfterSignIn
        // treats a missing profile as "finish signing up" rather than a crash.
        const { error: pErr } = await sb.from('profiles')
            .insert({ user_id: id, username: u, display_name: d });
        if (pErr) throw pErr;

        await accountAfterSignIn(id);
        return { ok: true };
    } catch (e) {
        const msg = (e && e.message) || 'Could not create the account';
        accountSetStatus('error', /already registered|duplicate|unique/i.test(msg)
            ? 'That username is taken' : msg);
        return { ok: false, error: accountDetail };
    }
}

async function accountSignIn(username, password) {
    if (!accountAvailable()) return { ok: false, error: accountDetail || 'Accounts are unavailable' };
    const u = String(username || '').trim().toLowerCase();
    if (!u) { accountSetStatus('error', 'Enter your username'); return { ok: false, error: accountDetail }; }
    if (!password) { accountSetStatus('error', 'Enter your password'); return { ok: false, error: accountDetail }; }

    accountSetStatus('busy', 'Signing in…');
    try {
        const { data, error } = await sb.auth.signInWithPassword({
            email: accountEmailFor(u), password: String(password),
        });
        if (error) throw error;
        await accountAfterSignIn(data.user.id);
        return { ok: true };
    } catch (e) {
        // DELIBERATELY ONE MESSAGE for a wrong username and a wrong password.
        // Telling them apart hands out which usernames exist, and tells an
        // honest player nothing they could act on differently.
        accountSetStatus('error', 'That username and password do not match');
        return { ok: false, error: accountDetail };
    }
}

async function accountSignOut() {
    if (!accountAvailable()) return;
    try { await sb.auth.signOut(); } catch (e) { /* signing out always works locally */ }
    accountUser = null;
    accountForgetProgress();
    accountSetStatus('signed-out', '');
}

// Signed out means EMPTY, not stale. The previous account's coins must not sit
// on screen - or worse, be pushed into whichever account signs in next.
function accountForgetProgress() {
    if (!accountSupported()) return;
    if (accountPushTimer) { clearTimeout(accountPushTimer); accountPushTimer = null; }
    progression.p1 = freshSideProgress();
    progression.p2 = freshSideProgress();
    accountNotify();
}

// ---------------------------------------------------------------------------
// The save
// ---------------------------------------------------------------------------

async function accountAfterSignIn(userId) {
    try {
        const { data: prof, error } = await sb.from('profiles')
            .select('username, display_name').eq('user_id', userId).maybeSingle();
        if (error) throw error;
        if (!prof) {
            // An auth user with no profile: sign-up got halfway. Say so rather
            // than pretending to be signed in with no name.
            accountUser = null;
            accountSetStatus('error', 'This account is half-created — sign up again');
            return;
        }
        accountUser = { id: userId, username: prof.username, displayName: prof.display_name };
        await accountLoadProgression();
        accountSetStatus('signed-in', prof.display_name);
    } catch (e) {
        accountUser = null;
        accountSetStatus('error', 'Signed in, but could not read your account');
    }
}

// THE ONLY PLACE PROGRESS COMES FROM in the online build.
async function accountLoadProgression() {
    if (!accountUser) return;
    const { data, error } = await sb.from('saves')
        .select('data').eq('user_id', accountUser.id).maybeSingle();
    if (error) throw error;
    const blob = (data && data.data) || null;
    // Through the same repair a local save gets. It arrived over a network from
    // a row a client wrote, so it is no more trustworthy than localStorage -
    // and repairSideProgress is what everything downstream assumes has run.
    progression.p1 = repairSideProgress(blob && blob.p1);
    progression.p2 = repairSideProgress(blob && blob.p2);
    // A brand-new account has no row yet. Writing one now means every later
    // save is an update against something that already exists.
    if (!blob) await accountPush();
    accountNotify();
}

async function accountPush() {
    if (!accountUser) return;
    const { error } = await sb.from('saves').upsert(
        { user_id: accountUser.id, data: progression, device: accountUser.username },
        { onConflict: 'user_id' });
    if (error) throw error;
}

// Called by saveProgression(). Debounced, so one match-end is one request.
function accountQueuePush() {
    if (!accountSignedIn()) return;
    if (accountPushTimer) clearTimeout(accountPushTimer);
    accountPushTimer = setTimeout(() => {
        accountPushTimer = null;
        accountPush().catch(() => accountSetStatus('error', 'Could not save to your account'));
    }, ACCOUNT_PUSH_MS);
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

function accountPanelHTML() {
    const st = accountState();
    if (!st.supported) {
        return '<p class="account-status">This is the split-screen build — progress is '
            + 'saved on this machine and each player keeps their own.</p>';
    }
    if (!st.configured) {
        return '<p class="account-status err">Accounts are not set up for this build, '
            + 'so nothing can be saved.</p>';
    }
    if (st.status === 'unavailable') {
        return '<p class="account-status err">' + st.detail + ', so nothing can be saved '
            + 'right now.</p>';
    }
    if (st.signedIn) {
        return '<p class="account-status ok">Signed in as <b>' + st.displayName + '</b> '
            + '(<span class="account-username">' + st.username + '</span>). '
            + 'Your coins, unlocks and upgrades are saved to this account.</p>'
            + '<button id="btn-account-signout" class="btn-secondary">Sign out</button>';
    }
    const busy = st.status === 'busy';
    const dis = busy ? ' disabled' : '';
    const up = st.mode === 'up';
    // ONE PANEL, TWO MODES. A separate sign-up screen means somebody who
    // already has an account meets a form asking them to invent one; this way
    // the thing you came to do is on screen and the other is one click away.
    return ''
        + '<div class="account-tabs">'
        + '<button id="btn-account-mode-in" class="account-tab' + (up ? '' : ' on') + '">Sign in</button>'
        + '<button id="btn-account-mode-up" class="account-tab' + (up ? ' on' : '') + '">Create account</button>'
        + '</div>'
        + '<div class="account-row"><label for="input-account-user">Username</label>'
        + '<input id="input-account-user" autocomplete="username" spellcheck="false"'
        + ' maxlength="20" placeholder="' + (up ? '3-20 characters' : '') + '"' + dis + '></div>'
        + (up
            ? '<div class="account-row"><label for="input-account-display">Display name</label>'
              + '<input id="input-account-display" autocomplete="nickname" maxlength="' + DISPLAY_MAX + '"'
              + ' placeholder="what other players see"' + dis + '></div>'
            : '')
        + '<div class="account-row"><label for="input-account-pass">Password</label>'
        + '<input id="input-account-pass" type="password"'
        + ' autocomplete="' + (up ? 'new-password' : 'current-password') + '"'
        + ' maxlength="72" placeholder="' + (up ? 'at least 8 characters' : '') + '"' + dis + '></div>'
        + '<button id="btn-account-go"' + dis + '>'
        + (busy ? '…' : (up ? 'Create account' : 'Sign in')) + '</button>'
        + '<p class="account-status' + (st.status === 'error' ? ' err' : '') + '">'
        + (st.detail || (up
            ? 'Nothing is emailed anywhere, so there is no password reset — pick '
              + 'one you will remember.'
            : 'Your progress lives on your account, not on this machine.'))
        + '</p>';
}

function refreshAccountUI() {
    if (!accountSupported()) return;
    const el = document.getElementById('account-body');
    if (!el) return;
    el.innerHTML = accountPanelHTML();
    wireAccountPanel();
    const st = accountState();
    // The row carries the DISPLAY NAME when signed in: it is the one piece of
    // this that a player recognises at a glance from the settings list.
    setOptState('btn-account', st.signedIn ? st.displayName : 'Signed out', st.signedIn);
}

function wireAccountPanel() {
    const on = (id, fn) => {
        const b = document.getElementById(id);
        if (b) b.addEventListener('click', fn);
    };
    const val = (id) => {
        const e = document.getElementById(id);
        return e ? e.value : '';
    };
    const submit = () => {
        const u = val('input-account-user');
        const p = val('input-account-pass');
        const go = accountMode === 'up'
            ? accountSignUp(u, val('input-account-display'), p)
            : accountSignIn(u, p);
        go.then(refreshAccountUI);
    };
    const mode = (m) => () => {
        accountMode = m;
        // Clear the last error with the mode: "that username is taken" makes no
        // sense once you have switched to signing in.
        accountSetStatus('signed-out', '');
        refreshAccountUI();
    };
    on('btn-account-mode-in', mode('in'));
    on('btn-account-mode-up', mode('up'));
    on('btn-account-go', submit);
    on('btn-account-signout', () => { accountSignOut().then(refreshAccountUI); });
    // Enter submits from any field. A three-box form whose button only answers
    // the mouse is a form people fight.
    for (const id of ['input-account-user', 'input-account-display', 'input-account-pass']) {
        const e = document.getElementById(id);
        if (!e) continue;
        e.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter') return;
            ev.preventDefault();
            submit();
        });
    }
}
