// A sandbox MATCH: the host declares it, both players see it, nobody banks
// coins - and both fighters are still exactly what their own save says.
//
// Requested as "there should be a sandbox option in online that doesn't earn
// you coins (host can toggle it, it is in a visible place so that both people
// know it is sandbox)".
//
// The distinction these assertions protect is the one that matters. The
// unlock-everything OVERRIDE is per-machine and private and grants
// MAX_UPGRADE_LEVEL on every stat, which is why Batch 44 made online ignore it
// - one player could bring a stronger fighter into a real match and nothing on
// the wire would show it. A sandbox MATCH is a property of the match: it
// changes the payout, not the fighters.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true });
    const D = (fn, args) => (args === undefined ? page.evaluate(fn) : page.evaluate(fn, args));

    section('The host can turn it on, and it goes on the wire:');
    let st = await D(() => {
        const A = window.ACDebug;
        A.netSetTimeout(900000);
        A.goHome();
        A.netFakeConnect('host');
        A.enterRoom();
        A.netDrainOutbox();
        const before = A.sandboxMatch;
        A.setSandboxMatch(true);
        const out = A.netDrainOutbox();
        const vis = id => {
            const el = document.getElementById(id);
            return !!el && el.getClientRects().length > 0;
        };
        return {
            before, after: A.sandboxMatch,
            sent: out.filter(m => m.t === 'SETUP').map(m => m.sandbox),
            button: (document.getElementById('btn-sandbox') || {}).textContent,
            banner: vis('sandbox-banner'),
        };
    });
    check('it starts off', st.before === false, JSON.stringify(st));
    check('the host can turn it on', st.after === true, JSON.stringify(st));
    check('and it is broadcast in SETUP',
        st.sent.includes(true), JSON.stringify(st.sent));
    check('the button states what it is', /Sandbox: On/.test(st.button || ''), JSON.stringify(st));
    check('and a banner says so where both players will see it',
        st.banner === true, JSON.stringify(st));

    section('Nobody banks coins in it:');
    st = await D(() => {
        const A = window.ACDebug;
        const side = A.LOCAL_SIDE;
        const start = A.prog(side).coins;
        A.addCoins(side, 250);
        const during = A.prog(side).coins;
        A.setSandboxMatch(false);
        A.addCoins(side, 250);
        return { start, during, after: A.prog(side).coins, isSandbox: A.matchIsSandbox() };
    });
    check('coins do not move while it is on', st.during === st.start, JSON.stringify(st));
    check('and they do once it is off', st.after === st.start + 250, JSON.stringify(st));

    section('It rides START too, so a late guest cannot miss it:');
    st = await D(() => {
        const A = window.ACDebug;
        A.setSandboxMatch(true);
        A.previewPick(A.LOCAL_SIDE, 'Kaelen'); A.confirmPick(A.LOCAL_SIDE);
        A.netFeed({ t: 'PICK', side: A.LOCAL_SIDE === 'p1' ? 'p2' : 'p1',
                    name: 'Lyra', stage: 'confirmed' });
        A.selectedMap = A.MAPS[0].name;
        A.netDrainOutbox();
        A.startOnline();
        const out = A.netDrainOutbox();
        return { start: out.filter(m => m.t === 'START').map(m => m.sandbox) };
    });
    check('START carries the flag', st.start.includes(true), JSON.stringify(st));

    section('A GUEST observes it rather than setting it:');
    st = await D(() => {
        const A = window.ACDebug;
        A.goHome();
        A.netFakeConnect('joiner');
        A.enterRoom();
        // Reset via the HOST's own channel, not by calling the setter as the
        // guest - the setter correctly refuses, and the first version of this
        // section then measured a flag that was still true from the section
        // above and blamed the guard.
        A.netFeed({ t: 'SETUP', sandbox: false });
        const afterGuestTriedOff = A.sandboxMatch;
        A.netDrainOutbox();
        A.setSandboxMatch(true);
        const guestTried = { value: A.sandboxMatch, sent: A.netDrainOutbox().length };
        // ...but it accepts what the host tells it.
        A.netFeed({ t: 'SETUP', sandbox: true });
        const vis = id => {
            const el = document.getElementById(id);
            return !!el && el.getClientRects().length > 0;
        };
        return { afterGuestTriedOff, guestTried, fromHost: A.sandboxMatch,
                 guestRow: (document.getElementById('guest-sandbox') || {}).textContent,
                 banner: vis('sandbox-banner') };
    });
    check('a guest cannot turn it on itself',
        st.guestTried.value === false && st.guestTried.sent === 0, JSON.stringify(st.guestTried));
    check('but it applies what the host sends', st.fromHost === true, JSON.stringify(st));
    check('and the guest is TOLD, in its own read-only summary',
        /no coins/i.test(st.guestRow || ''), JSON.stringify(st.guestRow));
    check('with the same banner the host sees', st.banner === true, JSON.stringify(st));

    section('It does NOT touch the fighters - that is the other sandbox:');
    st = await D(() => {
        const A = window.ACDebug;
        const name = A.CHARACTERS.map(c => c.name).find(n => !A.STARTER_CHARS.includes(n));
        return {
            sandbox: A.sandboxMatch,
            unlocked: A.isCharUnlocked('p1', name),
            upgrades: A.upgradeLevel('p1', name, 'dmg'),
            overrideActive: A.sandboxActive(),
        };
    });
    check('a sandbox match unlocks nothing',
        st.unlocked === false, JSON.stringify(st));
    check('and grants no upgrades - both fighters are still their real saves',
        st.upgrades === 0 && st.overrideActive === false, JSON.stringify(st));

    await finish(browser, page);
})();
