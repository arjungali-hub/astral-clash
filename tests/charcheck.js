// Batch 35: the generated, rigged character roster.
//
// Written against the specific ways this went wrong rather than as a
// formality. Every one of these bugs REPORTED SUCCESS at the time:
//   - three models rigged lying on their side, because "up = longest axis"
//     loses when a T-pose's arm span edges out its height (Ignis 1.90 vs 1.85)
//   - a wrist measured 0.001 units from the spine, because the joint finder
//     clustered signed x and the two arms cancelled out
//   - 100% unweighted vertices (Kaelen, UV-seam duplicates) and later 20 of
//     them (Nyx, robe hem): the mesh stands still while the skeleton walks off
//   - every rigged character scaled to the same height, so a titan and a
//     knee-high scrapling came out identical
//   - all fourteen models fetched at boot: ~29 MB before the menu works
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true });

    section('The roster is registered and NOT fetched at boot:');
    const boot = await page.evaluate(() => {
        const D = window.ACDebug;
        return {
            registered: Object.keys(D.CHAR_MODEL_URLS).length,
            names: Object.keys(D.CHAR_MODEL_URLS),
            loaded: D.charModelsLoaded,
            failed: D.charModelsFailed,
            roster: D.CHARACTERS.map(c => c.name),
        };
    });
    check('all fourteen characters have a model registered',
        boot.registered === 14, boot.registered + ': ' + boot.names.join(','));
    check('every pickable roster character has one',
        boot.roster.every(n => boot.names.includes(n)),
        boot.roster.filter(n => !boot.names.includes(n)).join(','));
    // Fourteen models is ~29 MB. A match needs two.
    check('nothing is downloaded until somebody picks a fighter',
        boot.loaded === 0 && boot.failed === 0, JSON.stringify(boot));

    section('Previewing a fighter warms its model:');
    const warmed = await page.evaluate(async () => {
        const D = window.ACDebug;
        D.netFakeConnect('host');
        D.previewPick('p1', 'Kaelen');
        await D.ensureCharModel('Kaelen');
        return { loaded: D.charModelsLoaded, failed: D.charModelsFailed, has: !!D.charModels['Kaelen'] };
    });
    check('the previewed character loads', warmed.has && warmed.loaded >= 1, JSON.stringify(warmed));
    check('and nothing failed', warmed.failed === 0, JSON.stringify(warmed));

    section('Every model builds a usable rigged fighter:');
    const rows = await page.evaluate(async () => {
        const D = window.ACDebug;
        const out = [];
        for (const name of Object.keys(D.CHAR_MODEL_URLS)) {
            const m = await D.ensureCharModel(name);
            if (!m) { out.push({ name, ok: false, why: 'model failed to load' }); continue; }
            const g = D.buildRiggedCharacter(name);
            if (!g) { out.push({ name, ok: false, why: 'buildRiggedCharacter returned null' }); continue; }
            const box = new THREE.Box3().setFromObject(g);
            const size = box.getSize(new THREE.Vector3());
            // The bones buildRiggedCharacter looks up by hand. A missing arm
            // bone means animateWeapon silently animates nothing.
            out.push({
                name,
                rigged: !!g.userData.rigged,
                armL: !!g.userData.armPos, armR: !!g.userData.armNeg,
                head: !!g.userData.head, torso: !!g.userData.torso,
                clips: m.animations.length,
                h: +size.y.toFixed(1), w: +size.x.toFixed(1), d: +size.z.toFixed(1),
                expected: 50 * (D.RIG_HEIGHT_MULT[name] || 1),
                ok: true,
            });
        }
        return out;
    });
    const bad = rows.filter(r => !r.ok);
    check('every registered model loaded and built', bad.length === 0, JSON.stringify(bad));
    const built = rows.filter(r => r.ok);
    check('each is flagged as rigged', built.every(r => r.rigged),
        JSON.stringify(built.filter(r => !r.rigged).map(r => r.name)));
    check('each exposes both arms, a head and a torso for the animators',
        built.every(r => r.armL && r.armR && r.head && r.torso),
        JSON.stringify(built.filter(r => !(r.armL && r.armR && r.head && r.torso)).map(r => r.name)));
    check('each carries all six baked clips', built.every(r => r.clips >= 6),
        JSON.stringify(built.map(r => [r.name, r.clips]).filter(x => x[1] < 6)));

    section('Nobody is lying down (the orientation bug):');
    // Compare height against the THINNEST and WIDEST horizontal extents rather
    // than against x and z by name. buildRiggedCharacter rotates the model
    // 90 degrees so local +X is forward (render3D maps the 2D facing vector
    // straight onto rotation.y), which SWAPS the x and z extents - so "width"
    // is the body's depth and "depth" is the arm span. Naming them x/z and
    // assuming otherwise made this assertion fail on nine perfectly upright
    // characters.
    //
    // A standing figure is comfortably taller than it is deep, and at least
    // half as tall as its arm span. One rigged on its side fails both.
    const lying = built.filter(r => {
        const thin = Math.min(r.w, r.d), wide = Math.max(r.w, r.d);
        return r.h < thin * 1.5 || r.h < wide * 0.5;
    });
    check('every model stands upright', lying.length === 0,
        JSON.stringify(lying.map(r => [r.name, 'h=' + r.h, 'thin=' + Math.min(r.w, r.d), 'wide=' + Math.max(r.w, r.d)])));

    section('Per-character size is applied (RIG_HEIGHT_MULT):');
    const byName = {};
    built.forEach(r => { byName[r.name] = r; });
    const g = byName['Grint'], k = byName['Kaelen'], K = byName['Karrigos'], s = byName['Slagling'];
    check('a scrapling is clearly shorter than a duelist',
        g && k && g.h < k.h * 0.85, g && k ? `Grint ${g.h} vs Kaelen ${k.h}` : 'missing');
    check('a titan is clearly taller than a duelist',
        K && k && K.h > k.h * 1.25, K && k ? `Karrigos ${K.h} vs Kaelen ${k.h}` : 'missing');
    check('a cinder caster sits between them',
        s && g && k && s.h > g.h && s.h < k.h, s && g && k ? `${g.h} < ${s.h} < ${k.h}` : 'missing');

    section('A real match runs on the generated art:');
    const match = await page.evaluate(async () => {
        const D = window.ACDebug;
        D.netSetTimeout(900000);
        D.goHome();
        D.netFakeConnect('host');
        D.setDebugUnlockAll(true);
        await Promise.all([D.ensureCharModel('Gorgonok'), D.ensureCharModel('Voss')]);
        D.previewPick('p1', 'Gorgonok'); D.confirmPick('p1');
        D.netFeed({ t: 'PICK', side: 'p2', name: 'Voss' });
        D.selectedMap = 'Twin Ramparts';
        D.startOnline();
        return true;
    });
    const reached = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    const live = await page.evaluate(() => {
        const D = window.ACDebug;
        return {
            state: D.gameState,
            p1: D.player1 && { name: D.player1.name, rigged: D.player1.isRigged },
            p2: D.player2 && { name: D.player2.name, rigged: D.player2.isRigged },
        };
    });
    check('the match starts', reached && live.state === 'FIGHT', JSON.stringify(live));
    check('both fighters use the rigged art, not the procedural fallback',
        live.p1 && live.p2 && live.p1.rigged && live.p2.rigged, JSON.stringify(live));

    await page.evaluate(() => localStorage.clear());
    await finish(browser, page);
})();
