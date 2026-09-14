// Batch 37: leaving the game tab pauses the match for both players, and it
// stays paused until BOTH are back AND the host resumes.
//
// Every assertion here is about a RULE rather than about nothing throwing. The
// interesting cases are the ones a careless implementation gets wrong:
//   - the person who left un-pausing the moment they come back (so they can
//     tab away, look at something, and resume before the other player notices)
//   - the guest un-pausing while the host is still away
//   - an opponent's absence surviving their disconnection, which would leave
//     the next match paused with nobody able to resume it
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true });

    // Drop into a live match as the host, against the loopback peer.
    const intoMatch = role => page.evaluate(async r => {
        const D = window.ACDebug;
        D.netSetTimeout(900000);
        D.goHome();
        D.netFakeConnect(r);
        D.previewPick(D.LOCAL_SIDE, 'Kaelen');
        D.confirmPick(D.LOCAL_SIDE);
        const foe = D.LOCAL_SIDE === 'p1' ? 'p2' : 'p1';
        D.netFeed({ t: 'PICK', side: foe, name: 'Lyra', stage: 'confirmed' });
        if (r === 'host') {
            D.selectedMap = D.MAPS[0].name;
            D.startOnline();
        } else {
            D.netFeed({ t: 'START', p1: 'Kaelen', p2: 'Lyra', map: D.MAPS[0].name, mode: 'classic' });
        }
    }, role);

    const state = () => page.evaluate(() => {
        const D = window.ACDebug;
        const btn = document.getElementById('btn-resume');
        const note = document.getElementById('pause-away-note');
        return {
            gameState: D.gameState,
            awayPaused: D.awayPaused,
            localAway: D.localAway,
            remoteAway: D.remoteAway,
            mayResume: D.mayResumeAway(),
            btnDisabled: !!(btn && btn.disabled),
            note: note && note.style.display !== 'none' ? note.textContent : '',
            sent: D.netDrainOutbox().map(m => m.t),
        };
    });

    // =====================================================================
    section('As the HOST, when the opponent leaves their tab:');
    await intoMatch('host');
    await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    await page.evaluate(() => window.ACDebug.netDrainOutbox());

    await page.evaluate(() => window.ACDebug.netFeed({ t: 'PRESENCE', away: true }));
    let st = await state();
    check('the match pauses', st.gameState === 'PAUSED', JSON.stringify(st));
    check('and it is marked an away-pause, not an ordinary one',
        st.awayPaused === true, JSON.stringify(st));
    check('Resume is refused while they are away', st.mayResume === false && st.btnDisabled,
        JSON.stringify(st));
    check('the screen says who left', /left the game tab/i.test(st.note), st.note);

    section('Pressing Resume anyway does nothing:');
    st = await page.evaluate(() => {
        const D = window.ACDebug;
        D.netDrainOutbox();
        document.getElementById('btn-resume').click();
        D.requestResume();                    // and through the Escape path
        const btn = document.getElementById('btn-resume');
        return {
            gameState: D.gameState, awayPaused: D.awayPaused,
            btnDisabled: !!btn.disabled,
            sent: D.netDrainOutbox().map(m => m.t),
        };
    });
    check('still paused', st.gameState === 'PAUSED' && st.awayPaused === true, JSON.stringify(st));
    check('and no RESUME was broadcast', !st.sent.includes('RESUME'), JSON.stringify(st.sent));

    section('When they come back, it does NOT resume by itself:');
    await page.evaluate(() => window.ACDebug.netFeed({ t: 'PRESENCE', away: false }));
    st = await state();
    check('still paused after they return',
        st.gameState === 'PAUSED' && st.awayPaused === true, JSON.stringify(st));
    check('but now the host may resume', st.mayResume === true && !st.btnDisabled,
        JSON.stringify(st));
    check('and the screen invites it', /resume when you are ready/i.test(st.note), st.note);

    section('The host resumes, and tells the other side:');
    st = await page.evaluate(() => {
        const D = window.ACDebug;
        D.netDrainOutbox();
        D.requestResume();
        return {
            gameState: D.gameState, awayPaused: D.awayPaused,
            sent: D.netDrainOutbox().map(m => m.t),
        };
    });
    check('the match is running again', st.gameState === 'FIGHT', JSON.stringify(st));
    check('the away-pause flag is cleared', st.awayPaused === false, JSON.stringify(st));
    check('a RESUME crossed the wire', st.sent.includes('RESUME'), JSON.stringify(st.sent));

    // =====================================================================
    section('When the LOCAL tab goes away, the peer is told:');
    st = await page.evaluate(() => {
        const D = window.ACDebug;
        D.netDrainOutbox();
        D.setLocalAway(true);
        const out = D.netDrainOutbox();
        return {
            gameState: D.gameState, awayPaused: D.awayPaused, localAway: D.localAway,
            presence: out.filter(m => m.t === 'PRESENCE').map(m => m.away),
        };
    });
    check('leaving pauses locally too', st.gameState === 'PAUSED' && st.awayPaused, JSON.stringify(st));
    check('a PRESENCE away:true is sent', st.presence.includes(true), JSON.stringify(st.presence));

    st = await page.evaluate(() => {
        const D = window.ACDebug;
        D.netDrainOutbox();
        D.setLocalAway(false);
        const out = D.netDrainOutbox();
        return {
            gameState: D.gameState, awayPaused: D.awayPaused,
            mayResume: D.mayResumeAway(),
            presence: out.filter(m => m.t === 'PRESENCE').map(m => m.away),
        };
    });
    check('coming back announces it', st.presence.includes(false), JSON.stringify(st.presence));
    check('but does NOT resume on its own - the whole point of the gate',
        st.gameState === 'PAUSED' && st.awayPaused === true, JSON.stringify(st));
    check('the host may now resume', st.mayResume === true, JSON.stringify(st));

    // =====================================================================
    section('As the JOINER: you may never lift an away-pause:');
    await intoMatch('joiner');
    await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    st = await page.evaluate(() => {
        const D = window.ACDebug;
        D.netFeed({ t: 'PRESENCE', away: true });   // host left
        D.netFeed({ t: 'PRESENCE', away: false });  // host back
        D.netDrainOutbox();
        D.requestResume();                           // the guest tries anyway
        const btn = document.getElementById('btn-resume');
        const note = document.getElementById('pause-away-note');
        return {
            isHost: D.netIsHost(), gameState: D.gameState, awayPaused: D.awayPaused,
            mayResume: D.mayResumeAway(), btnDisabled: !!btn.disabled,
            note: note.textContent,
            sent: D.netDrainOutbox().map(m => m.t),
        };
    });
    check('the joiner is not the host', st.isHost === false, JSON.stringify(st));
    check('and cannot resume even with both players present',
        st.gameState === 'PAUSED' && st.awayPaused === true && st.mayResume === false,
        JSON.stringify(st));
    check('it says it is waiting for the host', /waiting for/i.test(st.note), st.note);
    check('and it broadcasts nothing', !st.sent.includes('RESUME'), JSON.stringify(st.sent));

    section('The host RESUME lifts it on the joiner:');
    st = await page.evaluate(() => {
        const D = window.ACDebug;
        D.netFeed({ t: 'RESUME' });
        return { gameState: D.gameState, awayPaused: D.awayPaused };
    });
    check('the joiner resumes on the host\'s word',
        st.gameState === 'FIGHT' && st.awayPaused === false, JSON.stringify(st));

    // =====================================================================
    section('An opponent\'s absence does not outlive their connection:');
    st = await page.evaluate(() => {
        const D = window.ACDebug;
        D.netFeed({ t: 'PRESENCE', away: true });
        const during = { remoteAway: D.remoteAway, awayPaused: D.awayPaused };
        D.netTeardown('gone');
        return { during, after: { remoteAway: D.remoteAway, awayPaused: D.awayPaused } };
    });
    check('their absence is recorded while connected',
        st.during.remoteAway === true, JSON.stringify(st.during));
    check('and cleared on teardown, so the next match is not born paused',
        st.after.remoteAway === false && st.after.awayPaused === false,
        JSON.stringify(st.after));

    section('An ordinary Escape pause is still yours to undo:');
    st = await page.evaluate(() => {
        const D = window.ACDebug;
        D.goHome();
        D.netFakeConnect('joiner');          // a GUEST, to prove it is not host-gated
        D.netSetTimeout(900000);
        D.previewPick('p2', 'Kaelen'); D.confirmPick('p2');
        D.netFeed({ t: 'PICK', side: 'p1', name: 'Lyra', stage: 'confirmed' });
        D.netFeed({ t: 'START', p1: 'Lyra', p2: 'Kaelen', map: D.MAPS[0].name, mode: 'classic' });
        return { state: D.gameState };
    });
    await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    st = await page.evaluate(() => {
        const D = window.ACDebug;
        D.togglePause();
        const paused = { gameState: D.gameState, awayPaused: D.awayPaused };
        D.requestResume();
        return { paused, after: D.gameState };
    });
    check('a manual pause is not an away-pause',
        st.paused.gameState === 'PAUSED' && st.paused.awayPaused === false,
        JSON.stringify(st.paused));
    check('and a guest can lift their own manual pause', st.after === 'FIGHT', st.after);

    await finish(browser, page);
})();
