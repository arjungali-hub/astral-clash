// EVERY WEAPON IS CARRIED THE SAME WAY, measured rather than looked at.
//
// "Draven's weapon is backwards in first person view." A weapon prop is built
// along its own local +X, grip at the origin, so "which way does it point" is
// the direction that axis lands in camera space - and that is a number.
//
// Measured across the roster when this was reported:
//
//     Kaelen   inboard 0.39   into screen 0.61
//     Nyx              0.38               0.76
//     Thorne           0.60               0.70
//     Voss             0.39               0.61
//     Aurelia          0.44               0.86
//     Draven          -0.32               0.25   <- held vertical, tipped out
//
// Draven was the only weapon pointing OUT of the frame, with its axis 0.91
// straight up. A carry that disagrees with the whole roster is the definition
// of the thing that was reported, so the roster is the assertion.
const H = require('./harness');
const WHO = ['Kaelen', 'Draven', 'Nyx', 'Thorne', 'Voss', 'Aurelia', 'Gorgonok', 'Ignis'];

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true, models: true });

    const out = await page.evaluate(async (names) => {
        const D = window.ACDebug;
        const res = {};
        for (const name of names) {
            await D.ensureCharModel(name);
            const cfg = D.CHAR_MAP[name];
            const f = { name, atkType: cfg.atkType, color: cfg.color, cfg };
            const vm = D.buildViewmodel ? D.buildViewmodel(f, 3) : null;
            if (!vm) { res[name] = { noVm: true }; continue; }
            vm.updateMatrixWorld(true);
            // The prop is the child that is not the arm group: the arm carries
            // userData.fromModel, the prop does not.
            const prop = vm.children.find(c => c.type === 'Group' && !c.userData.fromModel);
            if (!prop) { res[name] = { atkType: cfg.atkType, noProp: true }; continue; }
            prop.updateMatrixWorld(true);
            // Grip = the prop's own origin. Far end = the point of its bounding
            // box furthest from that origin, which for every prop in this game
            // is the business end - they are all built along local +X.
            const grip = new THREE.Vector3().setFromMatrixPosition(prop.matrixWorld);
            const box = new THREE.Box3().setFromObject(prop);
            const corners = [];
            for (const x of [box.min.x, box.max.x]) {
                for (const y of [box.min.y, box.max.y]) {
                    for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
                }
            }
            let far = corners[0], best = -1;
            for (const c of corners) {
                const d = c.distanceTo(grip);
                if (d > best) { best = d; far = c; }
            }
            // THE WEAPON'S OWN AXIS, which is what "pointing" means. Every prop
            // in this game is built along its local +X with the grip at the
            // origin, so transforming that axis into camera space answers the
            // question directly. The bounding box does not: for a hammer the
            // furthest corner is a corner of the HEAD, and its position is
            // dominated by how big the head is rather than by where the haft
            // points.
            const axis = new THREE.Vector3(1, 0, 0)
                .transformDirection(prop.matrixWorld).normalize();
            const r = v => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
            res[name] = {
                atkType: cfg.atkType,
                grip: r(grip), far: r(far),
                // The vector from grip to far end, which is the direction the
                // weapon points. Negative z is into the screen.
                axis: r(axis),
                inboard: +(-axis.x).toFixed(2),      // >0 means across the view
                intoScreen: +(-axis.z).toFixed(2),   // >0 means away from the camera
            };
        }
        return res;
    }, WHO);
    section('Every weapon points across the view and away from the camera:');
    for (const name of Object.keys(out)) {
        const w = out[name];
        if (w.noProp) continue;   // a bare-fisted character has no prop to aim
        // INBOARD: the weapon crosses the frame rather than hanging off its
        // edge. The roster sits between 0.36 and 0.60; anything at or below
        // zero is pointing out of the picture, which is what was reported.
        check(`${name} (${w.atkType}) is carried inboard`,
            w.inboard > 0.2, JSON.stringify(w));
        // INTO THE SCREEN: a weapon aimed back at the camera is the other way
        // of being backwards.
        check(`${name} (${w.atkType}) points away from the camera`,
            w.intoScreen > 0.3, JSON.stringify(w));
    }
    await finish(browser, page);
})();
