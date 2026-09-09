// Batch 34: the photographic arena surfaces.
//
// These assertions exist because every bug this work actually hit was
// invisible to a "nothing threw" test and, in several cases, invisible in a
// single screenshot too:
//   - the albedo swap silently not happening (a 404 resolves to null by design)
//   - aoMap sampling vUv2 with no uv2 attribute, which goes blotchy not black
//   - metalness 1.0 rendering walls near-black for want of a bright environment
//   - a texture clone per mesh per round, which only shows up as a slow leak
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true });

    // Start a real match on a real map. The photographic sets load
    // asynchronously and swap onto live materials, so there is no way to assert
    // this without an arena actually on screen.
    const intoMap = async name => {
        await page.evaluate(n => {
            const D = window.ACDebug;
            D.netSetTimeout(900000);   // the loopback peer never answers; don't let it drop
            D.goHome();
            D.netFakeConnect('host');
            D.previewPick('p1', 'Kaelen'); D.confirmPick('p1');
            D.netFeed({ t: 'PICK', side: 'p2', name: 'Lyra' });
            D.selectedMap = n;
            D.startOnline();
        }, name);
        const ok = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
        if (!ok) throw new Error('never reached FIGHT on ' + name);
        // Let the fetch + decode + swap complete.
        await H.sleep(7000);
    };

    const surfaces = () => page.evaluate(() => {
        const D = window.ACDebug;
        const out = [];
        D.mapGroup.traverse(n => {
            if (!n.material || !n.geometry) return;
            const m = n.material;
            if (!m.map || !m.map.image) return;
            const w = m.map.image.width || 0;
            n.geometry.computeBoundingBox();
            const bb = n.geometry.boundingBox;
            const span = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
            out.push({
                span: Math.round(span),
                photographic: w >= 512,
                hasNormal: !!m.normalMap,
                hasOrm: !!m.aoMap && m.aoMap === m.roughnessMap && m.aoMap === m.metalnessMap,
                uv2: !!n.geometry.attributes.uv2,
                metalness: m.metalness,
                envIntensity: m.envMapIntensity,
                keepMap: !!m.userData.keepMap,
                emissive: !!m.emissiveMap,
                mapEncoding: m.map.encoding,
                normalEncoding: m.normalMap ? m.normalMap.encoding : null,
                ormEncoding: m.aoMap ? m.aoMap.encoding : null,
            });
        });
        return out;
    });

    // =====================================================================
    await intoMap('Voltaic Nexus');
    section('The photographic sets actually reach the arena:');
    let s = await surfaces();
    const big = s.filter(x => x.span >= 200);          // walls, floor, platforms
    check('there are large surfaces to inspect', big.length >= 3, 'found ' + big.length);
    check('every large surface got a photographic albedo, not the 256px canvas',
        big.length > 0 && big.every(x => x.photographic),
        JSON.stringify(big.filter(x => !x.photographic).slice(0, 3)));
    check('each carries a normal map and the packed ORM in all three slots',
        big.every(x => x.hasNormal && x.hasOrm),
        JSON.stringify(big.filter(x => !(x.hasNormal && x.hasOrm)).slice(0, 3)));

    section('The r128 gotchas the plan warned about:');
    // aoMap samples vUv2 in r128 - verified in three.min.js. Without a uv2
    // attribute the AO channel samples garbage and the surface goes blotchy,
    // which is subtle enough to survive a screenshot review.
    check('every surface using the ORM has a uv2 attribute for aoMap',
        big.filter(x => x.hasOrm).every(x => x.uv2),
        JSON.stringify(big.filter(x => x.hasOrm && !x.uv2).slice(0, 3)));
    // Colour is colour; normals and ORM are DATA. Tagging data sRGB
    // gamma-decodes the vectors and flattens the lighting.
    const LINEAR = await page.evaluate(() => THREE.LinearEncoding);
    const SRGB = await page.evaluate(() => THREE.sRGBEncoding);
    check('albedo is sRGB', big.every(x => x.mapEncoding === SRGB),
        JSON.stringify(big.map(x => x.mapEncoding).slice(0, 4)));
    check('normal and ORM are Linear, never sRGB',
        big.every(x => x.normalEncoding === LINEAR && x.ormEncoding === LINEAR),
        JSON.stringify(big.map(x => [x.normalEncoding, x.ormEncoding]).slice(0, 4)));
    // A fully metallic surface has no diffuse term, so with only a dim sky
    // PMREM for an environment it renders near-black. This bit twice.
    check('metalness is capped so the key light can still light a wall',
        big.every(x => x.metalness <= 0.6),
        JSON.stringify(big.map(x => x.metalness).slice(0, 4)));
    check('the environment contribution is lifted above 1',
        big.every(x => x.envIntensity >= 1.2),
        JSON.stringify(big.map(x => x.envIntensity).slice(0, 4)));

    section('Every arena keeps its own identity:');
    check('the accent glow survives as an emissive overlay',
        s.some(x => x.emissive), 'emissive surfaces: ' + s.filter(x => x.emissive).length);
    check('shared textures are protected from disposeObject3D',
        big.every(x => x.keepMap), JSON.stringify(big.filter(x => !x.keepMap).slice(0, 3)));

    // =====================================================================
    // The leak. buildPlatformMesh and buildOuterWall used to clone the wall
    // canvas PER MESH onto a keepMap material, so nothing ever freed them and
    // each loadMap() added a fresh set. A slow leak is invisible to every
    // other assertion here and to any screenshot.
    section('Loading maps repeatedly does not leak textures:');
    const counts = [];
    for (const name of ['Sundered Stair', 'Twin Ramparts', 'Sundered Stair', 'Twin Ramparts']) {
        await intoMap(name);
        counts.push(await page.evaluate(() => window.ACDebug.rendererInfo().textures));
    }
    // The first visit to each theme legitimately adds textures (its sets get
    // fetched). The SECOND visit to a theme already seen must add ~none.
    const firstPass = counts[1], secondPass = counts[3];
    check('revisiting maps reuses cached textures instead of cloning per mesh',
        secondPass - firstPass <= 8, `after 1st pair ${firstPass}, after 2nd pair ${secondPass}`);

    section('The shadow frustum follows the sun per map:');
    const shadow = await page.evaluate(() => {
        const D = window.ACDebug;
        const out = {};
        for (const name of ['Voltaic Nexus', 'Skyreach Spire']) {
            const theme = D.MAP_THEMES ? D.MAP_THEMES[name] : null;
            if (!theme) { out[name] = null; continue; }
            D.applyLighting(theme);
            const c = D.keyLight.shadow.camera;
            out[name] = {
                w: Math.round(c.right - c.left), h: Math.round(c.top - c.bottom),
                near: Math.round(c.near), far: Math.round(c.far),
                sun: theme.sun.pos,
            };
        }
        return out;
    });
    const a = shadow['Voltaic Nexus'], b2 = shadow['Skyreach Spire'];
    check('both maps produced a fitted frustum', !!a && !!b2, JSON.stringify(shadow));
    check('the frustum differs between two differently-lit maps - it is fitted, not fixed',
        !!a && !!b2 && (a.w !== b2.w || a.h !== b2.h || a.near !== b2.near),
        JSON.stringify(shadow));
    check('the frustum covers the whole arena (1755 x 975 plus walls)',
        !!a && a.w >= 1755 && a.h >= 975, JSON.stringify(a));
    check('near is in front of far, and both positive',
        !!a && a.near >= 1 && a.far > a.near, JSON.stringify(a));

    await finish(browser, page);
})();
