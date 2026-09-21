// Astral Clash - the procedural character bodies, shared by both builds.
//
// Loaded as a plain script by index.html and local/index.html, after three.js
// and after shared/props.js (these builders hang weapons off the hands).
//
// shared/props.js holds what a fighter CARRIES; this holds the fighter. One
// humanoid base, fourteen bodies built from it, and the table that names them.
//
// These are the PROCEDURAL bodies - what a character looks like when its
// Blender-authored GLB has not landed yet, or does not exist. The rigged path
// stays in each build, because it reaches for the model cache, the loader and
// the render layers, none of which are shared.
//
// RULES (the same as shared/props.js)
//   1. NO DOM, NO RENDERER, NO CLOSURE STATE. A builder takes a colour and
//      returns a THREE.Group with a documented userData contract.
//   2. Neither build may re-declare these names; art/sync_local.py checks.

// ---- the humanoid every body is built from ---------------------------
function buildHumanoidBase(color, opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const bodyMat = makeMat(color, opts.bodyMatOpts);
    const trimMat = makeMat(opts.trimColor || '#1e293b', { roughness: 0.55, metalness: 0.25 });
    const bodyMats = [bodyMat, trimMat];

    const legW = opts.legW || 5, legH = opts.legH || 15, legGap = opts.legGap || 4;
    const hipY = legH;
    const torsoD = opts.torsoD || 9, torsoH = opts.torsoH || 20, torsoW = opts.torsoW || 14;
    const headR = opts.headR || 6.5;
    const armW = opts.armW || 4.2, armLen = opts.armLen || 15;
    const shoulderY = hipY + torsoH - 2;
    const shoulderZ = torsoW / 2;

    for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legW), trimMat);
        leg.position.set(0, legH / 2, side * legGap);
        leg.castShadow = true; leg.receiveShadow = true;
        g.add(leg);
    }

    const torso = new THREE.Mesh(new THREE.BoxGeometry(torsoD, torsoH, torsoW), bodyMat);
    torso.position.set(0, hipY + torsoH / 2, 0);
    torso.castShadow = true; torso.receiveShadow = true;
    g.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 10, 10), bodyMat);
    head.position.set(1.5, hipY + torsoH + headR - 1, 0);
    head.castShadow = true;
    g.add(head);

    const arms = {};
    for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(0, shoulderY, side * shoulderZ);
        const limb = new THREE.Mesh(new THREE.BoxGeometry(armW, armLen, armW), trimMat);
        limb.position.y = -armLen / 2;
        limb.castShadow = true;
        pivot.add(limb);
        const hand = new THREE.Group();
        hand.position.y = -armLen;
        pivot.add(hand);
        g.add(pivot);
        arms[side] = { pivot, hand };
    }

    g.userData.bodyMats = bodyMats;
    g.userData.armPos = arms[1];  // +Z-side arm
    g.userData.armNeg = arms[-1]; // -Z-side arm
    g.userData.head = head;
    g.userData.torso = torso;
    return g;
}

// --- Weapon prop builders. Each returns a Group meant to be added to a
// fighter's hand socket, with local +X pointing "forward" out of the hand
// (the blade/head/tip direction), so a shoulder swing carries it through a
// natural arc. Built from real primitives shaped to actually read as the
// weapon (flat tapered blades with a crossguard and grip, not sticks; a
// bulky hammer head on a handle; a curved scythe; etc.). `userData.mats`
// lists this weapon's materials so the caller can fold them into the
// fighter's bodyMats (hit-flash / death-fade). ---
// --- Batch 28: weapons rebuilt. ------------------------------------------
// The blades used to be a flat BoxGeometry slab with a 4-sided cone glued on
// the end: no taper, no cutting edge, no central ridge, so they caught light
// like a painted plank and read as the crudest thing on screen - especially in
// first person, where the viewmodel is on screen every single frame.
//
// The fix is shape, not texture. A real blade has a DIAMOND cross-section: two
// edges and a raised spine. That gives four long faces at different angles to
// the light, which is what makes metal look like metal. bladeGeometry builds
// that from a list of cross-sections so one function serves swords, daggers and
// scythe blades at any taper.

