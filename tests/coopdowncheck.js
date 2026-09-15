// Co-op: a downed player respawns; only a WIPE ends the run.
//
// Requested as "if one person dies, it shouldn't end. Instead, they should
// respawn after a while (20-30 seconds). If the person who is still alive dies
// before this happens, then the game ends." Both halves of that are assertions
// here, because the interesting failure is the second one: it is easy to write
// a respawn that never lets the run end at all.
//
// The traps this file is shaped around, all of which have bitten before:
//   - dt is REAL elapsed time in frame units and runs ~3 under swiftshader, so
//     "step 1500 frames" cannot be "call the update 1500 times". The timer is
//     driven directly instead, and only the transition is asserted.
//   - a downed fighter must not be healed back to life by Survival's wave
//     clear, which tops both players up.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true });
    const D = (fn, args) => (args === undefined ? page.evaluate(fn) : page.evaluate(fn, args));

    // Starts a real local match, the way smoke.js does: pick on both sides,
    // confirm both, then choose a map. Driving the DOM rather than calling
    // startMatch() directly is what makes this a test of the game rather than
    // of a debug hook.
    const intoCoop = async (mode) => {
        await H.boot(page);
        await D(m => window.ACDebug.setMatchMode(m), mode);
        await D(() => {
            document.querySelectorAll('#p1-grid .fighter-btn')[0].click();
            document.querySelector('#p1-detail .btn-confirm').click();
            document.querySelectorAll('#p2-grid .fighter-btn')[1].click();
            document.querySelector('#p2-detail .btn-confirm').click();
        });
        await H.sleep(350);
        await D(() => document.querySelectorAll('#mapselect-grid .map-card')[0].click());
        // Models: a co-op mode loads the two fighters plus its enemies, under
        // software WebGL. Budget accordingly - a wait that expires here reports
        // as "the mode is broken", which it is not.
        await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'",
            30000 + (mode === 'survival' ? 4 : 1) * 20000);
        await H.sleep(400);
    };

    section('Constants are in the asked-for range:');
    const consts = await D(() => ({
        frames: window.ACDebug.COOP_RESPAWN_FRAMES,
        frac: window.ACDebug.COOP_RESPAWN_HP_FRAC,
    }));
    check('respawn delay is 20-30 seconds',
        consts.frames >= 20 * 60 && consts.frames <= 30 * 60, JSON.stringify(consts));
    check('and it comes back at full health (asked for explicitly)',
        consts.frac === 1, JSON.stringify(consts));

    section('A Boss Fight KO puts one player DOWN, and the run continues:');
    await intoCoop('boss');
    let st = await D(() => {
        const A = window.ACDebug;
        A.player2.hp = 0;
        A.resolveCoopMode(1);
        return {
            state: A.gameState,
            downed: A.player2.downed, timer: A.player2.respawnTimer,
            p1up: A.player1.hp > 0 && !A.player1.downed,
        };
    });
    check('the run does NOT end', st.state === 'FIGHT', JSON.stringify(st));
    check('the fallen player is downed with a clock running',
        st.downed === true && st.timer > 0, JSON.stringify(st));
    check('their teammate is untouched', st.p1up === true, JSON.stringify(st));

    section('A downed player is out of the fight, not a shield:');
    st = await D(() => {
        const A = window.ACDebug;
        const before = A.player2.hp;
        A.player2.takeDamage(200, A.coopEnemies[0], null);
        const acted = (() => {
            // Input is gated for a downed fighter: a movement key must not move it.
            const x0 = A.player2.x;
            A.player2.update(A.player1, 1);
            return A.player2.x !== x0;
        })();
        return { before, after: A.player2.hp, moved: acted, timer: A.player2.respawnTimer };
    });
    check('it takes no further damage', st.after === st.before, JSON.stringify(st));
    check('and does not act', st.moved === false, JSON.stringify(st));

    section('The clock brings them back, at full health:');
    st = await D(() => {
        const A = window.ACDebug;
        A.player2.respawnTimer = 1;
        A.resolveCoopMode(2);          // enough dt to expire it
        return {
            state: A.gameState, downed: A.player2.downed,
            hp: A.player2.hp, maxHp: A.player2.maxHp,
            invuln: A.player2.invulnFrames,
            atSpawn: Math.abs(A.player2.x - A.matchMap.spawn2.x) < 1,
        };
    });
    check('they are up again', st.downed === false && st.hp > 0, JSON.stringify(st));
    check('at COOP_RESPAWN_HP_FRAC of their bar - currently the whole thing',
        Math.abs(st.hp / st.maxHp - consts.frac) < 0.01, JSON.stringify(st));
    check('with spawn i-frames, so the boss cannot camp the return',
        st.invuln > 0, JSON.stringify(st));
    check('back at their own spawn', st.atSpawn === true, JSON.stringify(st));
    check('and the run is still going', st.state === 'FIGHT', JSON.stringify(st));

    section('A wipe DOES end the run:');
    st = await D(() => {
        const A = window.ACDebug;
        A.player1.hp = 0;
        A.player2.hp = 0;
        A.resolveCoopMode(1);
        return { state: A.gameState, text: A.coopResultText || '' };
    });
    check('both down ends the match', st.state === 'GAMEOVER', JSON.stringify(st));
    check('and it says so', /both/i.test(st.text), JSON.stringify(st));

    section('The second player falling while the first is DOWN also ends it:');
    await intoCoop('boss');
    st = await D(() => {
        const A = window.ACDebug;
        A.player2.hp = 0;
        A.resolveCoopMode(1);                 // p2 down, run continues
        const mid = A.gameState;
        A.player1.hp = 0;                     // the survivor falls too
        A.resolveCoopMode(1);
        return { mid, end: A.gameState, p2timer: A.player2.respawnTimer };
    });
    check('still going after the first goes down', st.mid === 'FIGHT', JSON.stringify(st));
    check('over when the survivor falls', st.end === 'GAMEOVER', JSON.stringify(st));

    section('Survival: a wave clear must not heal a downed teammate back to life:');
    await intoCoop('survival');
    st = await D(() => {
        const A = window.ACDebug;
        A.player2.hp = 0;
        A.resolveCoopMode(1);
        // Clear the wave the way the game does, then run the transition.
        A.coopEnemies.forEach(e => { e.hp = 0; });
        A.onBossDefeated();
        return {
            downed: A.player2.downed, hp: A.player2.hp,
            p1healed: A.player1.hp > 0, state: A.gameState,
        };
    });
    check('the downed player stays downed', st.downed === true && st.hp <= 0, JSON.stringify(st));
    check('while their teammate is healed as usual', st.p1healed === true, JSON.stringify(st));

    section('The wire carries the clock, and the owner runs it:');
    st = await D(() => {
        const A = window.ACDebug;
        A.netSetTimeout(900000);
        A.netFakeConnect('host');
        const me = A.localFighter(), them = A.remoteFighter();
        const owns = { mine: A.coopOwnsRespawn(me), theirs: A.coopOwnsRespawn(them) };
        A.coopDown(me);
        A.netDrainOutbox();
        // netTick rate-limits itself, so it needs a `now` well past the last
        // send or it returns having sent nothing.
        A.netTick(performance.now() + 100000);
        const out = A.netDrainOutbox();
        const state = out.find(m => m.t === 'STATE');
        // And a remote downed state arrives as display-only state.
        A.netFeed({ t: 'STATE', x: them.x, y: them.y, z: them.z, fx: 1, fy: 0,
                    hp: 0, meter: 0, g: true, dn: 900 });
        return { owns, sent: state ? state.dn : null,
                 remoteDowned: them.downed, remoteTimer: them.respawnTimer };
    });
    check('a client owns its own clock and not the other one',
        st.owns.mine === true && st.owns.theirs === false, JSON.stringify(st.owns));
    check('STATE carries the remaining frames', st.sent > 0, JSON.stringify(st));
    check('and an arriving clock is applied to the puppet',
        st.remoteDowned === true && st.remoteTimer === 900, JSON.stringify(st));

    await finish(browser, page);
})();
