// Astral Clash - the weapons, shared by both builds.
//
// Loaded as a plain script by index.html and local/index.html, AFTER three.js
// and before either defines bootGame().
//
// This is the second tier of shared module and the distinction matters:
// shared/roster.js and shared/animation.js load before three.js and may not
// touch THREE. This one loads after it and is made of nothing else.
//
// RULES
//   1. NO DOM, NO RENDERER, NO CLOSURE STATE. A builder here takes numbers and
//      colours and returns a THREE.Group. It does not know which game is
//      asking, what the arena is, or who is holding the result.
//   2. Neither build may re-declare these names - a `const` or `function`
//      inside bootGame() shadows the global and silently restores the drift
//      this file exists to remove. art/sync_local.py checks for exactly that.
//
// WHY: these were being copied from the online build into the local one by
// art/sync_local.py, one anchored edit at a time. The local build spent three
// batches holding a sword by a seven-unit grip that had already been shortened
// online, because a step that copies code is a chance to copy some of it.

// ---- caches ---------------------------------------------------------
const geometryCache = {};
function getCachedGeometry(key, factory) {
    if (!geometryCache[key]) {
        const g = factory();
        g.userData.shared = true;
        geometryCache[key] = g;
    }
    return geometryCache[key];
}
const materialCache = {};
function getCachedMaterial(key, factory) {
    if (!materialCache[key]) {
        const m = factory();
        m.userData.shared = true;
        materialCache[key] = m;
    }
    return materialCache[key];
}

// ---- the two smallest helpers ---------------------------------------
function hexNum(hex) { return parseInt(hex.replace('#', ''), 16); }

function makeMat(hex, opts) {
    const mat = new THREE.MeshStandardMaterial(Object.assign(
        { color: hexNum(hex), roughness: 0.5, metalness: 0.15, transparent: true, opacity: 1 },
        opts || {}
    ));
    mat.userData.origColor = mat.color.clone(); // so i-frames can flash white then restore it
    return mat;
}

// ---- the weapons -----------------------------------------------------
function steelMat(hex) {
    return makeMat(hex || '#cfd8e3', { metalness: 1.0, roughness: 0.17 });
}
function goldMat(hex) {
    return makeMat(hex || '#d4a13a', { metalness: 1.0, roughness: 0.3 });
}
function darkMetalMat(hex) {
    return makeMat(hex || '#2b303b', { metalness: 0.9, roughness: 0.45 });
}
function leatherMat(hex) {
    return makeMat(hex || '#3a2a1c', { metalness: 0.0, roughness: 0.92 });
}
// The glowing edge/energy line. Unlit on purpose: the arenas are bright and
// tone-mapped at exposure 1.1, so an emissive standard material clips to white
// and loses its colour - the lesson the Karrigos ember seams already taught.
function energyMat(hex) {
    return getCachedMaterial('energy:' + hex, () => new THREE.MeshBasicMaterial({ color: hexNum(hex) }));
}
function weaponMat(hex, emissiveHex) {
    return makeMat(hex, { metalness: 0.72, roughness: 0.24, emissive: hexNum(emissiveHex || hex), emissiveIntensity: 0.45 });
}

// Builds a solid with a diamond cross-section along +X, tapering through the
// given sections and closing to a point at the tip.
//   sections: [{ x, w, h }]  w = half-width (edge to edge), h = half-thickness
// Cached by shape, and flagged shared so disposeObject3D leaves it alone.
function bladeGeometry(key, sections, tipX) {
    return getCachedGeometry('blade:' + key, () => {
        const pos = [], idx = [];
        const push = (x, y, z) => { pos.push(x, y, z); return pos.length / 3 - 1; };
        const rings = sections.map(sc => [
            push(sc.x, 0, sc.w),    // one cutting edge
            push(sc.x, sc.h, 0),    // spine, front face
            push(sc.x, 0, -sc.w),   // other cutting edge
            push(sc.x, -sc.h, 0),   // spine, back face
        ]);
        for (let i = 0; i < rings.length - 1; i++) {
            const a = rings[i], b = rings[i + 1];
            for (let k = 0; k < 4; k++) {
                const k2 = (k + 1) % 4;
                idx.push(a[k], b[k], b[k2]);
                idx.push(a[k], b[k2], a[k2]);
            }
        }
        // Tip: fan the last ring into a single point.
        const apex = push(tipX, 0, 0);
        const last = rings[rings.length - 1];
        for (let k = 0; k < 4; k++) idx.push(last[k], apex, last[(k + 1) % 4]);
        // Base cap, so the blade is a closed solid and shadows correctly.
        const first = rings[0];
        idx.push(first[0], first[1], first[2]);
        idx.push(first[0], first[2], first[3]);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        return geo;
    });
}