// Physically-plausible metal beats the old flat-ish look immediately: real
// polished steel is fully metallic and quite smooth, and its colour comes from
// reflection rather than a bright base colour.
// EVERY WEAPON A FIGHTER CAN HOLD lives in shared/props.js, loaded above:
// one copy, shared with the local build. See that file's header for why.
function buildKaelenMesh(color) {
    const g = buildHumanoidBase(color, { trimColor: '#0f172a' });
    const sword = buildSwordProp('#e6faff', '#38bdf8', 17, 5);
    g.userData.armPos.hand.add(sword);
    g.userData.bodyMats.push(...sword.userData.mats);
    g.userData.weapon = sword;
    g.userData.weaponArm = g.userData.armPos;
    // Wide horizontal cleave: the whole body twists as the blade sweeps
    // across the front, so it reads clearly differently from Voss's quick
    // in-line stabs.
    g.userData.weaponAnim = { type: 'swing', backDeg: -30, fwdDeg: 55, twistDeg: 60 };
    return g;
}

function buildLyraMesh(color) {
    const g = buildHumanoidBase(color, { trimColor: '#312e81', torsoD: 7, torsoW: 12, legW: 4, headR: 6, bodyMatOpts: { metalness: 0.3, roughness: 0.25 } });
    const shardMat = makeMat('#e9d5ff', { emissive: 0xa855f7, emissiveIntensity: 0.6 });
    const orbitShard = new THREE.Mesh(new THREE.OctahedronGeometry(3.5, 0), shardMat);
    orbitShard.position.set(14, g.userData.head.position.y, 0);
    g.add(orbitShard);
    g.userData.orbiter = orbitShard;
    g.userData.orbitMode = 'position';
    g.userData.orbitRadius = 14;
    g.userData.orbitY = g.userData.head.position.y;

    const focus = buildOrbProp('#e9d5ff', '#a855f7');
    g.userData.armPos.hand.add(focus);
    g.userData.bodyMats.push(shardMat, ...focus.userData.mats);
    g.userData.weapon = focus.userData.core;
    g.userData.chargeOrb = focus.userData.chargeOrb;
    g.userData.weaponArm = g.userData.armPos;
    // Forward-thrust cast: one arm punches out ahead to hurl the shard —
    // horizontal, distinct from Seraphine's overhead invocation.
    g.userData.weaponAnim = { type: 'cast', raiseDeg: 85, peakScale: 2.0 };
    return g;
}

function buildGorgonokMesh(color) {
    const g = buildHumanoidBase(color, { trimColor: '#7c2d12', torsoD: 12, torsoW: 18, legW: 6.5, armW: 5.5, headR: 6, legH: 14 });
    const fist = buildFistProp(color);
    g.userData.armPos.hand.add(fist);
    g.userData.bodyMats.push(...fist.userData.mats);
    g.userData.weapon = fist;
    g.userData.weaponArm = g.userData.armPos;
    // Rising uppercut: minimal wind-up, arm drives up and forward hard.
    g.userData.weaponAnim = { type: 'swing', backDeg: -12, fwdDeg: 115 };
    return g;
}

function buildVossMesh(color) {
    const g = buildHumanoidBase(color, { trimColor: '#134e4a', torsoD: 6, torsoW: 10, legW: 3.5, legH: 13, armW: 3.2, armLen: 13, headR: 5.5 });
    const d1 = buildDaggerProp('#99f6e4', '#14b8a6');
    const d2 = buildDaggerProp('#99f6e4', '#14b8a6');
    g.userData.armPos.hand.add(d1);
    g.userData.armNeg.hand.add(d2);
    g.userData.bodyMats.push(...d1.userData.mats);
    g.userData.weapon = [d1, d2];
    g.userData.weaponArm = [g.userData.armPos, g.userData.armNeg];
    // Rapid double forward stab — a twitchy in-line thrust, no wide arc.
    g.userData.weaponAnim = { type: 'stab', reachDeg: 80, jabs: 2 };
    return g;
}

