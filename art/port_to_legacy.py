# -*- coding: utf-8 -*-
r"""Ports the art, font and balance work from index.html into the archived
local split-screen build.

    python art/port_to_legacy.py

legacy/local-splitscreen.html is a FORK, not a shared module: it was archived
verbatim before the online refactor because the two builds differ in their
renderer, input model and HUD layout, and keeping both live in one file was
exactly the half-wired state that refactor set out to avoid. That decision
stands - but it should not mean the archived build is frozen at the art it
happened to have on the day. It is still the only way to play on one machine,
and it is what a phone is redirected to.

So the SELF-CONTAINED improvements get ported: fonts, the character roster,
the photographic arena surfaces, and the lighting and leak fixes that came with
them. Anything entangled with the online refactor (the room, names, netcode)
deliberately does not, because it has no meaning in a split-screen build.

This is a script rather than a one-off edit so the next art batch can re-run it
instead of re-deriving what to copy. Every block is extracted from index.html by
its own anchors, so it cannot drift from the live version; paths are rewritten
from `assets/` to `../assets/` because the archive lives one directory down.
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'index.html')
DST = os.path.join(ROOT, 'legacy', 'local-splitscreen.html')


def block(text, start_marker, end_marker, name='block'):
    """The text from start_marker up to (not including) end_marker."""
    i = text.index(start_marker)
    j = text.index(end_marker, i)
    out = text[i:j]
    assert len(out) > 40, name
    return out


# `required=False` means "skip if the anchor is gone". Used by every step whose
# anchor gets consumed on first application, because this script is designed to
# be re-run after each batch - an idempotency failure here aborts the port
# halfway and leaves a half-updated build, which is worse than doing nothing.
def rep(hay, old, new, label, required=True):
    n = hay.count(old)
    if n != 1:
        if not required:
            print('  %-34s SKIPPED (%d matches)' % (label, n))
            return hay
        raise AssertionError('%s: %d matches for %r' % (label, n, old[:90]))
    print('  %-34s ok' % label)
    return hay.replace(old, new, 1)


def main():
    src = io.open(SRC, encoding='utf-8').read()
    dst = io.open(DST, encoding='utf-8').read()
    before = len(dst)

    # ------------------------------------------------------------- routing
    # The archived build links back to the root, not to /index.html - Vercel
    # already serves index.html there, and a bare domain is the address people
    # actually use.
    dst = dst.replace("location.href = '../index.html' + location.search;",
                      "location.href = '/' + location.search;")

    # --------------------------------------------------------- mobile notice
    # /local must refuse to run on a phone too.
    #
    # Batch 33 sent mobile users HERE, on the grounds that this build still has
    # touch controls. Then someone actually played it: "when I tried it on
    # mobile it was really bad and hard to play". Offering a worse experience is
    # not a kindness, so the archived build now shows the same single message
    # the main one does, and nothing else.
    if 'id="desktop-only"' not in dst:
        notice = block(src, "    <!-- ONE MESSAGE, NO ESCAPE HATCHES (Batch 41).",
                       "\n    <div id=\"cdn-error\">", 'notice markup')
        dst = rep(dst, '    <div id="cdn-error">', notice + '\n    <div id="cdn-error">',
                  'desktop-only notice markup', required=False)
        css = block(src, "        #desktop-only {", "        #cdn-error {", 'notice css')
        dst = rep(dst, "        #cdn-error {", css + "        #cdn-error {",
                  'desktop-only notice css', required=False)
        # Show it on a touch device. Anchored to `const TOUCH_UI = ...`,
        # which is unique - `if (TOUCH_UI) {` appears TWICE in this build,
        # so a rep on that silently skipped and the notice was inserted
        # with nothing to display it. TOUCH_UI is the same coarse-pointer
        # plus real-touch-points test the main build uses for
        # IS_TOUCH_DEVICE, so it is reused rather than declared a second
        # time where the two could drift apart.
        touch_anchor = 'const TOUCH_UI = !!(window.matchMedia'
        if touch_anchor in dst and "getElementById('desktop-only')" not in dst:
            k = dst.index(chr(10), dst.index(touch_anchor)) + 1
            wiring = (
                '// Batch 41: a touch device gets the notice and nothing else. The touch',
                '// control scheme is still in this build, but it is not good enough to',
                '// send anyone to - which is why the main build stopped offering it.',
                'if (TOUCH_UI) {',
                "    const dOnly = document.getElementById('desktop-only');",
                "    if (dOnly) dOnly.style.display = 'flex';",
                '}',
            )
            dst = dst[:k] + chr(10).join(wiring) + chr(10) + dst[k:]
            print('  %-34s ok' % 'desktop-only notice wiring')

    # ------------------------------------------------- gameplay + visuals
    # Widened after "for the legacy sync gap widen the scope to everything you
    # think are relevant". The rule applied here: anything that changes how the
    # game LOOKS or PLAYS belongs in the archived build; only machinery that is
    # meaningless without a network connection stays behind.
    #
    # Carried:   the teleport smear and its camera fix, the projectile sphere
    #            and material cache, the extracted first-person arm, the
    #            death/crush scale fix, the tutorial auto-open flag, the roster
    #            faces, and the armory's full-page layout.
    # Not carried: the room, player names, netcode, away-pause, the online-only
    #            mode list, and anything keyed on LOCAL_SIDE - a split-screen
    #            build has two local players and no peer, so none of it applies.

    # --- teleport smear -----------------------------------------------------
    if 'TELEPORT_VIS_DECAY' not in dst:
        consts = block(src, "// \"r,g,b\" - the form the effect system's `color` field takes",
                       "function hexToCss(", 'teleport consts')
        dst = rep(dst, "function hexToCss(", consts + "function hexToCss(",
                  'teleport constants', required=False)
    if 'this.visOffX = 0;' not in dst:
        init = block(src, "        // Batch 34: a VISUAL-ONLY position offset",
                     "\n    }", 'visOff init')
        dst = rep(dst, "        this.effects = [];", "        this.effects = [];\n" + init,
                  'visual offset state', required=False)
    if 'decayVisualOffset' not in dst:
        decay = block(src, "    // The teleport smear decays once per SIMULATION step",
                      "    update(opponent, dt) {", 'decay')
        dst = rep(dst, "    update(opponent, dt) {\n        this.vx = 0;",
                  decay + "    update(opponent, dt) {\n        this.decayVisualOffset(dt);\n        this.vx = 0;",
                  'decayVisualOffset', required=False)
    if 'const fromX = this.x, fromY = this.y;' not in dst:
        tp = block(src, "    teleportTo(dx, dy) {", "\n    // Reactive AI for a bot-controlled fighter", 'teleportTo')
        i = dst.find("    teleportTo(dx, dy) {")
        if i != -1:
            j = dst.index("\n    // Reactive AI for a bot-controlled fighter", i)
            dst = dst[:i] + tp + dst[j:]
            print('  %-34s ok' % 'teleportTo smear + streak')
    # The camera half - the piece that made the smear visible to the player
    # using it rather than only to the opponent.
    if 'f.visOffX || 0' not in dst:
        dst = rep(dst,
                  "    const cx = f.x + f.width / 2, cy = f.y + f.height / 2;\n"
                  "    const ex = worldX(cx), ey = f.z + EYE_HEIGHT, ez = worldZ(cy);",
                  "    // Batch 37: the camera follows the VISUAL position, offset included -\n"
                  "    // without this the smear is only ever visible to the OPPONENT.\n"
                  "    const cx = f.x + f.width / 2 + (f.visOffX || 0);\n"
                  "    const cy = f.y + f.height / 2 + (f.visOffY || 0);\n"
                  "    const ex = worldX(cx), ey = f.z + EYE_HEIGHT, ez = worldZ(cy);",
                  'camera follows the smear', required=False)

    # --- projectiles: a lit sphere, and nothing allocated per shot ----------
    if 'projCoreSphere' not in dst:
        i = dst.find("                const c = new THREE.Color(p.color || '#00f3ff');")
        if i != -1:
            j = dst.index("                scene.add(grp);", i) + len("                scene.add(grp);")
            newproj = block(src, "                // Batch 37: a lit 3D bolt, and NOTHING allocated per shot.",
                            "                scene.add(grp);", 'projectile') + "                scene.add(grp);"
            dst = dst[:i] + newproj + dst[j:]
            print('  %-34s ok' % 'projectile sphere + cache')
            dst = dst.replace(
                "            const flick = 0.8 + Math.sin(arenaTime * 0.6 + p.x) * 0.2; // subtle energy shimmer\n"
                "            p.mats[2].opacity = 0.25 * flick;",
                "            const flick = 0.92 + Math.sin(arenaTime * 0.6 + p.x) * 0.08;\n"
                "            if (p.halo) p.halo.scale.setScalar(flick * (p.big ? 1.7 : 1));", 1)

    # --- the death / crush scale fix ---------------------------------------
    if 'meshBaseScale' not in dst:
        dst = rep(dst, "        this.isRigged = !!group.userData.rigged;",
                  "        this.isRigged = !!group.userData.rigged;\n"
                  "        // Batch 34: MULTIPLY by the builder's scale, never assign over it -\n"
                  "        // otherwise Karrigos snaps from 1.5x to 1.0x the moment he dies.\n"
                  "        this.meshBaseScale = group.scale.x || 1;",
                  'meshBaseScale', required=False)
        dst = dst.replace("        this.mesh.scale.setScalar(scale);",
                          "        this.mesh.scale.setScalar(this.meshBaseScale * scale);", 1)
        dst = dst.replace(
            "            this.mesh.scale.x = 1 - 0.30 * t + tremor;\n"
            "            this.mesh.scale.z = 1 - 0.06 * t;\n"
            "            this.mesh.scale.y = 1 + 0.14 * t;",
            "            const bs = this.meshBaseScale;\n"
            "            this.mesh.scale.x = bs * (1 - 0.30 * t + tremor);\n"
            "            this.mesh.scale.z = bs * (1 - 0.06 * t);\n"
            "            this.mesh.scale.y = bs * (1 + 0.14 * t);", 1)

    # --- the tutorial's auto-open flag -------------------------------------
    if 'function openTutorial(auto)' not in dst:
        dst = rep(dst, "function openTutorial() {\n    buildTutorialControls();\n    openModal('tutorial');\n}",
                  "// Batch 37: the \"don't show automatically\" checkbox is hidden when you\n"
                  "// opened this deliberately - offering to stop something that is not\n"
                  "// happening implies the button you just pressed was an accident.\n"
                  "function openTutorial(auto) {\n"
                  "    buildTutorialControls();\n"
                  "    const row = document.getElementById('tutorial-hide-row');\n"
                  "    if (row) row.style.display = auto ? '' : 'none';\n"
                  "    openModal('tutorial');\n}",
                  'tutorial auto flag', required=False)
        dst = dst.replace('<label class="tutorial-hide-row">',
                          '<label class="tutorial-hide-row" id="tutorial-hide-row">', 1)
        dst = dst.replace("document.getElementById('btn-open-tutorial').addEventListener('click', openTutorial);",
                          "document.getElementById('btn-open-tutorial').addEventListener('click', () => openTutorial(false));", 1)
        dst = dst.replace("if (!safeLSGet('astralClashTutorialSeen')) openTutorial();",
                          "if (!safeLSGet('astralClashTutorialSeen')) openTutorial(true);", 1)

    # --- the first-person arm, cut from the character mesh -----------------
    # Claimed as carried in Batch 40 and in fact never ported: the script had
    # prose about it and no step. The archived build is first-person too, so it
    # wants the real arm exactly as much as the online one does.
    if 'buildViewmodelArmFromModel' not in dst:
        arm = block(src, "// The bones whose geometry becomes the viewmodel arm.",
                    "\nfunction buildViewmodelArm(f) {", 'arm extraction')
        dst = rep(dst, "function buildViewmodelArm(f) {",
                  arm + "\nfunction buildViewmodelArm(f) {", 'arm extraction', required=False)
        # ...and use it, with the procedural arm as the fallback it already is.
        dst = rep(dst, "    holder.add(buildViewmodelArm(f));",
                  "    const armGroup = buildViewmodelArmFromModel(f) || buildViewmodelArm(f);\n"
                  "    holder.userData.armFromModel = !!armGroup.userData.fromModel;\n"
                  "    armGroup.updateMatrix();\n"
                  "    holder.userData.handPoint = armGroup.userData.handPoint\n"
                  "        ? armGroup.userData.handPoint.clone().applyMatrix4(armGroup.matrix)\n"
                  "        : null;\n"
                  "    holder.add(armGroup);", 'arm used by viewmodel', required=False)
        # The weapon goes in the measured hand when there is one.
        dst = rep(dst, "    prop.position.set(-0.6, -0.8, 1.2);",
                  "    if (holder.userData.handPoint) prop.position.copy(holder.userData.handPoint);\n"
                  "    else prop.position.set(-0.6, -0.8, 1.2);", 'weapon in the measured hand', required=False)
        # NOT the placement constants. The extraction block above already
        # contains ARM_CHAIN, VM_ARM_LENGTH, VM_ARM_ANCHOR and VM_AIM (they
        # sit between that comment and buildViewmodelArm), and inserting
        # them again declared VM_ARM_LENGTH twice - a fatal redeclaration
        # that took the whole archived build down at load.
        # _armTriangles and _armBoneIndices are inside that block too.

    # --- roster faces -------------------------------------------------------
    if 'function faceUrl(' not in dst:
        face = block(src, "// Batch 37: the circles hold the character's FACE.",
                     "function paintSlotPortrait(", 'faceUrl')
        face = face.replace("'assets/faces/'", "'../assets/faces/'")
        dst = rep(dst, "function buildGrid(gridId, keyList, side) {",
                  face + "function buildGrid(gridId, keyList, side) {",
                  'faceUrl helper', required=False)
        dst = dst.replace(
            '        btn.innerHTML = `<span><span class="fkey">${keyList[i].toUpperCase()}</span><span class="fname">${c.name}</span></span><span class="ftitle">${c.title}</span>`;',
            '        btn.innerHTML =\n'
            '            `<span class="fface" style="background-color:${c.color};background-image:url(\'${faceUrl(c.name)}\')"></span>`\n'
            '            + `<span class="fmeta"><span><span class="fkey">${keyList[i].toUpperCase()}</span><span class="fname">${c.name}</span></span>`\n'
            '            + `<span class="ftitle">${c.title}</span></span>`;', 1)
        facecss = block(src, "        /* Batch 37: the roster card's face chip. */",
                        "\n        .pslot-portrait {", 'face css')
        dst = dst.replace("        .fighter-grid {", facecss + "        .fighter-grid {", 1)
        print('  %-34s ok' % 'roster face chips')

    # ------------------------------------------------------------- balance
    # Reported as "most of the changes seem to have not landed in the legacy
    # version - like the step-up, for example", and that was exactly right:
    # the first version of this script ported art and fonts only, while the
    # request had been "art/font/balance updates". Rules and tuning drifted
    # immediately - the archived build still called a mode Time Attack, still
    # let you ride a waist-high block, still gave the ranged fighters 100 extra
    # HP, and still collapsed the arena on the old 20s/6s clock.
    #
    # Every item below is extracted from index.html by its own anchors, so the
    # two builds cannot disagree about a number again. Anything whose meaning
    # depends on the online refactor is still excluded on purpose.
    # MAX_WALK_STEP_UP: 30 -> 12. The one the report actually named.
    step = block(src, "// Rises up to this are walkable on foot", "\nconst MAX_WALK_STEP_UP = 12;") + "\nconst MAX_WALK_STEP_UP = 12;"
    i = dst.index("const MAX_WALK_STEP_UP = ")
    j = dst.index("\n", i)
    dst = dst[:i] + step.lstrip("\n") + dst[j:]
    print('  %-34s ok' % 'MAX_WALK_STEP_UP')

    # The retimed arena collapse.
    grace = block(src, "// Batch 38: the collapse is much less hurried.", "const SHRINK_FRAC_STEP", 'grace')
    i = dst.index("const GRACE_PERIOD = ")
    j = dst.index("const SHRINK_FRAC_STEP", i)
    dst = dst[:i] + grace + dst[j:]
    print('  %-34s ok' % 'GRACE_PERIOD + SHRINK_INTERVAL')

    crushfrac = block(src, "// Once the collapse fraction passes this", "const CRUSH_DPS", 'crush frac')
    i = dst.index("const CRUSH_AT_FRAC = ")
    j = dst.index("const CRUSH_DPS", i)
    dst = dst[:i] + crushfrac + dst[j:]
    print('  %-34s ok' % 'CRUSH_AT_FRAC + arithmetic')

    # The mode rename. The ID stays `timeattack` in both builds.
    mode = block(src, "    // Batch 38: \"Time Attack\" named the one thing", "\n    { id: 'boss'")
    i = dst.index("    { id: 'timeattack',")
    j = dst.index("\n    { id: 'boss'", i)
    dst = dst[:i] + mode.lstrip("\n") + dst[j:]
    print('  %-34s ok' % 'Takedown Race rename')

    # No collapse in the Takedown Race.
    if "matchMode === 'timeattack') return;" not in dst:
        guard = block(src, "    // Batch 38: no collapse in the Takedown Race either.", "    if (!crushing) {", 'guard')
        dst = rep(dst, "    if (isCoopMode()) return;\n    if (!crushing) {",
                  "    if (isCoopMode()) return;\n" + guard + "    if (!crushing) {",
                  'no collapse in Takedown Race')

    # Ranged health. Matched inside each character's own entry.
    for name, old_hp, new_hp in [('Lyra', 360, 260), ('Seraphine', 380, 280), ('Aurelia', 340, 240)]:
        k = dst.index("name: '%s'" % name)
        h = dst.find("hp: %d" % old_hp, k, k + 400)
        if h == -1:
            print('  %-34s already %d' % (name + ' hp', new_hp))
            continue
        dst = dst[:h] + ("hp: %d" % new_hp) + dst[h + len("hp: %d" % old_hp):]
        print('  %-34s %d -> %d' % (name + ' hp', old_hp, new_hp))

    # Zone Control clears its own ring.
    if 'const clearZone' not in dst:
        zone = block(src, "    // Copies, not live references", "\n    OBSTACLES.forEach(ob =>")
        i = dst.index("    // Copies, not live references")
        j = dst.index("    map.obstacles.forEach(ob =>", i)
        dst = dst[:i] + zone.lstrip("\n") + "\n" + dst[j:]
        dst = dst.replace("    map.obstacles.forEach(ob => mapEdgeObjects.push({ mesh: buildPillarMesh(ob, theme), x: ob.x, y: ob.y }));",
                          "    OBSTACLES.forEach(ob => mapEdgeObjects.push({ mesh: buildPillarMesh(ob, theme), x: ob.x, y: ob.y }));", 1)
        print('  %-34s ok' % 'Zone Control ring clear')

    # ---------------------------------------------------------------- fonts
    # COUNT, not presence: re-running must not stack a second copy of the
    # @font-face blocks into the file.
    if '@font-face' not in dst:
        fontcss = block(src, "        /* ---- Batch 36: the game's own typeface", "        body {\n            margin: 0;", 'font css')
        fontcss = fontcss.replace("url('assets/fonts/", "url('../assets/fonts/")
        dst = rep(dst, "        body {\n            margin: 0;", fontcss + "        body {\n            margin: 0;", 'font-face blocks', required=False)
    dst = rep(dst,
              "            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;",
              "            font-family: var(--font-ui);\n"
              "            font-feature-settings: 'tnum' 1;\n"
              "            font-variation-settings: 'CASL' 0, 'MONO' 0;",
              'body font stack', required=False)

    hudfont = block(src, "// Batch 36: the HUD cut, at a whole pixel size.", "function cycleHudScale()", 'hudFont')
    old_hudfont = "function hudFont(px, bold) { return `${bold ? 'bold ' : ''}${Math.round(px * HUD_TEXT_SCALE)}px sans-serif`; }\n"
    dst = rep(dst, old_hudfont, hudfont, 'hudFont', required=False)

    families = block(src, "// Plain strings, because ctx.font is a string", "// Batch 36: the HUD cut, at a whole pixel size.", 'font families')
    # Guard on the DEFINITION, not the bare name. Keying on the name silently
    # skipped this: hudFont's own body REFERENCES HUD_FAMILY, so inserting the
    # hudFont block a few lines above put the name in the file and satisfied
    # the guard. Same trap hit getTiledWallTexture, whose name appears in a
    # comment inside the photo block. The legacy build then died at load with
    # "getTiledWallTexture is not defined".
    if 'const HUD_FAMILY' not in dst:
        anchor = "let HUD_TEXT_SCALE = parseFloat(safeLSGet('astralClashHudScale')) || 1;"
        dst = rep(dst, anchor, anchor + "\n" + families, 'font families + preload')

    # Announcements: the same canvas sites exist in both files.
    n = dst.count('px sans-serif')
    dst = dst.replace("hudCtx.font = `bold ${fontPx}px sans-serif`;", "hudCtx.font = announceFont(fontPx, 700);")
    dst = dst.replace("ctx.font = 'bold 20px sans-serif';", "ctx.font = announceFont(20, 700);")
    dst = re.sub(r"hudCtx\.font = `bold \$\{Math\.round\((W \* [0-9.]+)\)\}px sans-serif`;",
                 lambda m: "hudCtx.font = announceFont(%s, 800);" % m.group(1), dst)
    dst = re.sub(r"hudCtx\.font = `\$\{Math\.round\((W \* [0-9.]+)\)\}px sans-serif`;",
                 lambda m: "hudCtx.font = announceFont(%s, 500);" % m.group(1), dst)
    print('  %-34s %d -> %d' % ('canvas announcement fonts', n, dst.count('px sans-serif')))

    # ------------------------------------------------------ character roster
    roster = block(src, "const CHAR_MODEL_URLS = {", "const charModels = {}", 'roster')
    roster = roster.replace("'assets/chars/", "'../assets/chars/")
    old_roster = block(dst, "const CHAR_MODEL_URLS = {", "const charModels = {}", 'legacy roster')
    dst = rep(dst, old_roster, roster, 'CHAR_MODEL_URLS + RIG_HEIGHT_MULT', required=False)

    # The rig scale is per character now.
    dst = rep(dst, "    inner.scale.setScalar(RIG_TARGET_HEIGHT / m.height);",
              "    const rigTarget = rigHeightFor(name);   // per-character; see RIG_HEIGHT_MULT\n"
              "    inner.scale.setScalar(rigTarget / m.height);", 'per-character rig height', required=False)
    dst = rep(dst, "    g.userData.rigScale = RIG_TARGET_HEIGHT / m.height;",
              "    g.userData.rigScale = rigTarget / m.height;", 'rigScale', required=False)

    # ------------------------------------------------ photographic surfaces
    photo = block(src, "// ===========================================================================\n"
                       "// Batch 34: PHOTOGRAPHIC ARENA SURFACES",
                  "const wallTextureCache = {};", 'photo layer')
    photo = photo.replace("const PHOTO_BASE = 'assets/tex/';", "const PHOTO_BASE = '../assets/tex/';")
    if 'const PHOTO_SETS = {' not in dst:
        dst = rep(dst, "const wallTextureCache = {};", photo + "const wallTextureCache = {};", 'photo surface layer', required=False)

    tiled = block(src, "// Batch 34: see the note in buildPlatformMesh. A clone is needed per distinct",
                  "function getWallTexture(theme) {", 'tiled cache')
    if 'function getTiledWallTexture(' not in dst:
        dst = rep(dst, "function getWallTexture(theme) {", tiled + "function getWallTexture(theme) {", 'tiled wall cache', required=False)

    # Wire the three surfaces. The legacy builders are byte-identical to what
    # index.html had before Batch 34, so the same replacements apply.
    dst = rep(dst,
              "    const tex = getWallTexture(theme).clone();\n"
              "    tex.needsUpdate = true;\n"
              "    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;\n"
              "    tex.repeat.set(Math.max(1, Math.round(p.hw / 40)), Math.max(1, Math.round(p.height / 60)));",
              "    const tex = getTiledWallTexture(theme,\n"
              "        Math.max(1, Math.round(p.hw / 40)),\n"
              "        Math.max(1, Math.round(p.height / 60)));", 'platform tiled texture', required=False)
    if "attachPhotoSurface(slabMat" not in dst:
        dst = rep(dst,
                  "    attachSurfaceMaps(slabMat, 'wall:' + theme.id, { strength: 2.6, scale: 1.1 });\n"
                  "    slabMat.userData.keepMap = true;",
                  "    attachSurfaceMaps(slabMat, 'wall:' + theme.id, { strength: 2.6, scale: 1.1 });\n"
                  "    slabMat.userData.keepMap = true;\n"
                  "    attachAccentGlow(slabMat, tex, theme, 'wall:' + theme.id, tex.repeat.x, tex.repeat.y, 0.7);\n"
                  "    attachPhotoSurface(slabMat, 'wall', theme.wallTex, tex.repeat.x, tex.repeat.y,\n"
                  "        { normalScale: 1.0, ao: 0.8, tintFade: 0.62 });", 'platform photo surface', required=False)

    dst = rep(dst,
              "    const wtex = getWallTexture(theme).clone(); wtex.needsUpdate = true; wtex.wrapS = wtex.wrapT = THREE.RepeatWrapping;\n"
              "    wtex.repeat.set(Math.max(3, Math.round(along / 80)), Math.max(2, Math.round(WALL_HEIGHT / 80)));",
              "    const wtex = getTiledWallTexture(theme,\n"
              "        Math.max(3, Math.round(along / 80)),\n"
              "        Math.max(2, Math.round(WALL_HEIGHT / 80)));", 'wall tiled texture', required=False)
    if "attachPhotoSurface(bodyMat" not in dst:
        dst = rep(dst,
                  "    bodyMat.userData.keepMap = true; // maps wrap canvases shared across rounds",
                  "    bodyMat.userData.keepMap = true; // maps wrap canvases shared across rounds\n"
                  "    attachAccentGlow(bodyMat, wtex, theme, 'wall:' + theme.id, wtex.repeat.x, wtex.repeat.y, 0.8);\n"
                  "    attachPhotoSurface(bodyMat, 'wall', theme.wallTex, wtex.repeat.x, wtex.repeat.y,\n"
                  "        { normalScale: 1.15, ao: 0.85, tintFade: 0.62 });", 'wall photo surface', required=False)

    if "attachPhotoSurface(floorMat" not in dst:
        dst = rep(dst,
                  "    floorMat.userData.keepMap = true; // texture is cached/shared across rounds; don't let disposeObject3D free it",
                  "    floorMat.userData.keepMap = true; // texture is cached/shared across rounds; don't let disposeObject3D free it\n"
                  "    attachAccentGlow(floorMat, floorTex, theme, 'floor:' + theme.id,\n"
                  "        floorTex.repeat.x, floorTex.repeat.y, theme.floorTex === 'lava' ? 1.5 : 0.95);\n"
                  "    attachPhotoSurface(floorMat, 'floor', theme.floorTex, floorTex.repeat.x, floorTex.repeat.y,\n"
                  "        shinyFloor ? { normalScale: 0.55, ao: 0.6 } : { normalScale: 1.0, ao: 0.9 });", 'floor photo surface', required=False)

    # ---------------------------------------------------- lighting + leaks
    fit = block(src, "// Batch 34: re-fit the sun's shadow frustum to wherever the sun actually is.",
                "// Recolor/re-aim the daylight for a map's theme", 'shadow fit')
    if 'function fitKeyShadow(' not in dst:
        dst = rep(dst, "// Recolor/re-aim the daylight for a map's theme", fit + "// Recolor/re-aim the daylight for a map's theme", 'shadow frustum fit', required=False)
    dst = rep(dst, "    fillLight.color.set(theme.hemi.sky);\n}",
              "    fillLight.color.set(theme.hemi.sky);\n"
              "    fillLight.intensity = (theme.fill != null) ? theme.fill : 0.85;\n"
              "    fitKeyShadow();   // the sun moved; the shadow frustum must follow it\n}", 'fill light + shadow refit', required=False)
    dst = rep(dst, "const fillLight = new THREE.DirectionalLight(0xbcd8ff, 0.4);\nfillLight.position.set(900, 500, -700);",
              "const fillLight = new THREE.DirectionalLight(0xbcd8ff, 0.85);\nfillLight.position.set(700, 1400, -600);",
              'fill light rig', required=False)

    # The derived-texture cache (the second, older leak).
    if "const derivedTextureCache" not in dst:
        dst = rep(dst, "const derivedCanvasCache = {};",
                  "const derivedCanvasCache = {};\nconst derivedTextureCache = {};", 'derived texture cache', required=False)
    old_mk = block(src, "    // Batch 34: cached by (key, slot, repeat, offset)", "    mat.normalMap = mk(entry.n", 'mk')
    legacy_mk_start = "    const mk = (cv, srgb) => {"
    if legacy_mk_start in dst and 'derivedTextureCache[ck]' not in dst:
        j = dst.index("    mat.normalMap = mk(entry.n")
        dst = dst[:dst.index(legacy_mk_start)] + old_mk + dst[j:]
        dst = dst.replace("    mat.normalMap = mk(entry.n);\n    mat.roughnessMap = mk(entry.r);",
                          "    mat.normalMap = mk(entry.n, 'n');\n    mat.roughnessMap = mk(entry.r, 'r');")
        print('  %-34s ok' % 'attachSurfaceMaps texture cache')

    # VERIFY, rather than trust the guards.
    #
    # The first run of this script shipped a legacy build that died at load
    # because a guard matched a name in a comment and skipped the definition it
    # was guarding. The guards are keyed on definitions now, but the real lesson
    # is that a porting script must check its own output: every identifier it
    # introduces has to be defined, and every call it inserts has to have a
    # definition behind it. Refusing to write is much cheaper than shipping a
    # build whose only symptom is a blank screen.
    REQUIRED = [
        # Balance, so the two builds cannot drift on rules or tuning again.
        'const MAX_WALK_STEP_UP = 12;', 'const GRACE_PERIOD = 40;',
        # Gameplay + visuals, widened scope.
        'id="desktop-only"', 'This version needs a computer',
        'function buildViewmodelArmFromModel(', 'function _skelBone(',
        'function _aimBone(', 'function _sealArmCut(',
        'TELEPORT_VIS_DECAY', 'decayVisualOffset', 'projCoreSphere',
        'meshBaseScale', 'function openTutorial(auto)', 'function faceUrl(',
        'const SHRINK_INTERVAL = 18;', 'Takedown Race',
        "matchMode === 'timeattack') return;", 'const clearZone',
        'const PHOTO_SETS = {', 'function getTiledWallTexture(',
        'function attachPhotoSurface(', 'function attachAccentGlow(',
        'function ensureUV2(', 'function loadPhotoSet(',
        'function tiledPhotoTexture(', 'function accentEmissiveTexture(',
        'function fitKeyShadow(', 'const HUD_FAMILY', 'function announceFont(',
        'const RIG_HEIGHT_MULT', 'function rigHeightFor(',
        'const derivedTextureCache',
    ]
    CALLED = ['getTiledWallTexture', 'attachPhotoSurface', 'attachAccentGlow',
              'ensureUV2', 'fitKeyShadow', 'announceFont', 'rigHeightFor',
              'loadPhotoSet', 'tiledPhotoTexture', 'accentEmissiveTexture']
    missing = [d for d in REQUIRED if d not in dst]
    undefined = [c for c in CALLED
                 if ('function %s(' % c) not in dst and ('const %s' % c) not in dst]
    if missing or undefined:
        print('')
        print('PORT INCOMPLETE - refusing to write:')
        for m in missing:
            print('   missing definition: ' + m)
        for u in undefined:
            print('   called but never defined: ' + u)
        return 1
    print('  %-34s %d definitions, %d calls resolved' % ('verified', len(REQUIRED), len(CALLED)))

    io.open(DST, 'w', encoding='utf-8', newline='').write(dst)
    print('\nlegacy build: %d -> %d bytes' % (before, len(dst)))


if __name__ == '__main__':
    sys.exit(main())
