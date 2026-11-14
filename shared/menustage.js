// Astral Clash - the menu stage: live 3D behind the menus, shared by both builds.
//
// Loaded as a plain script after shared/common.js. Nothing outside a fight used
// to call the renderer at all - renderViews() returns on its first line in MENU
// - so the menus were HTML over a canvas that was not being drawn to, and the
// fourteen rigged fighters with their Idle clips were only ever seen from
// inside a match, by the person fighting them.
//
// WHAT THIS IS
//
// One small THREE.Scene of its own - a dais, a floor running into fog, some
// distant pylons, a rift of light, drifting motes - with a fighter standing on
// it, drawn by the game's ONE renderer while a menu is up.
//
// WHY ITS OWN SCENE, and not the arena that is already loaded behind the menu.
// Three reasons, each of which was a real cost somewhere else in this codebase:
//
//   * three.js compiles the NUMBER of lights into every shader. Adding, hiding
//     or removing a light in the main scene recompiles every arena material -
//     one measured frame of that took 9,858ms (see the note by warmCombatShaders
//     in the builds). A second scene has its own light state and cannot touch
//     the first one's. crushScene is the precedent.
//   * An arena is a full gameplay render: a 2048 shadow map and several
//     megabytes of textures per theme, with a PMREM rebuild on every switch.
//     That is what a fight needs and far more than a backdrop does.
//   * loadMap() rewrites gameplay globals. Harmless in MENU today, and exactly
//     the kind of harmless that stops being so.
//
// WHY NOT A SECOND RENDERER. A second WebGL context is rationed by the browser
// and paid for in memory by phones, which play the online build at full
// quality. This borrows the first one between matches and hands it back at the
// size it found it - see menuStageOnScreen, where that hand-back is a rule
// about fairness rather than about tidiness.
//
// THE SCOPE RULE. The renderer, the model loader and the rigged-character
// builder all live inside bootGame(), which shared code cannot see into. So
// they are INJECTED - menuStageInit(X) - and reached only as X.renderer,
// X.ensureCharModel and so on. A bare `renderer` here would be a ReferenceError
// the first time the line ran, and art/sync_local.py refuses the sync over it.
//
// RULES
//   1. Everything here is a no-op until menuStageInit() has run, and stays one
//      in the poster tier. A build that never calls it loses nothing.
//   2. Never promote a tier. The watchdog only ever steps down, so a machine
//      that could not hold a frame rate is not asked to try again every few
//      seconds for the rest of the session.
//   3. Whatever is created here is disposed here. tests/leakcheck.js traps
//      every texture upload across ten rematches and has no opinion about
//      whose they were.

// Stage units are the game's: a fighter stands RIG_TARGET_HEIGHT (50) tall.
const MENU_STAGE_DAIS_TOP = 5;
const MENU_STAGE_FIGHTER_DEFAULT = 'Kaelen';
// What has to fit in the slot, top to bottom: the dais, the fighter, headroom.
const MENU_STAGE_FIGHTER_SPAN = 62;
// How much fog there is AT THE FIGHTER, as density x distance. The camera backs
// off to make the fighter small - on an upright phone it is two and a half
// times further away than on a desktop - and a fixed density fogged the
// fighter out with the scenery: 63% gone at that distance, which is why the
// first upright shot was a grey figure. Holding this product constant keeps
// the fighter as clear as on a desktop and lets the set do the receding.
const MENU_STAGE_FOG_AT_FIGHTER = 0.41;
// The element whose box is where the fighter stands, per shot. Empty, and
// placed by the page's own layout - see menuStageReadSlot.
const MENU_STAGE_SLOT = { home: 'home-slot' };

// THE LADDER. `high` draws every frame; `medium` every other one, which is 30
// a second and what a phone gets from the start; `still` draws when something
// changed and otherwise holds the frame it has; `poster` never touches WebGL
// and shows a baked image of the same shot (art/render_stage_poster.js).
const MENU_STAGE_EVERY = { high: 1, medium: 2 };
// Frame-time thresholds, in ms between game-loop frames - NOT between stage
// draws, so `medium` drawing every other frame does not read as slow.
const MENU_STAGE_WINDOW = 20;        // frames per verdict
const MENU_STAGE_MEDIUM_MS = 24;     // under ~42fps, three windows running: high -> medium
const MENU_STAGE_STILL_MS = 50;      // under 20fps, one window: -> still, from either
// A held frame is redrawn this often anyway. Not motion - nothing in a still
// scene has moved - but a resize, a Glow toggle and a restored context all
// leave the canvas stale, and one draw every two seconds is cheaper than
// knowing about each of them.
const MENU_STAGE_STILL_REDRAW = 120;