function buildDravenMesh(color) {
    const g = buildHumanoidBase(color, { trimColor: '#374151', torsoD: 13, torsoW: 19, legW: 7, legH: 15, armW: 5.5, headR: 6.5 });
    const hammer = buildHammerProp();
    g.userData.armPos.hand.add(hammer);
    g.userData.bodyMats.push(...hammer.userData.mats);
    g.userData.weapon = hammer;
    g.userData.weaponArm = [g.userData.armPos, g.userData.armNeg];
    // Slow, huge two-handed overhead smash — biggest wind-up in the roster.
    g.userData.weaponAnim = { type: 'swing', backDeg: -75, fwdDeg: 80 };
    return g;
}

function buildSeraphineMesh(color) {
    const g = buildHumanoidBase(color, { trimColor: '#78716c', torsoD: 7, torsoW: 11, legW: 4, headR: 6, bodyMatOpts: { emissive: hexNum(color), emissiveIntensity: 0.3, roughness: 0.3, metalness: 0.1 } });
    const haloMat = makeMat('#fff7d6', { emissive: 0xfacc15, emissiveIntensity: 0.7, opacity: 0.9 });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(9, 1.1, 8, 24), haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = g.userData.head.position.y + 9;
    g.add(halo);
    const glowLight = new THREE.PointLight(hexNum(color), 0.5, 80);
    glowLight.position.y = g.userData.head.position.y;
    g.add(glowLight);
    g.userData.orbiter = halo;
    g.userData.orbitMode = 'spin';
    const focus = buildOrbProp('#fff7d6', '#facc15');
    g.userData.armPos.hand.add(focus);
    g.userData.bodyMats.push(haloMat, ...focus.userData.mats);
    g.userData.weapon = focus.userData.core;
    g.userData.chargeOrb = focus.userData.chargeOrb;
    // Overhead invocation: both arms raise high to the sky, distinct from
    // Lyra's forward thrust.
    g.userData.weaponArm = [g.userData.armPos, g.userData.armNeg];
    g.userData.weaponAnim = { type: 'cast', raiseDeg: 172, peakScale: 1.8 };
    return g;
}

// --- Four additional characters (added on request). ---

function buildNyxMesh(color) {
    const g = buildHumanoidBase(color, { trimColor: '#2e1065', torsoD: 7, torsoW: 12, legW: 4.5, headR: 6, bodyMatOpts: { emissive: hexNum(color), emissiveIntensity: 0.2 } });
    const scythe = buildScytheProp(60); // long shaft so the blade reaches Nyx's long (95) range during the reap
    g.userData.armPos.hand.add(scythe);
    g.userData.bodyMats.push(...scythe.userData.mats);
    g.userData.weapon = scythe;
    g.userData.weaponArm = g.userData.armPos;
    // Diagonal reap: a sweeping arc that twists the body the OTHER way from
    // Kaelen, so the two blade users don't read alike.
    g.userData.weaponAnim = { type: 'swing', backDeg: -55, fwdDeg: 60, twistDeg: -65 };
    return g;
}

function buildIgnisMesh(color) {
    const g = buildHumanoidBase(color, { trimColor: '#7f1d1d', torsoD: 10, torsoW: 15, legW: 5.5, armW: 4.8, headR: 6 });
    const f1 = buildFistProp(color);
    const f2 = buildFistProp(color);
    g.userData.armPos.hand.add(f1);
    g.userData.armNeg.hand.add(f2);
    g.userData.bodyMats.push(...f1.userData.mats);
    g.userData.weapon = [f1, f2];
    g.userData.weaponArm = [g.userData.armPos, g.userData.armNeg];
    // Rapid alternating jabs — left/right arms fire out of phase, a boxer's
    // flurry, distinct from Gorgonok's single big uppercut.
    g.userData.weaponAnim = { type: 'flurry', reachDeg: 95, jabs: 4 };
    return g;
}

