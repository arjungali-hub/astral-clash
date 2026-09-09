# Remaining art work

**Most of this file's original contents shipped in Batches 34 and 35 and have
been removed.** What is left is listed below. See `CHECKLIST.md` for what was
done and why.

## Shipped (was the bulk of this plan)

- Photographic PBR surfaces on walls, floors, platforms and columns, with each
  map's procedural canvas kept as an emissive accent overlay so the ten arenas
  stay distinguishable. Batch 34.
- The whole 14-character roster generated with Rodin and rigged through
  `art/pipeline.py`. Batch 35. This **supersedes** the "five scriptable
  characters" section: Rodin turned out not to be blocked (the key is
  blender-mcp's shared free-trial key, and its communal balance had refilled),
  so all thirteen missing characters were generated rather than five scripted.
- Every bug the plan had recorded: the open-ended bracer, the teleport with no
  motion, the fixed shadow frustum, the never-overridden fill light, Karrigos'
  death-animation scale snap, the per-mesh texture clone leak, and the
  `RIG_HEIGHT_MULT` blocker.

## Still to do

### 1. Arena geometry redesign (the user explicitly chose this over materials-only)

Batches 34-35 re-*surfaced* the arenas; the **structure** is unchanged. The
non-collidable detail is where the remaining impression is, and it cannot break
gameplay: edge trim and bevels on walls and platforms, better column profiles,
and PolyHaven props replacing the primitive scenery.

**Run `node tests/mapscheck.js` after every geometry change.** Rotational
symmetry and reachability were hard-won in Batch 26 and a geometry pass can
silently undo them.

**Scenery contract any replacement must honour:**
- `addSolid(mesh, x, y, r)` does three things at once: adds to `mapGroup`, pushes
  `{x, y, r}` onto **`OBSTACLES`** (collidable), and pushes `{mesh, x, y}` onto
  **`mapEdgeObjects`**.
- `mapEdgeObjects` is consumed only by `syncArenaCollapse`, which requires the
  entry's `mesh` to be a **top-level object whose `position.y` starts at 0**, be
  free to be driven downward, and have its `visible` flag owned by that routine.
  No opacity or material mutation is involved, deliberately.
- Braziers must keep a mesh whose non-uniform Y scale reads as flicker **plus a
  `PointLight`** - that is the `sceneryFlames` contract in `updateScenery`.
- Banners are decorative: in `mapGroup` and `mapEdgeObjects` but **never** in
  `OBSTACLES`.
- Corner props use a hardcoded radius (14, or 20 for `canyon`) and bypass
  `_propRadius`.

**Beware the light budget.** Braziers, ice shards and tech pylons each add a
`PointLight`. Batch 30 established that changing the scene's light count forces
three.js to recompile every material's shader - a multi-hundred-ms stall, and
exactly how the crush stutter happened. Keep the count fixed and low.

### 2. A real HDRI environment (optional)

`updateEnvironment` builds a PMREM from the sky-gradient canvas. It works and is
free, but it is dim and mostly one hue, which is why Batch 34 had to cap
metalness at 0.45 and lift `envMapIntensity` to compensate - a fully metallic
surface has no diffuse term and renders near-black against it. A 1k `.hdr` is
~1.33 MB (2k is 5.31 MB, too big for several) and needs
`examples/js/loaders/RGBELoader.js` vendored into `vendor/` and added to the
existing `loadScriptsThen()` chain. Keep the gradient path as the fallback.

### 3. Post-processing (now unblocked, still not done)

Bloom would suit the emissive accents. The blocker was split-screen: an
`EffectComposer` pass renders a full-screen quad and does not honour the outer
scissor/viewport, so it needed one composer per half. **Online play removed the
second view, so that problem is gone.** Note `index.html` records an earlier
decision *not* to add `EffectComposer` (which is why `addRimOutline` uses an
inverted hull), so this is a reversal to make deliberately.

Bright unlit things a bloom pass would grab, for threshold tuning: the sky dome,
the sun sprite, brazier flames, emissive accent rails/cores/orbs, Karrigos'
ember materials, and damage numbers.

## Reference facts worth not re-deriving

- **PolyHaven needs no key.** `api.polyhaven.com` is public; send a
  `User-Agent`. `?t=textures&c=<category>` lists, `/files/<id>` gives download
  URLs. Textures 857, HDRIs 993, but only **1 creature and 15 rigged models** -
  it is not a character source.
- Use **`nor_gl`, never `nor_dx`** - three.js is OpenGL convention and the
  DirectX variant has Y inverted, which lights every surface backwards.
- **`arm` packs AO+Roughness+Metalness into R/G/B**, exactly the glTF ORM
  convention three.js reads natively: one file, three material slots.
- **`aoMap` samples `vUv2` in r128** (verified in `three.min.js`), so any
  geometry using the packed AO channel needs a `uv2` attribute - see
  `ensureUV2`. Roughness and metalness use `vUv` and work without it.
- **Normal/roughness/AO must be `LinearEncoding`**, never sRGB: they are data,
  not colour.
- **Rodin's `bbox_condition` is not a hint** - it stretched a humanoid into a
  cone. Control proportion through the prompt.
- **Blender's glTF importer normalises to Z-up.** Do not "detect" the up axis
  from extents; a wide T-pose defeats it (see `orient_and_ground`).
- **Drive Blender headless** (`--background --python`), not through the MCP
  bridge: the bridge blocks the main thread and times out, and neither a worker
  thread nor a `bpy.app.timers` callback has a valid operator context.
