// EVERY ARENA HAS 180-DEGREE ROTATIONAL SYMMETRY.
//
// Reported: "in skyward temple, on one side there is a ramp and on the other
// side there are stairs, and while this doesn't matter for playing the game, it
// matters for looks. The arenas should all have perfect 180 degree rotational
// symmetry, so that both players have the exact same situation for every map."
//
// It is a property of the map DATA, so it can be asserted rather than looked
// at: rotate every piece of geometry 180 degrees about the arena centre and it
// must land on another piece of the same kind and size. That also makes it
// fair, not only tidy - whatever cover one spawn has, the other has the same.
const H = require('./harness');

// Two pieces match if their rotated position is within this many units and
// their dimensions agree. Positions are authored by hand, so exact equality
// would fail on rounding that nobody can see.
const POS_TOL = 1.5;
const DIM_TOL = 1.0;

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true });

    const report = await page.evaluate((tol) => {
        const D = window.ACDebug;
        const [POS_TOL, DIM_TOL] = tol;
        // The arena's centre of rotation, from the same constants the arena is
        // built with.
        const CX = (60 + (1755 - 60)) / 2, CY = (60 + (975 - 60)) / 2;
        const rot = p => ({ x: 2 * CX - p.x, y: 2 * CY - p.y });

        const out = {};
        for (const map of D.MAPS) {
            const problems = [];
            // Each kind is matched against its own kind: a platform must answer
            // a platform, not a pillar that happens to be nearby.
            const kinds = {
                platforms: (map.platforms || []).map(p => ({ x: p.x, y: p.y, a: p.hw, b: p.hd, c: p.h || 0 })),
                terrain: (map.terrain || []).map(p => ({ x: p.x, y: p.y, a: p.hw, b: p.hd, c: p.h || 0 })),
                obstacles: (map.obstacles || []).map(p => ({ x: p.x, y: p.y, a: p.r, b: p.r, c: p.h || 0 })),
                hazards: (map.hazards || []).map(p => ({ x: p.x, y: p.y, a: p.r || p.hw || 0, b: p.r || p.hd || 0, c: 0 })),
            };
            for (const kind of Object.keys(kinds)) {
                const list = kinds[kind];
                for (const item of list) {
                    const want = rot(item);
                    const hit = list.find(o =>
                        Math.abs(o.x - want.x) <= POS_TOL && Math.abs(o.y - want.y) <= POS_TOL
                        && Math.abs(o.a - item.a) <= DIM_TOL && Math.abs(o.b - item.b) <= DIM_TOL
                        && Math.abs(o.c - item.c) <= DIM_TOL);
                    if (!hit) {
                        problems.push(`${kind} at (${Math.round(item.x)},${Math.round(item.y)}) `
                            + `[${item.a}x${item.b}x${item.c}] has nothing at `
                            + `(${Math.round(want.x)},${Math.round(want.y)})`);
                    }
                }
            }
            // The spawns have to be each other's mirror too, or one player
            // starts closer to the middle.
            const s1 = map.spawn1, s2 = map.spawn2;
            if (s1 && s2) {
                const want = rot(s1);
                if (Math.abs(s2.x - want.x) > POS_TOL || Math.abs(s2.y - want.y) > POS_TOL) {
                    problems.push(`spawns are not opposite: (${s1.x},${s1.y}) rotates to `
                        + `(${Math.round(want.x)},${Math.round(want.y)}), but spawn2 is (${s2.x},${s2.y})`);
                }
            }
            out[map.name] = problems;
        }
        return out;
    }, [POS_TOL, DIM_TOL]);

    // ...and the SCENERY, which is where the reported asymmetry actually was.
    // The map data was already symmetric; the decoration placed on top of it
    // was not, because paired spots chose their prop by list index.
    const scenery = await page.evaluate(async (tol) => {
        const D = window.ACDebug;
        const [POS_TOL] = tol;
        const CX = (60 + (1755 - 60)) / 2, CY = (60 + (975 - 60)) / 2;
        const out = {};
        for (const map of D.MAPS) {
            D.loadMap(map);
            await new Promise(r => requestAnimationFrame(() => r()));
            // Every solid prop the arena placed, by position and silhouette.
            const props = [];
            D.mapGroup.traverse(o => {
                if (!o.isMesh || !o.parent || o.parent === D.mapGroup) {
                    // Props are added as groups or meshes directly under
                    // mapGroup; measure whatever sits at that level.
                }
            });
            for (const child of D.mapGroup.children) {
                const b = new THREE.Box3().setFromObject(child);
                if (!isFinite(b.min.x)) continue;
                const c = b.getCenter(new THREE.Vector3());
                const s = b.getSize(new THREE.Vector3());
                // Back into game space, which is what the map is authored in.
                props.push({
                    x: c.x + (60 + 1755 - 60) / 2, y: c.z + (60 + 975 - 60) / 2,
                    w: +s.x.toFixed(1), h: +s.y.toFixed(1), d: +s.z.toFixed(1),
                });
            }
            const problems = [];
            for (const p of props) {
                const wx = 2 * CX - p.x, wy = 2 * CY - p.y;
                const hit = props.find(o => Math.abs(o.x - wx) <= POS_TOL * 4
                    && Math.abs(o.y - wy) <= POS_TOL * 4
                    && Math.abs(o.w - p.w) <= 2.5 && Math.abs(o.h - p.h) <= 2.5);
                if (!hit) problems.push(`prop at (${Math.round(p.x)},${Math.round(p.y)}) [${p.w}x${p.h}]`);
            }
            out[map.name] = { count: props.length, problems: problems.slice(0, 3),
                              bad: problems.length };
        }
        return out;
    }, [POS_TOL, DIM_TOL]);

    section('Every arena reads the same from either spawn:');
    let worst = 0;
    for (const name of Object.keys(report)) {
        const problems = report[name];
        worst = Math.max(worst, problems.length);
        check(`${name}: 180° rotationally symmetric`,
            problems.length === 0, problems.slice(0, 4).join(' | '));
    }

    section('...and so does everything placed on it:');
    for (const name of Object.keys(scenery)) {
        const r = scenery[name];
        check(`${name}: scenery is symmetric too (${r.count} objects)`,
            r.bad === 0, JSON.stringify(r.problems));
    }

    await finish(browser, page);
})();
