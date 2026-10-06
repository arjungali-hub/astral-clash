// Accounts: a username, a display name, an email, and a password.
//
// ============================================================================
// THE SERVER IS THE TRUTH
// ============================================================================
//
// In the ONLINE build, progress belongs to an account and lives in the
// database. Nothing about it is written to this machine - no coins, no unlocks,
// no upgrades. Sign in and your progress is there; sign out and there is
// nothing on the device to find.
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
// WHY THERE IS AN EMAIL, AND WHY LOGIN IS STILL BY USERNAME
// ============================================================================
//
// An earlier version collected no address at all: each account got a synthetic
// one derived from its username, on a TLD that can never resolve. That was
// tidy, and it made password reset IMPOSSIBLE - Supabase mails the recovery
// link to the address on auth.users, and that address could never receive
// anything. A forgotten password meant a lost account.
//
// So the email is real now and it is the auth identity, which makes reset work
// with no custom machinery. Signing in is still by USERNAME, because that is
// the name a player chose; login_email_for() in the migration is what maps one
// to the other, and its header explains what that costs.
//
// Entering an email at the sign-in prompt also works, and skips the lookup.

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

// Collapses the burst of writes one match-end produces - coins, then unlocks,
// then challenges - into a single request. Not a rate limit; a tidy-up.
const ACCOUNT_PUSH_MS = 2000;

// Matches the CHECK constraints in the migration deliberately: a rule enforced
// in one place and described in another drifts, and a player should hear about
// a bad username before a round trip rather than after one.
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const DISPLAY_MAX = 14;
// Deliberately loose. The only thing a client can usefully check is that this
// could plausibly be delivered somewhere; whether it IS is settled by the
// confirmation mail, not by a regular expression. Stricter patterns reject real
// addresses and catch nothing that matters.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

let sb = null;
let accountUser = null;        // { id, username, displayName } when signed in
let accountStatus = 'off';     // off|unavailable|signed-out|busy|signed-in|error|sent
let accountDetail = '';
let accountPushTimer = null;
// Which face the panel is showing. 'recover' is not reachable by clicking: it
// is switched on when the player arrives back from a reset link.
let accountMode = 'in';        // 'in' | 'up' | 'forgot' | 'recover'
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

// ---------------------------------------------------------------------------
// The rules, checked here as well as in the database. The constraint is what
// makes them true; this is what makes them quick to hear about.
// ---------------------------------------------------------------------------

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
    // Supabase's own floor is 6. Eight, because a password people choose for a
    // game is a password they reuse.
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

function emailProblem(email) {
    const e = String(email || '').trim();
    if (!e) return 'Enter your email address';
    if (!EMAIL_RE.test(e)) return 'That does not look like an email address';
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
            // detectSessionInUrl ON, because a reset link is exactly that: the
            // player comes back with a recovery token in the URL and the client
            // has to notice it.
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
    } catch (e) {
        accountSetStatus('unavailable', 'Could not start the account service');
        return;
    }
    accountSetStatus('signed-out', '');
    sb.auth.onAuthStateChange((event, session) => {
        // ARRIVING FROM A RESET LINK. Supabase signs the player in with a
        // short-lived recovery session - which means without this branch they
        // would simply appear logged in and never be asked for a new password,
        // and the link they clicked would have done nothing they could see.
        if (event === 'PASSWORD_RECOVERY') {
            accountMode = 'recover';
            accountSetStatus('signed-out', 'Choose a new password');
            return;
        }
        if (session && session.user) accountAfterSignIn(session.user.id);
        else { accountUser = null; accountForgetProgress(); accountSetStatus('signed-out', ''); }
    });
    sb.auth.getSession().then(({ data }) => {
        if (data && data.session && data.session.user) accountAfterSignIn(data.session.user.id);
    }).catch(() => { /* no session is the normal case */ });
}

// Where a reset link should come back to. The page itself, with no query or
// hash of our own - Supabase appends its token to whatever this is, and
// anything already on the end gets in the way.
function accountRedirectTo() {
    return location.origin + location.pathname;
}

// ---------------------------------------------------------------------------
// Sign up / in / out / reset
// ---------------------------------------------------------------------------

