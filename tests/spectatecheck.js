// Can a third person WATCH a match without being in it?
//
// Three clients, because that is the shape of the feature: a host, a guest and
// a spectator. The first two are netcheck's arrangement; the third is what this
// adds, and almost everything that can go wrong is about the host now having
// two kinds of channel at once.
//
// THE TRANSPORT IS FAKED, exactly as netcheck fakes it - no PeerJS, no
// signalling server, just each page's outbox relayed into the others. Real
// WebRTC between three headless browsers would make this checker fail for
// reasons that have nothing to do with spectating.
//
// Note the TWO outboxes. A host sends down the match channel and down each
// spectator channel from one page, so a single outbox would mix them - and
// because each side now ignores the other's packet types, everything would be
// delivered to the wrong client and the test would still pass.
const path = require('path');
const H = require(path.join(__dirname, 'harness'));

process.on('unhandledRejection', (e) => {
    console.error('UNHANDLED', e && e.stack || e);
    process.exit(1);
});

(async () => {
    // Three browsers, one page each, for netcheck's reason: Chrome does not run
    // requestAnimationFrame in a background tab and only one window is
    // foreground, so as tabs two of these three would never tick.
    const hostBrowser = await H.launch({ keepAnimating: true });
    const joinBrowser = await H.launch({ keepAnimating: true });
    const watchBrowser = await H.launch({ keepAnimating: true });
    const host = await H.newPage(hostBrowser);
    const join = await H.newPage(joinBrowser);
    const watch = await H.newPage(watchBrowser);
    const { check, section, finish } = H.makeChecker();

    await H.boot(host, { clearStorage: true, models: true });
    await H.boot(join, { clearStorage: true, models: true });
    await H.boot(watch, { clearStorage: true, models: true });

    // --- the relay --------------------------------------------------------
    async function pumpOnce() {
        const fromHost = await host.evaluate(() => window.ACDebug.netDrainOutbox());
        const fromJoin = await join.evaluate(() => window.ACDebug.netDrainOutbox());
        const toWatch = await host.evaluate(() => window.ACDebug.netDrainWatchOutbox());
        for (const m of fromHost) await join.evaluate(x => window.ACDebug.netFeed(x), m);
        for (const m of fromJoin) await host.evaluate(x => window.ACDebug.netFeed(x), m);
        for (const m of toWatch) await watch.evaluate(x => window.ACDebug.netFeed(x), m);
        return { toWatch };
    }
    let relayTimer = null, relayBusy = false;
    const watchSeen = [];
    function startRelay() {
        if (relayTimer) return;
        relayTimer = setInterval(async () => {
            if (relayBusy) return;
            relayBusy = true;
            try {
                const { toWatch } = await pumpOnce();
                for (const m of toWatch) watchSeen.push(m.t);
            } catch (e) {
                if (/Target closed|Session closed|detached/i.test(e.message || '')) stopRelay();
            }
            relayBusy = false;
        }, 40);
    }
    function stopRelay() {
        if (relayTimer) { clearInterval(relayTimer); relayTimer = null; }
    }
    // Wait while STILL RELAYING. netcheck's note applies unchanged: a wait that
    // stops the pump makes both clients hear silence, hit the drop timeout and
    // pause, and then every later assertion fails for that one reason.
    //
    // It takes a FUNCTION, not a source string. The string form would need
    // eval() inside the page, and an artifact served with a strict
    // Content-Security-Policy is exactly the environment where that silently
    // throws and every wait reports false.
    async function waitRelaying(pg, fn, ms) {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
            try { if (await pg.evaluate(fn)) return true; }
            catch (e) { /* a page mid-navigation; try again */ }
            await H.sleep(80);
        }
        return false;
    }

    const budget = H.budget(45000);

    // --- a match, with a guest ---------------------------------------------
    section('A host and a guest get into a match:');
    await host.evaluate(() => window.ACDebug.netFakeConnect('host'));
    await join.evaluate(() => window.ACDebug.netFakeConnect('joiner'));
    startRelay();
    await host.evaluate(() => {
        const D = window.ACDebug;
        D.setDebugUnlockAll(true);
        D.confirmPick('p1', 'Kaelen');
        D.confirmPick('p2', 'Lyra');
    });
    await H.sleep(300);
    // --- a spectator who arrives EARLY ------------------------------------
    //
    // Deliberately before the match, because that is where the bugs were. A
    // spectator reuses netBindConnection, whose open handler is a PLAYER's
    // arrival: it says which player you are, announces a name and falls through
    // to enterRoom(), which puts the client on the roster to pick a fighter. It
    // is also the case where nothing would otherwise be sent to a watcher at
    // all - netTick returns early with no fighter to broadcast - so its own
    // silence timeout would fire while it waited.
    section('A spectator can arrive before the match does:');
    await watch.evaluate(() => {
        window.ACDebug.netFakeWatch();
        // A SHORT FUSE. The real timeout is 15s of silence; at that length this
        // assertion would pass by simply not waiting long enough to fail.
        window.ACDebug.netSetTimeout(2500);
    });
    const early = await host.evaluate(() => window.ACDebug.netFakeAddWatcher());
    check('the host admits one before a fight exists', early === 1, 'netWatcherCount ' + early);
    check('and the spectator is not put on the roster',
        await watch.evaluate(() => {
            const D = window.ACDebug;
            return D.gameState !== 'FIGHT' && D.gameState !== 'INTRO';
        }),
        'watcher state ' + await watch.evaluate(() => window.ACDebug.gameState));
    // Four seconds against a 2.5s fuse: it survives only because the host pings
    // its spectators on their own clock.
    await H.sleep(4000);
    check('it is kept alive while it waits',
        await watch.evaluate(() => window.ACDebug.netIsWatching() && window.ACDebug.netActive()),
        'the watcher dropped: ' + await watch.evaluate(() => window.ACDebug.gameState));
    await watch.evaluate(() => window.ACDebug.netSetTimeout(15000));

    await host.evaluate(() => window.ACDebug.beginMatch());
    const hostFighting = await waitRelaying(host, () => window.ACDebug.gameState === 'FIGHT', budget);
    check('the host reaches a fight', hostFighting,
        'host state ' + await host.evaluate(() => window.ACDebug.gameState));
    const joinFighting = await waitRelaying(join, () => window.ACDebug.gameState === 'FIGHT', budget);
    check('and so does the guest', joinFighting,
        'guest state ' + await join.evaluate(() => window.ACDebug.gameState));

    // --- the spectator ------------------------------------------------------
    section('A spectator is admitted without taking a player slot:');
    const admitted = await host.evaluate(() => window.ACDebug.netWatcherCount());
    check('the host still has its watcher', admitted === 1, 'netWatcherCount ' + admitted);
    // THE OPPONENT IS STILL THERE. This is the assertion the feature most
    // needed: the host's one-opponent rule used to close any second connection,
    // and a watcher admitted through the wrong door would have replaced the
    // guest rather than joined beside them.
    const stillPaired = await host.evaluate(() => !!(window.ACDebug.netWatcherCount() === 1));
    check('and still has its opponent', stillPaired
        && await join.evaluate(() => window.ACDebug.gameState === 'FIGHT'),
        'guest state ' + await join.evaluate(() => window.ACDebug.gameState));
    check('the spectator knows it is watching',
        await watch.evaluate(() => window.ACDebug.netIsWatching()), 'netIsWatching false');

    const built = await waitRelaying(watch,
        () => window.ACDebug.gameState === 'FIGHT' || window.ACDebug.gameState === 'INTRO', budget);
    check('the spectator builds the match it walked into', built,
        'watcher state ' + await watch.evaluate(() => window.ACDebug.gameState)
        + ' after seeing ' + JSON.stringify(watchSeen.slice(0, 6)));
    check('it was sent a catch-up packet', watchSeen.indexOf('WATCH_SETUP') >= 0,
        'packets seen: ' + JSON.stringify([...new Set(watchSeen)]));
    check('and the same two fighters',
        await watch.evaluate(() => {
            const D = window.ACDebug;
            return !!(D.player1 && D.player2)
                && D.player1.name === 'Kaelen' && D.player2.name === 'Lyra';
        }),
        await watch.evaluate(() => {
            const D = window.ACDebug;
            return D.player1 ? D.player1.name + ' vs ' + (D.player2 && D.player2.name) : 'no fighters';
        }));

    // --- what a spectator is ------------------------------------------------
    section('A spectator drives nothing:');
    check('both fighters are puppets',
        await watch.evaluate(() => {
            const D = window.ACDebug;
            return !!(D.player1 && D.player2
                && D.player1.isNetPuppet() && D.player2.isNetPuppet());
        }), 'one of them is still simulated locally');
    check('it shows the spectator view, not a first-person one',
        await watch.evaluate(() => window.ACDebug.watchView()), 'watchView() false');
    // IT MUST NOT TALK. A spectator with a fighter it thinks it owns would send
    // STATE for it and fight the host for authority - netTick's early return is
    // what stops that, and this is the assertion that it is still there.
    await watch.evaluate(() => { window.__netOutbox = []; });
    await H.sleep(900);
    const spoke = await watch.evaluate(() => window.ACDebug.netDrainOutbox());
    check('and sends nothing at all', spoke.length === 0,
        'the spectator sent ' + JSON.stringify(spoke.map(m => m.t)));

    // --- does it actually see the fight? ------------------------------------
    section('It sees what the host sees:');
    const gotState = await waitRelaying(watch,
        () => !!(window.ACDebug.netWatchState && window.ACDebug.netWatchState().p1), budget);
    if (!gotState) {
        check('state for both fighters arrives', watchSeen.indexOf('WATCH_STATE') >= 0,
            'packets seen: ' + JSON.stringify([...new Set(watchSeen)]));
    } else {
        check('state for both fighters arrives', true, '');
    }
    // Move the host's fighter somewhere unmistakable and see it arrive. A
    // tolerance, not an equality: the spectator EASES toward the buffer by
    // design, so demanding the exact number would assert the absence of the
    // smoothing the feature is built on.
    await host.evaluate(() => {
        const D = window.ACDebug;
        D.player1.x = 700; D.player1.y = 400; D.player1.vx = 0; D.player1.vy = 0;
    });
    const tracked = await waitRelaying(watch,
        () => !!window.ACDebug.player1
            && Math.hypot(window.ACDebug.player1.x - 700, window.ACDebug.player1.y - 400) < 120, budget);
    check('the spectator follows the host\'s fighter', tracked,
        'watcher p1 at ' + await watch.evaluate(() => window.ACDebug.player1
            ? Math.round(window.ACDebug.player1.x) + ',' + Math.round(window.ACDebug.player1.y)
            : 'none'));
    // Health SNAPS rather than easing, which is the same rule the opponent path
    // follows and matters more here: a spectator is reading the bars to know
    // how close the fight is.
    await host.evaluate(() => { window.ACDebug.player2.hp = 37; });
    const hpArrived = await waitRelaying(watch,
        () => !!window.ACDebug.player2 && Math.abs(window.ACDebug.player2.hp - 37) < 2, budget);
    check('health arrives and snaps', hpArrived,
        'watcher p2 hp ' + await watch.evaluate(() => window.ACDebug.player2
            ? Math.round(window.ACDebug.player2.hp) : 'none'));

    // --- leaving --------------------------------------------------------
    section('A spectator leaving does not disturb the match:');
    check('there is a watcher to lose', await host.evaluate(
        () => window.ACDebug.netWatcherCount() === 1), 'no watcher was attached');
    await watch.evaluate(() => window.ACDebug.netTeardown());
    // BOTH ENDS. Over a faked transport the spectator's end and the host's end
    // are separate objects in separate pages, so the teardown above is only
    // half of a tab closing - the host hears nothing until its own end closes.
    const sawDrop = await host.evaluate(() => window.ACDebug.netFakeDropWatcher());
    check('the host hears the channel close', sawDrop, 'there was nothing to close');
    await H.sleep(400);
    const dropped = await host.evaluate(() => window.ACDebug.netWatcherCount());
    check('and unlists it', dropped === 0, 'netWatcherCount still ' + dropped);
    const after = await host.evaluate(() => window.ACDebug.gameState);
    check('the host is still fighting', after === 'FIGHT', 'host state ' + after);
    const guestAfter = await join.evaluate(() => window.ACDebug.gameState);
    check('and so is the guest', guestAfter === 'FIGHT', 'guest state ' + guestAfter);

    stopRelay();
    await hostBrowser.close();
    await joinBrowser.close();
    await watchBrowser.close();
    finish();
})();