// A wrapped grip: a tapered cylinder plus raised binding rings, which breaks up
// the silhouette far better than one smooth 6-sided tube.
function buildGrip(g, mats, x0, len, r, wrapColor) {
    const gripMat = leatherMat(wrapColor);
    const grip = new THREE.Mesh(
        getCachedGeometry(`grip:${len}:${r}`, () => new THREE.CylinderGeometry(r, r * 1.12, len, 14)),
        gripMat);
    grip.rotation.z = Math.PI / 2;
    grip.position.x = x0 + len / 2;
    g.add(grip);
    mats.push(gripMat);
    const bandMat = darkMetalMat('#1c2027');
    const bandGeo = getCachedGeometry(`gripband:${r}`, () => new THREE.TorusGeometry(r * 1.06, r * 0.2, 6, 12));
    for (let i = 0; i < 3; i++) {
        const band = new THREE.Mesh(bandGeo, bandMat);
        band.rotation.y = Math.PI / 2;
        band.position.x = x0 + len * (0.2 + i * 0.3);
        g.add(band);
    }
    mats.push(bandMat);
    return grip;
}

// A pommel counterweight at the butt of the handle.
function buildPommel(g, mats, x, r, hex) {
    const mat = goldMat(hex);
    const p = new THREE.Mesh(
        getCachedGeometry(`pommel:${r}`, () => new THREE.SphereGeometry(r, 10, 8)),
        mat);
    p.position.x = x;
    p.scale.x = 0.8;
    g.add(p);
    mats.push(mat);
}

