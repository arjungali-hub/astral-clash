// Batch 38: mode retiming, the cleared Zone Control centre, ranged health, and
// the step that was a free elevator.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true });
    const D = fn => page.evaluate(fn);

    section('The mode no longer claims to be about time:');
    const modes = await D(() => {
        const M = window.ACDebug.MATCH_MODES;
        const ta = M.find(m => m.id === 'timeattack');
        return { name: ta.name, blurb: ta.blurb, ids: M.map(m => m.id) };
    });
    check('renamed away from "Time"', !/time/i.test(modes.name), modes.name);
    check('and named for what it measures', /takedown/i.test(modes.name), modes.name);
    // The id is a save key and a wire value; renaming it would reset records
    // and desync a mixed-version match.
    check('the id stays `timeattack` so saves and packets keep working',
        modes.ids.includes('timeattack'), JSON.stringify(modes.ids));

    section('The collapse is retimed, and the arithmetic is what was asked for:');
    const timing = await D(() => {
        const A = window.ACDebug;
        return {
            grace: A.GRACE_PERIOD, interval: A.SHRINK_INTERVAL,
            step: A.SHRINK_FRAC_STEP, at: A.CRUSH_AT_FRAC,
        };
    });
    check('the first collapse waits twice as long (20s -> 40s)',
        timing.grace === 40, JSON.stringify(timing));
    check('and the gap between ticks is three times as long (6s -> 18s)',
        timing.interval === 18, JSON.stringify(timing));
    // Derive when the crush actually starts, rather than trusting a comment.
    const crushAt = (() => {
        let frac = 0, t = timing.grace, tick = 0;
        while (frac < timing.at && tick < 100) { frac += timing.step; tick++; if (frac >= timing.at) break; t += timing.interval; }
        return { seconds: t, ticks: tick };
    })();
    check('which puts the walls slamming shut around 2.5 minutes in',
        crushAt.seconds >= 140 && crushAt.seconds <= 160, JSON.stringify(crushAt));

    section('No arena collapse in the Takedown Race:');
    const noCollapse = await D(async () => {
        const A = window.ACDebug;
        A.netSetTimeout(900000); A.goHome(); A.netFakeConnect('host');
        A.setMatchMode('timeattack');
        A.previewPick('p1', 'Kaelen'); A.confirmPick('p1');
        A.netFeed({ t: 'PICK', side: 'p2', name: 'Lyra', stage: 'confirmed' });
        A.selectedMap = A.MAPS[0].name;
        A.startOnline();
        return { mode: A.matchMode };
    });
    await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    const collapsed = await D(() => {
        const A = window.ACDebug;
        // Force the clock well past when Classic Versus would have crushed.
        A.setShrinkTimer(-1);
        for (let i = 0; i < 12; i++) A.syncArenaCollapse(60);
        return { frac: A.shrinkFrac, crushing: A.crushing, mode: A.matchMode };
    });
    check('the bounds never move', collapsed.frac === 0, JSON.stringify(collapsed));
    check('and the crush never starts', collapsed.crushing === false, JSON.stringify(collapsed));

    section('Zone Control clears the ring, other modes keep their centre:');
    const zone = await D(async () => {
        const A = window.ACDebug;
        const countInZone = () => {
            const R = A.ZONE_RADIUS + 30;
            const near = (x, y, reach) => Math.hypot(x - A.ARENA_CX, y - A.ARENA_CY) <= R + (reach || 0);
            return {
                obstacles: A.OBSTACLES.filter(o => near(o.x, o.y, o.r || 0)).length,
                platforms: A.PLATFORMS.filter(p => near(p.x, p.y, Math.hypot(p.hw || 0, p.hd || 0))).length,
                terrain: A.TERRAIN.filter(t => near(t.x, t.y, Math.hypot(t.hw || 0, t.hd || 0))).length,
            };
        };
        const map = A.MAPS.find(m => m.name === 'Voltaic Nexus');
        A.setMatchMode('classic');
        A.loadMap(map);
        const classic = countInZone();
        A.setMatchMode('zone');
        A.loadMap(map);
        const zoned = countInZone();
        A.setMatchMode('classic');
        return { classic, zoned };
    });
    check('Voltaic Nexus normally has geometry in the middle',
        (zone.classic.obstacles + zone.classic.platforms + zone.classic.terrain) > 0,
        JSON.stringify(zone.classic));
    check('Zone Control removes all of it',
        zone.zoned.obstacles === 0 && zone.zoned.platforms === 0 && zone.zoned.terrain === 0,
        JSON.stringify(zone.zoned));
    check('and the map itself is unchanged for other modes',
        (zone.classic.obstacles + zone.classic.platforms + zone.classic.terrain) > 0,
        JSON.stringify(zone.classic));

    section('Ranged fighters trade health for reach:');
    const hp = await D(() => {
        const A = window.ACDebug;
        const ranged = ['shard', 'orb', 'bolt'];
        const rows = A.CHARACTERS.map(c => ({ name: c.name, hp: c.hp, ranged: ranged.includes(c.atkType) }));
        const r = rows.filter(x => x.ranged), m = rows.filter(x => !x.ranged);
        return {
            ranged: r, rangedMax: Math.max(...r.map(x => x.hp)),
            meleeMin: Math.min(...m.map(x => x.hp)),
        };
    });
    check('all three ranged fighters are at or below 280 HP',
        hp.ranged.every(x => x.hp <= 280), JSON.stringify(hp.ranged));
    check('the toughest ranged fighter is now frailer than the frailest melee one',
        hp.rangedMax < hp.meleeMin, JSON.stringify(hp));

    section('A waist-high block blocks you instead of lifting you:');
    const step = await D(() => {
        const A = window.ACDebug;
        return {
            max: A.MAX_WALK_STEP_UP,
            // The step heights the maps actually use.
            heights: [...new Set(A.MAPS.flatMap(m => (m.terrain || []).map(t => t.height)))].sort((a, b) => a - b),
        };
    });
    check('the walkable rise is small enough to exclude a waist-high block',
        step.max < 18, JSON.stringify(step));
    check('but still admits kerbs and ramp lips',
        step.max >= 10, JSON.stringify(step));
    check('so at least one real map step is now a ledge you must jump',
        step.heights.some(h => h > step.max), JSON.stringify(step.heights));

    await finish(browser, page);
})();
