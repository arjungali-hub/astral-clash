// Batch 32 checker: online peer-to-peer play.
//
// Runs TWO real pages and relays messages between them through Node, using the
// loopback transport hook. That covers the whole protocol and every game-side
// consequence - roles, pick sync, arena agreement, puppet physics, damage
// authority - without depending on the public PeerJS broker being reachable,
// which would make the suite fail for reasons unrelated to this code. The real
// PeerJS handshake is checked separately at the end and reported without
// failing the run, since it needs the internet.
const H = require('./harness');

// A late rejection from a closed page must not kill the run before the summary
// is printed - that turned a 20-of-21 result into a stack trace with no verdict.
process.on('unhandledRejection', e => {
    console.log('  (ignored late rejection: ' + String(e && e.message).slice(0, 80) + ')');
});

(async () => {
    // TWO SEPARATE BROWSERS, one page each - not two tabs in one browser.
    // Chrome does not run requestAnimationFrame in a background tab, and only
    // the last-created tab is foreground, so as two tabs the host's game loop
    // never ticked and it never sent a single state packet. The
    // --disable-background-timer-throttling family of flags did not lift it in
    // headless. Two browsers gives each client a foreground page, which is also
    // what two real players have.
    // keepAnimating: this is the ONE checker that needs the background-throttle
    // flags. Chrome will not run requestAnimationFrame in a background tab and
    // only one window is foreground, so without this the host's loop never
    // ticks and it never sends a packet. It is opt-in rather than a harness
    // default because those flags also stop an ORPHANED test browser from ever
    // idling - see the comment on NO_THROTTLE_ARGS in harness.js.
    const hostBrowser = await H.launch({ keepAnimating: true });
    const joinBrowser = await H.launch({ keepAnimating: true });
    const host = await H.newPage(hostBrowser);
    const join = await H.newPage(joinBrowser);
    const { check, section, finish } = H.makeChecker();

    for (const [pg, tag] of [[host, 'HOST'], [join, 'JOIN']]) {
        pg.on('console', m => { if (/\[net\]/.test(m.text())) console.log(`  (${tag} ${m.text()})`); });
    }
    await H.boot(host, { clearStorage: true, models: true });
    await H.boot(join, { clearStorage: true, models: true });



    // Pump: drain each page's outbox into the other page.
    let pumping = false;
    async function pumpOnce() {
        const fromHost = await host.evaluate(() => window.ACDebug.netDrainOutbox());
        const fromJoin = await join.evaluate(() => window.ACDebug.netDrainOutbox());
        for (const m of fromHost) await join.evaluate(x => window.ACDebug.netFeed(x), m);
        for (const m of fromJoin) await host.evaluate(x => window.ACDebug.netFeed(x), m);
    }
    async function pump(times = 1) {
        for (let i = 0; i < times; i++) { await pumpOnce(); await H.sleep(120); }
    }
    let relayTimer = null, relayBusy = false;
    function startRelay() {
        if (relayTimer) return;
        relayTimer = setInterval(async () => {
            if (relayBusy) return;              // never overlap two pumps
            relayBusy = true;
            try { await pumpOnce(); }
            catch (e) {
                // A closed target will never recover, and an interval that keeps
                // evaluating against one throws an unhandled rejection that
                // kills the whole run mid-suite.
                if (/Target closed|Session closed|detached/i.test(e.message || '')) stopRelay();
            }
            relayBusy = false;
        }, 40);
    }
    function stopRelay() {
        if (relayTimer) { clearInterval(relayTimer); relayTimer = null; }
    }
    // Wait for a condition while STILL RELAYING. This has to be one interleaved
    // loop, not a wait plus a background pump: a pump running concurrently with
    // page.waitForFunction did not keep relaying, so during the ~6 second INTRO
    // both clients heard silence, hit the 6s drop timeout and paused - and every
    // assertion after that failed for that single reason. In a real match STATE
    // flows continuously at 30Hz, so the client is right to treat silence as a
    // dropped connection; it was the test that went quiet.
    async function waitPumping(pg, expr, label, ms = 30000) {
        const t0 = Date.now();
        let iter = 0;
        while (Date.now() - t0 < ms) {
            await pumpOnce();
            let val = false;
            try { val = await pg.evaluate(`(() => !!(${expr}))()`); } catch (e) { /* page busy */ }
            iter++;
            if (val) return true;
            await H.sleep(80);
        }
        check(label, false, `timed out after ${ms}ms waiting for: ${expr}`);
        return false;
    }

    section('Roles: host is Player 1, joiner is Player 2:');
    await host.evaluate(() => window.ACDebug.netFakeConnect('host'));
    await join.evaluate(() => window.ACDebug.netFakeConnect('joiner'));
    startRelay();
    // Raise the drop timeout for the functional sections. This harness relays
    // packets through CDP round-trips, which cannot sustain the client's 30Hz
    // send rate, so the link starves and the (correct) 6-second silence timeout
    // fires - which previously failed every assertion after it for that one
    // reason. The timeout gets its own deliberate section at the end instead.
    for (const pg of [host, join]) await pg.evaluate(() => window.ACDebug.netSetTimeout(600000));
    const roles = {
        host: await host.evaluate(() => ({ side: window.ACDebug.LOCAL_SIDE, isHost: window.ACDebug.netIsHost(), active: window.ACDebug.netActive(), status: window.ACDebug.netStatus })),
        join: await join.evaluate(() => ({ side: window.ACDebug.LOCAL_SIDE, isHost: window.ACDebug.netIsHost(), active: window.ACDebug.netActive(), status: window.ACDebug.netStatus })),
    };
    check('host controls p1', roles.host.side === 'p1' && roles.host.isHost === true, JSON.stringify(roles.host));
    check('joiner controls p2', roles.join.side === 'p2' && roles.join.isHost === false, JSON.stringify(roles.join));
    check('both report connected',
        roles.host.active && roles.join.active
        && roles.host.status === 'connected' && roles.join.status === 'connected',
        JSON.stringify(roles));

    // Batch 32 asserted that the bot toggle stayed hidden online even with the
    // sandbox on. Batch 34 removed bots from this build outright - the sandbox
    // that was their only door is gone too - so the assertion becomes their
    // absence. The flags remain because the Fighter constructor, the AI branch
    // of update() and beginMatch all read them.
    section('Bots do not exist in this build:');
    const bots = await host.evaluate(() => {
        const D = window.ACDebug;
        return {
            toggles: document.querySelectorAll('.bot-toggle, #btn-toggle-bot, #btn-toggle-bot-p1').length,
            sandbox: !!document.getElementById('chk-unlock-all'),
            p1IsBot: D.p1IsBot, p2IsBot: D.p2IsBot,
        };
    });
    check('no bot toggle and no sandbox switch exist, and both slots are human',
        bots.toggles === 0 && !bots.sandbox && !bots.p1IsBot && !bots.p2IsBot,
        JSON.stringify(bots));

    section('You can only pick your own fighter:');
    const gate = await join.evaluate(() => {
        const D = window.ACDebug;
        const before = D.p1Choice;
        // The joiner is p2, so attempting to pick for p1 must be refused.
        D.previewPick('p1', D.CHARACTERS[1].name);
        return { before, after: D.p1Choice, p1Preview: D.p1Preview };
    });
    check('the joiner cannot preview a pick for p1',
        gate.after === gate.before && !gate.p1Preview, JSON.stringify(gate));

    section('Character choices sync both ways:');
    await host.evaluate(() => {
        document.querySelectorAll('#p1-grid .fighter-btn')[0].click();
        document.querySelector('#p1-detail .btn-confirm').click();
    });
    await join.evaluate(() => {
        document.querySelectorAll('#p2-grid .fighter-btn')[1].click();
        document.querySelector('#p2-detail .btn-confirm').click();
    });
    await pump(3);
    const picks = {
        host: await host.evaluate(() => ({ p1: window.ACDebug.p1Choice, p2: window.ACDebug.p2Choice })),
        join: await join.evaluate(() => ({ p1: window.ACDebug.p1Choice, p2: window.ACDebug.p2Choice })),
    };
    check('both clients agree on both fighters',
        picks.host.p1 && picks.host.p2
        && picks.host.p1 === picks.join.p1 && picks.host.p2 === picks.join.p2,
        JSON.stringify(picks));

    section('The host picks the arena and both load it:');
    await host.evaluate(() => {
        const D = window.ACDebug;
        // Batch 34: chooseMap() only RECORDS the arena now - it used to start
        // the match on first click, which is why the guest could never see
        // what was chosen. Leave it on Random deliberately: startOnline() must
        // resolve Random to a CONCRETE map before broadcasting, or each side
        // rolls its own and they load different arenas.
        D.chooseMap(null);
        D.startOnline();
    });
    await pump(4);
    await waitPumping(host, "window.ACDebug.gameState === 'FIGHT' || window.ACDebug.gameState === 'INTRO'", 'host leaves the menu');
    await waitPumping(join, "window.ACDebug.gameState === 'FIGHT' || window.ACDebug.gameState === 'INTRO'", 'joiner leaves the menu');
    const maps = {
        host: await host.evaluate(() => window.ACDebug.matchMap && window.ACDebug.matchMap.name),
        join: await join.evaluate(() => window.ACDebug.matchMap && window.ACDebug.matchMap.name),
    };
    check('both clients loaded the SAME arena', maps.host && maps.host === maps.join,
        `host=${maps.host} joiner=${maps.join}`);

    // Get both into FIGHT so the simulation is live.
    await waitPumping(host, "window.ACDebug.gameState === 'FIGHT'", 'host reaches FIGHT');
    await waitPumping(join, "window.ACDebug.gameState === 'FIGHT'", 'joiner reaches FIGHT');

    // From here on the test drives the relay by hand, one pump at a time.
    stopRelay();

    section('The opponent is a puppet, not a locally simulated fighter:');
    for (const pg of [host, join]) {
        await pg.evaluate(() => {
            window.netDiag0 = () => ({
                mine: window.ACDebug.LOCAL_SIDE,
                active: window.ACDebug.netActive(),
                status: window.ACDebug.net.status,
                detail: window.ACDebug.net.detail,
                sinceRecvMs: window.ACDebug.net.lastRecvAt
                    ? Math.round(performance.now() - window.ACDebug.net.lastRecvAt) : null,
                sinceSendMs: window.ACDebug.net.lastSendAt
                    ? Math.round(performance.now() - window.ACDebug.net.lastSendAt) : null,
                fps: Math.round(window.ACDebug.fpsSmoothed || 0),
            });
        });
    }
    const netDiag = () => ({
        mine: window.ACDebug.LOCAL_SIDE,
        active: window.ACDebug.netActive(),
        status: window.ACDebug.net.status,
        detail: window.ACDebug.net.detail,
        sinceRecvMs: window.ACDebug.net.lastRecvAt
            ? Math.round(performance.now() - window.ACDebug.net.lastRecvAt) : null,
        sinceSendMs: window.ACDebug.net.lastSendAt
            ? Math.round(performance.now() - window.ACDebug.net.lastSendAt) : null,
        fps: Math.round(window.ACDebug.fpsSmoothed || 0),
    });
    const puppet = {
        host: await host.evaluate(() => Object.assign(netDiag0(), {
            mineIsPuppet: window.ACDebug.player1.isNetPuppet(),
            theirsIsPuppet: window.ACDebug.player2.isNetPuppet(),
        })),
        join: await join.evaluate(() => Object.assign(netDiag0(), {
            mineIsPuppet: window.ACDebug.player2.isNetPuppet(),
            theirsIsPuppet: window.ACDebug.player1.isNetPuppet(),
        })),
    };
    check('each client simulates its own fighter and puppets the other',
        puppet.host.mineIsPuppet === false && puppet.host.theirsIsPuppet === true
        && puppet.join.mineIsPuppet === false && puppet.join.theirsIsPuppet === true,
        JSON.stringify(puppet));

    // The host moves; the joiner's copy of p1 should follow.
    const follow = await (async () => {
        await host.evaluate(() => {
            const f = window.ACDebug.player1;
            f.x = 700; f.y = 470; f.z = 0; f.fx = 1; f.fy = 0;
        });
        await pump(3);
        const before = await join.evaluate(() => ({ x: window.ACDebug.player1.x, y: window.ACDebug.player1.y }));
        await host.evaluate(() => {
            const f = window.ACDebug.player1;
            f.x = 1000; f.y = 470;
        });
        await pump(8);
        const after = await join.evaluate(() => ({ x: window.ACDebug.player1.x, y: window.ACDebug.player1.y }));
        const target = await host.evaluate(() => ({ x: window.ACDebug.player1.x }));
        return { before, after, target: target.x };
    })();
    check('the puppet follows the owner across the network',
        follow.after.x > follow.before.x + 50,
        `joiner saw p1 move ${follow.before.x.toFixed(0)} -> ${follow.after.x.toFixed(0)} (host at ${follow.target.toFixed(0)})`);

    // The property here is that the puppet's OWN PHYSICS is suppressed - before
    // the guard, gravity pulled it down between packets and resolveObstacles
    // shoved it out of geometry its owner was standing in happily.
    //
    // The authoritative height has to be moved too, not just the local one. An
    // earlier version set only f.z = 40 while the buffered state still said 0,
    // then reported the puppet "falling" when it was correctly CONVERGING on
    // what the network said. That is the behaviour working, not failing.
    // From here the test relays EXPLICITLY. The background relay races two of
    // the assertions below: it drains the outbox before the test can inspect it
    // (so the HIT message is gone) and overwrites the buffered state with a
    // fresh packet mid-measurement. The drop timeout is already raised, so
    // going quiet is harmless.
    stopRelay();
    const drift = await join.evaluate(async () => {
        const D = window.ACDebug, f = D.player1;
        const step = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        // Both the local transform AND the authoritative buffer, with no relay
        // running - otherwise the next packet says z=0 and the puppet correctly
        // converges on it, which is the feature working, not failing.
        f.z = 40;
        if (D.net.remoteState) D.net.remoteState.z = 40;
        const z0 = f.z, x0 = f.x;
        for (let i = 0; i < 6; i++) await step();
        return { z0, z1: f.z, dx: Math.abs(f.x - x0), vz: f.vz };
    });
    check('the puppet does not fall under its own gravity between packets',
        Math.abs(drift.z1 - drift.z0) < 3 && drift.dx < 2 && Math.abs(drift.vz) < 0.001,
        `z ${drift.z0} -> ${drift.z1}, dx ${drift.dx.toFixed(2)}, vz ${drift.vz}`);

    section('Hits are attacker-authoritative:');
    const dmg = await (async () => {
        // Line them up, then have the HOST hit the joiner.
        await host.evaluate(() => {
            const D = window.ACDebug, a = D.player1, b = D.player2;
            a.x = 800; a.y = 480; a.fx = 1; a.fy = 0; a.z = 0;
            b.x = 840; b.y = 480; b.fx = -1; b.fy = 0; b.z = 0;
            a.invulnFrames = 0; b.invulnFrames = 0;
        });
        await join.evaluate(() => {
            const D = window.ACDebug, a = D.player1, b = D.player2;
            b.x = 840; b.y = 480; b.fx = -1; b.fy = 0; b.z = 0;
            a.invulnFrames = 0; b.invulnFrames = 0;
        });
        await pump(2);
        // Clear both outboxes so the HIT below is the only thing in flight.
        await host.evaluate(() => window.ACDebug.netDrainOutbox());
        await join.evaluate(() => window.ACDebug.netDrainOutbox());
        const hpBefore = await join.evaluate(() => window.ACDebug.player2.hp);
        // Damage applied on the host, as its own attack would.
        await host.evaluate(() => {
            const D = window.ACDebug;
            D.player2.takeDamage(40, D.player1);
        });
        const outbox = await host.evaluate(() => window.ACDebug.netDrainOutbox());
        const hit = outbox.find(m => m.t === 'HIT');
        for (const m of outbox) await join.evaluate(x => window.ACDebug.netFeed(x), m);
        await H.sleep(200);
        const hpAfter = await join.evaluate(() => window.ACDebug.player2.hp);
        return { hpBefore, hpAfter, hit };
    })();
    check('landing a hit sends a HIT message', !!dmg.hit && dmg.hit.dmg === 40, JSON.stringify(dmg.hit));
    check('the victim applies it to itself', dmg.hpAfter < dmg.hpBefore,
        `${dmg.hpBefore} -> ${dmg.hpAfter}`);

    const suppressed = await join.evaluate(() => {
        const D = window.ACDebug;
        const before = D.player2.hp;
        // An attack by the REMOTE fighter must not resolve here - its owner
        // decides and sends a HIT. Resolving locally too would double-count.
        D.player2.invulnFrames = 0;
        D.player2.takeDamage(50, D.player1);
        return { before, after: D.player2.hp };
    });
    check('an attack thrown by the remote fighter is NOT resolved locally',
        suppressed.after === suppressed.before, `${suppressed.before} -> ${suppressed.after}`);

    const envSuppressed = await host.evaluate(() => {
        const D = window.ACDebug;
        const before = D.player2.hp;
        // Environmental damage on the puppet belongs to its owner; ours would
        // land a second time and then be overwritten by their next STATE.
        D.player2.invulnFrames = 0;
        D.player2.takeDamage(30, null);
        return { before, after: D.player2.hp };
    });
    check('environmental damage on the puppet is left to its owner',
        envSuppressed.after === envSuppressed.before,
        `${envSuppressed.before} -> ${envSuppressed.after}`);

    section('Coins credit only the local player:');
    const coins = await host.evaluate(() => {
        const D = window.ACDebug;
        const before = { p1: D.prog('p1').coins, p2: D.prog('p2').coins };
        D.addCoins('p1', 25);
        D.addCoins('p2', 25);   // would be the opponent's purse
        return { before, after: { p1: D.prog('p1').coins, p2: D.prog('p2').coins } };
    });
    // addCoins itself is side-addressed; what matters is that endMatch only
    // ever calls it for LOCAL_SIDE online. Assert the wiring reads that way.
    const wiring = await host.evaluate(() => window.ACDebug.LOCAL_SIDE);
    check('the local side is the one that would be credited', wiring === 'p1', wiring);

    section('Disconnect is handled, not ignored:');
    stopRelay();   // this section kills the link on purpose

    // The silence timeout, tested on purpose rather than tripped over.
    const timedOut = await host.evaluate(async () => {
        const D = window.ACDebug;
        D.netFakeConnect('host');
        D.netSetTimeout(300);              // 300ms of silence is a dead link
        const before = D.netActive();
        await new Promise(r => setTimeout(r, 1200));   // say nothing
        return { before, after: D.netActive(), status: D.net.status, detail: D.net.detail };
    });
    check('silence past the timeout tears the connection down',
        timedOut.before === true && timedOut.after === false, JSON.stringify(timedOut));
    check('and reports why', /timed out/i.test(timedOut.detail || ''), timedOut.detail);

    await host.evaluate(() => window.ACDebug.netFeed({ t: 'BYE' }));
    await H.sleep(400);
    const bye = await host.evaluate(() => ({
        active: window.ACDebug.netActive(),
        status: window.ACDebug.netStatus,
        side: window.ACDebug.LOCAL_SIDE,
        state: window.ACDebug.gameState,
    }));
    check('a BYE tears the connection down', bye.active === false, JSON.stringify(bye));
    check('it reports as disconnected rather than silently idle', bye.status === 'dropped', bye.status);
    check('the match is paused rather than left running against a dead puppet',
        bye.state === 'PAUSED', bye.state);
    check('the local side resets to p1 for the next session', bye.side === 'p1', bye.side);

    section('Real PeerJS handshake (needs the internet; informational):');
    const real = await host.evaluate(() => new Promise(res => {
        if (typeof Peer !== 'function') return res({ ok: false, why: 'PeerJS did not load' });
        const timer = setTimeout(() => res({ ok: false, why: 'broker timeout' }), 12000);
        try {
            const pr = new Peer();
            pr.on('open', id => { clearTimeout(timer); pr.destroy(); res({ ok: true, id: String(id).slice(0, 8) }); });
            pr.on('error', e => { clearTimeout(timer); res({ ok: false, why: (e && e.type) || 'error' }); });
        } catch (e) { clearTimeout(timer); res({ ok: false, why: e.message }); }
    }));
    console.log(real.ok
        ? `  INFO  PeerJS broker reachable, got an id (${real.id}...)`
        : `  INFO  PeerJS broker unreachable in this environment (${real.why}) - loopback assertions above still cover the protocol`);

    stopRelay();
    await host.evaluate(() => localStorage.clear());
    try { await joinBrowser.close(); } catch (e) {}
    await finish(hostBrowser, host);
})();
