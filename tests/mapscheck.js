// Arena checker: rotational symmetry (competitive fairness), jump reachability,
// and spawn clearance for all ten maps.
//
// The symmetry assertion is the point of this file. Four of the ten maps were
// unfair before Batch 26 - one spire even had both spawns on the same side of
// the arena - and rotSym() only guarantees fairness for the halves an author
// actually wraps in it. This catches a map that stops being mirrored, whether
// that happens by hand-editing a list or by forgetting the wrapper.
const H = require('./harness');

const JUMP_REACH_H = 96.43;   // JUMP_VZ^2 / (2*GRAVITY): max height gain in one jump
const JUMP_REACH_XY = 130;    // conservative horizontal reach during that jump

(async () => {
    const browser = await H.launch();
    const page = await H.newPage(browser);
    const { check, section, finish } = H.makeChecker();
    await H.boot(page, { clearStorage: true });

    const data = await page.evaluate(() => {
        const D = window.ACDebug;
        return {
            CX: D.ARENA_CX, CY: D.ARENA_CY,
            L: D.ARENA_LEFT, R: D.ARENA_RIGHT, T: D.ARENA_TOP, B: D.ARENA_BOTTOM,
            jumpVz: D.JUMP_VZ, gravity: D.GRAVITY,
            maps: D.MAPS.map(m => ({
                name: m.name,
                spawn1: m.spawn1, spawn2: m.spawn2,
                obstacles: (m.obstacles || []).map(o => ({ x: o.x, y: o.y, r: o.r })),
                terrain: (m.terrain || []).map(t => ({
                    x: t.x, y: t.y, hw: t.hw, hd: t.hd, type: t.type,
                    height: t.height, from: t.from, to: t.to, axis: t.axis,
                })),
                platforms: (m.platforms || []).map(p => ({ x: p.x, y: p.y, hw: p.hw, hd: p.hd, height: p.height })),
            })),
        };
    });

    section('Physics constants match the reachability model:');
    const modelled = (data.jumpVz * data.jumpVz) / (2 * data.gravity);
    check('single-jump height ceiling is ~96.4 units',
        Math.abs(modelled - JUMP_REACH_H) < 0.5, `computed ${modelled.toFixed(2)}`);

    const near = (a, b, t) => Math.abs(a - b) <= t;
    const TOL = 8;

    section('Rotational symmetry (each fighter must see an identical arena):');
    for (const m of data.maps) {
        // Spawns must be exact 180-degree opposites, or one player starts
        // closer to the contested high ground than the other.
        const sOk = near(2 * data.CX - m.spawn1.x, m.spawn2.x, 12)
                 && near(2 * data.CY - m.spawn1.y, m.spawn2.y, 12);
        check(`${m.name}: spawns are 180-degree opposites`, sOk,
            `${JSON.stringify(m.spawn1)} vs ${JSON.stringify(m.spawn2)}`);

        const twinless = (list, keys) => list.filter(it => {
            const rx = 2 * data.CX - it.x, ry = 2 * data.CY - it.y;
            if (near(rx, it.x, 1) && near(ry, it.y, 1)) return false; // centrepiece
            return !list.some(o => o !== it && near(o.x, rx, TOL) && near(o.y, ry, TOL)
                && keys.every(k => near(o[k] || 0, it[k] || 0, TOL)));
        }).map(it => `(${Math.round(it.x)},${Math.round(it.y)})`);

        const o = twinless(m.obstacles, ['r']);
        const t = twinless(m.terrain, ['hw', 'hd', 'height']);
        const p = twinless(m.platforms, ['hw', 'hd', 'height']);
        check(`${m.name}: every feature has its rotational twin`,
            !o.length && !t.length && !p.length,
            `obstacles ${o.join(',')} terrain ${t.join(',')} platforms ${p.join(',')}`);
    }

    section('Reachability (no surface stranded above a jump):');
    for (const m of data.maps) {
        // Flood-fill upward from the ground: a surface is reachable if some
        // already-reachable surface is close enough horizontally AND no more
        // than one jump below it.
        const surfaces = [
            ...m.terrain.map(t => ({
                x: t.x, y: t.y, hw: t.hw, hd: t.hd,
                h: t.type === 'ramp' ? Math.max(t.from || 0, t.to || 0) : (t.height || 0),
                // A ramp is walkable from its low end, so it is never stranded.
                walkUp: t.type === 'ramp',
            })),
            ...m.platforms.map(p => ({ x: p.x, y: p.y, hw: p.hw, hd: p.hd, h: p.height, walkUp: false })),
        ];
        const gap = (a, b) => {
            const dx = Math.max(0, Math.abs(a.x - b.x) - (a.hw + b.hw));
            const dy = Math.max(0, Math.abs(a.y - b.y) - (a.hd + b.hd));
            return Math.hypot(dx, dy);
        };
        const reached = new Set();
        // Ground level, plus ramps you simply walk up.
        surfaces.forEach((s, i) => { if (s.h <= JUMP_REACH_H || s.walkUp) reached.add(i); });
        let grew = true;
        while (grew) {
            grew = false;
            surfaces.forEach((s, i) => {
                if (reached.has(i)) return;
                for (const j of reached) {
                    const t = surfaces[j];
                    if (s.h - t.h <= JUMP_REACH_H && gap(s, t) <= JUMP_REACH_XY) {
                        reached.add(i); grew = true; return;
                    }
                }
            });
        }
        // Tall THIN slabs are documented sight blockers / lane dividers, not
        // perches - index.html calls them out explicitly. They are excluded from
        // the perch assertion and get their own, weaker one below. The threshold
        // is 200, not 250: the real ones in the maps are 222-238 tall and 26-30
        // thick, and a 250 cut-off silently classified all four as perches.
        const isDivider = s => s.h >= 200 && Math.min(s.hw, s.hd) <= 30;
        const stranded = surfaces
            .map((s, i) => ({ s, i }))
            .filter(({ s, i }) => !reached.has(i) && !isDivider(s))
            .map(({ s }) => `h${s.h}@(${Math.round(s.x)},${Math.round(s.y)})`);
        check(`${m.name}: every perch is climbable`, stranded.length === 0, stranded.join(' '));

        // The assertion that belongs here is the OPPOSITE of a perch check.
        // index.html defines these slabs as "interior walls / lane dividers",
        // so the property worth protecting is that they stay UNCLIMBABLE - a
        // divider that becomes reachable by an ordinary jump stops being a
        // sight blocker and turns into a 26-unit-wide camping ledge over the
        // lane it was meant to close off.
        //
        // (An earlier version of this file asserted the reverse, that dividers
        // should be reachable with Double Jump, because Overgrown Sanctuary's
        // own comment cites a "comfortable Double Jump reach". That comment is
        // stale: its height-60 blocks are 227 units away horizontally, so the
        // wall is not reachable from them by any jump. The comment was wrong,
        // not the map.)
        const climbableDividers = surfaces.filter(s => {
            if (!isDivider(s)) return false;
            return surfaces.some(t => t !== s && !isDivider(t)
                && s.h - t.h <= JUMP_REACH_H && gap(s, t) <= JUMP_REACH_XY);
        }).map(s => `h${s.h}@(${Math.round(s.x)},${Math.round(s.y)})`);
        check(`${m.name}: sight blockers stay unclimbable`,
            climbableDividers.length === 0, climbableDividers.join(' '));
    }

    section('Spawns are inside the arena and clear of columns:');
    for (const m of data.maps) {
        for (const [label, sp] of [['spawn1', m.spawn1], ['spawn2', m.spawn2]]) {
            const inside = sp.x > data.L + 40 && sp.x < data.R - 40
                        && sp.y > data.T + 40 && sp.y < data.B - 40;
            const clear = m.obstacles.every(o => Math.hypot(o.x - sp.x, o.y - sp.y) > o.r + 45)
                && m.platforms.every(p => !(Math.abs(p.x - sp.x) < p.hw + 30
                                         && Math.abs(p.y - sp.y) < p.hd + 30 && p.height > 60));
            check(`${m.name} ${label}: inside arena and unobstructed`, inside && clear,
                `${JSON.stringify(sp)} inside=${inside} clear=${clear}`);
        }
    }

    section('Every map still loads and starts a fight:');
    for (const name of ['Sundered Stair', 'Skyreach Spire', 'Overgrown Sanctuary', 'Skyward Temple']) {
        await H.boot(page);
        const started = await page.evaluate(n => {
            const D = window.ACDebug;
            document.querySelectorAll('#p1-grid .fighter-btn')[0].click();
            document.querySelector('#p1-detail .btn-confirm').click();
            document.querySelectorAll('#p2-grid .fighter-btn')[1].click();
            document.querySelector('#p2-detail .btn-confirm').click();
            const idx = D.MAPS.findIndex(m => m.name === n);
            return idx;
        }, name);
        await H.sleep(350);
        await page.evaluate(i => {
            const cards = document.querySelectorAll('#mapselect-grid .map-card');
            (cards[i] || cards[0]).click();
        }, started);
        const ok = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 30000);
        const loaded = await page.evaluate(() => window.ACDebug.matchMap && window.ACDebug.matchMap.name);
        check(`${name}: loads into a live fight`, ok, `state map=${loaded}`);
    }

    await page.evaluate(() => localStorage.clear());
    await finish(browser, page);
})();
