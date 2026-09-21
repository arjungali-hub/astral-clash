# -*- coding: utf-8 -*-
r"""Ports the art, font and balance work from index.html into the local
local split-screen build.

    python art/sync_local.py

local/index.html is a FORK, not a shared module: it was local
verbatim before the online refactor because the two builds differ in their
renderer, input model and HUD layout, and keeping both live in one file was
exactly the half-wired state that refactor set out to avoid. That decision
stands - but it should not mean the local build is frozen at the art it
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
DST = os.path.join(ROOT, 'local', 'index.html')


def comment_start(text, i):
    """Index of the start of the run of `//` comment lines directly above the
    line containing `i` - or the start of that line if there is none.

    The steps below insert a comment block above the line they replace. Without
    this they replace only the line, so the PREVIOUS run's comment survives and
    a second copy lands above it: running this script twice from a clean
    checkout grew the local build by 3,164 bytes, and every run after that
    by the same again.
    """
    start = text.rfind(chr(10), 0, i) + 1
    while start > 0:
        prev_end = start - 1
        prev_start = text.rfind(chr(10), 0, prev_end) + 1
        line = text[prev_start:prev_end].strip()
        if not line.startswith('//'):
            break
        start = prev_start
    return start


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


# The local build's shop markup, before and after. Two panels, one per
# player, each shown independently.
SHOP_HTML_OLD = """        <div id="shop-screen">
            <div class="menu-section shop-panel">
                <h3 id="shop-title">Shop</h3>
                <p class="shop-sub">Your own coins, unlocks and upgrades. Win a match to earn more.</p>
                <div class="shop-head"><span class="coin-balance" id="shop-coin-balance">0</span></div>
                <div id="shop-list"></div>
                <button id="btn-shop-close" class="btn-back">\u2190 Back</button>
            </div>
        </div>"""

SHOP_HTML_NEW = """        <!-- TWO stores, open independently. In split-screen both players are at
             the same screen at the same time, so one player shopping cannot be
             allowed to freeze the other out. -->
        <div id="shop-screen">
            <div class="menu-section shop-panel" id="shop-panel-p1" style="display:none;">
                <h3 id="shop-title-p1">Player 1 \u2014 Shop</h3>
                <p class="shop-sub">Your own coins, unlocks and upgrades. Win a match to earn more.</p>
                <div class="shop-head"><span class="coin-balance" id="shop-coin-balance-p1">0</span></div>
                <div id="shop-list-p1"></div>
                <button class="btn-back" data-shop-close="p1">\u2190 Back</button>
            </div>
            <div class="menu-section shop-panel" id="shop-panel-p2" style="display:none;">
                <h3 id="shop-title-p2">Player 2 \u2014 Shop</h3>
                <p class="shop-sub">Your own coins, unlocks and upgrades. Win a match to earn more.</p>
                <div class="shop-head"><span class="coin-balance" id="shop-coin-balance-p2">0</span></div>
                <div id="shop-list-p2"></div>
                <button class="btn-back" data-shop-close="p2">\u2190 Back</button>
            </div>
        </div>"""

SHOP_CSS_OLD = """        #shop-screen {
            display: none;
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background: radial-gradient(ellipse at 50% 30%, rgba(20,28,44,0.96), rgba(8,11,18,0.98));
            align-items: center; justify-content: center; z-index: 30; padding: 20px;
        }"""

SHOP_CSS_NEW = """        #shop-screen {
            display: none;
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            /* NO scrim and NO pointer capture: the half of the screen this shop
               is not on belongs to the other player, who is still picking a
               fighter. Only the panels themselves take clicks. */
            background: none;
            pointer-events: none;
            align-items: center; justify-content: space-between; z-index: 30; padding: 20px;
        }
        #shop-screen .shop-panel { pointer-events: auto; }
        #shop-panel-p1 { margin-right: auto; }
        #shop-panel-p2 { margin-left: auto; }"""

SHOP_HELPERS = """function syncShopPanels() {
    for (const s of SIDES) {
        const el = document.getElementById('shop-panel-' + s);
        if (el) el.style.display = shopOpen[s] ? '' : 'none';
    }
}

function closeShopSide(side) {
    shopOpen[side] = false;
    syncShopPanels();
    // The overlay itself only goes away once NEITHER store is open.
    if (!shopOpen.p1 && !shopOpen.p2) closeModal();
}

"""

OPEN_SHOP_OLD = """    const screen = document.getElementById('shop-screen');
    if (screen) screen.className = `side-${shopSide}`;
    const title = document.getElementById('shop-title');
    if (title) title.textContent = `${shopSide === 'p1' ? 'Player 1' : 'Player 2'} \u2014 Shop`;
    shopExpanded.clear(); // every visit starts collapsed; see buildShop
    buildShop();"""

OPEN_SHOP_NEW = """    shopOpen[shopSide] = true;
    syncShopPanels();
    shopExpanded[shopSide].clear(); // every visit starts collapsed; see buildShop
    buildShop(shopSide);"""

CLOSE_MODAL_OLD = """function closeModal() {
    const name = modalStack.pop();
    if (name) document.getElementById(MODAL_EL[name]).style.display = 'none';
    return name;
}"""

CLOSE_MODAL_NEW = """function closeModal() {
    const name = modalStack.pop();
    if (name) document.getElementById(MODAL_EL[name]).style.display = 'none';
    // Closing the shop overlay closes BOTH stores - otherwise the next open
    // reveals a stale panel belonging to the other player.
    if (name === 'shop' && typeof shopOpen !== 'undefined') {
        shopOpen.p1 = false; shopOpen.p2 = false;
        syncShopPanels();
    }
    return name;
}"""

# The wipe-ending body of resolveCoopMode, for the local build.
COOP_RESOLVE_BODY = """    if (!isCoopMode()) return false;

    // Newly downed, both checked before the wipe test, so a double KO on one
    // frame reads as a wipe rather than as one player going down and the other
    // dying alone a frame later.
    for (const f of [player1, player2]) {
        if (f && !f.downed && f.hp <= 0) coopDown(f);
    }

    if (player1.downed && player2.downed) {
        endCoopMatch(false, matchMode === 'survival'
            ? `Both fighters fell on wave ${waveNumber + 1}.  <b>Waves cleared: ${waveNumber}</b>`
            : 'Both fighters fell.');
        return true;
    }

    for (const f of [player1, player2]) {
        if (!f || !f.downed || !coopOwnsRespawn(f)) continue;
        f.respawnTimer -= dt;
        if (f.respawnTimer <= 0) coopRevive(f);
    }
"""


HERE = os.path.dirname(os.path.abspath(__file__))


AUTO_START_OLD = """    // A human confirming as the final action that makes both sides ready
    // auto-starts (the classic pick\u2192pick\u2192fight feel). Other cases start
    // via the explicit Start Match button \u2014 see refreshMenuUI().
    if (sideReady('p1') && sideReady('p2')) beginMatch();"""

AUTO_START_NEW = """    // NO AUTO-START. Requested as "you should still have to press start fight
    // after both players confirm in local mode", and the reason is the one
    // thing this build has that the online one does not: two people at one
    // keyboard. Auto-starting on the second confirm lets whoever confirms last
    // decide when the other one is ready. The Start Fight button that
    // refreshMenuUI() already reveals is now the only way in."""

DETAIL_SCROLL_OLD = ".detail-scroll { max-height: min(200px, 30vh); overflow-y: auto; padding-right: 4px; }"

DETAIL_SCROLL_NEW = """/* Batch 47: NO inner scroller. Reported as "in local there shouldn't be this
           nested scroll down thing. The only scroll downs should be for the whole
           page" - the fighter detail had its own 200px scroll box, inside a panel,
           inside a scrollable overlay: three nested scrollbars to read one
           paragraph. It grows now and the page carries it. */
        .detail-scroll { max-height: none; overflow: visible; padding-right: 0; }"""

PANEL_SCROLLERS = [
    ".modeselect-panel { width: min(560px, 94vw); max-height: 100%; overflow-y: auto; box-sizing: border-box; text-align: center; }",
    ".shop-panel { width: min(560px, 46vw); max-height: 90vh; overflow-y: auto; text-align: left; }",
    ".mapselect-panel { width: min(1000px, 96vw); max-height: 92vh; overflow-y: auto; text-align: center; }",
    ".tutorial-panel { width: min(760px, 94vw); max-height: 90vh; overflow-y: auto; text-align: left; }",
]

MODALS_OLD = """        #mapselect-screen, #shop-screen, #tutorial-screen, #settings-screen, #audio-screen, #rebind-screen, #modeselect-screen {
            box-sizing: border-box;
        }"""

MODALS_NEW = """        #mapselect-screen, #shop-screen, #tutorial-screen, #settings-screen, #audio-screen, #rebind-screen, #modeselect-screen {
            box-sizing: border-box;
            /* Batch 47: TOP-aligned and scrollable, not centred.
               A panel taller than the viewport inside a centred flex container
               overflows EQUALLY in both directions, and the half above the top
               edge is simply unreachable - which is "when you open settings in
               local, the thing that pops up is shifted upwards". This is also
               the one scroller that stays: for a fixed overlay, this container
               IS the page. */
            align-items: flex-start;
            overflow-y: auto;
            padding-top: 24px;
            padding-bottom: 24px;
        }"""

WATCH_OLD = """    const twoHumans = !player1.isBot && !player2.isBot;
    renderer.setScissorTest(true);"""

WATCH_NEW = """    // Nobody is playing: one camera, from above. Two split-screen halves of a
    // fight neither player is in is the least useful way to show it, and this
    // is the only view in the game that holds the whole arena at once.
    if (botsOnly()) {
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, W, H);
        positionWatchCamera(W / H);
        renderWithBloomLocal(scene, watchCam);
        return;
    }
    const twoHumans = !player1.isBot && !player2.isBot;
    renderer.setScissorTest(true);"""