async function accountSignUp(username, displayName, email, password) {
    // THE FIELDS FIRST. These are client-side rules and answering them needs no
    // backend - reporting "accounts are unavailable" for a username with a
    // punctuation mark in it blames the wrong thing and sends somebody to check
    // their connection over a typo.
    const u = String(username || '').trim().toLowerCase();
    const d = String(displayName || '').trim();
    const e = String(email || '').trim();
    const bad = usernameProblem(u) || displayProblem(d) || emailProblem(e)
        || passwordProblem(password);
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
            email: e,
            password: String(password),
            options: { emailRedirectTo: accountRedirectTo() },
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

        // With email confirmation ON there is no session yet: the account
        // exists but cannot be used until the link is clicked. Saying so beats
        // a sign-in that mysteriously fails a moment later.
        if (!data.session) {
            accountSetStatus('sent', 'Account created — check ' + e
                + ' to confirm it, then sign in.');
            return { ok: true, confirm: true };
        }
        await accountAfterSignIn(id);
        return { ok: true };
    } catch (ex) {
        const msg = (ex && ex.message) || 'Could not create the account';
        accountSetStatus('error', /already registered|duplicate|unique/i.test(msg)
            ? 'That username or email is already in use' : msg);
        return { ok: false, error: accountDetail };
    }
}

// Accepts a username OR an email. An address is used directly; a username is
// looked up first (see login_email_for in the migration).
async function accountSignIn(usernameOrEmail, password) {
    const raw = String(usernameOrEmail || '').trim();
    if (!raw) { accountSetStatus('error', 'Enter your username'); return { ok: false, error: accountDetail }; }
    if (!password) { accountSetStatus('error', 'Enter your password'); return { ok: false, error: accountDetail }; }
    if (!accountAvailable()) return { ok: false, error: accountDetail || 'Accounts are unavailable' };

    accountSetStatus('busy', 'Signing in…');
    try {
        let email = raw;
        if (raw.indexOf('@') === -1) {
            const { data, error } = await sb.rpc('login_email_for', { candidate: raw.toLowerCase() });
            if (error) throw error;
            // A username nobody has. Fall through to the auth call anyway with
            // an address that cannot match, so an unknown username takes the
            // same path, and the same time, as a wrong password.
            email = data || (' unknown@' + location.hostname);
        }
        const { data, error } = await sb.auth.signInWithPassword({
            email, password: String(password),
        });
        if (error) throw error;
        await accountAfterSignIn(data.user.id);
        return { ok: true };
    } catch (ex) {
        const msg = (ex && ex.message) || '';
        // ONE MESSAGE for a wrong username and a wrong password. Telling them
        // apart hands out which usernames exist and tells an honest player
        // nothing they could act on differently. The unconfirmed-email case IS
        // worth separating, because the fix is in their inbox.
        accountSetStatus('error', /not confirmed|confirm/i.test(msg)
            ? 'Confirm your email address first — check your inbox'
            : 'That username and password do not match');
        return { ok: false, error: accountDetail };
    }
}

// SENDS THE LINK. Takes an email, not a username: asking for the address means
// somebody who has forgotten their username can still get in, and it keeps this
// path from depending on the username lookup at all.
async function accountRequestReset(email) {
    const e = String(email || '').trim();
    const bad = emailProblem(e);
    if (bad) { accountSetStatus('error', bad); return { ok: false, error: bad }; }
    if (!accountAvailable()) return { ok: false, error: accountDetail || 'Accounts are unavailable' };

    accountSetStatus('busy', 'Sending…');
    try {
        const { error } = await sb.auth.resetPasswordForEmail(e, {
            redirectTo: accountRedirectTo(),
        });
        if (error) throw error;
    } catch (ex) {
        // Deliberately NOT reported as a failure. Supabase answers the same way
        // whether or not the address has an account, and so does this: saying
        // "no account with that email" would turn the reset form into a way of
        // testing which addresses are registered.
    }
    accountSetStatus('sent', 'If there is an account for ' + e
        + ', a reset link is on its way.');
    return { ok: true };
}

// The other half: the player is back from the link with a recovery session and
// is choosing a new password.
async function accountSetNewPassword(password) {
    const bad = passwordProblem(password);
    if (bad) { accountSetStatus('error', bad); return { ok: false, error: bad }; }
    if (!accountAvailable()) return { ok: false, error: accountDetail || 'Accounts are unavailable' };

    accountSetStatus('busy', 'Saving…');
    try {
        const { error } = await sb.auth.updateUser({ password: String(password) });
        if (error) throw error;
        accountMode = 'in';
        // The recovery session is a real session, so this lands signed in.
        const { data } = await sb.auth.getSession();
        if (data && data.session && data.session.user) {
            await accountAfterSignIn(data.session.user.id);
        } else {
            accountSetStatus('signed-out', 'Password changed — sign in with it.');
        }
        return { ok: true };
    } catch (ex) {
        accountSetStatus('error', (ex && ex.message) || 'Could not change the password');
        return { ok: false, error: accountDetail };
    }
}

