// Batch 27 checker: the Arena Collapse crush cinematic.
//
// Every assertion here is about a thing that was broken in a first pass and is
// invisible to a "nothing threw" check: one shared pair of slabs sitting at the
// arena centre while the fighters stood metres away; the arena floor collapsing
// to nothing so the shot was two figures against empty sky; and a squash that
// drove the body to 12% width and 175% height, which reads as rubber.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    const page = await H.newPage(browser);
    const { check, section, finish } = H.makeChecker();
    await H.boot(page, { clearStorage: true, models: true });

    // Start a normal Classic match, then jump to the crush.
    await page.evaluate(() => {
        const pick = (s, i) => {
            document.querySelectorAll(`#${s}-grid .fighter-btn`)[i].click();
            document.querySelector(`#${s}-detail .btn-confirm`).click();
        };
        pick('p1', 0); pick('p2', 1);
    });
    await H.sleep(400);
    await page.evaluate(() => document.querySelectorAll('#mapselect-grid .map-card')[0].click());
    await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 40000);

    section('Before the crush, both players are in first person:');
    const before = await page.evaluate(() => {
        const D = window.ACDebug;
        return {
            crushing: D.crushing,
            p1SeesOwnBody: (D.camP1.layers.mask & (1 << 1)) !== 0,
            p2SeesOwnBody: (D.camP2.layers.mask & (1 << 2)) !== 0,
            rigs: !!D.crushRigs,
        };
    });
    check('not crushing yet', before.crushing === false);
    check('neither camera renders its own body', !before.p1SeesOwnBody && !before.p2SeesOwnBody,
        JSON.stringify(before));
    check('no crush slabs exist', before.rigs === false);

    section('The crush leaves first person, per the request:');
    await page.evaluate(() => window.ACDebug.forceCrush(0));
    await H.sleep(700);
    const during = await page.evaluate(() => {
        const D = window.ACDebug, T = window.THREE;
        const rigs = D.crushRigs;
        const info = {};
        for (const k of ['p1', 'p2']) {
            const g = rigs[k];
            const f = k === 'p1' ? D.player1 : D.player2;
            g.updateMatrixWorld(true);
            const slabs = g.children.filter(c => c.userData.sign !== undefined);
            const stage = g.children.find(c => c.userData.sign === undefined && !c.userData.back);
            // Slabs must straddle THIS fighter, not the arena centre.
            const fx = f.x + f.width / 2 - D.ARENA_CX;
            const fz = f.y + f.height / 2 - D.ARENA_CY;
            info[k] = {
                slabCount: slabs.length,
                hasBackWall: g.children.some(c => c.userData.back),
                hasStage: !!stage,
                rigX: +g.position.x.toFixed(1), rigZ: +g.position.z.toFixed(1),
                fighterX: +fx.toFixed(1), fighterZ: +fz.toFixed(1),
                slabSigns: slabs.map(sl => Math.sign(sl.position.x)).sort(),
                layer: slabs[0].layers.mask,
            };
        }
        return {
            crushing: D.crushing,
            p1SeesOwnBody: (D.camP1.layers.mask & (1 << 1)) !== 0,
            p2SeesOwnBody: (D.camP2.layers.mask & (1 << 2)) !== 0,
            p1SeesOther: (D.camP1.layers.mask & (1 << 2)) !== 0,
            p2SeesOther: (D.camP2.layers.mask & (1 << 1)) !== 0,
            p1Yaw: +D.player1.mesh.rotation.y.toFixed(4),
            p2Yaw: +D.player2.mesh.rotation.y.toFixed(4),
            p1VmHidden: D.vmP1 ? !D.vmP1.visible : null,
            info,
        };
    });
    check('crush is active', during.crushing === true);
    check('each camera now renders its OWN fighter (third person)',
        during.p1SeesOwnBody && during.p2SeesOwnBody, JSON.stringify({
            p1: during.p1SeesOwnBody, p2: during.p2SeesOwnBody }));
    // Each half must show ONE fighter. Without hiding the opponent's layer both
    // appear in both halves, one behind the other.
    check('each half hides the OTHER fighter',
        !during.p1SeesOther && !during.p2SeesOther,
        JSON.stringify({ p1SeesOther: during.p1SeesOther, p2SeesOther: during.p2SeesOther }));
    check('both fighters are turned to face the camera',
        Math.abs(during.p1Yaw + Math.PI / 2) < 0.01 && Math.abs(during.p2Yaw + Math.PI / 2) < 0.01,
        JSON.stringify({ p1: during.p1Yaw, p2: during.p2Yaw }));
    check('the first-person weapon viewmodel is hidden', during.p1VmHidden === true);

    section('Each fighter has their own walls, centred on them:');
    for (const k of ['p1', 'p2']) {
        const i = during.info[k];
        check(`${k}: two slabs, a stage floor and a back wall`,
            i.slabCount === 2 && i.hasStage && i.hasBackWall, JSON.stringify(i));
        // This is the bug the first pass had: the rig must track the FIGHTER.
        check(`${k}: walls are positioned on the fighter, not the arena centre`,
            Math.abs(i.rigX - i.fighterX) < 2 && Math.abs(i.rigZ - i.fighterZ) < 2,
            `rig(${i.rigX},${i.rigZ}) vs fighter(${i.fighterX},${i.fighterZ})`);
        check(`${k}: one slab each side`, JSON.stringify(i.slabSigns) === '[-1,1]',
            JSON.stringify(i.slabSigns));
    }
    // Private per-player layers are what makes a per-fighter shot possible at all.
    check('p1 and p2 slabs are on different render layers',
        during.info.p1.layer !== during.info.p2.layer,
        `${during.info.p1.layer} vs ${during.info.p2.layer}`);

    section('The walls actually close, and the squash stays believable:');
    const seq = await page.evaluate(async () => {
        const D = window.ACDebug;
        const out = [];
        for (const t of [0, 60, 120, 200]) {
            D.forceCrush(t);
            // Read the gap BEFORE yielding: crushGap() is a pure function of
            // crushTime, and the running game loop advances crushTime by a few
            // frames during an awaited rAF - which is why an earlier version of
            // this test saw 214 where it expected 230.
            const gap = +D.crushGap().toFixed(1);
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            out.push({ t, gap, scale: D.player1.mesh.scale.toArray().map(n => +n.toFixed(3)) });
        }
        return { out, start: D.CRUSH_GAP_START, end: D.CRUSH_GAP_END };
    });
    const gaps = seq.out.map(o => o.gap);
    check('the gap narrows monotonically', gaps.every((g, i) => i === 0 || g <= gaps[i - 1]),
        JSON.stringify(gaps));
    check('it starts wide and ends at the stop distance',
        Math.abs(gaps[0] - seq.start) < 1 && Math.abs(gaps[gaps.length - 1] - seq.end) < 1,
        `${gaps[0]} -> ${gaps[gaps.length - 1]} (expected ${seq.start} -> ${seq.end})`);
    check('the walls stop wider than they are apart at the start', seq.end < seq.start);
    // The retune: mild compression, not a needle.
    const last = seq.out[seq.out.length - 1].scale;
    check('the body compresses but is not turned into a needle',
        last[0] > 0.6 && last[0] < 0.85 && last[1] > 1.0 && last[1] < 1.3 && last[2] > 0.85,
        `final scale ${JSON.stringify(last)}`);

    section('Leaving the crush restores first person:');
    // Use the REAL exit the player takes. This found a genuine leak: both menu
    // exits disposed the boss and zone ring but left the crush running, so the
    // slabs stayed in the scene and both cameras stayed in third person with
    // the weapon viewmodels hidden.
    await page.evaluate(() => window.ACDebug.forceCrush(120));
    await H.sleep(400);
    await page.evaluate(() => {
        const btn = document.getElementById('btn-pause-menu') || document.getElementById('btn-play-again');
        if (btn) btn.click();
    });
    await H.sleep(400);
    const after = await page.evaluate(() => {
        const D = window.ACDebug;
        return {
            rigs: !!D.crushRigs, crushing: D.crushing,
            p1SeesOwnBody: (D.camP1.layers.mask & (1 << 1)) !== 0,
            vmVisible: D.vmP1 ? D.vmP1.visible : null,
        };
    });
    check('leaving to the menu clears the crush', after.crushing === false, JSON.stringify(after));
    check('leaving to the menu disposes the slabs', after.rigs === false, JSON.stringify(after));
    check('leaving to the menu restores first person',
        after.p1SeesOwnBody === false && after.vmVisible === true, JSON.stringify(after));

    await page.evaluate(() => localStorage.clear());
    await finish(browser, page);
})();
