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


def block(text, start_marker, end_marker, name):
    """The text from start_marker up to (not including) end_marker."""
    i = text.index(start_marker)
    j = text.index(end_marker, i)
    out = text[i:j]
    assert len(out) > 40, name
    return out


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

    # ---------------------------------------------------------------- fonts
    fontcss = block(src, "        /* ---- Batch 36: the game's own typeface", "        body {\n            margin: 0;", 'font css')
    fontcss = fontcss.replace("url('assets/fonts/", "url('../assets/fonts/")
    dst = rep(dst, "        body {\n            margin: 0;", fontcss + "        body {\n            margin: 0;", 'font-face blocks')
    dst = rep(dst,
              "            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;",
              "            font-family: var(--font-ui);\n"
              "            font-feature-settings: 'tnum' 1;\n"
              "            font-variation-settings: 'CASL' 0, 'MONO' 0;",
              'body font stack')

    hudfont = block(src, "// Batch 36: the HUD cut, at a whole pixel size.", "function cycleHudScale()", 'hudFont')
    old_hudfont = "function hudFont(px, bold) { return `${bold ? 'bold ' : ''}${Math.round(px * HUD_TEXT_SCALE)}px sans-serif`; }\n"
    dst = rep(dst, old_hudfont, hudfont, 'hudFont')

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
    dst = rep(dst, old_roster, roster, 'CHAR_MODEL_URLS + RIG_HEIGHT_MULT')

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
        dst = rep(dst, "const wallTextureCache = {};", photo + "const wallTextureCache = {};", 'photo surface layer')

    tiled = block(src, "// Batch 34: see the note in buildPlatformMesh. A clone is needed per distinct",
                  "function getWallTexture(theme) {", 'tiled cache')
    if 'function getTiledWallTexture(' not in dst:
        dst = rep(dst, "function getWallTexture(theme) {", tiled + "function getWallTexture(theme) {", 'tiled wall cache')

    # Wire the three surfaces. The legacy builders are byte-identical to what
    # index.html had before Batch 34, so the same replacements apply.
    dst = rep(dst,
              "    const tex = getWallTexture(theme).clone();\n"
              "    tex.needsUpdate = true;\n"
              "    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;\n"
              "    tex.repeat.set(Math.max(1, Math.round(p.hw / 40)), Math.max(1, Math.round(p.height / 60)));",
              "    const tex = getTiledWallTexture(theme,\n"
              "        Math.max(1, Math.round(p.hw / 40)),\n"
              "        Math.max(1, Math.round(p.height / 60)));", 'platform tiled texture')
    dst = rep(dst,
              "    attachSurfaceMaps(slabMat, 'wall:' + theme.id, { strength: 2.6, scale: 1.1 });\n"
              "    slabMat.userData.keepMap = true;",
              "    attachSurfaceMaps(slabMat, 'wall:' + theme.id, { strength: 2.6, scale: 1.1 });\n"
              "    slabMat.userData.keepMap = true;\n"
              "    attachAccentGlow(slabMat, tex, theme, 'wall:' + theme.id, tex.repeat.x, tex.repeat.y, 0.7);\n"
              "    attachPhotoSurface(slabMat, 'wall', theme.wallTex, tex.repeat.x, tex.repeat.y,\n"
              "        { normalScale: 1.0, ao: 0.8, tintFade: 0.62 });", 'platform photo surface')

    dst = rep(dst,
              "    const wtex = getWallTexture(theme).clone(); wtex.needsUpdate = true; wtex.wrapS = wtex.wrapT = THREE.RepeatWrapping;\n"
              "    wtex.repeat.set(Math.max(3, Math.round(along / 80)), Math.max(2, Math.round(WALL_HEIGHT / 80)));",
              "    const wtex = getTiledWallTexture(theme,\n"
              "        Math.max(3, Math.round(along / 80)),\n"
              "        Math.max(2, Math.round(WALL_HEIGHT / 80)));", 'wall tiled texture')
    dst = rep(dst,
              "    bodyMat.userData.keepMap = true; // maps wrap canvases shared across rounds",
              "    bodyMat.userData.keepMap = true; // maps wrap canvases shared across rounds\n"
              "    attachAccentGlow(bodyMat, wtex, theme, 'wall:' + theme.id, wtex.repeat.x, wtex.repeat.y, 0.8);\n"
              "    attachPhotoSurface(bodyMat, 'wall', theme.wallTex, wtex.repeat.x, wtex.repeat.y,\n"
              "        { normalScale: 1.15, ao: 0.85, tintFade: 0.62 });", 'wall photo surface')

    dst = rep(dst,
              "    floorMat.userData.keepMap = true; // texture is cached/shared across rounds; don't let disposeObject3D free it",
              "    floorMat.userData.keepMap = true; // texture is cached/shared across rounds; don't let disposeObject3D free it\n"
              "    attachAccentGlow(floorMat, floorTex, theme, 'floor:' + theme.id,\n"
              "        floorTex.repeat.x, floorTex.repeat.y, theme.floorTex === 'lava' ? 1.5 : 0.95);\n"
              "    attachPhotoSurface(floorMat, 'floor', theme.floorTex, floorTex.repeat.x, floorTex.repeat.y,\n"
              "        shinyFloor ? { normalScale: 0.55, ao: 0.6 } : { normalScale: 1.0, ao: 0.9 });", 'floor photo surface')

    # ---------------------------------------------------- lighting + leaks
    fit = block(src, "// Batch 34: re-fit the sun's shadow frustum to wherever the sun actually is.",
                "// Recolor/re-aim the daylight for a map's theme", 'shadow fit')
    if 'function fitKeyShadow(' not in dst:
        dst = rep(dst, "// Recolor/re-aim the daylight for a map's theme", fit + "// Recolor/re-aim the daylight for a map's theme", 'shadow frustum fit')
    dst = rep(dst, "    fillLight.color.set(theme.hemi.sky);\n}",
              "    fillLight.color.set(theme.hemi.sky);\n"
              "    fillLight.intensity = (theme.fill != null) ? theme.fill : 0.85;\n"
              "    fitKeyShadow();   // the sun moved; the shadow frustum must follow it\n}", 'fill light + shadow refit')
    dst = rep(dst, "const fillLight = new THREE.DirectionalLight(0xbcd8ff, 0.4);\nfillLight.position.set(900, 500, -700);",
              "const fillLight = new THREE.DirectionalLight(0xbcd8ff, 0.85);\nfillLight.position.set(700, 1400, -600);",
              'fill light rig', required=False)

    # The derived-texture cache (the second, older leak).
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
