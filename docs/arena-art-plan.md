# Deferred: arena art overhaul + five scriptable characters

**Status: parked.** Deliberately postponed until the online-multiplayer refactor lands,
because split-screen renders the scene twice per frame and that is the performance ceiling
this work would run into. Online play gives one camera per client, which roughly halves the
render cost and makes the fidelity budget affordable.

**Delete this file once the work is done.**

## Decisions already made by the user

- **Geometry: redesign it, not just decorate it.** The user explicitly chose "redesign
  geometry too" over the safer materials-and-lighting-only option. That means re-verifying
  `tests/mapscheck.js` (rotational symmetry + reachability) after every map change — those
  properties were hard-won in Batch 26 and a geometry pass can silently undo them.
- **Performance/quality question deferred**, on the grounds that multiplayer removes the
  split-screen cost. Revisit after the refactor; a Graphics cycler in Settings (next to the
  existing `btn-hud-scale`) is still the recommended shape if it is needed.

---

## Verified facts (the expensive part — do not re-derive)

### PolyHaven is directly fetchable, no Blender and no key

`api.polyhaven.com` is public and unauthenticated. The Blender addon just wraps it
(`addon.py` → `download_polyhaven_asset`), so **fetch straight into the repo with curl** and
skip the Blender round-trip entirely for textures and HDRIs.

```
https://api.polyhaven.com/assets?t=textures&c=metal     # listing, by category
https://api.polyhaven.com/files/<asset_id>              # download URLs + byte sizes
```
Send a `User-Agent`; the addon uses `blender-mcp`.

**Inventory confirmed:** textures 857 (floor 265, wall 242, rock 124, brick 106, concrete 80,
sand 60, cobblestone 37, metal 25, tiles 14, sandstone 11, snow 8). HDRIs 993 (skies 299,
pure skies 59, clear 238, sunrise-sunset 221, overcast 134, night 61). Models 521 but only
**1 "creature" and 15 "rigged"** — PolyHaven is *not* a character source. Props/rocks/
industrial/containers/structures are all well stocked and are good for scenery.

### File sizes at 1k JPG (measured on `factory_wall`)

| map | size | notes |
|---|---|---|
| `Diffuse` | 302 KB | base colour |
| `nor_gl` | 234 KB | **use `nor_gl`, NOT `nor_dx`** — three.js is OpenGL convention. Wrong one inverts lighting on Y. |
| `arm` | 159 KB | **AO + Roughness + Metalness packed into R/G/B.** Exactly the glTF ORM convention three.js reads natively. |

**≈695 KB per material set.** Ten sets ≈ 7 MB. A 1k `.hdr` is 1.33 MB (2k is 5.31 MB — too
big for several). Three skies ≈ 4 MB. Total ≈ 11 MB, fine for the repo (`.git` is ~13 MB now).

### Gotchas that will cost hours if forgotten

1. **`aoMap` samples `vUv2` in r128** — verified in `three.min.js`
   (`texture2D( aoMap, vUv2 )`). Any geometry using the packed AO channel needs
   `geo.setAttribute('uv2', geo.attributes.uv)`. Roughness (`.g`) and metalness (`.b`) use
   `vUv` and work without it.
2. **Normal/roughness/AO textures must be `LinearEncoding`**, never sRGB — they are data, not
   colour. `attachSurfaceMaps` already does this correctly; copy that.
3. **Loaders needed** (all confirmed present at `cdn.jsdelivr.net/npm/three@0.128.0/`):
   `examples/js/loaders/RGBELoader.js` for `.hdr`, plus `postprocessing/SSAOPass.js`,
   `shaders/SSAOShader.js`, `shaders/FXAAShader.js` if post-processing is wanted. Vendor them
   into `vendor/` and add to the existing `loadScriptsThen()` chain (index.html:1115-1128) —
   that is already the established pattern for `GLTFLoader`/`SkeletonUtils`.

### Post-processing feasibility (the risky part)