// `opts` exists for the VIEWMODEL copy, which is the same sword seen from a
// foot away instead of across an arena - see the note above propForAtkType's
// viewmodel branch.
//   grip:  how much of the handle sticks out behind the hand
//   guard: cross-guard scale, which otherwise follows the blade's width
//   diffuse: keep some of the blade's own colour instead of reflecting the
//            arena entirely
function buildSwordProp(bladeHex, emissiveHex, len, wide, opts) {
    const g = new THREE.Group();
    const mats = [];
    const o = opts || {};
    const w = (wide || 5) / 2;
    const guardScale = o.guard != null ? o.guard : 1;
    const x0 = 8;                      // blade starts past the guard
    const bl = len;                    // blade length
    // Wide at the base, narrowing through the length, then a long point: the
    // profile of an actual cutting sword rather than a constant-width bar.
    // A blade that holds its own colour. metalness 1.0 means no diffuse term -
    // all colour comes from the environment - which is right for a sword seen
    // across an arena and wrong for the one in your hand, reported as "tinted
    // pinkish-brown, so it blends into the floor".
    const bladeMat = o.diffuse
        ? makeMat(bladeHex || '#cfd8e3', { metalness: 0.45, roughness: 0.22 })
        : steelMat(bladeHex);
    const blade = new THREE.Mesh(bladeGeometry(
        `sword:${len}:${wide || 5}`,
        [
            { x: x0,               w: w,        h: w * 0.30 },
            { x: x0 + bl * 0.18,   w: w * 0.98, h: w * 0.28 },
            { x: x0 + bl * 0.62,   w: w * 0.86, h: w * 0.22 },
            { x: x0 + bl * 0.88,   w: w * 0.55, h: w * 0.16 },
        ],
        x0 + bl + w * 0.9), bladeMat);
    blade.castShadow = true;
    g.add(blade);
    mats.push(bladeMat);

    // A glowing fuller down the spine - the character's accent colour, thin
    // enough to read as an energy line rather than a painted stripe.
    const eMat = energyMat(emissiveHex || bladeHex);
    const fuller = new THREE.Mesh(
        getCachedGeometry(`fuller:${len}`, () => new THREE.BoxGeometry(bl * 0.82, 0.5, 0.9)),
        eMat);
    fuller.position.x = x0 + bl * 0.44;
    g.add(fuller);
    mats.push(eMat);

    // Swept cross guard: two tapered quillons, not one rectangular block.
    const guardMat = goldMat('#d9a83c');
    const qLen = w * 2.6 * guardScale;
    const quillonGeo = getCachedGeometry(`quillon:${qLen.toFixed(2)}`,
        () => new THREE.CylinderGeometry(1.5 * guardScale, 0.7 * guardScale, qLen, 8));
    for (const sign of [1, -1]) {
        const q = new THREE.Mesh(quillonGeo, guardMat);
        q.position.set(x0 - 1.5, 0, sign * w * 1.3 * guardScale);
        q.rotation.x = Math.PI / 2;
        q.rotation.y = sign * 0.22;      // sweep the tips forward
        g.add(q);
    }
    const collar = new THREE.Mesh(
        getCachedGeometry('collar', () => new THREE.BoxGeometry(3.4, w * 0.9, w * 0.9)),
        guardMat);
    collar.position.x = x0 - 1.5;
    g.add(collar);
    mats.push(guardMat);

    // The grip is what "a dark rod running from the grip down to the
    // bottom-right" was: seven units of dark leather behind the hand holding
    // it, which reads as a spear held mid-shaft rather than a sword held by
    // its handle.
    const gripLen = o.grip != null ? o.grip : 7;
    buildGrip(g, mats, 0.5, gripLen, 1.25, '#33241a');
    buildPommel(g, mats, 0.5 - gripLen * 0.09, 1.7 * (o.guard != null ? o.guard : 1), '#d9a83c');

    g.userData.mats = mats;
    return g;
}

function buildDaggerProp(bladeHex, emissiveHex) {
    const g = new THREE.Group();
    const mats = [];
    const w = 1.7, x0 = 4.5, bl = 11;
    const bladeMat = steelMat(bladeHex);
    // A dagger keeps its width almost to the tip then breaks sharply - that is
    // what makes it read as a stabbing blade rather than a small sword.
    const blade = new THREE.Mesh(bladeGeometry(
        `dagger:${bladeHex}`,
        [
            { x: x0,             w: w,        h: w * 0.42 },
            { x: x0 + bl * 0.55, w: w * 0.95, h: w * 0.34 },
            { x: x0 + bl * 0.85, w: w * 0.62, h: w * 0.24 },
        ],
        x0 + bl + 2.2), bladeMat);
    blade.castShadow = true;
    g.add(blade);
    mats.push(bladeMat);

    const eMat = energyMat(emissiveHex || bladeHex);
    const edge = new THREE.Mesh(
        getCachedGeometry('daggerEdge', () => new THREE.BoxGeometry(bl * 0.7, 0.34, 0.6)),
        eMat);
    edge.position.x = x0 + bl * 0.42;
    g.add(edge);
    mats.push(eMat);

    const guardMat = darkMetalMat('#20242d');
    const guard = new THREE.Mesh(
        getCachedGeometry('daggerGuard', () => new THREE.CylinderGeometry(0.55, 1.5, 5.2, 8)),
        guardMat);
    guard.rotation.x = Math.PI / 2;
    guard.position.x = x0 - 0.8;
    g.add(guard);
    mats.push(guardMat);

    buildGrip(g, mats, 0.2, 4.4, 0.95, '#241a12');
    g.userData.mats = mats;
    return g;
}

