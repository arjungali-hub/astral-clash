// Accounts: username, display name, password - and progress that lives on the
// server rather than on the machine.
//
// WHAT IS NOT TESTED HERE, and why that is the right line: actually creating an
// account needs a live Supabase project, and a checker that depends on one
// fails for reasons that have nothing to do with this code. What DOES belong
// here is everything that decides what happens to somebody's progress, because
// the failure mode of this feature is not "sign-in is broken" - it is "sign-in
// worked and I lost everything".
//
// So the assertions are:
//
//   * THE ONLINE BUILD WRITES NOTHING TO THIS MACHINE. That is the request, and
//     it is the one thing a checker can prove outright: play, earn, and then
//     show localStorage is still empty.
//   * THE SPLIT-SCREEN BUILD IS UNTOUCHED. Two people at one keyboard still
//     keep their progress locally, with no account anywhere near it.
//   * signing out LEAVES NOTHING BEHIND. The previous account's coins must not
//     sit on screen, and must never be pushed into the next account.
//   * the rules a player meets before any request is made - username shape,
//     password length - are enforced, and say which rule was broken.
const H = require('./harness');

const CFG = ['https://example.supabase.co', 'not-a-real-key'];

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));

    await H.boot(page, { clearStorage: true });

    section('The online build supports accounts and is pointed at a project:');
    const shipped = await page.evaluate(() => {
        const D = window.ACDebug;
        const st = D.accountState();
        return { supported: st.supported, configured: st.configured, status: st.status };
    });
    check('this build has accounts', shipped.supported === true, JSON.stringify(shipped));
    check('and a project is configured', shipped.configured === true, JSON.stringify(shipped));

    section('NOTHING about progress is written to this machine:');
    // The whole point of the change. Earn coins, buy something, and then look
    // at the disk: it has to be empty.
    const disk = await page.evaluate(() => {
        const D = window.ACDebug;
        D.setDebugUnlockAll(false);
        D.addCoins('p1', 500);
        D.prog('p1').unlockedChars.push('Nyx');
        D.saveProgression();
        const keys = Object.keys(localStorage);
        return {
            coins: D.prog('p1').coins,
            progression: localStorage.getItem('astralClashProgression'),
            // THE CLAIM IS ABOUT PROGRESS, not about key names. Matching on
            // names caught astralClashDebugUnlockAll, which is a SETTING and
            // belongs on the machine. So this looks at the VALUES: nothing
            // stored here may contain a progression blob.
            progressish: keys.filter(k => {
                const v = localStorage.getItem(k) || '';
                return /unlockedChars|doubleJumpUnlocked/.test(v);
            }),
        };
    });
    check('coins still move in memory, so the game works',
        disk.coins >= 500, String(disk.coins));
    check('but the progression key is NOT written',
        disk.progression === null, String(disk.progression));
    check('and nothing else on disk holds a progression blob either',
        disk.progressish.length === 0, JSON.stringify(disk.progressish));

    section('...and it survives a reload as nothing, because that is the deal:');
    // Signed out, a reload is a fresh start. This is the consequence of the
    // request and it should be asserted, not discovered.
    await page.reload({ waitUntil: 'load' });
    await H.sleep(900);
    const after = await page.evaluate(() => ({
        coins: window.ACDebug.prog('p1').coins,
        chars: window.ACDebug.prog('p1').unlockedChars.length,
    }));
    check('a signed-out reload starts from zero coins',
        after.coins === 0, String(after.coins));
    check('and from the starter roster', after.chars === 3, String(after.chars));

    section('The rules a player meets before any request is made:');
    const rules = await page.evaluate(() => {
        const D = window.ACDebug;
        return {
            short: D.usernameProblem('ab'),
            long: D.usernameProblem('a'.repeat(21)),
            punct: D.usernameProblem('arjun!'),
            spaces: D.usernameProblem('ar jun'),
            upper: D.usernameProblem('Arjun'),      // lowercased before checking
            good: D.usernameProblem('arjun_g'),
            pwShort: D.passwordProblem('short12'),
            pwGood: D.passwordProblem('longenough1'),
            dispEmpty: D.displayProblem('   '),
            dispLong: D.displayProblem('x'.repeat(15)),
            dispGood: D.displayProblem('Arjun'),
        };
    });
    check('a 2-character username is refused, and says so',
        /3 characters/.test(rules.short || ''), String(rules.short));
    check('a 21-character one is refused', !!rules.long, String(rules.long));
    check('punctuation is refused', /underscores/.test(rules.punct || ''), String(rules.punct));
    check('so are spaces', !!rules.spaces, String(rules.spaces));
    check('MIXED CASE is accepted and folded, not rejected',
        rules.upper === null, String(rules.upper));
    check('a sensible username passes', rules.good === null, String(rules.good));
    check('a 7-character password is refused',
        /8 characters/.test(rules.pwShort || ''), String(rules.pwShort));
    check('an 11-character one passes', rules.pwGood === null, String(rules.pwGood));
    check('an empty display name is refused', !!rules.dispEmpty, String(rules.dispEmpty));
    check('and an over-long one', !!rules.dispLong, String(rules.dispLong));
    check('a sensible display name passes', rules.dispGood === null, String(rules.dispGood));

    section('Email is validated before anything is sent:');
    const mail = await page.evaluate(() => {
        const D = window.ACDebug;
        return {
            empty: D.emailProblem('   '),
            noAt: D.emailProblem('arjun'),
            noDot: D.emailProblem('arjun@localhost'),
            good: D.emailProblem('arjun@example.com'),
            plus: D.emailProblem('arjun+clash@example.co.uk'),
        };
    });
    check('an empty address is refused', !!mail.empty, String(mail.empty));
    check('one with no @ is refused', !!mail.noAt, String(mail.noAt));
    check('one with no dot in the domain is refused', !!mail.noDot, String(mail.noDot));
    check('an ordinary address passes', mail.good === null, String(mail.good));
    // Plus-addressing and multi-part TLDs are real and get rejected by every
    // regex somebody tightens "just a bit" - so that is asserted, not assumed.
    check('and so does a +tagged one on a two-part TLD',
        mail.plus === null, String(mail.plus));

    section('Signing in is refused politely when there is no backend:');
    const refused = await page.evaluate(async () => {
        const D = window.ACDebug;
        return {
            noUser: await D.accountSignIn('', 'whatever12'),
            noPass: await D.accountSignIn('arjun', ''),
            badName: await D.accountSignUp('arj!n', 'Arjun', 'a@b.co', 'longenough1'),
            badPass: await D.accountSignUp('arjun', 'Arjun', 'a@b.co', 'short'),
            badMail: await D.accountSignUp('arjun', 'Arjun', 'nope', 'longenough1'),
        };
    });
    check('a missing username is named', refused.noUser.ok === false,
        JSON.stringify(refused.noUser));
    check('a missing password is named', refused.noPass.ok === false,
        JSON.stringify(refused.noPass));
    check('sign-up rejects a bad username before any request',
        refused.badName.ok === false && /underscores/.test(refused.badName.error),
        JSON.stringify(refused.badName));
    check('and a short password', refused.badPass.ok === false
        && /8 characters/.test(refused.badPass.error), JSON.stringify(refused.badPass));
    check('and a malformed email', refused.badMail.ok === false
        && /email address/.test(refused.badMail.error), JSON.stringify(refused.badMail));

    section('Signing out leaves NOTHING behind:');
    // The hazard: one account's coins staying in memory and being pushed into
    // whichever account signs in next.
    const cleared = await page.evaluate(() => {
        const D = window.ACDebug;
        D.addCoins('p1', 900);
        D.prog('p1').unlockedChars.push('Voss');
        D.prog('p2').coins = 400;
        const before = { p1: D.prog('p1').coins, p2: D.prog('p2').coins };
        D.accountForgetProgress();
        return {
            before,
            p1: D.prog('p1').coins, p2: D.prog('p2').coins,
            chars: D.prog('p1').unlockedChars.length,
        };
    });
    check('there was something to clear', cleared.before.p1 >= 900, JSON.stringify(cleared));
    check('both purses are emptied',
        cleared.p1 === 0 && cleared.p2 === 0, JSON.stringify(cleared));
    check('and the roster goes back to the starters',
        cleared.chars === 3, String(cleared.chars));

    section('The panel shows each state, and asks for the right things:');
    const panels = await page.evaluate((cfg) => {
        const D = window.ACDebug;
        const out = {};
        D.accountConfigure('', '');
        out.unconfigured = D.accountPanelHTML();
        D.accountConfigure(cfg[0], cfg[1]);
        D.__accountSetState('unavailable', 'Could not load the account service');
        out.unavailable = D.accountPanelHTML();
        D.__accountSetState('signed-out', '');
        D.__accountSetMode('in');
        out.signIn = D.accountPanelHTML();
        D.__accountSetMode('up');
        out.signUp = D.accountPanelHTML();
        D.__accountSetState('busy', 'Signing in…');
        out.busy = D.accountPanelHTML();
        D.__accountSetState('error', 'That username and password do not match');
        out.error = D.accountPanelHTML();
        D.__accountSetMode('in');
        D.__accountSetState('signed-out', '');
        return out;
    }, CFG);
    check('unconfigured says nothing can be saved',
        /nothing can be saved/i.test(panels.unconfigured), panels.unconfigured.slice(0, 90));
    check('a blocked CDN says the same',
        /nothing can be saved/i.test(panels.unavailable), panels.unavailable.slice(0, 90));
    check('SIGN IN asks for a username and a password, and nothing else',
        /input-account-user/.test(panels.signIn)
        && /input-account-pass/.test(panels.signIn)
        && !/input-account-display/.test(panels.signIn), panels.signIn.slice(0, 140));
    check('SIGN UP also asks for a display name and an email',
        /input-account-display/.test(panels.signUp)
        && /input-account-email/.test(panels.signUp), panels.signUp.slice(0, 220));
    check('and says the email is only for resets',
        /password resets/i.test(panels.signUp), panels.signUp.slice(-200));
    check('SIGN IN offers a way out of a forgotten password',
        /btn-account-mode-forgot/.test(panels.signIn), panels.signIn.slice(-200));
    check('the password field is a password field',
        /type="password"/.test(panels.signIn), panels.signIn.slice(0, 140));

    check('a request in flight disables the button, so it is not sent twice',
        /disabled/.test(panels.busy), panels.busy.slice(0, 140));
    check('an error is marked as one', /account-status err/.test(panels.error),
        panels.error.slice(-160));
    // One message for both, deliberately: telling them apart hands out which
    // usernames exist.
    check('and a failed sign-in does not say WHICH half was wrong',
        /do not match/.test(panels.error)
        && !/no such user|unknown username|wrong password/i.test(panels.error),
        panels.error.slice(-160));

    section('The reset path, both halves of it:');
    const reset = await page.evaluate(async (cfg) => {
        const D = window.ACDebug;
        D.accountConfigure(cfg[0], cfg[1]);
        D.__accountSetMode('forgot');
        D.__accountSetState('signed-out', '');
        const forgot = D.accountPanelHTML();
        // The reply must be the same whether or not the address has an account:
        // anything else turns this form into a way of testing which addresses
        // are registered.
        const sent = await D.accountRequestReset('nobody_at_all');
        const sentPanel = D.accountPanelHTML();
        D.__accountSetMode('recover');
        D.__accountSetState('signed-out', 'Choose a new password');
        const recover = D.accountPanelHTML();
        D.__accountSetMode('in');
        D.__accountSetState('signed-out', '');
        return { forgot, sent, sentPanel, recover, redirect: D.accountRedirectTo() };
    }, CFG);
    // BY USERNAME, which is the point of putting the lookup server-side: the
    // player types the name they remember and the function mails whatever
    // address is on the account. This side never sees it.
    check('the forgot form asks for a username, not an email',
        /input-account-user/.test(reset.forgot) && !/input-account-email/.test(reset.forgot),
        reset.forgot.slice(0, 180));
    check('and offers a way back', /btn-account-mode-in/.test(reset.forgot),
        reset.forgot.slice(-160));
    check('an unknown username is NOT reported as unknown',
        reset.sent.ok === true && /if there is an account/i.test(reset.sentPanel),
        JSON.stringify(reset.sent) + ' | ' + reset.sentPanel.slice(0, 120));
    check('the recover form asks for a new password and nothing else',
        /input-account-pass/.test(reset.recover)
        && !/input-account-user/.test(reset.recover)
        && !/btn-account-mode-up/.test(reset.recover), reset.recover.slice(0, 200));
    // Supabase appends its token to this, so anything already on the end of it
    // gets in the way.
    check('the link comes back to a bare page URL',
        !/[?#]/.test(reset.redirect), reset.redirect);

    section('THE ADDRESS NEVER REACHES THIS SIDE:');
    // The reason the Edge Function exists. Asserted structurally rather than by
    // reading the panel, because the claim is about what the client is CAPABLE
    // of, not about what it happens to display.
    const noLeak = await page.evaluate(() => {
        const D = window.ACDebug;
        return {
            // The function the browser used to call to resolve a username.
            hasLookup: typeof D.accountEmailFor === 'function',
            // Sign-in and reset both go through one place now.
            url: D.accountFunctionURL(),
            state: Object.keys(D.accountState()),
        };
    });
    check('there is no username-to-email resolver left on the client',
        noLeak.hasLookup === false, String(noLeak.hasLookup));
    check('sign-in and reset go to the account function',
        /\/functions\/v1\/account$/.test(noLeak.url), noLeak.url);
    check('and nothing about an email is exposed in the account state',
        !noLeak.state.some(k => /email/i.test(k)), JSON.stringify(noLeak.state));

    section('Signed in, it shows who you are:');
    const inPanel = await page.evaluate(() => {
        const D = window.ACDebug;
        D.__accountSetUser({ id: 'u1', username: 'arjun_g', displayName: 'Arjun' });
        D.__accountSetState('signed-in', 'Arjun');
        const html = D.accountPanelHTML();
        D.refreshAccountUI();
        const row = document.getElementById('btn-account').textContent
            .replace(/\s+/g, ' ').trim();
        D.__accountSetUser(null);
        D.__accountSetState('signed-out', '');
        return { html, row };
    });
    check('the display name is what is shown',
        /<b>Arjun<\/b>/.test(inPanel.html), inPanel.html.slice(0, 120));
    check('with the login name beside it, so you know which account',
        /account-username">arjun_g/.test(inPanel.html), inPanel.html.slice(0, 160));
    check('and there is a way out', /btn-account-signout/.test(inPanel.html),
        inPanel.html.slice(0, 200));
    check('the settings row carries the display name',
        /Arjun/.test(inPanel.row), inPanel.row);

    // ============================================== THE SPLIT-SCREEN BUILD
    section('The split-screen build is UNTOUCHED - local save, no account:');
    const local = await H.newPage(browser);
    local.on('pageerror', e => errors.push('local: ' + String(e.message || e)));
    await H.boot(local, { clearStorage: true, path: '/local/index.html' });
    const lp = await local.evaluate(() => {
        const D = window.ACDebug;
        D.setDebugUnlockAll(false);
        D.addCoins('p1', 250);
        D.saveProgression();
        const raw = localStorage.getItem('astralClashProgression');
        return {
            row: !!document.getElementById('btn-account'),
            panel: !!document.getElementById('account-screen'),
            supported: window.accountSupported(),
            coins: D.prog('p1').coins,
            stored: raw ? (JSON.parse(raw).p1 || {}).coins : null,
        };
    });
    check('it has no account row or panel',
        !lp.row && !lp.panel, JSON.stringify(lp));
    check('the module reports the build as unsupported',
        lp.supported === false, String(lp.supported));
    check('and progress IS written to this machine there',
        lp.stored === lp.coins && lp.coins >= 250, JSON.stringify(lp));

    // THE ONE EXPECTED NOISE. This file configures a project that does not
    // exist, so the reset call genuinely tries to reach example.supabase.co and
    // genuinely fails to resolve it - the correct outcome of the test's own
    // setup. Dropped from what finish() grades on, by exact shape, so every
    // other console error stays fatal.
    page.errors = (page.errors || []).filter(
        e => !/ERR_NAME_NOT_RESOLVED|example\.supabase\.co/.test(String(e)));
    check('no errors thrown', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
    await finish(browser, page);
})();