Both split-screen halves render **directly to the default framebuffer**: exactly one
`renderer.render(scene, cam)` per half (index.html:2599), and it is the only `render` call in
the file. No render targets are used for the scene (`envRT` from PMREM is the only
`WebGLRenderTarget`). `renderer.autoClear` is never touched, so each half's own clear is
confined to the scissor rect set just before it — that is *why* the second half does not wipe
the first.

**EffectComposer's passes render a full-screen quad sized to the composer's own targets and do
not honour the outer scissor/viewport.** So bloom in split-screen needs one composer per half
(or per-half render targets), not one global composer. **After the multiplayer refactor there
is only one view, and this problem disappears** — which is a good reason the ordering is right.
Note index.html:5900-5904 records the earlier decision *not* to add EffectComposer (that is why
`addRimOutline` uses an inverted hull).

HUD is a **separate 2D canvas** (`#hudCanvas`, index.html:824) — a composer on the WebGL canvas
cannot affect it. Confirmed.

Bright unlit things a bloom pass would grab, for tuning the threshold: sky dome
(index.html:2156), sun sprite (:2174), brazier flame (:3521), emissive accent rails/cores/orbs
(:3358, :3225, :3171, :3580), Karrigos ember materials (:6864, :6884), damage numbers (:5894).

---

## Arena work

### Materials
Replace the procedural canvas art with PolyHaven PBR sets, per theme, **keeping each map's
identity** via the existing `theme.wallColor`/`floorColor` multiply plus the accent colour.
Roughly 6-10 sets cover all ten maps: metal, concrete/ashlar, sandstone, marble/tiles, rock
(basalt), sand, cobblestone, snow/ice, moss/terrain, coral-ish.

**Do not simply delete the procedural canvases.** They currently carry each map's *glow
signature* — the tech grid, the lava cracks, the ivy — painted into the base colour. Losing
those flattens all ten maps into the same look. Keep them as an **emissive/accent overlay**
layer on top of the photographic base (extract the accent-coloured pixels into an
`emissiveMap`), which is also how a real game layers a base material plus decals.

The ten `wallTex` ids: `metal, ice, sandstone, marble, redrock, basalt, mossstone, cloudmarble,
coralstone, ashlar`. The ten `floorTex` ids: `techgrid, sand, grass, redsand, lava, jungle,
cloud, coralsand, ice, flagstone`. Generators at index.html:3013 (`getWallTexture`) and
index.html:3076 (`getFloorTexture`), cached by `theme.id`.

### Lighting
Current rig (index.html:2611-2635): `AmbientLight(0xbfd6f5, 0.55)`,
`HemisphereLight(0xdcefff, 0x6b5a45, 0.95)`, `DirectionalLight(0xfff4e0, 1.75)` at
`(-1400, 2600, 1600)` casting shadows, `DirectionalLight(0xbcd8ff, 0.4)` fill. All four call
`layers.enableAll()` — **mandatory**, because fighters live on layers 1/2/5 and a light only
lights objects sharing an enabled layer.

Shadow: 2048², frustum ±1000 × ±650, near 1 far 5200, bias -0.0004, normalBias 1.2.

**Bug worth fixing during this work:** `applyLighting(theme)` (index.html:2640) moves
`keyLight.position` per map — as far as `(-2000, 1700, 1100)` for Skyreach Spire — but
**never adjusts the shadow camera frustum**, which stays ±1000 × ±650. So on maps with a
distant sun, parts of the arena fall outside the shadow frustum. Also `fillLight.intensity` is
never overridden and stays 0.4 forever.

Replace the sky-derived PMREM environment (`updateEnvironment`, index.html:2200) with a real
HDRI where it wins; keep the sky-gradient path as the fallback since it is already working and
free.

### Geometry (user chose to redesign)
Non-collidable detail first, since it carries most of the impression and cannot break
gameplay: edge trim and bevels on walls/platforms, better column profiles, PolyHaven props
replacing the primitive scenery.

**Scenery contract that any replacement must honour:**
- `addSolid(mesh, x, y, r)` (index.html:3602) does three things at once: adds to `mapGroup`,
  pushes `{x, y, r}` onto **`OBSTACLES`** (collidable), and pushes `{mesh, x, y}` onto
  **`mapEdgeObjects`**.