def main():
    src = io.open(SRC, encoding='utf-8').read()
    dst = io.open(DST, encoding='utf-8').read()
    before = len(dst)

    # ------------------------------------------------------------- routing
    # The local build links back to the root, not to /index.html - Vercel
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
    # not a kindness, so the local build now shows the same single message
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
    # game LOOKS or PLAYS belongs in the local build; only machinery that is
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
    # prose about it and no step. The local build is first-person too, so it
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
        # that took the whole local build down at load.
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
    # immediately - the local build still called a mode Time Attack, still
    # let you ride a waist-high block, still gave the ranged fighters 100 extra
    # HP, and still collapsed the arena on the old 20s/6s clock.
    #
    # Every item below is extracted from index.html by its own anchors, so the
    # two builds cannot disagree about a number again. Anything whose meaning
    # depends on the online refactor is still excluded on purpose.
    # MAX_WALK_STEP_UP: 30 -> 12. The one the report actually named.
    step = block(src, "// Rises up to this are walkable on foot", "\nconst MAX_WALK_STEP_UP = 12;") + "\nconst MAX_WALK_STEP_UP = 12;"
    i = comment_start(dst, dst.index("const MAX_WALK_STEP_UP = "))
    j = dst.index("\n", dst.index("const MAX_WALK_STEP_UP = "))
    dst = dst[:i] + step.lstrip("\n") + dst[j:]
    print('  %-34s ok' % 'MAX_WALK_STEP_UP')

    # The retimed arena collapse.
    grace = block(src, "// Batch 38: the collapse is much less hurried.", "const SHRINK_FRAC_STEP", 'grace')
    i = comment_start(dst, dst.index("const GRACE_PERIOD = "))
    j = dst.index("const SHRINK_FRAC_STEP", i)
    dst = dst[:i] + grace + dst[j:]
    print('  %-34s ok' % 'GRACE_PERIOD + SHRINK_INTERVAL')

    crushfrac = block(src, "// Once the collapse fraction passes this", "const CRUSH_DPS", 'crush frac')
    i = comment_start(dst, dst.index("const CRUSH_AT_FRAC = "))
    j = dst.index("const CRUSH_DPS", i)
    dst = dst[:i] + crushfrac + dst[j:]
    print('  %-34s ok' % 'CRUSH_AT_FRAC + arithmetic')

    # The mode rename. The ID stays `timeattack` in both builds.
    mode = block(src, "    // Batch 38: \"Time Attack\" named the one thing", "\n    { id: 'boss'")
    i = comment_start(dst, dst.index("    { id: 'timeattack',"))
    j = dst.index("\n    { id: 'boss'", i)
    dst = dst[:i] + mode.lstrip("\n") + dst[j:]
    print('  %-34s ok' % 'Takedown Race rename')

    # No collapse in the Takedown Race.
    if "matchMode === 'timeattack') return;" not in dst:
        guard = block(src, "    // Batch 38: no collapse in the Takedown Race either.", "    if (!crushing) {", 'guard')
        dst = rep(dst, "    if (isCoopMode()) return;\n    if (!crushing) {",
                  "    if (isCoopMode()) return;\n" + guard + "    if (!crushing) {",
                  'no collapse in Takedown Race')

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
    # comment inside the photo block. The local build then died at load with
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

    # The CHAR_MODEL_URLS step is GONE: the table and its paths are shared now
    # (see AC_ASSET_BASE in shared/roster.js). It was the last thing ported for
    # data reasons.

    # The rig scale is per character now.
    dst = rep(dst, "    inner.scale.setScalar(RIG_TARGET_HEIGHT / m.height);",
              "    const rigTarget = rigHeightFor(name);   // per-character; see RIG_HEIGHT_MULT\n"
              "    inner.scale.setScalar(rigTarget / m.height);", 'per-character rig height', required=False)
    dst = rep(dst, "    g.userData.rigScale = RIG_TARGET_HEIGHT / m.height;",
              "    g.userData.rigScale = rigTarget / m.height;", 'rigScale', required=False)

    # ------------------------------------------------------- SHARED DATA
    # The roster, the economy and the frame data are not ported any more: both
    # builds LOAD THE SAME FILE. Everything below this comment used to be four
    # steps that copied those tables across by anchor, and the recurring bug
    # report was the obvious consequence - "most of the changes seem to have not
    # landed in the legacy version".
    #
    # So: delete the local build's own copies, and load shared/roster.js
    # instead. Classic scripts share one global scope, so bootGame() resolves
    # CHARACTERS, FRAME_DATA, BOSS_MAP and the economy constants to the shared
    # ones with no other change - as long as the local `const`s are GONE. A
    # local declaration would shadow the shared value and silently restore the
    # drift this removes.
    if 'shared/roster.js' not in dst:
        # Each region is cut by its own anchors, from the local build. The
        # closing `});` of the Object.assign is included deliberately: leaving
        # it behind is exactly the off-by-one that shipped two syntax errors
        # when index.html was done the same way.
        regions = [
            ("// Three starters spanning the three archetypes a new player needs to feel",
             "// Batch 21: progression is PER PLAYER.", False),
            ("// Co-op-only combatants, kept OUT of CHARACTERS so buildGrid (which iterates",
             "const BOSS_MAP = {};", True),
            ("const DEG = Math.PI / 180;", "\n", True),
            ("const CHARACTERS = [",
             "CHARACTERS.sort((a, b) => (UNLOCK_COST[a.name] || 0) - (UNLOCK_COST[b.name] || 0));",
             True),
            ("const CHAR_MAP = Object.fromEntries(CHARACTERS.map(c => [c.name, c]));", "\n", True),
            # "(co-op boss)." is load-bearing: the shorter prefix also matches
            # the mesh builder's own "Karrigos, the ... Co-op boss." heading
            # further down the file.
            ("// --- Batch 17: Karrigos, the Hollow Titan (co-op boss).", "\n});", True),
            ("const FRAME_DATA = {", "\nconst DODGE_DIST", False),
            # Asset paths too, now that AC_ASSET_BASE resolves them from the
            # shared file's own URL. This was the LAST table ported for data
            # reasons, and it only existed because the two builds sit at
            # different depths.
            ("const CHAR_MODEL_URLS = {", "\n};", True),
            ("const RIG_TARGET_HEIGHT = 50;", "\n", True),
            ("const RIG_HEIGHT_MULT = {",
             "function rigHeightFor(name) { return RIG_TARGET_HEIGHT * (RIG_HEIGHT_MULT[name] || 1); }",
             True),
        ]
        for start, end, keep_end in regions:
            assert dst.count(start) == 1, 'shared cut %r: %d' % (start[:50], dst.count(start))
            i = dst.index(start)
            j = dst.index(end, i) + (len(end) if keep_end else 0)
            dst = dst[:i] + dst[j:]
        dst = rep(dst, '<script src="../three.min.js"',
                  '<!-- Shared with the online build; see the header in that file. -->\n'
                  '<script src="../shared/roster.js"></script>\n'
                  '<script src="../three.min.js"', 'shared roster script tag', required=False)
        if 'shared/roster.js' not in dst:
            # No vendored-three tag to anchor on: fall back to the CDN one.
            dst = rep(dst, '<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"',
                      '<!-- Shared with the online build; see the header in that file. -->\n'
                      '<script src="../shared/roster.js"></script>\n'
                      '<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"',
                      'shared roster script tag (cdn anchor)')
        # The two remaining '../assets/' literals become base-relative, so the
        # local build stops caring what directory it is served from - which
        # matters because /local is a rewrite and its document URL is not in
        # legacy/ at all.
        dst = rep(dst, "const PHOTO_BASE = '../assets/tex/';",
                  "const PHOTO_BASE = AC_ASSET_BASE + 'tex/';   // see shared/roster.js",
                  'photo base from AC_ASSET_BASE', required=False)
        dst = rep(dst, "function faceUrl(name) { return '../assets/faces/' + String(name).toLowerCase() + '.png'; }",
                  "function faceUrl(name) { return AC_ASSET_BASE + 'faces/' + String(name).toLowerCase() + '.png'; }",
                  'face url from AC_ASSET_BASE', required=False)
        print('  %-34s ok' % 'shared/roster.js replaces 5 steps')

    # ---------------------------------------------- Batch 46: arm animation
    # The swing axis, the jab rate and the first-person arm's facing. Whole
    # blocks, not lines: _applyArms went from four lines to a helper with a new
    # signature, and every call site changed with it.
    if 'function _swingArm(' not in dst:
        swing = block(src, "// The usable range of a shoulder swing, in degrees.",
                      "\nfunction animateWeapon(", 'swing helpers')
        old_apply = block(dst, "// Batch 25: `axis` lets one animation path drive both rigs.",
                          "\nfunction animateWeapon(", 'legacy _applyArms')
        dst = dst.replace(old_apply, swing, 1)
        print('  %-34s ok' % 'swing axis + jab helpers')

        # readableJabs sits above armsOf in index.html; the local build needs
        # it before animateWeapon runs.
        jabs = block(src, "// How many jabs will actually READ inside an attack's active window.",
                     "\nfunction armsOf(", 'readableJabs')
        dst = rep(dst, "function armsOf(f) {", jabs + "\nfunction armsOf(f) {", 'readable jab count')

        # The three animation branches that changed.
        dst = rep(dst, "        const deg = t >= 0 ? t * anim.backDeg : -t * anim.fwdDeg;\n        _applyArms(arms, deg);",
                  block(src, "        // The WIND-UP IS CAPPED AGAINST THE STRIKE",
                        "\n        if (anim.twistDeg)", 'swing branch'),
                  'wind-up cap')
        dst = rep(dst, "reach = 0.5 - 0.5 * Math.cos(p * Math.PI * 2 * anim.jabs);",
                  "reach = 0.5 - 0.5 * Math.cos(p * Math.PI * 2 * readableJabs(anim.jabs, fd.active));",
                  'stab jab rate')
        old_flurry = block(dst, "    } else if (anim.type === 'flurry') {",
                           "\n    } else if (anim.type === 'cast') {", 'legacy flurry')
        new_flurry = block(src, "    } else if (anim.type === 'flurry') {",
                           "\n    } else if (anim.type === 'cast') {", 'flurry')
        dst = dst.replace(old_flurry, new_flurry, 1)
        print('  %-34s ok' % 'flurry spans the whole action')

        # Every remaining _applyArms call has to pass the fighter, or the axis
        # cannot be derived from the body.
        n = dst.count("_applyArms(arms, ")
        dst = re.sub(r"_applyArms\(arms, ([^;]+?)\);", r"_applyArms(arms, \1, f);", dst)
        dst = dst.replace("_applyArms(arms, deg, f, f);", "_applyArms(arms, deg, f);")
        print('  %-34s %d call sites' % ('fighter passed to _applyArms', n))

    # The first-person arm's facing, and the weapon it holds.
    if 'VM_PROP_YAW' not in dst:
        dst = rep(dst, "const ARM_CHAIN = ['UpperArm', 'LowerArm', 'Hand'];",
                  block(src, "// HOW THE WEAPON IS HELD", "\nconst ARM_CHAIN")
                  + "const ARM_CHAIN = ['UpperArm', 'LowerArm', 'Hand'];", 'viewmodel prop constants')
        dst = rep(dst, "    holder.rotation.y = -Math.PI / 2;",
                  block(src, "    // The model faces local +X (buildRiggedCharacter rotates it so render3D can",
                        "\n\n    holder.userData.mats", 'arm facing'), 'first-person arm faces away')

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

    # -------------------------------------------- co-op down and respawn
    # "if one person dies, it shouldn't end. Instead, they should respawn after
    # a while (20-30 seconds). If the person who is still alive dies before this
    # happens, then the game ends." A rule, so both builds get it.
    if 'COOP_RESPAWN_FRAMES' not in dst:
        consts = block(src, "// Co-op: a KO puts you DOWN, not out.",
                       "\n// Batch 18: Survival Waves pacing.", 'coop respawn constants')
        dst = rep(dst, "// Batch 18: Survival Waves pacing.",
                  consts + "// Batch 18: Survival Waves pacing.", 'coop respawn constants')
        dst = rep(dst, "        this.invulnFrames = 0;\n        this.muzzleFlash = 0",
                  "        this.invulnFrames = 0;\n"
                  "        // Co-op only: down and counting, rather than dead.\n"
                  "        this.downed = false;\n"
                  "        this.respawnTimer = 0;\n"
                  "        this.muzzleFlash = 0", 'downed fighter state')
        dst = rep(dst, "    respawn(spawn) {\n        this.hp = this.maxHp;\n        this.hpGhost = this.maxHp;",
                  "    respawn(spawn, hpFrac) {\n"
                  "        this.hp = this.maxHp * (hpFrac === undefined ? 1 : hpFrac);\n"
                  "        this.hpGhost = this.hp;\n"
                  "        this.downed = false;\n"
                  "        this.respawnTimer = 0;", 'respawn fraction')
        dst = rep(dst, "        if (this.isBot) {\n            const decision = this.botDecide(target, dt);",
                  "        if (this.downed) {\n"
                  "            // Down in co-op: no input, no AI, no actions - but the rest of\n"
                  "            // update() still runs, so gravity settles the body and the Death\n"
                  "            // clip plays. Gating here rather than returning early is what\n"
                  "            // keeps a downed fighter from hanging in mid-air.\n"
                  "        } else if (this.isBot) {\n            const decision = this.botDecide(target, dt);",
                  'downed input gate')
        dst = rep(dst, "        if (this.invulnFrames > 0) return;",
                  "        if (this.invulnFrames > 0) return;\n"
                  "        // A downed co-op teammate is out of the fight, not a shield.\n"
                  "        if (this.downed) return;", 'downed takes no damage')
        # The legacy-side lifecycle, as real JavaScript in its own file.
        coop_js = io.open(os.path.join(HERE, 'local_coop_respawn.js'), encoding='utf-8').read()
        dst = rep(dst, "function resolveCoopMode() {",
                  coop_js + "\nfunction resolveCoopMode(dt) {", 'coop respawn lifecycle')
        # ...and its body: the either-down ending becomes a WIPE ending.
        old_end = block(dst, "    if (!isCoopMode()) return false;\n    if (!isAlive(player1) || !isAlive(player2)) {",
                        "\n    // Batch 23: the wave is cleared when EVERY enemy is down", 'coop end block')
        dst = dst.replace(old_end, COOP_RESOLVE_BODY, 1)
        dst = rep(dst, "resolveCoopMode())", "resolveCoopMode(dt))", 'coop resolve call')
        dst = rep(dst, "        let healed = 0;\n        for (const p of [player1, player2]) {\n            const before = p.hp;",
                  "        let healed = 0;\n        for (const p of [player1, player2]) {\n"
                  "            // A downed teammate is NOT healed by the wave clear: hp above 0\n"
                  "            // with `downed` still set is a fighter stuck on the floor for the\n"
                  "            // rest of the run.\n"
                  "            if (p.downed) continue;\n            const before = p.hp;",
                  'wave heal skips the downed')
        dst = rep(dst, "    if (coopEnemies.length) drawBossHUD();",
                  "    if (isCoopMode()) drawCoopDownHUD();\n"
                  "    if (coopEnemies.length) drawBossHUD();", 'coop down HUD')
        # ...and the debug handles, so localshopcheck can assert the rule
        # arrived rather than assuming the port worked.
        dst = rep(dst, "        MATCH_MODES, ZONE_RADIUS, ZONE_TARGET, TIME_ATTACK_KOS, RESPAWN_INVULN,",
                  "        MATCH_MODES, ZONE_RADIUS, ZONE_TARGET, TIME_ATTACK_KOS, RESPAWN_INVULN,\n"
                  "        COOP_RESPAWN_FRAMES, COOP_RESPAWN_HP_FRAC, coopDown, coopRevive,\n"
                  "        coopOwnsRespawn, syncShopPanels, closeShopSide,",
                  'coop respawn debug handles')

    # ------------------------------------------------ the shop, on both sides
    # One panel covered the whole screen behind an opaque scrim, so whichever
    # player did not open it could do nothing at all - not pick a fighter, not
    # open their own store. Two independent panels instead, one per half, and no
    # scrim: the overlay passes clicks through everywhere except the panels.
    if 'shop-panel-p1' not in dst:
        dst = rep(dst, SHOP_HTML_OLD, SHOP_HTML_NEW, 'two shop panels')
        dst = rep(dst, SHOP_CSS_OLD, SHOP_CSS_NEW, 'shop overlay is click-through')
        dst = rep(dst, "function buildShop() {\n"
                       "    const list = document.getElementById('shop-list');\n"
                       "    if (!list) return;\n"
                       "    const side = shopSide;",
                  "function buildShop(only) {\n"
                  "    // No argument: rebuild BOTH stores, which is what every purchase\n"
                  "    // wants. openShop passes the one side it just opened.\n"
                  "    if (!only) { for (const s of SIDES) buildShop(s); return; }\n"
                  "    const side = only;\n"
                  "    const list = document.getElementById('shop-list-' + side);\n"
                  "    if (!list) return;", 'buildShop per side')
        dst = dst.replace("shopExpanded.has(c.name)", "shopExpanded[side].has(c.name)")
        dst = dst.replace("shopExpanded.delete(c.name); else shopExpanded.add(c.name);",
                          "shopExpanded[side].delete(c.name); else shopExpanded[side].add(c.name);")
        dst = rep(dst, "const shopExpanded = new Set();",
                  "const shopExpanded = { p1: new Set(), p2: new Set() };\n"
                  "// Which stores are open right now. BOTH may be: see syncShopPanels.\n"
                  "const shopOpen = { p1: false, p2: false };", 'per-side shop state')
        dst = rep(dst, "    const shopEl = document.getElementById('shop-coin-balance');",
                  "    for (const s of SIDES) {\n"
                  "        const el2 = document.getElementById('shop-coin-balance-' + s);\n"
                  "        if (el2) el2.textContent = String(prog(s).coins);\n"
                  "    }\n"
                  "    const shopEl = null;", 'both shop balances')
        dst = rep(dst, "function openShop(side) {\n    if (side) shopSide = side;",
                  SHOP_HELPERS + "function openShop(side) {\n    if (side) shopSide = side;",
                  'shop panel helpers')
        dst = rep(dst, OPEN_SHOP_OLD, OPEN_SHOP_NEW, 'openShop opens one side')
        dst = rep(dst, "document.getElementById('btn-shop-close').addEventListener('click', () => closeModal());",
                  "document.querySelectorAll('[data-shop-close]').forEach(b =>\n"
                  "    b.addEventListener('click', () => closeShopSide(b.dataset.shopClose)));",
                  'per-side close buttons')
        dst = rep(dst, CLOSE_MODAL_OLD, CLOSE_MODAL_NEW, 'closeModal clears both stores')

    # ------------------------------------------------------- the canonical URL
    # Land on /local even if someone arrives at the file path. A page-level
    # redirect rather than a Vercel one: /local is a REWRITE to this same path,
    # and a redirect on a rewrite's destination risks the loop that would take
    # /local down again.
    if 'CANONICAL_PATH' not in dst:
        # Anchored on the first script's own opening comment: "<script>" alone
        # appears three times here (CDN loader, vendored fallback, the game).
        dst = rep(dst, "<script>\n// Three.js is the only external dependency", """<script>
// The shareable address for this build is /local. Anyone who arrives at the
// file path gets moved there, so links, bookmarks and the browser's own history
// all say the same thing.
//
// Deliberately NOT a Vercel redirect: /local is a rewrite TO this path, and a
// redirect sitting on a rewrite destination is how you get a loop - which would
// break the one URL this is meant to tidy up.
// ...and only where /local is actually SERVED. The pretty path is a Vercel
// rewrite, so it does not exist over file:// or on the test server's plain
// static host - redirecting there would turn a working page into a 404, which
// is a far worse bug than an ugly URL.
const CANONICAL_PATH = '/local';
if (location.protocol === 'https:'
    && !/^(localhost|127\\.|\\[::1\\])/.test(location.hostname)
    && location.pathname !== CANONICAL_PATH
    && /\\/local\\/index(\\.html)?$/.test(location.pathname)) {
    location.replace(CANONICAL_PATH + location.search + location.hash);
}
// Three.js is the only external dependency""", 'canonical /local redirect')

    # ------------------------------------------- local-build requests (B47)
    # Names, a progress reset, an explicit Start Fight, no nested scrollbars,
    # and a spectator camera when both sides are bots. Local-build only: the
    # online build has one player per machine, so none of it applies there.
    if 'function playerName(' not in dst:
        extras = io.open(os.path.join(HERE, 'local_extras.js'), encoding='utf-8').read()
        # After freshSideProgress/progression exist, and before anything can
        # call in. watchCam is a const built at load, so it needs THREE (which
        # is present by then) and nothing from the arena.
        dst = rep(dst, "function saveProgression() {", extras + "\nfunction saveProgression() {",
                  'local extras')

        # --- a name field per side -----------------------------------------
        # Anchored on each panel's own heading, which is unique. `.side-purse`
        # appears once per side, and a single-match replacement cannot tell the
        # two apart - the first attempt asserted on that and stopped.
        for side, label in (('p1', 'Player 1'), ('p2', 'Player 2')):
            head_old = ('<h3 id="%s-heading">%s <span class="key-hint">(keys on cards)</span></h3>'
                        % (side, label))
            head_new = (
                '<h3 id="%s-heading"><span id="side-name-%s">%s</span> '
                '<span class="key-hint">(keys on cards)</span></h3>\n'
                '                        <div class="side-name-row">\n'
                '                            <input id="name-%s" class="side-name" maxlength="14"\n'
                '                                   placeholder="%s" aria-label="%s name">\n'
                '                        </div>' % (side, side, label, side, label, label))
            dst = rep(dst, head_old, head_new, '%s name field' % side)

        dst = rep(dst, "        .side-purse {",
                  "        .side-name-row { display: flex; justify-content: center; margin: 0 0 8px; }\n"
                  "        .side-name {\n"
                  "            width: 100%; max-width: 220px; box-sizing: border-box;\n"
                  "            padding: 5px 8px; text-align: center;\n"
                  "            background: #0b0f18; color: #e2e8f0; border: 1px solid #2e3a59;\n"
                  "            border-radius: 5px; font-family: var(--font-hud); font-size: 0.72rem;\n"
                  "        }\n"
                  "        .side-name:focus { outline: none; border-color: #00f3ff; }\n"
                  "        .side-purse {", 'name field css')

        # --- reset progress, in settings -----------------------------------
        dst = rep(dst, '<button id="btn-settings-close"',
                  '<div class="settings-list" style="margin-top:14px;">\n'
                  '                        <button id="btn-reset-progress" class="btn-danger">Reset Progress</button>\n'
                  '                    </div>\n'
                  '                    <p class="settings-note">Clears both players\' coins, unlocks and upgrades on this machine. Names are kept. Click twice to confirm.</p>\n'
                  '                    <button id="btn-settings-close"', 'reset progress button')
        dst = rep(dst, "        .settings-note {",
                  "        .btn-danger {\n"
                  "            background: transparent; color: #f87171; border: 1px solid #f87171;\n"
                  "            box-shadow: none;\n"
                  "        }\n"
                  "        .btn-danger:hover { background: rgba(248, 113, 113, 0.14); box-shadow: none; }\n"
                  "        .settings-note {", 'danger button css')

        # --- wiring --------------------------------------------------------
        dst = rep(dst, "refreshCoinDisplays(); // initial paint at load, before any menu interaction",
                  "refreshCoinDisplays(); // initial paint at load, before any menu interaction\n"
                  "for (const nameSide of SIDES) {\n"
                  "    const input = document.getElementById('name-' + nameSide);\n"
                  "    if (input) input.addEventListener('input', () => setLocalName(nameSide, input.value));\n"
                  "}\n"
                  "document.getElementById('btn-reset-progress')\n"
                  "    .addEventListener('click', resetProgressClicked);\n"
                  "refreshLocalNames();", 'local extras wiring')

        # --- the names replace the literals --------------------------------
        dst = dst.replace("`${shopSide === 'p1' ? 'Player 1' : 'Player 2'} \u2014 Shop`",
                          "playerName(shopSide) + ' \u2014 Shop'")
        dst = dst.replace("(side === 'p1' ? 'Player 1' : 'Player 2')", "playerName(side)")
        dst = dst.replace("winner === player1 ? 'Player 1' : 'Player 2'",
                          "winner === player1 ? playerName('p1') : playerName('p2')")

        # --- an explicit Start Fight ---------------------------------------
        dst = rep(dst, AUTO_START_OLD, AUTO_START_NEW, 'no auto-start in local')
        dst = dst.replace('<button id="btn-start-match" style="display:none;">Start Match</button>',
                          '<button id="btn-start-match" style="display:none;">Start Fight</button>')

        # --- scrolling: the page, not the panels ---------------------------
        dst = dst.replace(DETAIL_SCROLL_OLD, DETAIL_SCROLL_NEW)
        for old_css in PANEL_SCROLLERS:
            if old_css in dst:
                dst = dst.replace(old_css, old_css
                                  .replace("overflow-y: auto", "overflow-y: visible")
                                  .replace("max-height: 100%", "max-height: none")
                                  .replace("max-height: 90vh", "max-height: none")
                                  .replace("max-height: 92vh", "max-height: none"))
        print('  %-34s ok' % 'page scroll, not panel scroll')

        # --- the modal that was clipped off the top -----------------------
        dst = rep(dst, MODALS_OLD, MODALS_NEW, 'modals align to top')

        # --- two bots: watch from above -----------------------------------
        dst = rep(dst, WATCH_OLD, WATCH_NEW, 'bots-only watch view')
        dst = rep(dst, "function renderOneView(cam, viewer, x, y, vw, vh, dt) {",
                  "// The local build renders directly - bloom is an online-build addition,\n"
                  "// which one viewport is what made practical. Named rather than inlined so\n"
                  "// the two builds' render paths read the same shape.\n"
                  "function renderWithBloomLocal(scn, cam) { renderer.render(scn, cam); }\n\n"
                  "function renderOneView(cam, viewer, x, y, vw, vh, dt) {", 'local render helper')
        dst = rep(dst, "        openShop, buildShop, refreshBotUI,",
                  "        openShop, buildShop, refreshBotUI,\n"
                  "        playerName, setLocalName, refreshLocalNames, resetProgressClicked,\n"
                  "        botsOnly, soloHumanSide, positionWatchCamera,\n"
                  "        get localNames() { return localNames; },",
                  'local debug handles')
        # headingHTML() regenerates each side's heading on every
        # refreshMenuUI, from a hardcoded `Player ${num}` - so the name span
        # inserted above is wiped the moment anything changes. The template
        # reads the name instead.
        n_head = dst.count("`Player ${num}${botTag}")
        dst = dst.replace("`Player ${num}${botTag}", "`${playerName(side)}${botTag}")
        print('  %-34s %d templates' % ('heading uses the name', n_head))
        # ...and typing a name repaints the headings through the same path.
        dst = rep(dst, "function refreshLocalNames() {",
                  "function refreshLocalNames() {\n"
                  "    // refreshMenuUI owns the headings (see headingHTML), so the name\n"
                  "    // change goes through it rather than poking at the DOM twice.\n"
                  "    if (typeof refreshMenuUI === 'function') refreshMenuUI();",
                  'name change repaints the headings')
        # ONE branch, ahead of the two per-side ones: when exactly one side is
        # human, that side uses the online scheme instead of the
        # split-keyboard one. Inserted rather than merged into both branches so
        # the two-human path is textually untouched.
        dst = rep(dst, "        } else if (this.isPlayerOne) {",
                  "        } else if (soloHumanSide() === sideOf(this)) {\n"
                  "            // One human, so the reason for the split-keyboard scheme is\n"
                  "            // gone - see applySoloControls.\n"
                  "            const r = applySoloControls(this, BINDINGS[sideOf(this)], dt, target);\n"
                  "            moveX = r.moveX; moveY = r.moveY;\n"
                  "            jumpPressed = r.jumpPressed; jumpJustPressed = r.jumpJustPressed;\n"
                  "        } else if (this.isPlayerOne) {", 'solo human controls')
        # The extras declare p1IsBot/p2IsBot themselves (see the note there),
        # so the original declaration has to go or it is a redeclaration.
        dst = rep(dst, "let p1IsBot = false, p2IsBot = false;",
                  "// p1IsBot/p2IsBot are declared with the local extras above, because the\n"
                  "// load-time menu build reads them through displayName().",
                  'bot flags hoisted')
        print('  %-34s ok' % 'local requests wired')

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

    # ------------------------------------------- the first-person rig, whole
    # Reported P0: in the LOCAL build Gorgonok's first-person hand is "a large
    # flat-shaded gold hexagonal prism", and "check whether the local and online
    # builds use different first-person rigs". They do, and that is the whole
    # bug: this build forked before Batch 46, so it has none of the viewmodel
    # work - no handIsTheWeapon guard (so a punch character gets buildFistProp
    # bolted onto the model's real hand, which IS the gold block), no tuned prop
    # angles, no camera-space anchor, and no arm mirror.
    #
    # Ported as ONE contiguous region rather than as a dozen edits: everything
    # from buildViewmodelArmFromModel down to viewmodelAnimKind is the rig, the
    # two builds' copies start and end on the same lines, and half a rig is
    # worse than either whole one. The animation driver below it (syncViewmodels)
    # is deliberately NOT included - it is split-screen-aware here.
    VM_END = chr(10) + 'const _vmLerp = (a, b, t) => a + (b - a) * t;'
    if 'function finishViewmodel(' not in dst:
        new_rig = block(src, 'function buildViewmodelArmFromModel(f) {', VM_END, 'first-person rig')
        old_rig = block(dst, 'function buildViewmodelArmFromModel(f) {', VM_END, 'first-person rig (old)')
        dst = dst.replace(old_rig, new_rig, 1)
        # ...and the pieces the rig calls that live further up the file.
        # A source end marker and a destination one, because a block does not
        # always end the same way in both files. Getting this wrong is not a
        # subtle failure: an end marker 1800 lines too late once pulled 106KB of
        # unrelated code into the local build, which the byte count caught.
        for start, src_end, dst_end, label in (
            ('function propForAtkType(',
             chr(10) + '// Batch 28: the first-person arm.',
             chr(10) + '// Batch 28: the first-person arm.',
             'propForAtkType'),
            ('const VM_PROP_TUNE = {', chr(10) + 'const VM_SCALE',
             chr(10) + 'const VM_SCALE', 'VM_PROP_TUNE + vmPropAngles'),
        ):
            end = src_end
            new_blk = block(src, start, src_end, label)
            # A ported block can carry a TOP-LEVEL `const` this build already
            # declares further up, and a duplicate const is a SyntaxError that
            # kills the whole page - which is how the first run of this step
            # shipped a blank local build ("Identifier 'ARM_CHAIN' has
            # already been declared"). Dropping the redeclaration is right and
            # removing the older one is not: code between the two would then
            # reference it before its declaration.
            #
            # COLUMN 0 ONLY, and whole lines only. The first version of this
            # matched any `const NAME`, which stripped a one-letter local
            # (`const t = VM_PROP_TUNE[...]`) out of the middle of a function
            # because some unrelated line elsewhere declared a `t`. Both the
            # candidate and the existing declaration have to be top-level.
            for line in new_blk.split(chr(10)):
                m = re.match(r'^const ([A-Za-z_$][\w$]*)\s*=.*;$', line)
                if not m:
                    continue
                ident = m.group(1)
                if re.search(r'(?m)^const %s\s*=' % re.escape(ident), dst):
                    new_blk = new_blk.replace(line + chr(10), '', 1)
                    print('  %-34s already declared here; kept' % ident)
            if start in dst:
                old_blk = block(dst, start, dst_end, label + ' (old)')
                dst = dst.replace(old_blk, new_blk, 1)
            else:
                # The trailing newline matters: a block that ends on a comment
                # line, concatenated straight onto the next declaration, makes
                # the declaration part of the comment. The whole page then dies
                # with "Unexpected token".
                dst = rep(dst, 'function buildViewmodelArmFromModel(f) {',
                          new_blk.rstrip(chr(10)) + chr(10)
                          + 'function buildViewmodelArmFromModel(f) {', label)
        for decl, after in (
            ('const VM_SCALE = 0.30;', 'const VM_ARM_ROLL'),
            ('const VM_ARM_ANCHOR = new THREE.Vector3(10.6, -6.8, -13.6);', 'const VM_ARM_ROLL'),
        ):
            if decl.split(' =')[0] + ' =' not in dst:
                dst = rep(dst, after, decl + chr(10) + after, decl.split(' ')[1])
        print('  %-34s ok' % 'first-person rig')

    # --------------------------------------- the local build's own UI items
    # Each of these is local-only: they are about two players at one keyboard,
    # which the online build does not have.

    # "With Bot on, the header reads 'Bot [BOT]', which says the same thing
    # twice." displayName() already returns 'Bot' for a bot side - a deliberate
    # earlier decision, since the name belongs to the person and not to the slot
    # the AI is driving - and the heading appended the tag on top of it. One
    # marker, kept in the tag's colour so it still reads at a glance.
    dst = rep(dst, """    const botTag = isBotSide ? ' <span style="color:#f59e0b">[BOT]</span>' : '';""",
              """    // NOT a [BOT] tag on top of displayName's 'Bot'. Reported as "the header
    // reads 'Bot [BOT]', which says the same thing twice" - the tag colours the
    // name instead.
    const botTag = '';""",
              'bot tag says it once', required=False)

    dst = rep(dst, """function displayName(side) {
    const isBot = side === 'p1' ? p1IsBot : p2IsBot;
    return isBot ? 'Bot' : playerName(side);
}""",
              """function displayName(side) {
    const isBot = side === 'p1' ? p1IsBot : p2IsBot;
    if (!isBot) return playerName(side);
    // TWO BOTS NEED TWO NAMES. Reported from a mirror match: "both have
    // identical red rings and identical red health bars labeled 'Ignis (Bot)'"
    // - with one bot, "Bot" is unambiguous; with two it is the same label
    // twice, on the only two things on screen.
    return (p1IsBot && p2IsBot) ? (side === 'p1' ? 'Bot 1' : 'Bot 2') : 'Bot';
}""", 'two bots, two names', required=False)

    # The results screen agrees with itself, and reads from the winner's side.
    dst = rep(dst, """        const winnerLabel = winner === player1 ? playerName('p1') : playerName('p2');""",
              """        // displayName, not playerName: the summary below uses displayName, and
        // the two disagreed - reported as "the title says 'Gorgonok (Arjun)
        // Wins' while the stats line says 'Gorgonok (Bot)'".
        const winnerSide = winner === player1 ? 'p1' : 'p2';
        const loserSide = winnerSide === 'p1' ? 'p2' : 'p1';
        const winnerLabel = displayName(winnerSide);""",
              'results label agrees', required=False)

    dst = rep(dst, """        if (matchMode === 'zone') score = `${Math.floor(zoneScore.p1)}s-${Math.floor(zoneScore.p2)}s held`;
        else if (matchMode === 'timeattack') score = `${koTally.p1}-${koTally.p2} KOs`;
        else score = `${roundWins.p1}-${roundWins.p2}`;""",
              """        // FROM THE WINNER'S SIDE. Fixed P1-P2 order meant a P2 win was announced
        // as "(0-2)", which reads as a loss - reported.
        if (matchMode === 'zone') score = `${Math.floor(zoneScore[winnerSide])}s-${Math.floor(zoneScore[loserSide])}s held`;
        else if (matchMode === 'timeattack') score = `${koTally[winnerSide]}-${koTally[loserSide]} KOs`;
        else score = `${roundWins[winnerSide]}-${roundWins[loserSide]}`;""",
              'score reads from the winner', required=False)

    # Rings that identify the SIDE, not the fighter.
    dst = rep(dst, """        ring.material.color.set(f.color);""",
              """        // BY SIDE, not by fighter. A mirror match gave both fighters the same
        // ring colour and the same HUD colour, so from overhead there was
        // nothing to tell them apart - reported for Ignis vs Ignis. A side
        // colour is the one thing that is always different.
        ring.material.color.set(WATCH_RING_SIDE[i === 0 ? 'p1' : 'p2']);""",
              'rings identify the side', required=False)

    # GUARDED, because this step's anchor survives inside its own replacement -
    # without the guard a second run of this script declares WATCH_RING_SIDE
    # twice, which is a SyntaxError that blanks the page.
    if 'WATCH_RING_SIDE' not in dst:
      dst = rep(dst, """const WATCH_RING_INNER = 26, WATCH_RING_OUTER = 34;""",
              """const WATCH_RING_INNER = 26, WATCH_RING_OUTER = 34;
// Deliberately NOT the fighter's colour: see the note where these are applied.
// Blue and orange, which no character on the roster uses as its identity and
// which stay distinguishable against every arena floor.
const WATCH_RING_SIDE = { p1: '#38bdf8', p2: '#fb923c' };""",
                'side ring colours', required=False)

    # --------------------------------- the spectator camera follows the fight
    # The extras fragment is injected once, guarded on `function playerName(`,
    # so a change inside it never reaches a build that already has it. Rather
    # than keep a second copy of the new code here, the block is LIFTED OUT of
    # the fragment and swapped in - one source of truth, and idempotent.
    if 'function syncWatchRings(' not in dst:
        extras_src = io.open(os.path.join(HERE, 'local_extras.js'), encoding='utf-8').read()
        END = chr(10) + "// ------------------------------------------- the solo human's controls"
        new_cam = block(extras_src, '// Batch 52: IT FRAMES THE FIGHT', END, 'watch camera (new)')
        old_cam = block(dst, 'function positionWatchCamera(aspect) {', END, 'watch camera (old)')
        dst = dst.replace(old_cam, new_cam, 1)
        # One call, at the top of renderViews rather than inside its watch
        # branch: the rings have to be HIDDEN when the view is not the watch
        # view, and a call that only runs in that branch can never do that.
        dst = rep(dst, """    renderer.getSize(_rendSize);
    const W = _rendSize.x, H = _rendSize.y;
    // Nobody is playing: one camera, from above.""",
                  """    syncWatchRings(botsOnly());
    renderer.getSize(_rendSize);
    const W = _rendSize.x, H = _rendSize.y;
    // Nobody is playing: one camera, from above.""",
                  'watch ring sync')
        dst = rep(dst, '        botsOnly, soloHumanSide, positionWatchCamera,',
                  '        botsOnly, soloHumanSide, positionWatchCamera, syncWatchRings,' + chr(10)
                  + '        get watchSpan() { return watchSpan; },' + chr(10)
                  + '        get watchRings() { return watchRings; },',
                  'watch debug surface')
        print('  %-34s ok' % 'spectator camera follows the fight')

    # --------------------------------------------- the same type as the main build
    # "The local build uses Arial almost everywhere" - measured at 147 visible
    # controls against zero online. Form elements do NOT inherit font-family
    # from their ancestors: the UA stylesheet gives them their own, so setting
    # it on `body` reaches paragraphs and misses every button, and in this game
    # most of the text IS buttons.
    if 'font-family: inherit' not in dst:
        # The body rule inside the :root block, not the two in media queries.
        body_anchor = "        body {" + chr(10) + "            margin: 0;"
        dst = rep(dst, body_anchor,
                  block(src, "        /* EVERY piece of text, not just what inherits.",
                        chr(10) + "        h1 {", 'font inherit')
                  + body_anchor, 'font inherit')
        print('  %-34s ok' % 'font inherit')

    # ------------------------------------------------- Settings while paused
    # Reported as missing "in either build". It is in the online one; this file
    # is GENERATED, so Batch 53 writing the button straight into it lasted
    # exactly until the next run of this script. A change this build needs is a
    # step here or it is not a change.
    if 'btn-pause-settings' not in dst:
        dst = rep(dst, """                    <button id="btn-pause-rebind">Rebind Keys</button>""",
                  """                    <button id="btn-pause-rebind">Rebind Keys</button>
                    <!-- Glow, HUD Text and Audio are only worth changing while
                         you can see what they do. The modal stack puts this over
                         the pause screen and Escape closes it back to here. -->
                    <button id="btn-pause-settings" class="btn-secondary">Settings</button>""",
                  'pause settings button')
        dst = rep(dst, "document.getElementById('btn-pause-rebind').addEventListener('click',",
                  """document.getElementById('btn-pause-settings').addEventListener('click', () => {
    if (typeof syncDebugUnlockUI === 'function') syncDebugUnlockUI();
    openModal('settings');
});
document.getElementById('btn-pause-rebind').addEventListener('click',""",
                  'pause settings listener')
        print('  %-34s ok' % 'pause settings')

    # ------------------------------------------------- one name for one thing
    # MATCH_MODES is data with prose in it, and the prose drifted: the boss is
    # "the Granite Colossus" online and was still "the Hollow Titan" here, and
    # Survival Waves said "one at a time" in the mode list and "squads" in How
    # to Play. Ported whole.
    new_modes = block(src, 'const MATCH_MODES = [', chr(10) + '];', 'match modes')
    old_modes = block(dst, 'const MATCH_MODES = [', chr(10) + '];', 'match modes (old)')
    if old_modes != new_modes:
        dst = dst.replace(old_modes, new_modes, 1)
        print('  %-34s ok' % 'match modes')
    # ...and the same boss name in this build's own prose.
    if 'Hollow Titan' in dst:
        dst = dst.replace('Hollow Titan', 'Granite Colossus')
        print('  %-34s ok' % 'boss name')

    # --------------------------------------------- Controls first in How to Play
    # Reported: "the Controls card comes LAST." It is the card this panel is
    # opened to read. A step rather than an edit to this file, because this file
    # is generated - see the pause-Settings note above for what happens to edits
    # made here directly.
    ctrl_card = ('                        <div class="tutorial-card">' + chr(10)
                 + '                            <h4>Controls</h4>' + chr(10)
                 + '                            <div id="tutorial-controls"></div>' + chr(10)
                 + '                        </div>' + chr(10))
    grid_open = '                    <div class="tutorial-grid">' + chr(10)
    # Already first when the card follows the grid's opening tag directly.
    already_first = (grid_open + ctrl_card) in dst
    if ctrl_card in dst and not already_first:
        dst = dst.replace(ctrl_card, '', 1)
        dst = dst.replace(grid_open, grid_open + ctrl_card, 1)
        print('  %-34s ok' % 'controls card first')

    # ------------------------------------- How to Play, for the controls it has
    # "It says 'Turn keys rotate your view... there's no strafing sideways'" -
    # true since Batch 47 gave the solo player the online scheme. BOTH schemes
    # are real here and which one you get depends on how many humans are
    # playing, so the card says that instead of picking one. It also goes FIRST:
    # it is the card this panel is opened to read.
    if 'Movement is covered under' not in dst:
        # NOT a new Controls card: both builds already have one (it prints the
        # live bindings), and it has been moved to the front of the grid in the
        # markup. This step is only the PROSE that still describes controls this
        # build no longer has.
        # The two paragraphs that still describe controls this build no longer
        # has. Matched on ASCII-only fragments: the surrounding text has em
        # dashes and curly apostrophes, and a pattern carrying those matched
        # nothing at all on the first attempt.
        for frag, repl, label in (
            ('Turn to look around, then walk forward or back in that direction',
             'Movement is covered under <b>Controls</b> above.', 'movement card'),
            ('Turn keys rotate your view like looking around, not an instant sidestep',
             'See <b>Controls</b> above for how you move and aim', 'first-person card'),
        ):
            i = dst.find(frag)
            if i < 0:
                print('  %-34s SKIPPED (0 matches)' % label)
                continue
            # ...up to the end of that sentence.
            j = dst.index('. ', i + len(frag)) + 2
            dst = dst[:i] + repl + '. ' + dst[j:]
            print('  %-34s ok' % label)

    # WHICH SCHEME YOU GET depends on how many humans are playing, and the
    # Controls card described only one of them. Reported: "it says 'Turn keys
    # rotate your view... there's no strafing sideways', but local now gives the
    # human mouse look and A/D strafing whenever the other side is a bot."
    # Escape was missing too - the one key that is not a combat binding, and the
    # only way out of a match.
    if 'Alone against a bot' not in dst:
        dst = rep(dst, '''        `<div class="tutorial-controls-row" style="margin-top:4px;color:#64748b;"><b>Gamepad:</b> stick move/turn, A jump, B attack, X special, Y dash</div>`;''',
                  '''        `<div class="tutorial-controls-row" style="margin-top:4px;color:#64748b;"><b>Gamepad:</b> stick move/turn, A jump, B attack, X special, Y dash</div>` +
        `<div class="tutorial-controls-row" style="margin-top:6px;"><b>Alone against a bot:</b> you get the whole screen and the online scheme — mouse look, <b>A/D</b> to strafe, left click to attack. Click the arena once to capture the mouse.</div>` +
        `<div class="tutorial-controls-row" style="margin-top:4px;"><b>Two players:</b> the screen splits and each side uses its own keys, above — turn to look, then walk in the direction you face.</div>` +
        `<div class="tutorial-controls-row" style="margin-top:4px;"><b>Esc</b> pauses, and opens Rebind Keys and Settings.</div>`;''',
                  'controls card copy')

    # One name for the store. The online build calls it the Armory; this one
    # called it the Shop, in a build that shares its progression.
    # Every user-visible use, including inside How to Play's prose - the phrase
    # "open the Shop from your own panel" survived the first pass because it was
    # in a sentence rather than on a button.
    for old_word, new_word in ((" + ' — Shop'", " + ' — Armory'"),
                               ('the Shop from', 'the Armory from'),
                               ('>Shop<', '>Armory<'), ('Shop</button>', 'Armory</button>'),
                               ('Player 1 \u2014 Shop', 'Player 1 \u2014 Armory'),
                               ('Player 2 \u2014 Shop', 'Player 2 \u2014 Armory'),
                               ('in the Shop', 'in the Armory'), ('the Shop.', 'the Armory.')):
        if old_word in dst:
            dst = dst.replace(old_word, new_word)
    print('  %-34s ok' % 'store is the Armory')

    # ------------------------------------------- the same debug surface
    # Not cosmetic: the checkers that found the online build's bugs could not be
    # pointed at this one, because ACDebug here is missing the handles they use.
    # "Local mode is behind in everything" is partly this - it was behind in
    # what could be MEASURED about it.
    if 'get scene()' not in dst:
        dst = rep(dst, '        rendererInfo() {',
                  """        showLoading, hideLoading, withLoading, themeTexturesReady,
        get scene() { return scene; },
        get renderer() { return renderer; },
        get mapGroup() { return mapGroup; },
        get currentMap() { return currentMap; },
        rendererInfo() {""", 'debug surface parity')
        print('  %-34s ok' % 'debug surface parity')

    # ------------------------------- a muzzle flash must not change the light count
    # The same freeze, in this build: each pool entry's PointLight was a CHILD
    # of the flash mesh, and hiding the mesh when the flash expired took the
    # light out of the scene - which changes the lights hash and recompiles
    # every material in the arena. Measured in the online build at 9,858ms for a
    # single frame. Ported whole, since the pool is identical here.
    if 'scene.add(light);' not in dst:
        new_pool = block(src, "// ONE PROJECTILE'S VISUALS.",
                         chr(10) + 'function spawnMuzzleFlash(', 'muzzle pool')
        old_pool = block(dst, 'const muzzleFlashes = [];',
                         chr(10) + 'function spawnMuzzleFlash(', 'muzzle pool (old)')
        dst = dst.replace(old_pool, 'const muzzleFlashes = [];' + chr(10) + new_pool, 1)

        dst = rep(dst, """    if (!mf) {
        const core = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 }));
        const light = new THREE.PointLight(0xffffff, 0, 140);
        light.layers.enableAll();
        core.add(light);
        scene.add(core);
        mf = { mesh: core, light, life: 0, maxLife: 8, active: false };
        muzzleFlashes.push(mf);
    }""",
                  """    if (!mf) mf = makeMuzzleFlash();""", 'muzzle factory')
        dst = rep(dst, """    mf.mesh.position.set(worldX(gameX), height, worldZ(gameY));
    mf.mesh.material.color.set(hexNum(colorHex));""",
                  """    mf.mesh.position.set(worldX(gameX), height, worldZ(gameY));
    mf.light.position.copy(mf.mesh.position);   // no longer parented to it
    mf.mesh.material.color.set(hexNum(colorHex));""", 'muzzle light follows')
        print('  %-34s ok' % 'muzzle flash light count')

    # The cap the pool is built to. Checked on its own rather than inside the
    # pool's guard: the committed build already had the pool and still lacked
    # the cap, so a guard keyed on the pool skipped the one thing missing -
    # "MUZZLE_FLASH_MAX is not defined" on every frame of a ranged attack, which
    # is another frozen screen. Same half-port shape as the swing constants.
    if 'const MUZZLE_FLASH_MAX' not in dst:
        dst = rep(dst, 'const muzzleFlashes = [];',
                  'const muzzleFlashes = [];' + chr(10)
                  + block(src, '// Batch 30: HARD CAP.', chr(10) + "// ONE PROJECTILE'S VISUALS.",
                          'muzzle cap').rstrip(chr(10)), 'muzzle cap')
        print('  %-34s ok' % 'muzzle flash cap')

    # ...and the pool is BUILT before the fight, here as well. Measured in this
    # build after the light fix landed: Lyra's first shot still cost a 4,304ms
    # frame with the live light count going 17 -> 18, because the first pool
    # entry was still being created lazily, mid-fight. The warm-up was an
    # index.html edit and this file needs it just as much.
    if 'warmCombatShaders' not in dst:
        dst = rep(dst, "// EVERY SHADER A FIGHT WILL NEED", "// EVERY SHADER A FIGHT WILL NEED",
                  'warm probe', required=False)
        warm = block(src, '// BUILD THE POOL BEFORE THE FIGHT, not during it.',
                     chr(10) + 'function spawnMuzzleFlash(', 'warm block')
        dst = rep(dst, 'function spawnMuzzleFlash(', warm + 'function spawnMuzzleFlash(', 'warm block')
        print('  %-34s ok' % 'shader warm-up')

    # The CALL gets its own guard. Guarding it on the function's existence meant
    # that once the function had been ported, the call never was - a definition
    # with no caller, which is the same half-port shape as the two above.
    if 'warmCombatShaders([' not in dst:
        dst = rep(dst, '    loadMap(matchMap);',
                  '''    loadMap(matchMap);
    // Before anyone can fire: a light added mid-fight recompiles every material
    // in the scene. See warmCombatShaders.
    warmCombatShaders([p1Choice && p1Choice.color, p2Choice && p2Choice.color]);''',
                  'warm call')

    # ------------------------------------ how a swing travels, and what it holds
    # Pure animation: the shape of the arc, where the strike begins, how long
    # the contact pose is held. Nothing in it knows which build it is in.
    #
    # Replace-if-different rather than insert-if-missing, so the two builds stay
    # in step from here on. An insert-if-missing step is correct exactly once,
    # which is how the local build ended up with a swing envelope three
    # batches behind and a sword with a seven-unit grip sticking out of frame.
    for start, end, label in (
        ('function buildSwordProp(', chr(10) + 'function buildDaggerProp(', 'sword prop'),
        ('function propForAtkType(', chr(10) + '// Batch 28: the first-person arm.',
         'weapon props'),
    ):
        new_blk = block(src, start, end, label)
        old_blk = block(dst, start, end, label + ' (old)')
        if old_blk != new_blk:
            dst = dst.replace(old_blk, new_blk, 1)
            print('  %-34s ok' % label)
    # THE SWING ENVELOPE IS NOT PORTED ANY MORE. It lives in
    # shared/animation.js, which both builds load, so there is nothing to carry
    # and nothing to half-carry. Three crashes in one week came from this step
    # copying swingT without all of its constants; the verification at the end
    # now asserts the opposite - that neither build re-declares any of it,
    # because a local `const` would shadow the shared one and bring the drift
    # straight back.

    # ----------------------------------------------- how each arena is lit
    # Same story as PHOTO_SETS below, found the same way: this build's Molten
    # Foundry is still the bright arena reported three times, because every
    # per-theme fix landed in the online build only. MAP_THEMES is pure art
    # direction, so it ports whole, along with the two things that read its new
    # fields.
    new_themes = block(src, 'const MAP_THEMES = {', chr(10) + 'function themeTintFade(', 'map themes')
    old_themes = block(dst, 'const MAP_THEMES = {', chr(10) + 'function themeFor(', 'map themes (old)')
    if 'themeTintFade' not in dst:
        dst = dst.replace(old_themes, new_themes, 1)
        # The reader for theme.tintFade, and the per-theme exposure base.
        dst = rep(dst, 'function themeFor(map) {',
                  block(src, '// How much of a theme\'s COLOUR survives',
                        chr(10) + 'function themeFor(map) {', 'tint fade helper')
                  + 'function themeFor(map) {', 'tint fade helper')
        dst = rep(dst, 'renderer.toneMappingExposure = 1.1;',
                  """// The base, which applyLighting() then scales per theme (see theme.exposure).
// 1.1 was this build's flat value; the online build settled on 0.92 after the
// pale arenas were reported as "almost entirely white".
const BASE_EXPOSURE = 0.92;
renderer.toneMappingExposure = BASE_EXPOSURE;""", 'base exposure')
        dst = rep(dst, """function applyLighting(theme) {
    ambientLight.color.set(theme.ambient.color);""",
                  """function applyLighting(theme) {
    // PER-THEME EXPOSURE. One global value cannot serve a glacier and a
    // foundry: a near-white albedo clips under it and a near-black one washes
    // out. See theme.exposure.
    renderer.toneMappingExposure = BASE_EXPOSURE * (theme.exposure || 1);
    ambientLight.color.set(theme.ambient.color);""", 'per-theme exposure')
        # ...and the tint strength actually reaching the surfaces.
        for old_tint in ('tintFade: 0.62 }', 'tintFade: 0.62 });'):
            while old_tint in dst:
                dst = dst.replace(old_tint, old_tint.replace('0.62', 'themeTintFade(theme)'), 1)
        print('  %-34s ok' % 'map themes + exposure')

    # ------------------------------------------- which photograph, and how big
    # PHOTO_SETS is pure art direction - which photograph maps to which surface,
    # and the tile scale - with nothing build-specific in it, so it is ported
    # whole every time rather than as individual tile numbers. Ported per-line
    # is exactly how it drifted: "the Voltaic Nexus floor is still the brown
    # carpet texture from above" was this build still holding techgrid at 4.2
    # after Batch 49 fixed it online, and its Molten Foundry was still tan rock
    # after Batch 53 moved basalt and lava onto metal_plate.
    new_sets = block(src, 'const PHOTO_SETS = {', chr(10) + 'const PHOTO_BASE', 'photo sets')
    old_sets = block(dst, 'const PHOTO_SETS = {', chr(10) + 'const PHOTO_BASE', 'photo sets (old)')
    if old_sets != new_sets:
        dst = dst.replace(old_sets, new_sets, 1)
        print('  %-34s ok' % 'photo sets')

    # ------------------------------------------------- the loading screen
    # "Loading animations are also not yet implemented in local mode." The
    # markup, the styles and the API are all build-agnostic - the screen covers
    # whatever is loading, and this build loads the same models, textures and
    # shaders.
    if 'id="loading-screen"' not in dst:
        dst = rep(dst, '    <div id="lock-hint">',
                  block(src, '    <!-- The loading screen.', chr(10) + '    <div id="lock-hint">',
                        'loading markup')
                  + '    <div id="lock-hint">', 'loading markup')
        dst = rep(dst, '        #lock-hint {',
                  block(src, '        /* ================= LOADING SCREEN',
                        chr(10) + '        #lock-hint {', 'loading css')
                  + '        #lock-hint {', 'loading css')
        print('  %-34s ok' % 'loading screen markup')
    # The API is replace-if-different so timing changes follow.
    new_api = block(src, '// ---- THE LOADING SCREEN --------',
                    chr(10) + '// ---- Batch 36: player names ----', 'loading api')
    if 'function withLoading(' not in dst:
        dst = rep(dst, 'function saveProgression() {', new_api + 'function saveProgression() {',
                  'loading api')
        print('  %-34s ok' % 'loading api')
    else:
        old_api = block(dst, '// ---- THE LOADING SCREEN --------',
                        chr(10) + 'function saveProgression() {', 'loading api (old)')
        if old_api != new_api:
            dst = dst.replace(old_api, new_api, 1)
            print('  %-34s ok' % 'loading api')

    # ...and this build's match start goes behind it too. Its startMatch is its
    # own (no lobby, two local fighters), so only the wrapping is ported.
    if 'withLoading(matchMap.name' not in dst:
        dst = rep(dst, '    startRound(true);',
                  """    // Behind the loading screen: the models, the arena's photographs and the
    // first-draw shader compiles all happen here rather than as visible hitches
    // once the fight has started. See withLoading.
    withLoading(matchMap.name, () => Promise.resolve()
        .then(() => Promise.all([p1Choice, p2Choice].map(
            c => c && Promise.resolve(ensureCharModel(c.name)).catch(() => null))))
        .then(() => themeTexturesReady(themeFor(matchMap)))
        .then(() => {
            startRound(true);
            return new Promise(r => requestAnimationFrame(() => { renderViews(0); r(); }));
        }));""", 'match start behind the screen')
        print('  %-34s ok' % 'match start behind the screen')

    # ------------------------------------------- the dash cooldown, on your bar
    # "ALL of the ui stuff should be the same in local for example the dash
    # cooldown visual thing." Split screen has two "your" panels, so both get
    # the pips - which is correct here: each player needs their own.
    if "'DASH'" not in dst:
        pips = block(src, '    // THE DASH COOLDOWN.', chr(10) + '}', 'dash pips')
        dst = rep(dst, """    hudCtx.fillText(meterReady ? 'SPECIAL READY' : `Special ${Math.floor(f.specialMeter)}%`, x, 108);
}""",
                  """    hudCtx.fillText(meterReady ? 'SPECIAL READY' : `Special ${Math.floor(f.specialMeter)}%`, x, 108);

""" + pips.replace('    if (!isMine) return;' + chr(10), '').rstrip() + chr(10) + '}', 'dash pips')
        print('  %-34s ok' % 'dash cooldown pips')

    # ------------------------------------------- arena previews that are arenas
    if 'map-shot' not in dst:
        dst = rep(dst, 'function buildMapThumbnail(map) {',
                  block(src, '// The slug art/render_arenas.js writes its files under.',
                        chr(10) + 'function buildMapPlan(map) {', 'arena thumbs')
                  + 'function buildMapPlan(map) {', 'arena thumbs')
        # ...and the old painter keeps its body under the new name.
        dst = rep(dst, """function buildMapPlan(map) {
function buildMapThumbnail(map) {""", 'function buildMapPlan(map) {', 'thumb rename', required=False)
        dst = rep(dst, '        .map-card canvas { display: block; width: 100%; height: auto; }',
                  """        .map-card canvas, .map-card .map-shot {
            display: block; width: 100%; height: auto; aspect-ratio: 16 / 9;
            object-fit: cover; background: #0d1420;
        }""", 'arena thumb css', required=False)
        print('  %-34s ok' % 'arena previews')

    # ------------------------------------------------- the HUD is readable
    # Same strings, same skies, same window sizes as the online build, so the
    # same two fixes: a floor under the rendered pixel size (the HUD is authored
    # in a 1755x975 space and drawn at min(w/1755, h/975), which is 0.35 in a
    # 614px frame - an 18-unit label lands at 6 real pixels), and a plate behind
    # anything drawn over the ARENA rather than over the HUD's own panels.
    #
    # The dash pips are deliberately NOT ported: they are drawn on "your" panel,
    # and split screen has two of those.
    if 'function hudPlate(' not in dst:
        dst = rep(dst, """function hudFont(px, bold) {
    return `${bold ? 700 : 500} ${Math.max(9, Math.round(px * HUD_TEXT_SCALE))}px ${HUD_FAMILY}`;
}""",
                  block(src, 'const HUD_MIN_PX = 11;', chr(10) + 'function cycleHudScale(',
                        'hud font floor').rstrip(chr(10)),
                  'hud font floor')
        dst = rep(dst, 'function drawRoundStatus() {',
                  block(src, '// A dark plate behind a centred string',
                        chr(10) + 'function drawRoundStatus() {', 'hud plate')
                  + 'function drawRoundStatus() {',
                  'hud plate')
        dst = rep(dst, """            hudCtx.fillStyle = "#64748b"; hudCtx.font = hudFont(15); hudCtx.textAlign = "center";
            hudCtx.fillText(currentMap.name, hudW() / 2, 24); hudCtx.textAlign = "left";""",
                  """            hudCtx.font = hudFont(15); hudCtx.textAlign = "center";
            hudPlate(currentMap.name, hudW() / 2, 24);
            hudCtx.fillStyle = "#dbe6f5";
            hudCtx.fillText(currentMap.name, hudW() / 2, 24); hudCtx.textAlign = "left";""",
                  'arena name plate')
        print('  %-34s ok' % 'readable HUD')

    # ------------------------------------------- the HUD is not stretched
    # Batch 51 in the main build, and the same bug here: the HUD is authored in
    # a fixed 1.8:1 virtual space and was scaled onto the canvas one axis at a
    # time, so any other frame aspect stretched every string in it - 28% wide
    # at 1280x529, because `aspect-ratio` and `max-height: 96vh` cannot both
    # hold in a short window and max-height wins.
    #
    # The substitution is by LINE POSITION, which is unusual for this file and
    # deliberate: VIRTUAL_W means two different things in this source. Below the
    # HUD section it is the arena's size in world units (ARENA_*, every map's
    # hand-placed geometry, the shadow fit) and must not move; from the HUD
    # section on it is pure layout. There is no textual difference between the
    # two, so the boundary is the only thing that can distinguish them. It is
    # asserted below rather than assumed.
    if 'function hudUnitScale(' not in dst:
        lines = dst.splitlines()
        # The first HUD drawing function. Everything before it that mentions
        # VIRTUAL_W is world-space; nothing after it is.
        anchor = next(i for i, l in enumerate(lines) if l.startswith('function drawBossHUD('))
        world = sum(l.count('VIRTUAL_W') + l.count('VIRTUAL_H') for l in lines[:anchor])
        # The constant, ARENA_*, SHADOW_FIT_HX/HZ and three comments. If this
        # ever moves, the boundary has moved and the substitution below would
        # be rewriting arena geometry as HUD layout.
        assert world == 10, 'world-space VIRTUAL_* uses: %d (expected 10)' % world
        n = 0
        for i in range(anchor, len(lines)):
            b = lines[i]
            lines[i] = b.replace('VIRTUAL_W', 'hudW()').replace('VIRTUAL_H', 'hudH()')
            if lines[i] != b:
                n += b.count('VIRTUAL_W') + b.count('VIRTUAL_H')
        assert n > 20, 'only %d HUD uses rewritten' % n
        dst = chr(10).join(lines)
        dst = rep(dst, "    hudCtx.scale(hudCanvas.width / hudW(), hudCanvas.height / hudH());",
                  "    hudVirtualTransform();", 'hud transform (shared draw)', required=False)
        dst = dst.replace("    hudCtx.scale(hudCanvas.width / hudW(), hudCanvas.height / hudH());",
                          "    hudVirtualTransform();")
        helpers = block(src, "// THE HUD'S OWN VIRTUAL SPACE, which is NOT the arena's.",
                        "// Floating damage numbers + impact sparks", 'hud space helpers')
        dst = rep(dst, "// Floating damage numbers + impact sparks",
                  helpers + "// Floating damage numbers + impact sparks", 'hud space helpers')
        print('  %-34s ok (%d HUD refs)' % ('uniform HUD scale', n))

    # The frame may use the window it is in, now that no aspect needs defending.
    # Written out rather than lifted from the source: the local build's
    # container carries its own split-screen comment above these lines.
    dst = rep(dst, """            width: min(96vw, 1170px);
            aspect-ratio: 1170 / 650;
            max-height: 96vh;""",
              """            /* NOT aspect-ratio: 1170/650 - see hudUnitScale. That lock
               existed because the HUD was scaled one axis at a time, and it did
               not even hold: aspect-ratio plus max-height contradict each other
               in a short window and max-height wins, which is how a 1280x529
               window got a 2.29:1 frame full of 28%-wide text. The caps are
               unchanged, so a desktop window still gets exactly 1170x650. */
            width: min(96vw, 1170px);
            height: min(96vh, 650px);""",
              'frame fills the window', required=False)

    # VERIFY, rather than trust the guards.
    #
    # The first run of this script shipped a local build that died at load
    # because a guard matched a name in a comment and skipped the definition it
    # was guarding. The guards are keyed on definitions now, but the real lesson
    # is that a porting script must check its own output: every identifier it
    # introduces has to be defined, and every call it inserts has to have a
    # definition behind it. Refusing to write is much cheaper than shipping a
    # build whose only symptom is a blank screen.
    REQUIRED = [
        # Balance that is NOT in shared/roster.js (arena rules, not roster data).
        'const MAX_WALK_STEP_UP = 12;', 'const GRACE_PERIOD = 40;',
        # ...and the shared module itself, which replaced every step that used
        # to copy the roster and the economy across.
        'shared/roster.js', 'AC_ASSET_BASE',
        # Batch 47's local-build requests.
        'function playerName(', 'function resetProgressClicked(',
        'function botsOnly(', 'id="name-p1"', 'id="btn-reset-progress"',
        '>Start Fight<',
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
        # RIG_HEIGHT_MULT and rigHeightFor moved to shared/roster.js, where
        # SHARED_REQUIRED below checks them instead - a definition that is
        # supposed to be shared must NOT be found in this file, or it is
        # shadowing the shared one.
        'const derivedTextureCache',
        # Co-op down and respawn, the two-sided shop, the canonical URL.
        'const COOP_RESPAWN_FRAMES', 'function coopDown(', 'function coopRevive(',
        'function drawCoopDownHUD(', 'function resolveCoopMode(dt)',
        'id="shop-panel-p1"', 'id="shop-panel-p2"', 'function closeShopSide(',
        'function syncShopPanels(', "const CANONICAL_PATH = '/local';",
    ]
    CALLED = ['getTiledWallTexture', 'attachPhotoSurface', 'attachAccentGlow',
              'ensureUV2', 'fitKeyShadow', 'announceFont',
              'loadPhotoSet', 'tiledPhotoTexture', 'accentEmissiveTexture',
              'coopDown', 'coopRevive', 'drawCoopDownHUD', 'syncShopPanels',
              'closeShopSide', 'playerName', 'resetProgressClicked',
              'refreshLocalNames', 'botsOnly', 'positionWatchCamera']
    # What must live in shared/roster.js, and must NOT be re-declared here. A
    # local copy would shadow the shared binding and silently restore exactly
    # the drift this file stopped porting around.
    # Anything moved into a shared module must NOT be re-declared in either
    # build: a `const` inside bootGame() shadows the global and silently
    # restores the drift the move removed. The check below is what makes that
    # a failure rather than a mystery.
    SHARED_REQUIRED = [
        'const CHARACTERS = [', 'const FRAME_DATA = {', 'const BOSS_MAP = {}',
        'const CHAR_MODEL_URLS = {', 'const RIG_HEIGHT_MULT', 'function rigHeightFor(',
        'const AC_ASSET_BASE', 'const UNLOCK_COST', 'const COIN_AWARDS',
    ]
    # ...and the animation module, whose half-porting caused three crashes.
    ANIM_REQUIRED = [
        'const SWING_TRAVEL_FRAMES', 'const SWING_WINDUP_FRAC',
        'const SWING_PRESTRIKE_T', 'const SWING_HOLD_RECOVERY_FRAC',
        'function swingT(', 'function actionPhase(', 'function readableJabs(',
    ]
    shared_src = io.open(os.path.join(ROOT, 'shared', 'roster.js'), encoding='utf-8').read()
    anim_src = io.open(os.path.join(ROOT, 'shared', 'animation.js'), encoding='utf-8').read()
    shared_missing = ([d for d in SHARED_REQUIRED if d not in shared_src]
                      + [d for d in ANIM_REQUIRED if d not in anim_src])
    shadowed = ([d for d in SHARED_REQUIRED if d in dst]
                + [d for d in ANIM_REQUIRED if d in dst])

    missing = [d for d in REQUIRED if d not in dst]
    undefined = [c for c in CALLED
                 if ('function %s(' % c) not in dst and ('const %s' % c) not in dst]
    if missing or undefined or shared_missing or shadowed:
        print('')
        print('PORT INCOMPLETE - refusing to write:')
        for m in missing:
            print('   missing definition: ' + m)
        for u in undefined:
            print('   called but never defined: ' + u)
        for m in shared_missing:
            print('   missing from shared/roster.js: ' + m)
        for d in shadowed:
            print('   SHADOWS the shared definition (must be removed here): ' + d)
        return 1
    print('  %-34s %d local, %d shared, %d calls resolved'
          % ('verified', len(REQUIRED), len(SHARED_REQUIRED) + len(ANIM_REQUIRED), len(CALLED)))

    io.open(DST, 'w', encoding='utf-8', newline='').write(dst)
    print('\nlocal build: %d -> %d bytes' % (before, len(dst)))


if __name__ == '__main__':
    sys.exit(main())