function buildAureliaMesh(color) {
    const g = buildHumanoidBase(color, { trimColor: '#155e75', torsoD: 7, torsoW: 12, legW: 4, headR: 6, bodyMatOpts: { emissive: hexNum(color), emissiveIntensity: 0.25, metalness: 0.2 } });
    const staff = buildStaffProp();
    g.userData.armPos.hand.add(staff);
    g.userData.bodyMats.push(...staff.userData.mats);
    g.userData.weapon = staff.userData.core;
    g.userData.chargeOrb = staff.userData.chargeOrb;
    // Two-handed forward staff-point cast — levels the staff ahead to loose
    // a bolt; two arms, distinct from Lyra's one-arm shard toss.
    g.userData.weaponArm = [g.userData.armPos, g.userData.armNeg];
    g.userData.weaponAnim = { type: 'cast', raiseDeg: 88, peakScale: 1.6 };
    return g;
}

function buildThorneMesh(color) {
    const g = buildHumanoidBase(color, { trimColor: '#14532d', torsoD: 9, torsoW: 14, legW: 5, legH: 15, headR: 6.2 });
    const whip = buildWhipProp(13, 6.5); // long lash so it reaches Thorne's range (115) — the longest melee in the roster
    g.userData.armPos.hand.add(whip);
    g.userData.bodyMats.push(...whip.userData.mats);
    g.userData.weapon = whip;
    g.userData.weaponArm = g.userData.armPos;
    // Overhead-to-forward whip crack: a fast snap with a hard forward
    // follow-through, no body twist — reads unlike the sword/scythe sweeps.
    g.userData.weaponAnim = { type: 'swing', backDeg: -60, fwdDeg: 105 };
    return g;
}

// --- Batch 17: Karrigos, the Granite Colossus. Co-op boss.
// Built from the SAME buildHumanoidBase rig as the roster (scaled up and
// re-skinned) rather than new geometry: the rig already carries shoulder
// pivots, hand sockets and the animation hooks every attack type drives, so
// reusing it means the boss inherits all of that for free and only its
// silhouette and materials are new work. A golem also isn't on the roster
// thematically — none of the ten are giants — so it reads as a boss without
// needing a new art pipeline. ---
function buildKarrigosMesh(color) {
    const g = buildHumanoidBase(color, {
        trimColor: '#241d18',
        // Heavy, wide, low-slung: broad torso, thick limbs, small head — the
        // proportions do most of the "this is not a duellist" work.
        torsoD: 16, torsoW: 26, torsoH: 26, legW: 9, legH: 18, legGap: 6,
        armW: 8, armLen: 20, headR: 6,
        bodyMatOpts: { roughness: 0.95, metalness: 0.05 }, // dead stone, not armour
    });
    // Massive stone fists. Deliberately NOT buildFistProp — that one bolts on
    // bright gold emissive knuckles (right for Ignis' burning gauntlets, wrong
    // for a golem, and on screen it read as pale cream plastic). These are just
    // rough rock blocks in the body's own stone tone.
    const rockMat = makeMat('#332e29', { roughness: 0.98, metalness: 0.02 });
    const buildStoneFist = () => {
        const fg = new THREE.Group();
        const knuckle = new THREE.Mesh(new THREE.BoxGeometry(11, 11, 11), rockMat);
        knuckle.position.x = 5; knuckle.castShadow = true;
        const spur = new THREE.Mesh(new THREE.BoxGeometry(4, 8, 8), rockMat);
        spur.position.x = 11;
        fg.add(knuckle, spur);
        fg.userData.mats = [rockMat];
        return fg;
    };
    const fistL = buildStoneFist(), fistR = buildStoneFist();
    g.userData.armPos.hand.add(fistL);
    g.userData.armNeg.hand.add(fistR);
    g.userData.bodyMats.push(rockMat);

    // Glowing ember seams: the cracks where the stone has split.
    //
    // Deliberately an UNLIT MeshBasicMaterial rather than a lit/emissive one.
    // The arenas are brightly lit (sun + hemisphere + ambient) and the renderer
    // tone-maps at exposure 1.1, which multiplies a lit surface's albedo by
    // roughly 3x here — a lit orange plus emissive clipped straight to
    // pale yellow-white, so the "embers" rendered as blank beige panels. Unlit
    // means the colour on screen is exactly the colour chosen, which is the only
    // reliable way to get a hot-crack read against every map's lighting.
    const emberMat = new THREE.MeshBasicMaterial({ color: hexNum('#ff4d0d') });
    const seams = [];
    [[0, 34, 0, 15, 1.6], [0, 26, 7, 9, 1.2], [0, 26, -7, 9, 1.2], [0, 44, 0, 7, 1.1]].forEach(([x, y, z, w, h]) => {
        const seam = new THREE.Mesh(new THREE.BoxGeometry(1.5, h, w), emberMat);
        seam.position.set(8.2 + x, y, z);
        g.add(seam);
        seams.push(seam);
    });
    // Cracked shoulder plating, so the silhouette reads as armoured rock.
    const plateMat = makeMat('#241f1c', { roughness: 0.98, metalness: 0.02 });
    for (const side of [-1, 1]) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(13, 7, 11), plateMat);
        plate.position.set(0, 40, side * 13);
        plate.castShadow = true;
        g.add(plate);
    }
    g.userData.bodyMats.push(plateMat);

    // A hollow, ember-lit skull: two glowing eyes in a dark head.
    for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 8), emberMat);
        eye.position.set(6, 48, side * 2.4);
        g.add(eye);
    }
    g.userData.emberSeams = seams;
    g.userData.emberMat = emberMat;

    g.userData.weapon = [fistL, fistR];
    g.userData.weaponArm = [g.userData.armPos, g.userData.armNeg];
    // Slow two-armed overhead smash for the basic — long, obvious, punishable.
    g.userData.weaponAnim = { type: 'swing', backDeg: -70, fwdDeg: 120, twistDeg: 10 };
    // Scale the whole rig up. Done here rather than by inflating every
    // dimension above so the proportions stay the tuned ones.
    g.scale.setScalar(1.5);
    return g;
}