- `mapEdgeObjects` is consumed only by `syncArenaCollapse` (index.html:8440), which requires:
  the entry's `mesh` is a **top-level object whose `position.y` starts at 0**, is free to be
  driven downward, and whose `visible` flag is owned by that routine. No opacity/material
  mutation is involved, deliberately.
- Braziers must keep a mesh whose non-uniform Y scale reads as flicker **plus a `PointLight`**
  — that is the `sceneryFlames` contract (`updateScenery`, index.html:3646).
- Banners are decorative: in `mapGroup` and `mapEdgeObjects` but **never** in `OBSTACLES`.
- Corner props use a **hardcoded** radius (14, or 20 for `canyon`) and bypass `_propRadius`.

**Beware the light budget.** Braziers, ice shards and tech pylons each add a `PointLight`, and
pillars add more. Batch 30 established that changing the scene's light count forces three.js to
recompile every material's shader — a multi-hundred-ms stall. Adding lights per prop is exactly
how the crush stutter happened. Keep the count fixed and low.

### Disposal invariants (get these wrong and textures vanish after one round)
- `disposeObject3D` (index.html:2814): skips geometry with `userData.shared`; for materials,
  `userData.shared` returns early (material never disposed at all), while `userData.keepMap`
  only suppresses texture disposal across **7 slots** (`map, normalMap, roughnessMap,
  metalnessMap, aoMap, emissiveMap, alphaMap`) — `m.dispose()` still runs.
- Any newly loaded texture that ends up on a material inside `mapGroup` or inside a fighter
  group **must** be behind `keepMap`, or it is freed on the next `loadMap`.
- `getCachedGeometry`/`getCachedMaterial` stamp `userData.shared`; there is no cache-clear
  function and that is intentional.
- **Pre-existing leak worth fixing:** `buildPlatformMesh` (:3210) and `buildOuterWall` (:3334)
  each `.clone()` the cached wall texture, and those clones live on `keepMap` materials — so
  they are never disposed and **accumulate one clone per platform/wall per `loadMap` call**.

---

## The five scriptable characters

Karrigos (stone titan), Draven (armoured knight), Hollowkin (husk), Grint (scrapling),
Slagling (cinder caster). Chosen because **none needs a convincing human face**, which is the
one thing script-modelling cannot do well — and four of the five are `BOSS_MAP` entries, so
they are AI-only and never player-picked.

Build them in Blender by script, then run the existing `art/pipeline.py` `process(name, obj)`,
which handles orient → ground → weld → measure → rig → bind → bake six clips → export GLB.
Scripted meshes are manifold by construction, so the heat-weighting failure that hit Kaelen
(11,717 UV-seam duplicate vertices → 100% unweighted) cannot occur.

Consider texturing the stone/metal bodies with the same PolyHaven rock/metal sets via
`smart_project` UVs — a stone titan gains far more from a real rock texture than from PBR
factors alone.

### Blocker to fix first: rigged characters are all the same size

`buildRiggedCharacter` scales every model to exactly `RIG_TARGET_HEIGHT = 50` world units
(`inner.scale.setScalar(RIG_TARGET_HEIGHT / m.height)`, index.html:7057). The procedural
builders apply per-character multipliers on the **outer** group instead:

| character | line | multiplier |
|---|---|---|
| Karrigos | index.html:6897 | 1.5 |
| Grint | index.html:6917 | 0.72 |
| Slagling | index.html:6935 | 0.86 |
| Hollowkin | index.html:6951 | 1.08 |

So a rigged Karrigos and a rigged Grint would come out **identical height**. Needs a
`RIG_HEIGHT_MULT` table applied alongside `RIG_TARGET_HEIGHT`. Note `g.userData.rigScale`
(:7076) and `this.isRigged` (:5459) are both currently set and never read.

**Mesh scale is purely visual** — nothing in the simulation reads it. `this.width/height` are
hardcoded 40/40 for every fighter (index.html:4430), `EYE_HEIGHT = 46` and
`MUZZLE_HEIGHT = 34` are single globals, and attack reach is `cfg.range` data. So Karrigos is
a 60-unit-looking model on a 40-unit collision circle, with eyes at the same height as Grint.