function buildHammerProp(forVm) {
    const g = new THREE.Group();
    const mats = [];
    // Haft: a long tapered shaft with a bound grip, so the weight reads as
    // being at the far end.
    const haftMat = leatherMat('#2e2118');
    const haft = new THREE.Mesh(
        // Thicker in the hand than on the body: at viewmodel scale the
        // third-person haft is two pixels wide and the head looks stuck to
        // nothing ("a flat disc or washer on a thin stick").
        forVm
            ? getCachedGeometry('haftVm', () => new THREE.CylinderGeometry(1.9, 2.4, 20, 12))
            : getCachedGeometry('haft', () => new THREE.CylinderGeometry(1.15, 1.5, 20, 12)),
        haftMat);
    haft.rotation.z = Math.PI / 2;
    haft.position.x = 9;
    g.add(haft);
    mats.push(haftMat);

    const headMat = darkMetalMat('#4a5261');
    // The striking head: a broad face, tapered cheeks either side, and a
    // wedge-shaped rear claw. Three simple pieces, but the silhouette stops
    // being a cube.
    const face = new THREE.Mesh(
        getCachedGeometry('hammerFace', () => new THREE.CylinderGeometry(5.4, 4.6, 7.5, 8)),
        headMat);
    face.rotation.z = Math.PI / 2;
    face.position.x = 22;
    face.castShadow = true;
    g.add(face);
    const claw = new THREE.Mesh(
        getCachedGeometry('hammerClaw', () => new THREE.ConeGeometry(3.4, 6.5, 6)),
        headMat);
    claw.rotation.z = Math.PI / 2;
    claw.position.x = 15.5;
    claw.scale.set(1, 1, 0.65);
    g.add(claw);
    mats.push(headMat);

    const bandMat = goldMat('#9aa3b2');
    const band = new THREE.Mesh(
        getCachedGeometry('hammerBand', () => new THREE.TorusGeometry(5.0, 0.55, 6, 14)),
        bandMat);
    band.rotation.y = Math.PI / 2;
    band.position.x = 22;
    g.add(band);
    mats.push(bandMat);

    buildPommel(g, mats, -1.2, 1.9, '#7d8695');
    g.userData.mats = mats;
    return g;
}

function buildScytheProp(len = 34) {
    const g = new THREE.Group();
    const mats = [];
    const shaftMat = darkMetalMat('#23262e');
    const shaft = new THREE.Mesh(
        getCachedGeometry(`scytheShaft:${len}`, () => new THREE.CylinderGeometry(1.0, 1.3, len, 12)),
        shaftMat);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = len / 2;
    g.add(shaft);
    mats.push(shaftMat);

    // The blade: five short diamond-section segments swept along an arc, which
    // gives a genuine curve instead of the old three straight boxes.
    const bladeMat = steelMat('#dbe3ee');
    const segGeo = bladeGeometry('scytheSeg', [
        { x: 0,   w: 2.6, h: 0.75 },
        { x: 5.5, w: 2.2, h: 0.6 },
    ], 7.6);
    const SEGS = 5;
    for (let i = 0; i < SEGS; i++) {
        const t = i / SEGS;
        const seg = new THREE.Mesh(segGeo, bladeMat);
        const ang = -0.30 - t * 1.15;                  // sweep back around the tip
        const r = 13 - t * 2.2;
        seg.position.set(len - 2 + Math.cos(ang) * r * 0.42, Math.sin(ang) * r * 0.9, 0);
        seg.rotation.z = ang + 0.5;
        seg.scale.setScalar(1 - t * 0.34);
        seg.castShadow = true;
        g.add(seg);
    }
    mats.push(bladeMat);

    const eMat = energyMat('#a855f7');
    const glow = new THREE.Mesh(
        getCachedGeometry('scytheGlow', () => new THREE.TorusGeometry(7.5, 0.34, 5, 16, Math.PI * 0.85)),
        eMat);
    glow.position.set(len - 4, -4.5, 0);
    glow.rotation.z = 0.5;
    g.add(glow);
    mats.push(eMat);

    buildGrip(g, mats, 1.0, 8, 1.15, '#1d1a22');
    g.userData.mats = mats;
    return g;
}