// --- Batch 23: Survival minion meshes. All three reuse buildHumanoidBase with
// deliberately off-model proportions so they read as *not people* at a glance,
// which matters when three of them are converging on you at once: Grint is
// tiny and spindly, Slagling is a hunched lantern-carrier, Hollowkin is a
// squat slab. Silhouette does the identification work, not detail. ---
function buildGrintMesh(color) {
    const g = buildHumanoidBase(color, {
        trimColor: '#3f6212', torsoD: 5, torsoW: 7, torsoH: 12,
        legW: 2.4, legH: 11, legGap: 2.4, armW: 2.2, armLen: 12, headR: 4.2,
    });
    const claw = buildDaggerProp('#d9f99d', '#84cc16');
    g.userData.armPos.hand.add(claw);
    g.userData.bodyMats.push(...claw.userData.mats);
    g.userData.weapon = claw;
    g.userData.weaponArm = g.userData.armPos;
    g.userData.weaponAnim = { type: 'stab', reachDeg: 90, jabs: 2 };
    g.scale.setScalar(0.72); // clearly smaller than a fighter
    return g;
}
function buildSlaglingMesh(color) {
    const g = buildHumanoidBase(color, {
        trimColor: '#7c2d12', torsoD: 7, torsoW: 10, torsoH: 14,
        legW: 3.2, legH: 10, armW: 2.8, armLen: 16, headR: 4.6,
    });
    // A held ember-orb it casts from. Unlit so it stays a hot point of light
    // against every map's lighting (same reasoning as Karrigos' seams).
    const orb = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(3.2, 10, 10), new THREE.MeshBasicMaterial({ color: hexNum('#ff6a1f') }));
    core.position.x = 5;
    orb.add(core);
    g.userData.armPos.hand.add(orb);
    g.userData.weapon = orb;
    g.userData.weaponArm = g.userData.armPos;
    g.userData.weaponAnim = { type: 'cast', raiseDeg: 70 };
    g.scale.setScalar(0.86);
    return g;
}
function buildHollowkinMesh(color) {
    const g = buildHumanoidBase(color, {
        trimColor: '#334155', torsoD: 13, torsoW: 20, torsoH: 17,
        legW: 6.5, legH: 11, legGap: 5, armW: 6, armLen: 14, headR: 4.4,
        bodyMatOpts: { roughness: 0.9, metalness: 0.08 },
    });
    const fist = buildFistProp('#94a3b8');
    fist.scale.setScalar(1.25);
    g.userData.armPos.hand.add(fist);
    g.userData.bodyMats.push(...fist.userData.mats);
    g.userData.weapon = fist;
    g.userData.weaponArm = g.userData.armPos;
    g.userData.weaponAnim = { type: 'swing', backDeg: -30, fwdDeg: 100 };
    g.scale.setScalar(1.08);
    return g;
}

