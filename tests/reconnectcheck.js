// A dropped connection holds the match instead of ending it.
//
// WHAT THIS IS FOR. A Wi-Fi blip used to cost the match: the data channel
// closed, netTeardown destroyed the peer, and the pause screen said the
// opponent had disconnected. Honest, and unsatisfying - because most drops are
// a lift, a tunnel or a handover, and the opponent is still sitting there.
//
// THE SUBTLE PART, and the reason this file leans on it hard: netActive() is
// deliberately TRUE for the whole grace window. PeerJS flips conn.open to false
// the instant a channel closes, and dozens of guards hang off netActive() -
// including isNetPuppet(), which decides whether the opponent is driven by the
// wire or by this machine. A grace window that let netActive() go false would,
// for those seconds, tell the game there is no opponent: the puppet stops being
// a puppet and this client starts driving BOTH fighters. So that is asserted
// directly, not inferred.
//
// Runs on this machine: netFakeConnect gives a loopback link on one page, so
// none of this needs the two browsers and 2.2GB that netcheck needs.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));

    await H.boot(page, { clearStorage: true, models: true });

    section('Constants are sane before anything is driven by them:');
    const k = await page.evaluate(() => ({
        grace: window.ACDebug.NET_GRACE_MS,
        retry: window.ACDebug.NET_RETRY_MS,
        inGrace: window.ACDebug.netInGrace(),
    }));
    check('the grace window is long enough to cover a blip',
        k.grace >= 8000 && k.grace <= 30000, String(k.grace));
    check('retries are spaced, not a hammer',
        k.retry >= 1000 && k.retry < k.grace, String(k.retry));
    check('and no grace window is open to begin with',
        k.inGrace === false, String(k.inGrace));

    section('A drop in a MENU is still a teardown - there is nothing to hold:');
    const menu = await page.evaluate(() => {
        const D = window.ACDebug;
        return { worthwhile: D.netGraceWorthwhile(), state: D.gameState };
    });
    check('a menu is not worth holding a match for',
        menu.worthwhile === false, JSON.stringify(menu));

    section('Into a real online match:');
    await page.evaluate(() => {
        const D = window.ACDebug;
        D.netSetTimeout(900000);
        D.netFakeConnect('host');
        D.previewPick('p1', 'Kaelen');
        D.confirmPick('p1');
        D.netFeed({ t: 'PICK', side: 'p2', name: 'Lyra' });
        D.selectedMap = D.MAPS[0].name;
        D.startOnline();
    });
    const live = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    check('a match is running', live, 'never reached FIGHT');
    if (!live) { await finish(browser, page); return; }

    const before = await page.evaluate(() => {
        const D = window.ACDebug;
        return {
            worthwhile: D.netGraceWorthwhile(),
            puppet: D.player2.isNetPuppet(),
            active: D.netActive(),
        };
    });
    check('a live fight IS worth holding', before.worthwhile === true,
        JSON.stringify(before));
    check('the opponent is a puppet', before.puppet === true, JSON.stringify(before));

    section('The drop: held, paused, and NOT declared over:');
    const dropped = await page.evaluate(() => {
        const D = window.ACDebug;
        D.netFakeDrop();        // fires conn.on('close') -> netDropped
        const note = document.getElementById('pause-away-note');
        const btn = document.getElementById('btn-resume');
        return {
            inGrace: D.netInGrace(),
            state: D.gameState,
            left: D.netGraceSecondsLeft(),
            note: note ? note.textContent.trim() : null,
            noteShown: note ? getComputedStyle(note).display !== 'none' : null,
            resumeDisabled: btn ? btn.disabled : null,
        };
    });
    check('a grace window opened', dropped.inGrace === true, JSON.stringify(dropped));
    check('the match is paused, not ended', dropped.state === 'PAUSED', dropped.state);
    check('a countdown is running', dropped.left > 0 && dropped.left <= k.grace / 1000,
        String(dropped.left));
    check('the screen says it is reconnecting, not that the match is over',
        /reconnect/i.test(dropped.note || '') && !/cannot continue/i.test(dropped.note || ''),
        String(dropped.note));
    check('the note is actually visible', dropped.noteShown === true,
        String(dropped.noteShown));
    check('Resume is refused while nobody is on the other end',
        dropped.resumeDisabled === true, String(dropped.resumeDisabled));

    section('THE HAZARD: identity must not change during the window:');
    // If netActive() went false here, this client would start driving the
    // opponent as well as itself.
    const identity = await page.evaluate(() => {
        const D = window.ACDebug;
        return {
            active: D.netActive(),
            puppet: D.player2.isNetPuppet(),
            open: !!(D.net.conn && D.net.conn.open),
            localSide: D.LOCAL_SIDE,
        };
    });
    check('netActive() is still true, even with the channel closed',
        identity.active === true, JSON.stringify(identity));
    check('and the opponent is STILL a puppet, not something this client drives',
        identity.puppet === true, JSON.stringify(identity));
    check('which side is ours has not moved',
        identity.localSide === 'p1', String(identity.localSide));

    section('The match state is preserved across the window:');
    const kept = await page.evaluate(() => {
        const D = window.ACDebug;
        return {
            p1: !!D.player1, p2: !!D.player2,
            map: D.currentMapName || D.selectedMap,
            name: D.net.remoteName,
        };
    });
    check('both fighters are still there', kept.p1 && kept.p2, JSON.stringify(kept));
    check('and the arena has not been thrown away', !!kept.map, JSON.stringify(kept));

    section('Coming back resumes the match rather than restarting it:');
    const resumed = await page.evaluate(() => {
        const D = window.ACDebug;
        // The real path: a channel re-opens while a grace window is live.
        D.netFakeReopen();
        const note = document.getElementById('pause-away-note');
        return {
            inGrace: D.netInGrace(),
            state: D.gameState,
            screen: D.currentScreen,
            p1: !!D.player1,
            note: note ? getComputedStyle(note).display : null,
        };
    });
    check('the grace window closed', resumed.inGrace === false, JSON.stringify(resumed));
    check('the fighters survived - it did NOT go back to the roster',
        resumed.p1 === true && resumed.screen !== 'select', JSON.stringify(resumed));
    check('and the reconnecting note is gone', resumed.note === 'none',
        String(resumed.note));

    section('The host re-states the score, because nothing else ever does:');
    // A guest that missed the hit which ended a round would otherwise carry a
    // stale bar and a stale score for the rest of the match. In Takedown Race,
    // first to three, a missed takedown is the match.
    const resync = await page.evaluate(() => {
        const D = window.ACDebug;
        const sent = [];
        const real = D.net.conn.send;
        D.net.conn.send = (m) => { sent.push(m); return real && real.call(D.net.conn, m); };
        D.netSendResync();
        D.net.conn.send = real;
        return sent.filter(m => m && m.t === 'RESYNC');
    });
    check('a RESYNC is sent', resync.length === 1, JSON.stringify(resync).slice(0, 120));
    const r = resync[0] || {};
    check('it carries the round score', !!r.wins && typeof r.wins.p1 === 'number',
        JSON.stringify(r.wins));
    check('the Zone Control tally', !!r.zone && typeof r.zone.p1 === 'number',
        JSON.stringify(r.zone));
    check('the Takedown Race tally', !!r.ko && typeof r.ko.p1 === 'number',
        JSON.stringify(r.ko));
    check('and both HP bars', !!r.hp && typeof r.hp.p1 === 'number',
        JSON.stringify(r.hp));
    check('but NOT positions - a seconds-old position would be a jump backwards',
        r.x === undefined && r.pos === undefined, JSON.stringify(Object.keys(r)));

    section('A guest applies it; a host ignores it (it IS the source):');
    const applied = await page.evaluate(() => {
        const D = window.ACDebug;
        const asHost = (() => {
            const was = D.roundWins.p1;
            D.netApplyResync({ t: 'RESYNC', wins: { p1: was + 7, p2: 0 } });
            return D.roundWins.p1 === was;       // unchanged: we are the host
        })();
        // Now as a guest.
        D.netFakeConnect('joiner');
        D.netApplyResync({
            t: 'RESYNC', round: 3,
            wins: { p1: 1, p2: 2 }, zone: { p1: 12, p2: 5 }, ko: { p1: 2, p2: 1 },
            hp: { p1: 55, p2: 77 }, meter: { p1: 10, p2: 20 },
        });
        return {
            asHost,
            round: D.currentRound,
            wins: { p1: D.roundWins.p1, p2: D.roundWins.p2 },
            ko: { p1: D.koTally.p1, p2: D.koTally.p2 },
            hp1: D.player1.hp, hp2: D.player2.hp,
        };
    });
    check('a host ignores a RESYNC', applied.asHost === true, JSON.stringify(applied));
    check('a guest takes the round and the score',
        applied.round === 3 && applied.wins.p1 === 1 && applied.wins.p2 === 2,
        JSON.stringify(applied));
    check('the takedown tally', applied.ko.p1 === 2 && applied.ko.p2 === 1,
        JSON.stringify(applied.ko));
    check('and both HP bars', applied.hp1 === 55 && applied.hp2 === 77,
        JSON.stringify(applied));

    section('Rubbish in a RESYNC cannot corrupt the match:');
    // It arrives over the wire, so it is untrusted. A NaN in an HP bar is a
    // fighter that can never be knocked out.
    const junk = await page.evaluate(() => {
        const D = window.ACDebug;
        D.player1.hp = 60; D.koTally.p1 = 1;
        const roundBefore = D.currentRound;   // read-only through ACDebug
        D.netApplyResync({ t: 'RESYNC', round: 'three', wins: null,
                           ko: { p1: NaN, p2: undefined },
                           hp: { p1: 'lots' }, meter: 'none' });
        return { hp1: D.player1.hp, round: D.currentRound,
                 roundBefore, ko1: D.koTally.p1 };
    });
    check('a non-numeric HP is refused', junk.hp1 === 60, JSON.stringify(junk));
    check('a non-numeric round is refused',
        junk.round === junk.roundBefore, JSON.stringify(junk));
    check('and NaN does not reach a tally', junk.ko1 === 1, JSON.stringify(junk));

    section('When the window really does expire, it ends properly:');
    const expired = await page.evaluate(() => {
        const D = window.ACDebug;
        D.netFakeDrop();
        const held = D.netInGrace();
        // Wind the clock past the end rather than waiting fifteen seconds.
        D.net.graceUntil = performance.now() - 1;
        D.netGraceTick();
        const note = document.getElementById('pause-away-note');
        return {
            held,
            inGrace: D.netInGrace(),
            active: D.netActive(),
            status: D.net.status,
            note: note ? note.textContent.trim() : null,
        };
    });
    check('it held first', expired.held === true, JSON.stringify(expired));
    check('then gave up', expired.inGrace === false, JSON.stringify(expired));
    check('the connection is genuinely gone now',
        expired.active === false, JSON.stringify(expired));
    check('and the screen says the match cannot continue',
        /cannot continue/i.test(expired.note || ''), String(expired.note));

    check('no errors thrown', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
    await finish(browser, page);
})();