// A knuckle-plate cap for the PROCEDURAL arm, which ends in a stub. A rigged
// model ends in its own modelled hand and must not be given one of these - see
// the marker's use in buildRiggedCharacter and finishViewmodel.
function buildFistProp(color) {
    const g = new THREE.Group();
    const mats = [];
    const plateMat = darkMetalMat(color || '#6b7280');
    // Cuff, back-of-hand plate and four knuckle studs: the old version was a
    // 7x7x7 cube plus one slab, which is why a "gauntlet" read as a brick.
    const cuff = new THREE.Mesh(
        getCachedGeometry('fistCuff', () => new THREE.CylinderGeometry(3.6, 4.2, 5.0, 10)),
        plateMat);
    cuff.rotation.z = Math.PI / 2;
    cuff.position.x = -1.0;
    g.add(cuff);
    const back = new THREE.Mesh(
        getCachedGeometry('fistBack', () => new THREE.BoxGeometry(6.2, 5.4, 6.0)),
        plateMat);
    back.position.x = 3.2;
    back.castShadow = true;
    g.add(back);
    mats.push(plateMat);

    const studMat = goldMat('#b9c2d0');
    const studGeo = getCachedGeometry('fistStud', () => new THREE.SphereGeometry(1.05, 8, 6));
    for (let i = 0; i < 4; i++) {
        const stud = new THREE.Mesh(studGeo, studMat);
        stud.position.set(6.4, 1.6, -2.1 + i * 1.4);
        g.add(stud);
    }
    mats.push(studMat);

    const eMat = energyMat('#fb923c');
    const vent = new THREE.Mesh(
        getCachedGeometry('fistVent', () => new THREE.BoxGeometry(0.6, 3.4, 4.6)),
        eMat);
    vent.position.set(6.5, -0.6, 0);
    g.add(vent);
    mats.push(eMat);

    g.userData.mats = mats;
    // See the note above this function: a rigged body already has a hand, so
    // this cap is hidden there rather than stacked on top of it.
    g.userData.bareFistCap = true;
    return g;
}