// ---------------------------------------------------------------------------
// Batch 25: Blender-authored rigged characters.
//
// Each entry here replaces that character's procedural primitive mesh with a
// real skinned GLB (see art/*.blend). Anything NOT listed keeps its original
// procedural builder untouched, so the roster can be converted one character
// at a time without the game ever being in a broken half-state.
//
// Loading is asynchronous and entirely optional: if the fetch fails - offline,
// a file:// origin where XHR is blocked, a missing asset - charModels stays
// empty, buildRiggedCharacter() returns null, and initMesh() falls back to the
// primitive builder. The game must never fail to start over art.

// Total height in world units that a loaded model is scaled to. The procedural
// rig stands about this tall (hipY 15 + torsoH 20 + head ~13) and EYE_HEIGHT is
// 46, so matching it keeps cameras, muzzle heights and hitboxes valid.
// Batch 34: per-character size, so a rigged Karrigos is not the same height as
// a rigged Grint.
//
// buildRiggedCharacter scales every model to exactly RIG_TARGET_HEIGHT, which
// is right for the roster (they are all roughly human) and wrong for the
// creatures: the PROCEDURAL builders apply their size multiplier to the OUTER
// group instead, so the two paths disagreed and a rigged Karrigos would have
// come out the same height as a rigged Grint. These are the multipliers the
// procedural builders already use, in one table both paths can read.
//
// Mesh scale is PURELY VISUAL - nothing in the simulation reads it. `width`
// and `height` are hardcoded 40/40 for every fighter, EYE_HEIGHT (46) and
// MUZZLE_HEIGHT (34) are single globals, and attack reach is `cfg.range` data.
// So Karrigos is a 75-unit-tall model on a 40-unit collision circle with his
// eyes at the same height as Grint's. That is a pre-existing design property,
// not something this table changes; it is written down here because it is
// surprising and someone will eventually try to "fix" it.
// How far a transplanted prop may sit from the hand it is attached to.
//
// The procedural builders position a weapon relative to THEIR hand, and some of
// those offsets are large (a two-handed hammer is held well forward). Moved onto
// a generated skeleton whose hand is somewhere else, a large offset becomes a
// weapon floating at the waist - which is exactly what was reported for Ignis.
// Small nudges are real authoring and are kept; anything beyond this is clamped
// back toward the hand.

// ---- and the table that names them -----------------------------------
const PROC_MESH_BUILDERS = {
    Karrigos: buildKarrigosMesh,
    Grint: buildGrintMesh,
    Slagling: buildSlaglingMesh,
    Hollowkin: buildHollowkinMesh,
    Kaelen: buildKaelenMesh,
    Lyra: buildLyraMesh,
    Gorgonok: buildGorgonokMesh,
    Voss: buildVossMesh,
    Draven: buildDravenMesh,
    Seraphine: buildSeraphineMesh,
    Nyx: buildNyxMesh,
    Ignis: buildIgnisMesh,
    Aurelia: buildAureliaMesh,
    Thorne: buildThorneMesh
};
