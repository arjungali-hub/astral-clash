// Batch 42: the co-op modes work online, with the HOST owning the enemies.
//
// Batch 34 excluded these modes because two clients each running their own boss
// AI diverge on the first frame. That reason was sound, so these assertions are
// about what makes it safe now: exactly one machine simulates the enemies, and
// the other never touches them.
//
// The nastiest bug this catches was really there. The damage authority gate
// reasons in p1/p2 sides, and a boss is neither - so a local player hitting the
// boss sent a plain HIT, which the OPPONENT applies to THEMSELVES. Hitting the
// boss damaged your teammate.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true });
    // Forwards args: intoCoop passes [role, mode], and a helper that quietly
    // dropped them made the destructuring receive undefined.
    const D = (fn, args) => (args === undefined ? page.evaluate(fn) : page.evaluate(fn, args));

    section('The co-op modes are offered online again:');
    const modes = await D(() => ({
        ids: window.ACDebug.onlineModes(),
        all: window.ACDebug.MATCH_MODES.map(m => m.id),
    }));
    check('Boss Fight is available', modes.ids.includes('boss'), JSON.stringify(modes.ids));
    check('Survival Waves is available', modes.ids.includes('survival'), JSON.stringify(modes.ids));
    check('and nothing was dropped', modes.ids.length === modes.all.length, JSON.stringify(modes));

    const intoCoop = (role, mode) => D(([r, m]) => {
        const A = window.ACDebug;
        A.netSetTimeout(900000);
        A.goHome();
        A.netFakeConnect(r);
        A.setMatchMode(m);
        const me = A.LOCAL_SIDE, foe = me === 'p1' ? 'p2' : 'p1';
        A.previewPick(me, 'Kaelen'); A.confirmPick(me);
        A.netFeed({ t: 'PICK', side: foe, name: 'Lyra', stage: 'confirmed' });
        if (r === 'host') { A.selectedMap = A.MAPS[0].name; A.startOnline(); }
        else A.netFeed({ t: 'START', p1: 'Kaelen', p2: 'Lyra', map: A.MAPS[0].name, mode: m });
    }, [role, mode]);

    // ------------------------------------------------------------- as HOST
    section('As the HOST of a Boss Fight:');
    await intoCoop('host', 'boss');
    await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 120000);
    await H.sleep(600);
    let st = await D(() => {
        const A = window.ACDebug;
        A.netDrainOutbox();
        A.netBroadcastCoopSpawn();
        A.netBroadcastCoopState();
        const out = A.netDrainOutbox();
        return {
            isHost: A.coopIsHost(), isPuppet: A.coopIsPuppet(),
            enemies: A.coopEnemies.length,
            spawn: out.find(m => m.t === 'COOP_SPAWN') || null,
            state: out.find(m => m.t === 'COOP_STATE') || null,
        };
    });
    check('the host owns the enemies', st.isHost === true && st.isPuppet === false, JSON.stringify(st));
    check('a boss was spawned', st.enemies >= 1, JSON.stringify(st));
    check('it broadcasts what it spawned, with names and scaled hp',
        !!st.spawn && st.spawn.enemies.length === st.enemies
        && st.spawn.enemies.every(e => e.n && e.hp > 0), JSON.stringify(st.spawn));
    check('and broadcasts their position and hp',
        !!st.state && st.state.e.length === st.enemies
        && st.state.e.every(e => typeof e.x === 'number' && typeof e.hp === 'number'),
        JSON.stringify(st.state));

    section('Hitting the boss as the host does NOT send a plain HIT:');
    st = await D(() => {
        const A = window.ACDebug;
        const boss = A.coopEnemies[0];
        const before = boss.hp;
        A.netDrainOutbox();
        boss.takeDamage(40, A.player1, null);
        return { before, after: boss.hp, sent: A.netDrainOutbox().map(m => m.t) };
    });
    check('the host resolves it locally', st.after < st.before, JSON.stringify(st));
    check('and sends no HIT - that would damage the teammate',
        !st.sent.includes('HIT'), JSON.stringify(st.sent));

    // ------------------------------------------------------------ as GUEST
    section('As the GUEST: it never simulates the enemies:');
    await intoCoop('joiner', 'boss');
    await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 120000);
    await H.sleep(400);
    st = await D(() => {
        const A = window.ACDebug;
        const beforeSpawn = A.coopEnemies.length;   // a guest waits to be told
        A.netFeed({ t: 'COOP_SPAWN', wave: 0, boss: true, enemies: [
            { n: 'Karrigos', x: 800, y: 480, w: 96, hp: 3000, dmg: 22, tm: 1.2 },
        ] });
        const e = A.coopEnemies[0];
        return {
            isHost: A.coopIsHost(), isPuppet: A.coopIsPuppet(),
            beforeSpawn, afterSpawn: A.coopEnemies.length,
            name: e && e.name, hp: e && e.hp, width: e && e.width,
        };
    });
    check('the guest is a puppet for enemies', st.isPuppet === true && st.isHost === false,
        JSON.stringify(st));
    check('it had no enemies of its own', st.beforeSpawn === 0, JSON.stringify(st));
    check('COOP_SPAWN builds exactly what the host made',
        st.afterSpawn === 1 && st.name === 'Karrigos' && st.hp === 3000 && st.width === 96,
        JSON.stringify(st));

    section('COOP_STATE drives the guest enemies:');
    st = await D(() => {
        const A = window.ACDebug;
        const e = A.coopEnemies[0];
        const before = { x: e.x, hp: e.hp };
        A.netFeed({ t: 'COOP_STATE', e: [{ x: 1000, y: 500, z: 0, fx: -1, fy: 0, hp: 1500, a: 1 }] });
        return { before, after: { x: e.x, hp: e.hp, fx: e.fx } };
    });
    check('position follows the wire', st.after.x === 1000, JSON.stringify(st));
    check('hp snaps rather than easing - a boss bar must not lie',
        st.after.hp === 1500, JSON.stringify(st));

    section('A guest hit on an enemy is attacker-authoritative:');
    st = await D(() => {
        const A = window.ACDebug;
        const e = A.coopEnemies[0];
        A.netDrainOutbox();
        const before = e.hp;
        e.takeDamage(75, A.player2, null);     // p2 is the guest fighter
        const out = A.netDrainOutbox();
        return { before, after: e.hp, hit: out.find(m => m.t === 'HIT_ENEMY'),
                 sentTypes: out.map(m => m.t) };
    });
    check('it sends HIT_ENEMY, naming which enemy',
        !!st.hit && st.hit.i === 0 && st.hit.dmg === 75, JSON.stringify(st));
    check('it never sends a plain HIT for an enemy',
        !st.sentTypes.includes('HIT'), JSON.stringify(st.sentTypes));
    check('and it shows the damage immediately rather than a frame late',
        st.after < st.before, JSON.stringify(st));

    section('Environmental damage on an enemy belongs to the host:');
    st = await D(() => {
        const A = window.ACDebug;
        const e = A.coopEnemies[0];
        const before = e.hp;
        e.takeDamage(30, null, null);     // no attacker: crush, burn, etc
        return { before, after: e.hp };
    });
    check('the guest ignores it - the host owns that enemy',
        st.after === st.before, JSON.stringify(st));

    await finish(browser, page);
})();