function buildStaffProp() {
    const g = new THREE.Group();
    const shaftMat = makeMat('#334155', { roughness: 0.6, metalness: 0.4 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 30, 8), shaftMat);
    shaft.rotation.z = Math.PI / 2; shaft.position.x = 13; shaft.castShadow = true;
    const crystalMat = makeMat('#a5f3fc', { emissive: 0x22d3ee, emissiveIntensity: 0.9 });
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(4, 0), crystalMat);
    crystal.position.x = 30; crystal.castShadow = true;
    const prongMat = makeMat('#0e7490', { metalness: 0.6 });
    for (const s of [-1, 1]) {
        const prong = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 1), prongMat);
        prong.position.set(28, s * 3.5, 0); prong.rotation.z = s * 0.5;
        g.add(prong);
    }
    g.add(shaft, crystal);
    const charge = new THREE.Mesh(new THREE.SphereGeometry(3, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    charge.position.copy(crystal.position); g.add(charge); g.userData.chargeOrb = charge; // magical charge glow (animated during casts)
    g.userData.mats = [shaftMat, crystalMat, prongMat];
    g.userData.core = crystal;
    return g;
}
// A drooping chain of shrinking segments — a coiled vine whip. `n`/`step`
// control its length: Thorne's on-body whip is built long (it's the longest
// reach in the roster) so the lash reaches the edge of its range; the
// viewmodel uses a shorter version.
// A VINE, not a string of beads.
//
// Reported: "Thorne's weapon needs to look better. The green balls aren't even
// connected to each other." Literally true - it was seven spheres whose radii
// shrank from 2.0 to 0.6, placed 3.2 apart, so the first two touched and the
// rest were beads on an invisible string.
//
// One tube along the same curve the beads followed, tapering as it goes, with
// thorns down its length and a barb at the tip. TubeGeometry takes the radius
// as a constant, so the taper is done by scaling each of a few short tubes -
// cheaper than a custom buffer and it reads the same.
function buildWhipProp(n = 7, step = 3.2) {
    const g = new THREE.Group();
    const mat = makeMat('#4ade80', { emissive: 0x16a34a, emissiveIntensity: 0.4, roughness: 0.6 });
    const thornMat = makeMat('#166534');

    // The same path the old beads sat on, as a smooth curve.
    const pts = [];
    let px = 4, py = 0;
    for (let i = 0; i <= n; i++) {
        pts.push(new THREE.Vector3(px, py, 0));
        px += step; py -= 0.5 + i * (2.2 / n);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    // Short overlapping tubes, each thinner than the last: a continuous vine
    // that tapers, without writing a tapered-tube geometry by hand.
    const SEGS = 6;
    for (let i = 0; i < SEGS; i++) {
        const t0 = i / SEGS, t1 = (i + 1) / SEGS;
        const sub = new THREE.CatmullRomCurve3([
            curve.getPoint(t0), curve.getPoint((t0 + t1) / 2), curve.getPoint(t1),
        ]);
        const r = 1.9 - 1.35 * (i / SEGS);
        const tube = new THREE.Mesh(new THREE.TubeGeometry(sub, 6, r, 8, false), mat);
        tube.castShadow = true;
        g.add(tube);
        // A thorn on alternating sides, which is what makes it a bramble.
        const at = curve.getPoint((t0 + t1) / 2);
        const thorn = new THREE.Mesh(new THREE.ConeGeometry(r * 0.5, r * 2.2, 4), thornMat);
        thorn.position.copy(at);
        thorn.rotation.z = (i % 2 ? 1 : -1) * 1.1;
        thorn.rotation.y = i * 0.7;
        g.add(thorn);
    }
    const tipAt = curve.getPoint(1);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(1.2, 5.5, 5), thornMat);
    tip.position.copy(tipAt);
    tip.rotation.z = Math.PI * 0.62;
    g.add(tip);
    g.userData.mats = [mat, thornMat];
    return g;
}
function buildOrbProp(coreHex, emissiveHex) {
    const g = new THREE.Group();
    const coreMat = makeMat(coreHex, { emissive: hexNum(emissiveHex), emissiveIntensity: 0.9 });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(3, 0), coreMat);
    core.castShadow = true;
    // A SPHERE, not a ring. A RingGeometry is a flat annulus: head-on it is a
    // halo and from anywhere else it is a line, which is what "the charge up
    // animation is a 2d disk in her hand" was. Batch 37 made the projectile's
    // halo a real sphere for exactly this reason and left the one in the hand.
    // Additive and depth-write off so it reads as light around the core rather
    // than as a second solid object.
    const haloMat = new THREE.MeshBasicMaterial({
        // 0.18, not 0.35: additive blending multiplies what is already a bright
        // emissive core, and at the ring's old opacity the sphere read as a
        // white blob that swallowed the hand holding it.
        color: hexNum(emissiveHex), transparent: true, opacity: 0.18,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, fog: false,
    });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(3.7, 14, 10), haloMat);
    g.add(core, halo);
    const charge = new THREE.Mesh(new THREE.SphereGeometry(3, 10, 10),
        new THREE.MeshBasicMaterial({ color: hexNum(emissiveHex), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    g.add(charge); g.userData.chargeOrb = charge; // magical charge glow (animated during casts)
    g.userData.mats = [coreMat];
    g.userData.core = core;
    return g;
}

// --- First-person weapon viewmodel: the weapon (+ a bit of forearm) held
// in the player's own view, matching their character. Built as a child of
// their camera and placed on their own viewmodel layer so only their camera
// renders it. Small and toward the lower-right, so it reads as "your hands"
// without eating the screen. ---
// `forVm` asks for the FIRST-PERSON variant. Only the sword differs so far,
// and the flag exists rather than a second builder because everything else
// about the prop - materials, cached geometry, the weapon-swing data - should
// stay identical between the two views.