### Pre-existing bug found while investigating this
`renderDeathAnim` sets `this.mesh.scale.setScalar(Math.max(0.001, 1 - progress))`
(index.html:5688) — an **absolute** assignment. At `progress = 0` that is 1.0, so **Karrigos
visibly snaps from 1.5× to 1.0× the instant he starts dying.** The crush cinematic clobbers the
group scale the same way (:5757-5759). There is no stored base scale; it only self-heals
because `initMesh()` builds a fresh group each round. Fix by storing a base scale and
multiplying, not assigning.

---

---

## Two reported bugs to fix as part of this work

### 1. Specials and dash snap to a new position with no motion, and stutter sometimes

Reported for Kaelen in particular: using the special teleports him to the new location in a
single frame with no travel, and **dash has no animation either**.

Cause is confirmed by the code, in two independent parts:

- **The snap is by design and needs a visual layer.** `teleportTo(dx, dy)` moves the fighter
  instantly, and `render3D` copies the simulation position straight onto the mesh every frame
  (`this.mesh.position.set(worldX(...), this.z, worldZ(...))`, index.html:5580-ish). So any
  teleport is a one-frame jump by construction. Every mechanic built on it is affected:
  Kaelen's Blade Dash, Voss's Shadow Flurry blink, Nyx's Death's Embrace pull, Karrigos'
  Charge, and `tryDodge` (`DODGE_DIST = 70`, index.html:4241). Note `animateWeapon` *does*
  have a `dash` case and `SPECIAL_ANIMS` entries — so the **arm** animates while the **body**
  teleports, which is probably why it reads as broken rather than merely fast.
  Fix: give the mesh its own smoothed visual position that eases toward the simulation
  position over a few frames (keeping the simulation instant, so hitboxes and i-frames are
  unchanged), plus a dash trail / afterimages to sell the travel. Do **not** slow the actual
  teleport — the i-frame timing is tuned against it.
- **The stutter is likely the Batch 30 problem again.** Specials push new effect entries and
  `syncEffects` builds their meshes on demand, allocating geometry and materials per use;
  first use of each effect type also compiles a new shader. That is the same signature as the
  crush stutter (measured there: programs 11 → 27, one 2183 ms frame). Verify with
  `ACDebug.rendererInfo()` before/after firing each special, then pre-warm the effect
  geometry/material via `getCachedGeometry`/`getCachedMaterial` and `renderer.compile()`,
  exactly as `buildCrushRigs` now does.

### 2. The first-person arm looks detached — you can see inside it

Confirmed defect in my own Batch 28 geometry, not a perception issue. `buildViewmodelArm`
creates the bracer as
`new THREE.CylinderGeometry(2.1, 2.35, 6.2, 12, 1, true)` — the trailing `true` is
**`openEnded`**, so the cylinder has no end caps. With default `FrontSide` culling the far
interior wall is discarded, so you see straight through the tube to the background, which
reads as the arm being severed. The screenshot the user supplied shows exactly this: the open
ring of the bracer's elbow end.

Fix: close the bracer (drop `openEnded`, or add a cap disc), and overlap the forearm, bracer
and palm so they read as one continuous limb rather than three abutting solids. Worth doing
early and separately from the rest of this file — the viewmodel is on screen every frame of
every match, so it is the most-seen art in the game.

---

## Verification when this is picked up again

- `node tests/mapscheck.js` after **every** geometry change — symmetry and reachability are
  the properties most at risk from a geometry pass.
- `node tests/smoke.js`, `tests/crushcheck.js`, `tests/batch24check.js` for regressions.
- Screenshots across contrasting themes (Voltaic Nexus, Molten Foundry, Coral Hollow at
  minimum) — the material and lighting bugs in this area have consistently been invisible to
  assertions and obvious in a rendered frame.
- Watch `renderer.info.programs` before/after: a jump means shaders are recompiling, which is
  the stutter signature from Batch 30.