let menuStage = null;

function menuStageChooseTier() {
    let asked = null;
    try { asked = new URLSearchParams(location.search).get('stage'); } catch (e) { /* no URL to read */ }
    if (asked === 'poster' || asked === 'still') return asked;
    const live = IS_TOUCH_DEVICE ? 'medium' : 'high';
    // `stage=live` is how tests/stagecheck.js asks for the real path past
    // everything below - the harness runs with reduced motion off, but it is
    // also the one place a person can override a guess this function got wrong.
    if (asked === 'live') return live;
    if (REDUCED_MOTION) return 'still';
    const nav = window.navigator || {};
    if (nav.connection && nav.connection.saveData) return 'poster';
    if (nav.deviceMemory && nav.deviceMemory <= 2) return 'still';
    return live;
}

// X: what this module needs from inside bootGame(). See THE SCOPE RULE above.
//   renderer, renderWithBloom(scene, camera, dt), ensureCharModel(name),
//   buildRiggedCharacter(name), disposeObject3D(obj), syncSurface(), screen()
function menuStageInit(X) {
    if (menuStage || !X || !X.renderer) return;
    menuStage = {
        X,
        tier: menuStageChooseTier(),
        wants: 'none',          // the shot the current screen asks for
        scene: null, cam: null, // built on first use, never at boot
        building: false, ready: false,
        surface: false,         // the canvas is currently stage-sized
        shown: false,           // ...and has a frame on it worth fading in
        dirty: true,
        t: 0, owed: 0, tick: 0, sinceDraw: 0, drawn: 0,
        lastAt: 0,
        watch: { sum: 0, n: 0, slow: 0 },
        fighter: null, fighterName: null, wantFighter: MENU_STAGE_FIGHTER_DEFAULT,
        slot: null, slotAge: 0,
        arrive: 0,              // 1 as a fighter lands on the dais, easing to 0
        reacting: 0,            // seconds left of a one-shot clip
        par: { x: 0, y: 0, tx: 0, ty: 0 },   // where the pointer is, eased
        size: new THREE.Vector2(),
        target: new THREE.Vector3(),
    };
    // WHAT THE FRAME SHOWS UNTIL THERE IS A LIVE ONE. The poster tier shows the
    // baked shot, for good. Every other tier waits on an EMPTY set drawn in
    // CSS and fades its first frame in over that.
    //
    // It was the poster for everyone, and that was a jump cut waiting on the
    // window: the live shot is framed by where this particular layout leaves
    // room, while a poster is a photograph of three particular windows. On a
    // 1366x768 laptop the baked fighter was a quarter larger than the live one
    // who replaced him a third of a second later. An empty stage that a
    // fighter arrives on has no size to disagree about.
    document.documentElement.classList.add(menuStage.tier === 'poster' ? 'stage-poster' : 'stage-wait');
    const relaid = () => { if (menuStage) { menuStage.slot = null; menuStage.dirty = true; } };
    window.addEventListener('resize', relaid);
    // The menu scrolls on a short window, and the slot scrolls with it.
    const ov = document.getElementById('ui-overlay');
    if (ov) ov.addEventListener('scroll', relaid, { passive: true });
    // THE SET LEANS TOWARD THE POINTER, a few units of camera, so the pylons
    // slide behind the fighter as the mouse crosses the frame. It is what
    // makes a still backdrop read as a place, and every menu in Valorant does
    // it. Stored here and eased in menuStagePose; nothing is drawn from an
    // event handler.
    const frame = document.getElementById('game-container');
    if (frame) frame.addEventListener('pointermove', (e) => {
        const st = menuStage;
        if (!st || !st.surface) return;
        const r = frame.getBoundingClientRect();
        st.par.tx = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
        st.par.ty = ((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1;
    }, { passive: true });
    // ...and the fighter answers a tap, which is the first thing anyone does
    // to a character standing on a home screen.
    const slotEl = document.getElementById(MENU_STAGE_SLOT.home);
    if (slotEl) slotEl.addEventListener('click', menuStageReact);
    // A lost context takes every texture and program with it. The game's own
    // recovery is its business; the stage's is to stop drawing and let the
    // poster stand, which needs nothing the context held.
    const el = X.renderer.domElement;
    if (el && el.addEventListener) {
        el.addEventListener('webglcontextlost', () => menuStageDemote(menuStage, 'poster'));
    }
    menuStageOnScreen(typeof X.screen === 'function' ? X.screen() : null);
    menuStageRefreshPlate();
}

// The nameplate under the fighter on Home: who the stage is showing, or about
// to. Written here and not in the build because it reads nothing from inside
// bootGame() - and because the stage is the only thing that knows the answer.
//
// The accent goes through accentTextColor() like every other use of a
// fighter's colour as TEXT: Draven's grey and Nyx's violet are both under
// 4.5:1 on this ground as they come.
function menuStageRefreshPlate() {
    const plate = document.getElementById('home-plate');
    const st = menuStage;
    if (!plate || !st) return;
    const c = CHAR_MAP[st.wantFighter];
    if (!c) return;
    const nameEl = document.getElementById('home-plate-name');
    const titleEl = document.getElementById('home-plate-title');
    if (nameEl && nameEl.textContent !== c.name) {
        nameEl.textContent = c.name;
        uiBump(nameEl, 'ac-slam');      // the name lands; see MOTION in the design layer
    }
    if (titleEl) titleEl.textContent = (typeof t === 'function') ? t(c.title) : c.title;
    plate.style.setProperty('--plate-accent', c.color);
    plate.style.setProperty('--plate-text', accentTextColor(c.color));
}

// Called by showScreen() with the screen now showing, or null when a match
// takes the frame.
//
// THE HAND-BACK IS SYNCHRONOUS, and that is the point of this function. On a
// menu the canvas is allowed to fill the roomy frame, up to 1000px tall; a
// match is capped at 1170x650 because the field of view is fixed, so a taller
// canvas would simply SEE more arena than the other player's. If the renderer
// were still stage-sized when the first match frame drew, that is exactly the
// advantage the cap exists to prevent - so the surface is returned here, in
// the same call that hides the menu, before any match code can read a size.
function menuStageOnScreen(name) {
    const gc = document.getElementById('game-container');
    if (gc) gc.setAttribute('data-screen', name || '');
    const st = menuStage;
    if (!st) return;
    st.wants = (name === 'home') ? 'home' : 'none';
    st.slot = null;
    if (st.wants === 'none') menuStageRelease(st);
    else st.dirty = true;
}

function menuStageRelease(st) {
    if (!st.surface) return;
    document.documentElement.classList.remove('stage-live', 'stage-on');
    st.surface = false;
    st.shown = false;
    st.X.syncSurface();
}

function menuStageDemote(st, tier) {
    if (!st || st.tier === tier) return tier;
    st.tier = tier;
    st.dirty = true;
    st.watch.sum = 0; st.watch.n = 0; st.watch.slow = 0;
    // A tier with no clock cannot finish a clip it was half-way through.
    if (!MENU_STAGE_EVERY[tier]) menuStageSettle(st);
    if (tier === 'poster') {
        menuStageRelease(st);
        document.documentElement.classList.remove('stage-wait');
        document.documentElement.classList.add('stage-poster');
    }
    return tier;
}

// One more frame time, in ms. Returns the tier afterwards. A pure function of
// its samples, so tests/stagecheck.js can feed it a slow machine rather than
// hoping the runner is one.
function menuStageWatch(st, ms) {
    const every = MENU_STAGE_EVERY[st.tier];
    if (!every) return st.tier;                 // still and poster have no rate to hold
    const w = st.watch;
    w.sum += ms; w.n++;
    if (w.n < MENU_STAGE_WINDOW) return st.tier;
    const avg = w.sum / w.n;
    w.sum = 0; w.n = 0;
    if (avg > MENU_STAGE_STILL_MS) return menuStageDemote(st, 'still');
    if (st.tier === 'high') {
        w.slow = avg > MENU_STAGE_MEDIUM_MS ? w.slow + 1 : 0;
        if (w.slow >= 3) return menuStageDemote(st, 'medium');
    }
    return st.tier;
}

// ---- the set -------------------------------------------------------------

function menuStageCanvasTexture(size, paint) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    paint(c.getContext('2d'), size);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

function menuStageBuildSet(st) {
    const sc = new THREE.Scene();
    const ground = 0x06080f;
    sc.background = new THREE.Color(ground);
    // Exponential, so the floor and the pylons run OUT rather than stop: there
    // is no far wall here, and a linear fog would draw one.
    sc.fog = new THREE.FogExp2(ground, 0.0030);

    // THREE LIGHTS AND A KICK, and the count never changes after this line -
    // the rim is RETINTED per fighter, which costs a uniform, where swapping a
    // light in or out would cost every program in the scene.
    sc.add(new THREE.HemisphereLight(0xcfe2ff, 0x0b0e16, 0.85));
    const keyLight = new THREE.DirectionalLight(0xfff2e0, 2.1);
    keyLight.position.set(-70, 95, 120);
    sc.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x00f3ff, 2.8);
    rimLight.position.set(80, 45, -95);
    sc.add(rimLight);
    const kickLight = new THREE.DirectionalLight(0xa855f7, 1.3);
    kickLight.position.set(-95, 25, -70);
    sc.add(kickLight);
    st.rimLight = rimLight;

    // The floor: a dark plane so there is a horizon, and a grid over it.
    const floorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(4000, 4000),
        new THREE.MeshBasicMaterial({ color: 0x080b14 }));
    floorMesh.rotation.x = -Math.PI / 2;
    sc.add(floorMesh);
    const gridTex = menuStageCanvasTexture(128, (g, s) => {
        g.clearRect(0, 0, s, s);
        g.strokeStyle = 'rgba(120, 200, 255, 0.9)';
        g.lineWidth = 2;
        g.strokeRect(0, 0, s, s);
    });
    gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
    gridTex.repeat.set(160, 160);
    gridTex.anisotropy = Math.min(8, st.X.renderer.capabilities.getMaxAnisotropy());
    const gridMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(4000, 4000),
        new THREE.MeshBasicMaterial({ map: gridTex, transparent: true, opacity: 0.16, depthWrite: false }));
    gridMesh.rotation.x = -Math.PI / 2;
    gridMesh.position.y = 0.05;
    sc.add(gridMesh);

    // The dais. Six-sided because the accent trim in the arenas is, and lit
    // from its own rim so the fighter reads as standing ON light.
    const dais = new THREE.Mesh(
        new THREE.CylinderGeometry(38, 44, MENU_STAGE_DAIS_TOP, 6),
        // UNLIT. Lit, even a 4%-albedo top face came out pale lavender: it
        // faces straight up into the key, the hemisphere and both rims at
        // once, and was the brightest surface in a frame it is meant to be the
        // floor of. Its edge is drawn by the rings; the slab only has to be
        // dark and take the fog.
        new THREE.MeshBasicMaterial({ color: 0x0b101c }));
    dais.position.y = MENU_STAGE_DAIS_TOP / 2;
    sc.add(dais);
    // toneMapped: false on everything that is meant to be a LIGHT rather than
    // a lit surface. The renderer tone-maps with ACES, which rolls a saturated
    // bright colour off toward grey - correct for a sunlit wall and exactly
    // wrong for a neon edge, which came out the colour of wet slate. Unmapped,
    // it is also bright enough to clear the bloom threshold where there is one.
    const rimMat = new THREE.MeshBasicMaterial({ color: 0x00f3ff, toneMapped: false });
    const hexRing = (radius, tube, y, mat) => {
        const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 6, 6), mat);
        m.rotation.x = Math.PI / 2;
        m.rotation.z = Math.PI / 2;      // the cylinder's corners sit a twelfth of a turn round from the torus's
        m.position.y = y;
        sc.add(m);
        return m;
    };
    hexRing(37.4, 0.8, MENU_STAGE_DAIS_TOP + 0.1, rimMat);
    st.ringIn = hexRing(25, 0.28, MENU_STAGE_DAIS_TOP + 0.1,
        new THREE.MeshBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 0.4, toneMapped: false }));
    hexRing(66, 0.45, 0.2,
        new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.8, toneMapped: false }));
    st.rimMat = rimMat;

    // A soft dark blob where a shadow would be. The renderer has shadow maps on
    // for the arena's sake; nothing here casts into one, so nothing here pays
    // for one.
    const blobTex = menuStageCanvasTexture(128, (g, s) => {
        const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        r.addColorStop(0, 'rgba(0,0,0,0.85)');
        r.addColorStop(0.6, 'rgba(0,0,0,0.35)');
        r.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = r;
        g.fillRect(0, 0, s, s);
    });
    const blob = new THREE.Mesh(
        new THREE.PlaneGeometry(52, 52),
        new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = MENU_STAGE_DAIS_TOP + 0.2;
    sc.add(blob);

    // Pylons, far enough back that fog does most of the drawing. Positions are
    // a fixed table, not random: the poster is a photograph of this set, and
    // the two have to be the same place.
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0x0f1422, roughness: 0.85, metalness: 0.1 });
    const stripA = new THREE.MeshBasicMaterial({ color: 0x00f3ff, toneMapped: false });
    const stripB = new THREE.MeshBasicMaterial({ color: 0xa855f7, toneMapped: false });
    const PYLONS = [
        [-250, -210, 250, 0], [-150, -300, 330, 1], [-60, -390, 420, 0],
        [70, -400, 400, 1], [170, -300, 340, 0], [270, -215, 260, 1],
        [-360, -120, 190, 1], [380, -130, 200, 0],
    ];
    for (const [px, pz, ph, which] of PYLONS) {
        const body = new THREE.Mesh(new THREE.BoxGeometry(26, ph, 26), pylonMat);
        body.position.set(px, ph / 2, pz);
        sc.add(body);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(2.2, ph * 0.72, 0.8), which ? stripB : stripA);
        strip.position.set(px, ph * 0.5, pz + 13.6);
        sc.add(strip);
    }

    // The rift: the "dimensional" in the tagline, as the one bright thing
    // behind the fighter. Additive and unfogged, so it reads as a light source
    // rather than as an object at a distance.
    const riftTex = menuStageCanvasTexture(256, (g, s) => {
        const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        r.addColorStop(0, 'rgba(190, 250, 255, 0.95)');
        r.addColorStop(0.18, 'rgba(0, 243, 255, 0.55)');
        r.addColorStop(0.5, 'rgba(168, 85, 247, 0.22)');
        r.addColorStop(1, 'rgba(168, 85, 247, 0)');
        g.fillStyle = r;
        g.fillRect(0, 0, s, s);
    });
    const rift = new THREE.Mesh(
        new THREE.PlaneGeometry(330, 560),
        new THREE.MeshBasicMaterial({ map: riftTex, transparent: true, opacity: 0.62,
            blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
    rift.position.set(0, 120, -470);
    sc.add(rift);
    st.rift = rift;

    // Motes. Their positions come from a fixed seed for the same reason the
    // pylons are a table.
    let seed = 20261111;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const COUNT = 260;
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
        pos[i * 3] = (rnd() - 0.5) * 520;
        pos[i * 3 + 1] = rnd() * 230;
        pos[i * 3 + 2] = (rnd() - 0.72) * 420;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // A point is a SQUARE unless it is given a picture of something else, and
    // one that drifts close to the camera is a large square - the first shot
    // had a pale grey tile hanging beside the nameplate.
    const moteTex = menuStageCanvasTexture(64, (g, s) => {
        const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        r.addColorStop(0, 'rgba(255,255,255,1)');
        r.addColorStop(0.35, 'rgba(255,255,255,0.55)');
        r.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = r;
        g.fillRect(0, 0, s, s);
    });
    const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
        color: 0x9fefff, size: 3.2, map: moteTex, sizeAttenuation: true, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    sc.add(motes);
    st.motes = motes;

    const holder = new THREE.Group();
    holder.position.y = MENU_STAGE_DAIS_TOP;
    sc.add(holder);
    st.holder = holder;

    st.cam = new THREE.PerspectiveCamera(30, 1, 1, 4000);
    st.scene = sc;
}

// ---- the fighter ---------------------------------------------------------

function menuStageDropFighter(st) {
    const g = st.fighter;
    if (!g) return;
    st.fighter = null;
    st.fighterName = null;
    if (g.parent) g.parent.remove(g);
    const rig = g.userData && g.userData.rig;
    if (rig && rig.mixer) {
        rig.mixer.stopAllAction();
        rig.mixer.uncacheRoot(rig.mixer.getRoot());
    }
    st.X.disposeObject3D(g);
}

// Resolves once `name` is standing on the dais. A newer call wins: a slow
// download for a fighter nobody is waiting for any more is thrown away on
// arrival rather than swapped in over the one they asked for after it.
function menuStageSetFighter(name) {
    const st = menuStage;
    if (!st || !name) return Promise.resolve(false);
    st.wantFighter = name;
    menuStageRefreshPlate();
    if (!st.scene || st.fighterName === name) return Promise.resolve(!!st.scene);
    return st.X.ensureCharModel(name).then((model) => {
        if (st.wantFighter !== name || st.fighterName === name) return false;
        let g = model ? st.X.buildRiggedCharacter(name) : null;
        // The same fallback a match uses when a model will not load: the
        // procedural body. It has no clips, so it simply stands.
        if (!g && typeof PROC_MESH_BUILDERS !== 'undefined' && PROC_MESH_BUILDERS[name] && CHAR_MAP[name]) {
            g = PROC_MESH_BUILDERS[name](CHAR_MAP[name].color);
        }
        if (!g) return false;
        menuStageDropFighter(st);
        const rig = g.userData.rig;
        if (rig && rig.actions && rig.actions.Idle) {
            rig.actions.Idle.reset().play();
            rig.current = 'Idle';
            // Into the clip, so a `still` frame is a pose and not the bind pose
            // the mixer has before its first update.
            rig.mixer.update(0.6);
        }
        st.holder.add(g);
        st.fighter = g;
        st.fighterName = name;
        // What animateWeapon() needs to hold this fighter's weapon at rest: it
        // takes a Fighter and reads four things off it. See menuStageDraw.
        st.poser = { name, mesh: g, atkState: 'idle', atkKind: null, atkStateTimer: 0 };
        st.reacting = 0;
        // ARRIVES, rather than appears: a little small and lit hard from
        // behind, settling over half a second. In a tier with no clock it is
        // simply there.
        st.arrive = MENU_STAGE_EVERY[st.tier] ? 1 : 0;
        const colour = CHAR_MAP[name] && CHAR_MAP[name].color;
        if (colour) { st.rimLight.color.set(colour); st.rimMat.color.set(colour); }
        st.dirty = true;
        return true;
    });
}

function menuStageEnsure(st) {
    if (st.building || st.ready) return;
    st.building = true;
    const go = () => {
        try {
            menuStageBuildSet(st);
        } catch (e) {
            console.warn('[astral] menu stage unavailable:', e && e.message);
            menuStageDemote(st, 'poster');
            return;
        }
        menuStageSetFighter(st.wantFighter).then(() => { st.ready = true; st.dirty = true; });
    };
    // On idle: this is a backdrop, and the first seconds of a visit belong to
    // the page that is actually being read.
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(go, { timeout: 1500 });
    else setTimeout(go, 250);
}

// ---- the frame -----------------------------------------------------------

// WHERE THE FIGHTER STANDS IS THE LAYOUT'S DECISION, and this reads it off the
// page instead of making it again.
//
// The first version framed the shot from the canvas's aspect ratio: wide means
// beside the menu, tall means above it. The CSS made the same decision from
// the window's WIDTH - and at 640x530 the two disagreed, with a single-column
// menu laid over a fighter standing where the second column would have been.
// Two rules for one fact, in two languages, kept in step by hand.
//
// So the page has an empty element where the fighter goes (#home-slot), placed
// by the same grid that places everything else, and the camera is aimed at
// that box. A new breakpoint moves the fighter without this file hearing of it.
function menuStageReadSlot(st) {
    st.slotAge = 0;
    st.slot = null;
    const el = document.getElementById(MENU_STAGE_SLOT[st.wants] || '');
    const surf = st.X.renderer.domElement;
    if (!el || !surf) return;
    const r = el.getBoundingClientRect(), c = surf.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    st.slot = { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
}

function menuStagePose(st) {
    const t = st.t;
    const W = st.size.x, H = st.size.y;
    const cam = st.cam;
    // Re-read now and then even with nothing to say it moved: a web font
    // arriving reflows the menu, and nothing fires an event for that.
    if (!st.slot || st.slotAge++ > 90) menuStageReadSlot(st);
    const slot = st.slot || { x: W * 0.5, y: 0, w: W * 0.5, h: H };
    // SIZE: by whichever of the slot's sides runs out first.
    const fit = Math.max(40, Math.min(slot.h * 0.94, slot.w * 1.5));
    const seen = MENU_STAGE_FIGHTER_SPAN * H / fit;
    const dist = seen / (2 * Math.tan(cam.fov * Math.PI / 360));
    // Low, looking slightly up the fighter. From eye height the frame was
    // mostly the top of the dais.
    cam.position.set(Math.sin(t * 0.17) * 2.2 + st.par.x * 5,
        22 + Math.sin(t * 0.22) * 1.1 - st.par.y * 2.4, dist);
    st.target.set(0, 31, 0);
    cam.lookAt(st.target);
    // PLACE: the camera stays pointed AT the fighter and the picture is slid
    // sideways under it - a lens shift, which is what a view offset is. Turning
    // the camera to put the fighter off-centre keystones the whole set; this
    // is the same image a wider shot would give, cropped.
    const dx = (slot.x + slot.w / 2) - W / 2;
    const dy = (slot.y + slot.h / 2) - H / 2;
    cam.setViewOffset(W, H, -dx, -dy, W, H);     // sets the aspect and the projection too
    st.scene.fog.density = MENU_STAGE_FOG_AT_FIGHTER / dist;
    // A fighter's own +X is its forward. A quarter turn brings that to face
    // the camera; the rest opens the guard stance toward the middle of the
    // frame, since an Idle clip holds the body side-on to its own forward.
    const turn = Math.max(-1, Math.min(1, dx / (W * 0.25)));
    st.holder.rotation.y = -Math.PI / 2 - 0.62 * turn + Math.sin(t * 0.33) * 0.1;
    st.rift.material.opacity = 0.58 + Math.sin(t * 0.6) * 0.07;
    st.motes.rotation.y = t * 0.012;
    st.motes.position.y = Math.sin(t * 0.21) * 5;
    st.ringIn.rotation.z = Math.PI / 2 + t * 0.16;
    const land = st.arrive * st.arrive * (3 - 2 * st.arrive);
    st.holder.scale.setScalar(1 - 0.1 * land);
    st.rimLight.intensity = 2.8 + 6 * land;
}

// One clip, once, and back to Idle: what the fighter does when tapped. Only
// where there is a clock to play it on.
function menuStageReact() {
    const st = menuStage;
    if (!st || !st.fighter || !MENU_STAGE_EVERY[st.tier] || st.reacting > 0) return false;
    const rig = st.fighter.userData.rig;
    if (!rig || !rig.actions || !rig.actions.Jump || !rig.actions.Idle) return false;
    const jump = rig.actions.Jump;
    jump.reset();
    jump.setLoop(THREE.LoopOnce, 1);
    jump.clampWhenFinished = true;
    jump.play();
    jump.crossFadeFrom(rig.actions.Idle, 0.12, false);
    rig.current = 'Jump';
    st.reacting = Math.max(0.3, jump.getClip().duration);
    st.arrive = Math.max(st.arrive, 0.45);     // the rim flares with it
    return true;
}

// Back to Idle, now. Called when a clip runs out, and when the stage steps
// down to a tier that could never have finished it.
function menuStageSettle(st) {
    st.reacting = 0;
    st.arrive = 0;
    const rig = st.fighter && st.fighter.userData.rig;
    if (!rig || !rig.actions || !rig.actions.Idle || rig.current === 'Idle') return;
    const idle = rig.actions.Idle;
    idle.reset();
    idle.play();
    if (rig.actions[rig.current]) idle.crossFadeFrom(rig.actions[rig.current], 0.2, false);
    rig.current = 'Idle';
    st.dirty = true;
}

function menuStageDraw(st, sec) {
    const R = st.X.renderer;
    R.getSize(st.size);
    if (st.size.x < 2 || st.size.y < 2) return false;
    menuStagePose(st);
    const rig = st.fighter && st.fighter.userData.rig;
    if (rig && rig.mixer && sec > 0) rig.mixer.update(sec);
    // THE WEAPON ARM IS NOT THE CLIP'S TO POSE. In a fight the mixer writes
    // every bone and then animateWeapon() runs after it and takes the weapon
    // arm back - that layering is how baked walk and run cycles coexist with
    // the tuned per-character swings. A fighter built on its own gets the clip
    // and not the second half, so the arm simply hangs: Nyx's scythe pointed
    // straight down through the dais and stuck out a body-length below her
    // feet. Same routine, same order, with a stand-in that is never attacking.
    if (st.fighter && st.poser && typeof animateWeapon === 'function') animateWeapon(st.poser);
    // The arena sets an exposure per theme and the stage is not an arena.
    const exposure = R.toneMappingExposure;
    R.toneMappingExposure = 1.0;
    R.setScissorTest(false);
    R.setViewport(0, 0, st.size.x, st.size.y);
    st.X.renderWithBloom(st.scene, st.cam, sec || 0.016);
    R.toneMappingExposure = exposure;
    st.drawn++;
    st.dirty = false;
    st.sinceDraw = 0;
    return true;
}

// Called at the top of renderViews() while a menu owns the frame. `dt` is the
// game's: elapsed time in sixtieths of a second. Returns true when the stage
// has the canvas - drew to it, or is deliberately holding the frame on it.
function menuStageFrame(dt) {
    const st = menuStage;
    if (!st || st.tier === 'poster' || st.wants === 'none') return false;
    // Not under a modal and not behind the loading cover: neither can be seen
    // through, and the first of those blurs whatever is under it, which is
    // cheapest when what is under it has stopped moving.
    const covered = modalStack.length > 0 || (typeof loadingVisible === 'function' && loadingVisible());
    if (!st.ready) {
        if (!covered) menuStageEnsure(st);
        return false;
    }
    if (covered) return st.surface;
    if (!st.surface) {
        document.documentElement.classList.add('stage-live');
        st.X.syncSurface();
        st.surface = true;
        st.dirty = true;
        st.lastAt = 0;
    }
    const sec = Math.max(0, Math.min(0.1, (dt || 1) / 60));
    const every = MENU_STAGE_EVERY[st.tier];
    st.sinceDraw++;
    if (!every) {
        // still: the clock does not run, so two draws of an unchanged scene
        // are the same picture.
        if (!st.dirty && st.sinceDraw < MENU_STAGE_STILL_REDRAW) return true;
        menuStageDraw(st, 0);
    } else {
        const now = performance.now();
        if (st.lastAt) menuStageWatch(st, now - st.lastAt);
        st.lastAt = now;
        st.t += sec;
        st.owed += sec;
        st.arrive = Math.max(0, st.arrive - sec * 2.1);
        const ease = 1 - Math.exp(-sec * 4);
        st.par.x += (st.par.tx - st.par.x) * ease;
        st.par.y += (st.par.ty - st.par.y) * ease;
        if (st.reacting > 0) {
            st.reacting -= sec;
            if (st.reacting <= 0.16) menuStageSettle(st);
        }
        st.tick = (st.tick + 1) % every;
        if (st.tick && !st.dirty) return true;
        menuStageDraw(st, st.owed);
        st.owed = 0;
    }
    if (!st.shown) {
        // AFTER the first frame is on the canvas, so what fades in over the
        // poster is the stage and not a cleared buffer.
        st.shown = true;
        document.documentElement.classList.add('stage-on');
    }
    return true;
}

// ---- for the checkers and the poster script -------------------------------

function menuStageStats() {
    const st = menuStage;
    if (!st) return null;
    return {
        tier: st.tier, wants: st.wants, built: !!st.scene, ready: st.ready,
        surface: st.surface, shown: st.shown, drawn: st.drawn,
        fighter: st.fighterName, showing: st.wantFighter, slot: st.slot,
        reacting: st.reacting > 0,
    };
}

// Draw now and hand back the pixels, in ONE task: the renderer keeps no
// drawing buffer between frames, so a toDataURL any later reads a cleared one.
function menuStageSnapshot(type, quality) {
    const st = menuStage;
    if (!st || !st.ready || !st.surface) return null;
    menuStageDraw(st, 0);
    return st.X.renderer.domElement.toDataURL(type || 'image/png', quality);
}