async function accountSignOut() {
    if (!accountAvailable()) return;
    try { await sb.auth.signOut(); } catch (e) { /* signing out always works locally */ }
    accountUser = null;
    accountForgetProgress();
    accountMode = 'in';
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

function accountField(id, label, type, placeholder, auto, max, dis) {
    return '<div class="account-row"><label for="' + id + '">' + label + '</label>'
        + '<input id="' + id + '" type="' + type + '" autocomplete="' + auto + '"'
        + (type === 'password' ? '' : ' spellcheck="false"')
        + ' maxlength="' + max + '" placeholder="' + placeholder + '"' + dis + '></div>';
}

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
    const note = (text) => '<p class="account-status' + (st.status === 'error' ? ' err' : '')
        + (st.status === 'sent' ? ' ok' : '') + '">' + (st.detail || text) + '</p>';

    // BACK FROM A RESET LINK. No tabs here: the player is mid-task and every
    // other control on this panel is a way to lose their place.
    if (st.mode === 'recover') {
        return '<p class="account-status">Choose a new password for your account.</p>'
            + accountField('input-account-pass', 'New password', 'password',
                'at least 8 characters', 'new-password', 72, dis)
            + '<button id="btn-account-go"' + dis + '>'
            + (busy ? '…' : 'Save new password') + '</button>'
            + note('');
    }

    if (st.mode === 'forgot') {
        return '<p class="account-status">We will email you a link to set a new one.</p>'
            + accountField('input-account-email', 'Email', 'email',
                'the address on your account', 'email', 120, dis)
            + '<button id="btn-account-go"' + dis + '>'
            + (busy ? '…' : 'Send reset link') + '</button>'
            + note('')
            + '<button id="btn-account-mode-in" class="account-link">'
            + '← Back to signing in</button>';
    }

    const up = st.mode === 'up';
    // ONE PANEL, TWO MODES. A separate sign-up screen means somebody who
    // already has an account meets a form asking them to invent one; this way
    // the thing you came to do is on screen and the other is one click away.
    return ''
        + '<div class="account-tabs">'
        + '<button id="btn-account-mode-in" class="account-tab' + (up ? '' : ' on') + '">Sign in</button>'
        + '<button id="btn-account-mode-up" class="account-tab' + (up ? ' on' : '') + '">Create account</button>'
        + '</div>'
        + accountField('input-account-user', up ? 'Username' : 'Username or email', 'text',
            up ? '3-20 characters' : '', 'username', 120, dis)
        + (up ? accountField('input-account-display', 'Display name', 'text',
            'what other players see', 'nickname', DISPLAY_MAX, dis) : '')
        + (up ? accountField('input-account-email', 'Email', 'email',
            'for password resets only', 'email', 120, dis) : '')
        + accountField('input-account-pass', 'Password', 'password',
            up ? 'at least 8 characters' : '', up ? 'new-password' : 'current-password', 72, dis)
        + '<button id="btn-account-go"' + dis + '>'
        + (busy ? '…' : (up ? 'Create account' : 'Sign in')) + '</button>'
        + note(up
            ? 'Your email is used for password resets and nothing else.'
            : 'Your progress lives on your account, not on this machine.')
        + (up ? '' : '<button id="btn-account-mode-forgot" class="account-link">'
            + 'Forgotten your password?</button>');
}

function refreshAccountUI() {
    if (!accountSupported()) return;
    const el = document.getElementById('account-body');
    if (!el) return;
    el.innerHTML = accountPanelHTML();
    wireAccountPanel();
    const st = accountState();
    // The row carries the DISPLAY NAME when signed in: it is the one piece of
    // this a player recognises at a glance from the settings list.
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
        let go;
        if (accountMode === 'recover') go = accountSetNewPassword(val('input-account-pass'));
        else if (accountMode === 'forgot') go = accountRequestReset(val('input-account-email'));
        else if (accountMode === 'up') {
            go = accountSignUp(val('input-account-user'), val('input-account-display'),
                val('input-account-email'), val('input-account-pass'));
        } else go = accountSignIn(val('input-account-user'), val('input-account-pass'));
        go.then(refreshAccountUI);
    };
    const mode = (m) => () => {
        accountMode = m;
        // Clear the last message with the mode: "that username is taken" makes
        // no sense once you have switched to signing in.
        accountSetStatus('signed-out', '');
        refreshAccountUI();
    };
    on('btn-account-mode-in', mode('in'));
    on('btn-account-mode-up', mode('up'));
    on('btn-account-mode-forgot', mode('forgot'));
    on('btn-account-go', submit);
    on('btn-account-signout', () => { accountSignOut().then(refreshAccountUI); });
    // Enter submits from any field. A form whose button only answers the mouse
    // is a form people fight.
    for (const id of ['input-account-user', 'input-account-display',
                      'input-account-email', 'input-account-pass']) {
        const e = document.getElementById(id);
        if (!e) continue;
        e.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter') return;
            ev.preventDefault();
            submit();
        });
    }
}
