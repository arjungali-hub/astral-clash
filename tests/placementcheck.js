// A fighter can never be displaced INTO the scenery.
//
// The last automatable line on the original brief:
//
//     [ ] Teleports and knockback never place a fighter inside a pillar or
//         platform
//
// tests/teleportcheck.js does not answer it - that file measures how a teleport
// LOOKS (the visual lag offset, the camera holding back) and asserts nothing
// about the destination being clear.
//
// Reading the code first, the claim looks structurally true: teleportTo walks
// the distance in 8-unit steps and BREAKS on wouldCollide, then clampToArena.
// So it cannot pass through a pillar or end inside one. That is a good design
// and exactly the reason to test it: a future "optimisation" that replaces the
// walk with a single assignment would silently delete the guarantee, and
// nothing would notice until a fighter was standing inside a rock.
//
// So this fires teleports of every length and direction from a grid of starting
// points, on every map, and asserts the resting position is clear.
//
// The predicate is the fighter's OWN wouldCollide(), not spotBlocked(). They
// disagree, and picking the wrong one would have invented failures: spotBlocked
// counts TERRAIN and PLATFORMS unconditionally - it is the SPAWN rule, which is
// deliberately stricter - while wouldCollide ignores terrain entirely and treats
// a platform as solid only from below. Terrain is the ramps and stairs, so
// asking spotBlocked would have flagged Sundered Stair and Skyward Temple for
// letting a fighter stand on a staircase. Using the game's own collision test
// means the checker cannot disagree with the game about what "inside" means.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true });

    // A live fight is needed for player1 to exist; the arena data is swapped
    // underneath it per map, which is what loadMap already does every round.
    await page.evaluate(() => {
        const D = window.ACDebug;
        D.goHome();
        D.netFakeConnect('host');
        D.previewPick('p1', 'Kaelen'); D.confirmPick('p1');
        D.netFeed({ t: 'PICK', side: 'p2', name: 'Lyra', stage: 'confirmed' });
        D.selectedMap = D.MAPS[0].name;
        D.startOnline();
    });
    // Wait for the FIGHTER, not for gameState === 'FIGHT'. player1 exists from
    // the moment the round is built, while the state is still the drop-in intro
    // - so demanding FIGHT waited 90 seconds and then failed, on a run where the
    // whole sweep underneath it had worked perfectly. The precondition should be
    // the thing actually required.
    const live = await H.waitInPage(page, "!!(window.ACDebug.player1)", 90000);
    check('a fighter exists to displace', live, 'player1 never appeared');

    section('No teleport ends inside the scenery, on any map:');
    // ONE MAP PER EVALUATE. Ten maps and ~10,000 teleports in a single call sat
    // in the page long enough to trip puppeteer's protocol timeout, and the
    // failure arrived as a ProtocolError stack rather than as anything about
    // the game.
    const maps = await page.evaluate(() => window.ACDebug.MAPS.map(m => m.name));
    const results = [];
    for (const name of maps) {
        results.push(await page.evaluate((mapName) => {
            const D = window.ACDebug;
            const f = D.player1;
            D.loadMap(D.MAPS.find(m => m.name === mapName));
            let tried = 0, blocked = 0, worst = null;
            for (let gx = -0.8; gx <= 0.8; gx += 0.4) {
                for (let gy = -0.8; gy <= 0.8; gy += 0.4) {
                    const sx = D.ARENA_CX + gx * (D.ARENA_RIGHT - D.ARENA_CX);
                    const sy = D.ARENA_CY + gy * (D.ARENA_BOTTOM - D.ARENA_CY);
                    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
                        for (const dist of [12, 40, 90, 160, 260]) {
                            f.x = sx; f.y = sy; f.z = 0;
                            f.visOffX = 0; f.visOffY = 0;
                            // Starting inside something is not what is under
                            // test; skip rather than blame the teleport.
                            if (f.wouldCollide(f.x, f.y)) continue;
                            f.teleportTo(Math.cos(a) * dist, Math.sin(a) * dist);
                            tried++;
                            if (f.wouldCollide(f.x, f.y)) {
                                blocked++;
                                if (!worst) worst = { from: [Math.round(sx), Math.round(sy)],
                                                      angle: +a.toFixed(2), dist,
                                                      to: [Math.round(f.x), Math.round(f.y)] };
                            }
                        }
                    }
                }
            }
            return { map: mapName, tried, blocked, worst };
        }, name));
    }

    let total = 0;
    for (const r of results) {
        total += r.tried;
        check(`${r.map}: ${r.tried} teleports, none end inside geometry`,
            r.blocked === 0, JSON.stringify(r));
    }
    check('the sweep actually exercised something', total > 2000, total + ' teleports');

    await page.evaluate(() => localStorage.clear());
    await finish(browser, page);
})();
