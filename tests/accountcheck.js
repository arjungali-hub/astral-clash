// Accounts: the parts that do not need a backend, which is most of what can go
// wrong.
//
// WHAT IS NOT TESTED HERE, and why that is the right line: signing in needs a
// Supabase project, an email, and a link clicked in it. None of that belongs in
// a checker. What DOES belong is everything that decides what happens to
// somebody's progress - because the failure mode of this feature is not "sign
// in is broken", it is "sign in worked and ate my save".
//
// So the assertions are:
//
//   * the game is completely unaffected when there is no account service. This
//     is the promise the whole design rests on - localStorage is still the
//     truth, so an unconfigured build, a blocked CDN and an offline player all
//     have to be ordinary.
//   * a conflict is NEVER resolved quietly. Two real saves that disagree is the
//     normal case for two devices, and both of the obvious answers lose data:
//     last-write-wins silently discards the newer save when the older device is
//     opened second, and merge-by-maximum refunds coins that were spent.
//   * a save that comes back from the network goes through the same repair as
//     one from localStorage. It arrived from a row a client wrote; it is no
//     more trustworthy.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));

    await H.boot(page, { clearStorage: true });

    section('The shipped build is pointed at a project:');
    // Asserted as a FACT about the deployment, not assumed. This file used to
    // open by checking the build was UNconfigured, which was true when it was
    // written and silently became a test of the deployment rather than of the
    // code the moment a project was wired in.
    const shipped = await page.evaluate(() => {
        const D = window.ACDebug;
        const st = D.accountState();
        return { configured: st.configured, status: st.status, supported: st.supported };
    });
    check('a project is configured in this build',
        shipped.configured === true, JSON.stringify(shipped));
    check('and the online build supports accounts at all',
        shipped.supported === true, JSON.stringify(shipped));

    section('With NO account service, nothing about the game changes:');
    // Driven, not assumed - this is the promise the whole design rests on and
    // it has to hold whether or not this particular build has a project.
    const off = await page.evaluate(() => {
        const D = window.ACDebug;
        D.accountConfigure('', '');
        D.__accountSetState('off', '');
        const st = D.accountState();
        return {
            configured: st.configured,
            status: st.status,
            available: D.accountAvailable(),
            // The game's own save must still work, untouched.
            coinsBefore: D.prog('p1').coins,
        };
    });
    check('it reports itself as unconfigured rather than broken',
        off.configured === false && off.status === 'off', JSON.stringify(off));
    check('and nothing is "available" to talk to', off.available === false,
        String(off.available));

    const stillWorks = await page.evaluate(() => {
        const D = window.ACDebug;
        D.setDebugUnlockAll(false);
        const before = D.prog('p1').coins;
        D.addCoins('p1', 123);
        const after = D.prog('p1').coins;
        // ...and it is really on disk, not just in memory.
        const raw = JSON.parse(localStorage.getItem('astralClashProgression') || '{}');
        return { before, after, stored: raw.p1 ? raw.p1.coins : null };
    });
    check('coins are still earned with no account',
        stillWorks.after === stillWorks.before + 123, JSON.stringify(stillWorks));
    check('and still written to localStorage, which remains the truth',
        stillWorks.stored === stillWorks.after, JSON.stringify(stillWorks));

    section('Signing in is refused politely rather than throwing:');
    const refused = await page.evaluate(async () => {
        const D = window.ACDebug;
        const bad = await D.accountSignIn('not-an-email');
        const unconfigured = await D.accountSignIn('someone@example.com');
        return { bad, unconfigured };
    });
    check('a malformed address is rejected with a sentence',
        refused.bad.ok === false && /email address/i.test(refused.bad.error),
        JSON.stringify(refused.bad));
    check('and an unconfigured build says so instead of hanging',
        refused.unconfigured.ok === false, JSON.stringify(refused.unconfigured));

    section('The panel renders every state it has:');
    const panels = await page.evaluate(() => {
        const D = window.ACDebug;
        const out = {};
        D.accountConfigure('', '');
        D.__accountSetState('off', '');
        out.unconfigured = D.accountPanelHTML();
        // CONFIGURE IT, with a project that does not exist. Every state below
        // sits behind the "is this configured" check, so without this they are
        // unreachable - which is the reason the URL and key are settable rather
        // than baked into the source. Nothing is contacted: these assertions are
        // all about what the panel SAYS.
        D.accountConfigure('https://example.supabase.co', 'not-a-real-key');
        // Drive each state directly; there is no backend to produce them.
        D.__accountSetState('unavailable', 'Could not load the account service');
        out.unavailable = D.accountPanelHTML();
        D.__accountSetState('signed-out', '');
        out.signedOut = D.accountPanelHTML();
        D.__accountSetState('sending', 'Check you@example.com for a sign-in link');
        out.sending = D.accountPanelHTML();
        D.__accountSetState('error', 'Could not send the link');
        out.error = D.accountPanelHTML();
        D.__accountSetState('off', '');
        D.accountConfigure('', '');          // back to how the build ships
        return out;
    });
    check('unconfigured says progress is still saved locally',
        /still saved on this device/i.test(panels.unconfigured), panels.unconfigured.slice(0, 80));
    check('a blocked CDN says the same reassuring thing',
        /still saved on this device/i.test(panels.unavailable), panels.unavailable.slice(0, 80));
    // No password FIELD. The first version of this looked for the word and
    // failed on the copy that explains there is no password - which is the
    // sentence most worth keeping on the screen.
    check('signed-out offers an email field and no password field',
        /input-account-email/.test(panels.signedOut)
        && !/type="password"/i.test(panels.signedOut), panels.signedOut.slice(0, 110));
    check('"sent" disables the button so it is not pressed twice',
        /disabled/.test(panels.sending), panels.sending.slice(0, 110));
    check('an error is marked as one', /account-status err/.test(panels.error),
        panels.error.slice(0, 110));

    section('A CONFLICT is shown, with numbers, and never decided quietly:');
    const conflict = await page.evaluate(() => {
        const D = window.ACDebug;
        const cloud = {
            p1: { coins: 900, unlockedChars: ['Kaelen', 'Lyra', 'Nyx', 'Voss'],
                  upgrades: {}, doubleJumpUnlocked: true },
            p2: { coins: 10, unlockedChars: ['Kaelen'], upgrades: {}, doubleJumpUnlocked: false },
        };
        D.__accountSetConflict({
            local: D.accountSummary({ p1: { coins: 40, unlockedChars: ['Kaelen', 'Lyra'] },
                                      p2: { coins: 0, unlockedChars: ['Kaelen'] } },
                                    Date.now() - 3600000, 'device-abc12'),
            cloud: D.accountSummary(cloud, Date.now() - 86400000 * 2, 'device-zz999'),
            cloudData: cloud,
        });
        return { html: D.accountPanelHTML(), state: D.accountState() };
    });
    check('both saves are offered, neither applied',
        /btn-account-use-cloud/.test(conflict.html)
        && /btn-account-use-local/.test(conflict.html), conflict.html.slice(0, 120));
    check('the CLOUD save shows its real coin total',
        /910 coins/.test(conflict.html), (conflict.html.match(/\d+ coins/g) || []).join(', '));
    check('the LOCAL save shows its own, so they can be told apart',
        /40 coins/.test(conflict.html), (conflict.html.match(/\d+ coins/g) || []).join(', '));
    check('each says when and where it was saved',
        /day[s]? ago/.test(conflict.html) && /device-zz999/.test(conflict.html),
        conflict.html.slice(0, 200));
    check('and it says plainly that the other one is replaced',
        /replaced/i.test(conflict.html), conflict.html.slice(0, 200));

    section('Choosing the cloud save applies it; choosing local does not:');
    const chose = await page.evaluate(async () => {
        const D = window.ACDebug;
        const before = D.prog('p1').coins;
        await D.accountResolveConflict('cloud');
        return { before, after: D.prog('p1').coins,
                 chars: D.prog('p1').unlockedChars.length,
                 conflict: D.accountState().conflict };
    });
    check('the cloud save really replaced the local one',
        chose.after === 900 && chose.chars === 4, JSON.stringify(chose));
    check('and the prompt is cleared once answered',
        chose.conflict === null, JSON.stringify(chose.conflict));

    section('A save from the network is repaired like any other:');
    // It came from a row a client wrote. A `coins` of "lots" or an unlockedChars
    // of null must not reach the code that indexes into them.
    const repaired = await page.evaluate(() => {
        const D = window.ACDebug;
        let threw = null;
        try {
            D.__accountApplyCloud({
                p1: { coins: 'lots', unlockedChars: null, upgrades: 'nope' },
                p2: null,
            });
        } catch (e) { threw = e.message; }
        return {
            threw,
            coins: D.prog('p1').coins,
            chars: Array.isArray(D.prog('p1').unlockedChars),
            upgrades: typeof D.prog('p1').upgrades,
            p2chars: Array.isArray(D.prog('p2').unlockedChars),
        };
    });
    check('a mangled cloud save does not throw', repaired.threw === null,
        String(repaired.threw));
    check('a non-numeric coin total becomes a number',
        repaired.coins === 0, String(repaired.coins));
    check('a null roster becomes the starter roster',
        repaired.chars === true && repaired.p2chars === true, JSON.stringify(repaired));
    check('and upgrades is an object whatever arrived',
        repaired.upgrades === 'object', repaired.upgrades);

    section('The settings row says enough to be worth reading:');
    const row = await page.evaluate(() => {
        const D = window.ACDebug;
        const read = () => document.getElementById('btn-account').textContent
            .replace(/\s+/g, ' ').trim();
        D.__accountSetState('off', ''); D.refreshAccountUI();
        const off = read();
        D.__accountSetState('signed-in', 'you@example.com'); D.refreshAccountUI();
        const on = read();
        D.__accountSetConflict({ local: { coins: 1, chars: 1, when: 1, device: 'a' },
                                 cloud: { coins: 2, chars: 1, when: 1, device: 'b' },
                                 cloudData: { p1: {}, p2: {} } });
        D.refreshAccountUI();
        const needs = read();
        return { off, on, needs };
    });
    check('it reads Off when signed out', /Off/.test(row.off), row.off);
    check('On when signed in', /On/.test(row.on), row.on);
    check('and ASKS when a choice is pending, rather than sitting quiet',
        /Action needed/i.test(row.needs), row.needs);

    section('The LOCAL build has no account, and says nothing about one:');
    // Two people at one keyboard share a single progression object with a p1
    // and a p2 side, so "whose account is this" has no good answer there. The
    // row is REMOVED rather than hidden: a settings row that opens a panel
    // explaining why the feature is not for you advertises something and then
    // withdraws it. Nothing is lost - the builds share one progression store,
    // so a split-screen player signs in once on the online build.
    const local = await H.newPage(browser);
    local.on('pageerror', e => errors.push('local: ' + String(e.message || e)));
    await H.boot(local, { clearStorage: true, path: '/local/index.html' });
    const lp = await local.evaluate(() => {
        const D = window.ACDebug || {};
        return {
            row: !!document.getElementById('btn-account'),
            panel: !!document.getElementById('account-screen'),
            body: !!document.getElementById('account-body'),
            // Asked of WINDOW, not of ACDebug: a top-level `function` in a
            // classic script is a global, and each build's ACDebug lists only
            // what that build chose to export. The question here is about the
            // module, which both builds load.
            supported: window.accountSupported(),
            available: window.accountAvailable(),
            // ...and the progression it does have still works.
            coins: D.prog ? typeof D.prog('p1').coins : 'no prog',
        };
    });
    check('no account row, panel or body exists there',
        !lp.row && !lp.panel && !lp.body, JSON.stringify(lp));
    check('the module itself reports the build as unsupported',
        lp.supported === false && lp.available === false, JSON.stringify(lp));
    check('and local progression is untouched by any of it',
        lp.coins === 'number', JSON.stringify(lp));

    section('The ONLINE build has all of it:');
    const op = await page.evaluate(() => ({
        row: !!document.getElementById('btn-account'),
        panel: !!document.getElementById('account-screen'),
        body: !!document.getElementById('account-body'),
        back: !!document.getElementById('btn-account-back'),
        supported: window.ACDebug.accountSupported(),
    }));
    check('the row, the panel and a way back all exist',
        op.row && op.panel && op.body && op.back && op.supported === true,
        JSON.stringify(op));

    check('no errors thrown', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
    await finish(browser, page);
})();
