# -*- coding: utf-8 -*-
r"""Ports the art, font and balance work from index.html into the local
local split-screen build.

    python art/sync_local.py            # regenerate the local build
    python art/sync_local.py --check    # fail if it is stale, write nothing

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
import difflib
import subprocess
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'index.html')
DST = os.path.join(ROOT, 'local', 'index.html')


# A column-0 definition, the same shape art/extract_shared.py looks for.
_IDENT_RE = re.compile(r'[A-Za-z_$][\w$]*')
# Every name the shared modules define; filled in by main().
SHARED_NAMES = set()

# `class` included: without it `class Fighter` was invisible here too, and its
# 1,681 lines were absorbed into the chunk of whatever preceded it.
_DEF_RE = re.compile(r'(?m)^(?:function\s+([A-Za-z_$][\w$]*)\s*\(|'
                     r'(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=|'
                     r'class\s+([A-Za-z_$][\w$]*)\b)')


def strip_trailing_comment(line):
    """Drop a `// ...` comment from the end of a line of code.

    Scans rather than splits, because the '//' has to be found OUTSIDE string
    literals: 'https://example' would otherwise be truncated to 'https:' and two
    genuinely different URLs would compare equal. Quotes, double quotes and
    template literals are tracked, with backslash escapes honoured.

    Used for COMPARISON only. The text actually written is the online body
    verbatim, so the worst a mis-scan can do is unify two bodies that should
    have stayed apart - never corrupt one.
    """
    quote = None
    i = 0
    while i < len(line):
        c = line[i]
        if quote:
            if c == chr(92):
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in ('"', "'", '`'):
            quote = c
        elif c == '/' and i + 1 < len(line) and line[i + 1] == '/':
            return line[:i].rstrip()
        i += 1
    return line


def code_only(text):
    """The lines that actually run: no comments, no blanks, no indentation.

    Trailing comments count as comments too. Keeping them made a note appended
    to a line of code read as a code difference:

        hudCtx.font = announceFont(fontPx, 700);   // floating damage numbers
        hudCtx.font = announceFont(fontPx, 700);

    - which pinned five definitions apart over nothing.
    """
    out = []
    for line in text.splitlines():
        t = strip_trailing_comment(line.strip())
        if t and not t.startswith('//'):
            out.append(t)
    return chr(10).join(out)


# Definitions that differ BETWEEN THE BUILDS ON PURPOSE.
#
# 35 entries were pruned once definition boundaries became correct: they did not
# differ AT ALL. A chunk used to run to the next definition, so any top-level
# statement in between counted as part of the body - and two identical functions
# with different wiring after them looked like a fork. Every one of those had a
# reason written beside it, and every one of those reasons was fiction.
#
# AUDITED. Six entries were removed after reading their actual diffs: a reason
# written beside a name is not the same as a necessary reason, and these six
# described the STRUCTURE (two viewmodels, two HUD panels) while the actual
# difference was drift. Two of them were live bugs in the local build - the arm
# mirrored about X instead of Z ("the arms are still left arms" and "Draven's
# weapon is backwards" are one bug), and a viewmodel roll that went flat on the
# first frame because syncViewmodels assigns rotation every frame.
#
# Names that have since moved to shared/ are pruned from this list rather than
# left as harmless no-ops: an entry naming something that no longer exists reads
# as a decision somebody made, and the next person has no way to tell it from a
# live one. Nothing here is copied
# across, and each entry says why, because an unexplained name on this list is
# indistinguishable from drift somebody gave up on.
INTERFACE = {
    # The Fighter class holds the genuinely forked input handling - per-side
    # bindings here, mouse look and isLocalSide there - in the SAME body as code
    # that has merely drifted (the local copy still has the old single-rate
    # teleport decay). A chunk is all-or-nothing, so copying it would trade a
    # visual regression for a controls regression. Splitting the input out of
    # the class is the way to unify the rest; until then this is honest.
    'Fighter': 'forked input handling and drifted visuals share one class body',

    # These four reach the LOBBY: refreshRoomUI, startOnline, netAnnouncePick and
    # requestResume are the room screen and the away-pause handshake, which exist
    # only where there is somebody to announce a pick TO. Tried unifying them and
    # the sync refused by name, which is the check working.
    'chooseMap': 'calls the room UI and startOnline',
    'confirmPick': 'announces the pick to the other client',
    'previewPick': 'announces the pick to the other client',

    # Unified in CODE; the two copies differ only by the engine path, which the
    # rewrite above applies deterministically after the body is copied. Listed
    # so the drift report stays empty and so nobody "fixes" it by copying the
    # online path over the top - which is exactly what happened once, and only
    # bites when the CDN is down.
    'loadThreeFallback': 'same body; the engine sits one directory up',

    # NOT the function - the STATEMENTS after it. A chunk runs to the next
    # definition, so copying randomPick also copied
    #     document.getElementById('btn-my-random').addEventListener(...)
    #     document.getElementById('btn-my-shop').addEventListener(...)
    # which are the online build's single Random and Armory buttons. This build
    # has a pair per side and no such ids, so getElementById returned null and
    # the whole build died at load with "Cannot read properties of null".

    # The last one. The online body calls refreshHudScaleUI(); that helper is
    # portable now that boundaries are right, but it reads setOptState on an
    # options row this build does not have, so the two-line inlined version
    # here says the same thing without the row. Left as the honest remainder.
    'cycleHudScale': 'sets the button text directly; no options row here',

    # --- rendering: one full-screen camera vs two split-screen viewports
    'renderer': 'split-screen sizing and scissor state',
    'PIXEL_RATIO': 'local pays for two viewports, so it caps lower',
    'renderViews': 'the split itself',
    'renderOneView': 'per-viewport camera and scissor',
    'hudViewports': 'two HUD panels here, one there',
    'drawHUD': 'draws two panels',
    'drawHUDInner': 'draws two panels',
    'drawPlayerHUD': 'per-panel geometry',
    'drawIntroOverlay': 'per-panel geometry',
    'drawRoundStatus': 'per-panel geometry',
    'drawCoopDownHUD': 'per-panel geometry',
    'toggleBloom': 'the local build has no composer',
    'onWindowResize': 'no composer to resize, two viewports to lay out',

    # --- controls: two players at one keyboard vs one player and a mouse
    'DEFAULT_BINDINGS': 'two full key sets',
    'REBIND_ACTION_LABELS': 'labelled per side',
    'keyLabel': 'labelled per side',
    'controlsSummary': 'describes two players',
    'buildTutorialControls': 'describes two players',
    'buildRebindList': 'two lists',
    'saveBindings': 'two sides',
    'startCapture': 'two sides',
    'pollGamepad': 'two pads',

    # --- screens and flow: lobby and room code vs a local picker
    'SCREEN_EL': 'different screens exist',
    'MODAL_EL': 'different modals exist',
    'currentScreen': 'different screens exist',
    'startGame': 'entry point',
    'startMatch': 'match framework',
    'startRound': 'match framework',
    'beginMatch': 'match framework',
    'endMatch': 'match framework',
    'endCoopMatch': 'match framework',
    'backToPick': 'match framework',
    'togglePause': 'match framework',
    'refreshMenuUI': 'different menus',
    'refreshBotUI': 'bots are per side here',
    'resolveCoopMode': 'match framework',
    # Not per-side at all: the online body calls refreshHudScaleUI(), and that
    # helper cannot travel because a definition's CHUNK runs to the next
    # definition - so it sweeps up the listener statements below it, which
    # reference setSandboxMatch, which is online-only. The two-line inlined
    # version here says the same thing. Honest limitation of chunk boundaries,
    # recorded rather than papered over.
    'gameLoop': 'drives two views and no network tick',
    'onBossDefeated': 'match framework',

    # --- progression and the store: one account vs two side-local purses
    'prog': 'two purses',
    'upgradeLevel': 'two purses',
    'addCoins': 'two purses',
    'refreshCoinDisplays': 'two purses',
    'buildShop': 'two purses',
    'openShop': 'two purses',
    'showDetail': 'two purses',
    'buildDetailHTML': 'two purses',
    'refreshGridLocks': 'two purses',
    'isCharUnlocked': 'two purses',
    'isDoubleJumpUnlocked': 'two purses',
    'shopExpanded': 'two panels open at once',
    'debugUnlockAll': 'per side',
    'setDebugUnlockAll': 'per side',
    'syncLockHint': 'per side',
    'preloadCharModels': 'preloads both sides at once',
    'refreshPauseUI': 'pause offers different things',
    'refreshGameOverUI': 'results name two local players',
    'refreshSandboxUI': 'sandbox is online-only',
    'refreshHudScaleUI': 'two HUD panels',
    'resetCrush': 'the crush cinematic is online-only',
    'buildCrushRigs': 'the crush cinematic is online-only',
    'disposeCrushRigs': 'the crush cinematic is online-only',
}


# The two shapes that have actually shipped, and the six that must NOT trip the
# guard. See selftest_guard().
_GUARD_CASES = [
    ('a swing reading an undefined constant',
     'function doSwing(f) { const t = f.frames * SWING_WINDUP_FRAC; }', True),
    ('a call to a function only the online build has',
     'function startMatch(m) { ensureCharModel(m.name); }', True),
    ('the name only inside a line comment',
     'function ok() { // SWING_WINDUP_FRAC is documented here' + chr(10) + ' return 1; }', False),
    ('the name only inside a string',
     'function ok() { return "SWING_WINDUP_FRAC"; }', False),
    ('a typeof feature detection',
     'function ok() { return typeof SWING_WINDUP_FRAC === "number"; }', False),
    ('a property that shares the name',
     'function ok(o) { return o.SWING_WINDUP_FRAC; }', False),
    ('a name that IS defined here',
     'const SWING_WINDUP_FRAC = 0.7;' + chr(10) + 'function ok() { return SWING_WINDUP_FRAC; }', False),
    ('a name defined in shared/',
     'function ok() { return sharedOnlyName(12); }', False),
]


def selftest_guard():
    """Prove the dangling-reference guard still works, before trusting it.

    It reports zero on the real build, which is correct - and which makes a
    broken guard and a clean build look identical. Since the guard is a few
    regexes with lookarounds plus comment and string stripping, "looks right" is
    not good enough for something whose whole job is to stop the freeze class
    (SWING_WINDUP_FRAC, MUZZLE_FLASH_MAX) from shipping again.
    """
    saved = set(SHARED_NAMES)
    SHARED_NAMES.clear()
    SHARED_NAMES.add('sharedOnlyName')
    names = ['SWING_WINDUP_FRAC', 'ensureCharModel', 'sharedOnlyName']
    try:
        wrong = [label for label, src, expect in _GUARD_CASES
                 if bool(undefined_calls(src, names)) != expect]
    finally:
        SHARED_NAMES.clear()
        SHARED_NAMES.update(saved)
    if wrong:
        print('THE DANGLING-REFERENCE GUARD IS BROKEN - refusing to run:')
        for label in wrong:
            print('   wrong answer for: ' + label)
        print('   Fix undefined_calls() before syncing; it is the only thing')
        print('   standing between a half-port and another frame-by-frame freeze.')
        return False
    print('  %-34s %d cases' % ('guard self-test', len(_GUARD_CASES)))
    return True


# Names that are legitimately global at the point shared/ runs: the browser, the
# engine, and the per-build profile declared in its own script tag.
_SHARED_GLOBALS = set((
    'THREE Math JSON Object Array String Number Boolean Date Promise Set Map WeakMap Symbol '
    'document window console performance localStorage sessionStorage navigator location history '
    'requestAnimationFrame cancelAnimationFrame setTimeout clearTimeout setInterval clearInterval '
    'parseInt parseFloat isNaN isFinite Error TypeError RangeError encodeURIComponent '
    'decodeURIComponent fetch AudioContext webkitAudioContext Peer atob btoa Image Audio Blob URL '
    'CanvasRenderingContext2D HTMLCanvasElement getComputedStyle matchMedia structuredClone '
    'AC_ONE_SIDE_PER_CLIENT undefined null true false this arguments'
).split())

# Reserved words and syntax that _IDENT_RE picks up but that are not references.
_JS_WORDS = set((
    'function const let var return if else for while do break continue new delete typeof '
    'instanceof in of class extends super static get set try catch finally throw switch case '
    'default void yield await async export import from as with debugger'
).split())


def shared_scope_violations(shared_sources, build_src):
    """Names shared/ uses that only exist inside the build's bootGame() closure.

    A shared module cannot see into bootGame(), so such a name is a
    ReferenceError the moment that line runs - and only when it runs, which is
    why it survives a page load and shows up later as a feature that silently
    does nothing.

    Bounded by the build's own vocabulary: a name is reported only if the BUILD
    defines it at column 0 and shared/ does not. That keeps property names and
    locals out of it.
    """
    shared_text = chr(10).join(shared_sources)
    shared_names = set(_def_names(shared_text))
    build_names = set(_def_names(build_src))
    # Only names the build defines and shared does not - those are the ones
    # that are definitely out of reach rather than merely unrecognised.
    suspect = build_names - shared_names
    if not suspect:
        return []
    bare = _code_only_text(shared_text)
    out = []
    for name in sorted(suspect):
        if name in _SHARED_GLOBALS or name in _JS_WORDS:
            continue
        if re.search(_REF_HEAD + re.escape(name) + _REF_TAIL, bare):
            out.append(name)
    return out


def _code_only_text(text):
    """Comments and string literals removed, newlines kept."""
    text = re.sub(_LINE_COMMENT, '', text)
    text = re.sub(_BLOCK_COMMENT, '', text, flags=re.S)
    text = re.sub(_SQ_STRING, "''", text)
    text = re.sub(_DQ_STRING, '""', text)
    return text


def definition_end(text, start):
    """Index just past the definition beginning at `start`, or None if unsure.

    A chunk that runs to the next definition carries any top-level statements
    in between. Copying those across builds broke the local build at load:
    randomPick's chunk included the online build's single Random/Armory button
    wiring, whose element ids do not exist here, so getElementById returned null
    and .addEventListener threw before ACDebug was ever assigned.

    Braces are matched for a function or class, and the terminating semicolon
    found for a const/let/var. Strings and comments are skipped so a brace
    inside either cannot move the boundary. Regex literals are NOT understood -
    `/}/` would fool it - so the caller checks the result and falls back to the
    whole chunk when it looks wrong.
    """
    i, n = start, len(text)
    depth, seen_brace, quote = 0, False, None
    is_block = text.startswith('function', start) or text.startswith('class', start)
    while i < n:
        c = text[i]
        if quote:
            if c == chr(92):
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            j = text.find(chr(10), i)
            i = n if j < 0 else j + 1
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '*':
            j = text.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in ('"', "'", '`'):
            quote = c
            i += 1
            continue
        if c == '{':
            depth += 1
            seen_brace = True
        elif c == '}':
            depth -= 1
            if is_block and seen_brace and depth == 0:
                return i + 1
        elif c == ';' and not is_block and depth == 0:
            return i + 1
        i += 1
    return None


def definition_span(text, start, chunk_end):
    """Where this definition really ends, with the whole chunk as a fallback.

    Checked rather than trusted: a definition ends on '}' or ';'. Anything else
    means the scanner lost its place (an unhandled regex literal, most likely),
    and the old whole-chunk boundary is used instead - wrong in the way we
    already understand rather than wrong in a new one.
    """
    end = definition_end(text, start)
    if end is None or end > chunk_end or end <= start:
        return chunk_end
    if text[end - 1] not in '};':
        return chunk_end
    # Take the rest of the line WITH the newline. Stopping exactly on the '}'
    # left the boundary one character short of where the whole-chunk version
    # ended, so a replacement dropped a newline and the build oscillated by a
    # single byte forever - which the fixed-point check reported as -1 bytes.
    nl = text.find(chr(10), end)
    if nl != -1 and not text[end:nl].strip():
        return nl + 1
    return end


def _def_names(text):
    return [m.group(1) or m.group(2) or m.group(3) for m in _DEF_RE.finditer(text)]


# A REFERENCE to `name`: not preceded by a word character or a dot (so
# obj.name and othername do not match) and not followed by one.
_REF_HEAD = r'(?<![\w$.])'
_REF_TAIL = r'(?![\w$])'
_LINE_COMMENT = r'//[^\n]*'
_BLOCK_COMMENT = r'/\*.*?\*/'
_SQ_STRING = r"'(?:[^'\\\n]|\\.)*'"
_DQ_STRING = r'"(?:[^"\\\n]|\\.)*"'


def _code_only(text):
    """The build with comments and string literals removed.

    Without this, every comment explaining a constant would look like a
    reference to it, and a check that cries wolf gets switched off rather
    than fixed.
    """
    text = re.sub(_LINE_COMMENT, '', text)
    text = re.sub(_BLOCK_COMMENT, '', text, flags=re.S)
    text = re.sub(_SQ_STRING, "''", text)
    text = re.sub(_DQ_STRING, '""', text)
    return text


def undefined_calls(dst, online_names):
    """Names the generated build REFERENCES that neither it nor shared/ defines.

    Bounded by the online build's own vocabulary, so this does not have to
    parse JavaScript: a name counts only if the online build defines it at
    column 0, this build mentions it in code, and nothing this build loads
    defines it.

    READS COUNT, not just calls, and that is the whole point. The freeze this
    project keeps hitting is a constant, not a function:

        SWING_WINDUP_FRAC is not defined    every frame of every swing
        MUZZLE_FLASH_MAX is not defined     same shape

    Three of those shipped together - Thorne, Gorgonok, Kaelen - each from a
    port step whose guard had gone permanently true, and each reported as
    "the attack freezes the screen and then you can't continue" rather than
    as an error anyone saw. A search for `name(` sees none of them.

    Exempt: any name under a `typeof` test. typeof on an UNDECLARED
    identifier is legal and yields 'undefined' rather than throwing, and the
    local build uses exactly that (localCamera) to ask whether the online
    build's camera pair exists here.
    """
    have = set(_def_names(dst)) | SHARED_NAMES
    bare = _code_only(dst)
    out = []
    for name in online_names:
        if name in have or ('typeof %s' % name) in bare:
            continue
        if re.search(_REF_HEAD + re.escape(name) + _REF_TAIL, bare):
            out.append(name)
    return out


def port_missing_definitions(src, dst):
    """Insert definitions the local build lacks, when it already has their needs.

    The counterpart to force_online_bodies(): that one refuses to copy a body
    whose free names are missing here, and this one supplies the missing names
    so the next pass can. Same safety rule - a definition travels only when
    every free name IT uses already exists in the local build or in shared/ -
    and computed to a fixed point so a helper brings the helper it calls.

    Nothing from the online build's own business travels: networking, room codes
    and the lobby are filtered by name, the same way art/promote_shared.py does
    it, because those exist only online by design.
    """
    src_defs, dst_defs = {}, {}
    for table, text in ((src_defs, src), (dst_defs, dst)):
        hits = list(_DEF_RE.finditer(text))
        # From the top of the leading COMMENT, not from the definition: the
        # comment is what explains it, and chunking from the definition left
        # that behind. See definitions() in art/extract_shared.py.
        starts = [comment_start(text, m.start()) for m in hits]
        for k, m in enumerate(hits):
            chunk_end = starts[k + 1] if k + 1 < len(hits) else len(text)
            # The DEFINITION, not everything up to the next one. The gap between
            # them holds top-level statements belonging to THIS build - copying
            # randomPick's chunk brought the online build's Random/Armory button
            # wiring with it, whose element ids do not exist in the other build,
            # and the whole thing died at load on a null getElementById.
            # close_comment_drift deliberately keeps the WHOLE chunk. Narrowing it
            # made 179 definitions suddenly look comment-only-different, and the
            # replacement is not idempotent at that boundary: comment_start walks
            # back over CONTIGUOUS // lines only, so a blank line above a comment
            # block leaves the old comments in place and adds the new ones below,
            # growing the file by 8,493 bytes every run. The fixed-point check
            # caught it on the first attempt.
            end = chunk_end
            table[m.group(1) or m.group(2) or m.group(3)] = text[starts[k]:end]

    have = set(dst_defs) | SHARED_NAMES
    # SEEDED BY WHAT THIS BUILD CALLS AND NOTHING DEFINES, first. Scanning only
    # the bodies being synced missed ensureCharModel entirely: its one caller is
    # startMatch, which is on INTERFACE, so nothing ever asked what it needed -
    # and the call had been throwing a ReferenceError into the promise
    # withLoading() awaits, which is why the local build never left the loading
    # screen. A dangling call is a correctness question; whose body it sits in
    # is beside the point.
    wanted = set(undefined_calls(dst, list(src_defs)))
    for name, chunk in dst_defs.items():
        theirs = src_defs.get(name)
        if not theirs or theirs == chunk or name in INTERFACE:
            continue
        wanted |= {r for r in set(_IDENT_RE.findall(theirs)) - {name}
                   if r in src_defs and r not in have}

    # Close over what those need, and keep only what can travel safely.
    movable, changed = set(), True
    while changed:
        changed = False
        for n in sorted(wanted - movable):
            # INTERFACE is as binding here as it is for the body sync. Four of
            # its entries exist only in the online build - the sandbox panel,
            # the pause and results screens - and pulling those across because
            # something referenced them is exactly the move it exists to stop.
            if n in INTERFACE or is_online_only_business(n):
                continue
            refs = {r for r in set(_IDENT_RE.findall(src_defs[n])) - {n}
                    if r in src_defs and r not in have and r not in movable}
            if refs:
                wanted |= refs          # try to bring them too
                continue
            movable.add(n)
            changed = True

    if not movable:
        return dst, []
    # In the online build's own order, so anything order-sensitive keeps it.
    ordered = [n for n in src_defs if n in movable]
    block_text = chr(10).join(src_defs[n].rstrip() + chr(10) for n in ordered)
    anchor = "function disposeObject3D("
    i = dst.index(anchor)
    i = comment_start(dst, i)
    return dst[:i] + block_text + chr(10) + dst[i:], ordered


# Same anchored matching art/promote_shared.py uses; a plain substring test for
# "host" also matches hpGhost.
_UPPER_NET = ('NET_', 'ROOM_', 'LOBBY_', 'PEER_', 'HOST_')
_CAMEL_NET = ('net', 'room', 'lobby', 'peer', 'host', 'remote', 'spectat')
_INFIX_NET = ('Net', 'Room', 'Lobby', 'Peer', 'Host', 'Remote', 'Spectat')


def is_online_only_business(name):
    if name.startswith(_UPPER_NET):
        return True
    if name.isupper():
        return False
    return name.startswith(_CAMEL_NET) or any(k in name for k in _INFIX_NET)


def force_online_bodies(src, dst):
    """Copy the online body over the local one for everything that is not
    interface, and return what is still out of step.

    Safe by a check rather than by review: a body is copied only when every free
    name it uses already exists in the local build or in a shared module. A
    missing name would mean the local build lacks the feature outright, and that
    is a port, not a sync - those are reported instead.

    What this cannot judge is whether two bodies differ deliberately, so that is
    INTERFACE above, with a reason on every entry.
    """
    src_defs, dst_defs = {}, {}
    for table, text in ((src_defs, src), (dst_defs, dst)):
        hits = list(_DEF_RE.finditer(text))
        # From the top of the leading COMMENT, not from the definition: the
        # comment is what explains it, and chunking from the definition left
        # that behind. See definitions() in art/extract_shared.py.
        starts = [comment_start(text, m.start()) for m in hits]
        for k, m in enumerate(hits):
            chunk_end = starts[k + 1] if k + 1 < len(hits) else len(text)
            # The DEFINITION, not everything up to the next one. The gap between
            # them holds top-level statements belonging to THIS build - copying
            # randomPick's chunk brought the online build's Random/Armory button
            # wiring with it, whose element ids do not exist in the other build,
            # and the whole thing died at load on a null getElementById.
            end = definition_span(text, m.start(), chunk_end)
            table[m.group(1) or m.group(2) or m.group(3)] = text[starts[k]:end]

    have = set(dst_defs) | SHARED_NAMES
    copied, needs_port = [], []
    while True:
        hits = list(_DEF_RE.finditer(dst))
        starts = [comment_start(dst, m.start()) for m in hits]
        for k, m in enumerate(hits):
            name = m.group(1) or m.group(2) or m.group(3)
            if name in copied or name in INTERFACE or name not in src_defs:
                continue
            chunk_end = starts[k + 1] if k + 1 < len(hits) else len(dst)
            end = definition_span(dst, m.start(), chunk_end)
            mine, theirs = dst[starts[k]:end], src_defs[name]
            if mine == theirs:
                continue
            missing = {r for r in set(_IDENT_RE.findall(theirs)) - {name}
                       if r in src_defs and r not in have}
            if missing:
                needs_port.append((name, sorted(missing)[:3]))
                copied.append(name)          # counted, not copied; do not revisit
                continue
            dst = dst[:starts[k]] + theirs + dst[end:]
            copied.append(name)
            break
        else:
            break
    return dst, [c for c in copied if c not in dict(needs_port)], needs_port


def close_comment_drift(src, dst):
    """Rewrite local definitions whose code already matches, to pick up the notes.

    A definition that differs ONLY in its comments is a note that never crossed
    over, and it pins the definition in both builds forever: art/extract_shared.py
    moves a definition only when the two copies are byte-identical, so a stale
    comment is as good as a real difference to it.

    Rewriting is safe here by construction, not by review - the guard is that
    code_only() already agrees, so what changes is exclusively comments. A
    definition whose code differs is left alone and reported as drift instead.
    """
    src_defs = {}
    hits = list(_DEF_RE.finditer(src))
    starts = [comment_start(src, m.start()) for m in hits]
    for k, m in enumerate(hits):
        end = starts[k + 1] if k + 1 < len(hits) else len(src)
        src_defs[m.group(1) or m.group(2) or m.group(3)] = src[starts[k]:end]

    updated = []
    while True:
        hits = list(_DEF_RE.finditer(dst))
        starts = [comment_start(dst, m.start()) for m in hits]
        for k, m in enumerate(hits):
            name = m.group(1) or m.group(2) or m.group(3)
            if name in updated or name not in src_defs:
                continue
            chunk_end = starts[k + 1] if k + 1 < len(hits) else len(dst)
            # close_comment_drift deliberately keeps the WHOLE chunk. Narrowing it
            # made 179 definitions suddenly look comment-only-different, and the
            # replacement is not idempotent at that boundary: comment_start walks
            # back over CONTIGUOUS // lines only, so a blank line above a comment
            # block leaves the old comments in place and adds the new ones below,
            # growing the file by 8,493 bytes every run. The fixed-point check
            # caught it on the first attempt.
            end = chunk_end
            mine, theirs = dst[starts[k]:end], src_defs[name]
            if mine == theirs or code_only(mine) != code_only(theirs):
                continue
            dst = dst[:starts[k]] + theirs + dst[end:]
            updated.append(name)
            break
        else:
            break
    return dst, updated


def strip_shared_duplicates(text, shared_sources):
    """Remove every top-level definition that a shared module already defines.

    The steps above insert blocks guarded on names, and the shared extraction
    keeps removing those names from this build - so a guard passes, the block
    goes back, and the build gains a second copy of something shared. That is
    a SyntaxError ("already been declared") and it grew the file by 13KB a run.

    Rather than fix forty guards, the generated file is cleaned at the end:
    whatever the steps did, what gets written cannot shadow shared/.
    """
    shared_names = set()
    for src_text in shared_sources:
        for m in _DEF_RE.finditer(src_text):
            shared_names.add(m.group(1) or m.group(2) or m.group(3))

    removed = []
    while True:
        hits = list(_DEF_RE.finditer(text))
        # A name declared twice HERE is the same failure with a different
        # cause: a step whose guard stopped matching inserts its block on every
        # run. `let hudFontReady` appeared twice and grew the file 13KB a run.
        # The first declaration wins; later ones go.
        seen = set()
        for k, m in enumerate(hits):
            name = m.group(1) or m.group(2) or m.group(3)
            dup_here = name in seen
            seen.add(name)
            if name not in shared_names and not dup_here:
                continue
            end = hits[k + 1].start() if k + 1 < len(hits) else len(text)
            text = text[:m.start()] + text[end:]
            removed.append(name)
            break
        else:
            break
    return text, removed


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


# Filled in by main() once the shared modules have been read. block() falls
# back to these; see the note in block().
SHARED_FALLBACK = []
BLOCK_MOVED = []
BLOCK_MISSING = []


def block(text, start_marker, end_marker, name='block'):
    """The text from start_marker up to (not including) end_marker.

    Falls back to the shared modules when the online build no longer contains
    the region. Every step that copies a region out of index.html dies the day
    that region moves to shared/ - the marker is simply gone - and three steps
    went that way in one afternoon, each aborting the whole sync. But a step
    whose content has moved is not broken, it is FINISHED: both builds load that
    code from one file now.

    So rather than crash, the region is found in shared/, the step runs, and the
    de-shadowing pass removes the copy it inserted on the same run. That makes a
    finished step inert instead of fatal. It is reported so it can be deleted on
    purpose instead of discovered by a traceback, and the fixed-point check at
    the end proves the inertness rather than taking it on trust.
    """
    haystacks = [text] + SHARED_FALLBACK
    for k, hay in enumerate(haystacks):
        if start_marker not in hay:
            continue
        i = hay.index(start_marker)
        if end_marker not in hay[i:]:
            continue
        out = hay[i:hay.index(end_marker, i)]
        if len(out) <= 40:
            continue
        if k:
            BLOCK_MOVED.append(name)
        return out
    # NOT FATAL. A region that is in neither the online build nor shared/ is a
    # step that has FINISHED - its code moved, most often into shared/, and
    # there is nothing left to copy. Raising here meant one finished step
    # aborted the whole sync, and after 87 definitions moved at once there were
    # seven of them queued up, each discovered by a separate crash.
    #
    # Returning empty makes the step a no-op: a guarded insert inserts nothing,
    # and a `rep(dst, anchor, '' + anchor)` leaves the file alone. What stops
    # this from silently DROPPING something still needed is everything after it
    # - the REQUIRED list, the dangling-reference guard, and the fixed point.
    BLOCK_MISSING.append(name)
    return ''


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
    shared_src = io.open(os.path.join(ROOT, 'shared', 'roster.js'), encoding='utf-8').read()
    anim_src = io.open(os.path.join(ROOT, 'shared', 'animation.js'), encoding='utf-8').read()
    props_src = io.open(os.path.join(ROOT, 'shared', 'props.js'), encoding='utf-8').read()
    chars_src = io.open(os.path.join(ROOT, 'shared', 'characters.js'), encoding='utf-8').read()
    common_src = io.open(os.path.join(ROOT, 'shared', 'common.js'), encoding='utf-8').read()
    # block() falls back to these when a region has moved out of the online
    # build; see its docstring. Read here rather than at the de-shadowing
    # pass because the port steps that need the fallback run long before it.
    SHARED_FALLBACK[:] = [shared_src, anim_src, props_src, chars_src, common_src]
    for _text in SHARED_FALLBACK:
        for _m in _DEF_RE.finditer(_text):
            SHARED_NAMES.add(_m.group(1) or _m.group(2) or _m.group(3))
    # The guard that stops the freeze class is itself checked first.
    if not selftest_guard():
        return 1
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

    # THE PROJECTILE VISUAL STEP IS FINISHED: buildProjectileVisual and the
    # caches it uses are shared, and this build already has projCoreSphere.

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
    # NOT guarded on faceUrl: that moved to shared/common.js, so the guard
    # became permanently true. Keyed on the block's own comment, which stays in
    # THE faceUrl STEP IS FINISHED. faceUrl and paintSlotPortrait both live in
    # shared/common.js, so the region this copied no longer exists in one piece:
    # its start marker was in index.html and its end marker in shared/, and
    # block() cannot span two files. It went one better than dying, too - the
    # long Batch 37 comment it keyed on had been ORPHANED by the old chunker
    # (which cut from the definition, not from the top of its comment), so it was
    # sitting above localPlayerNumber, twenty lines about baked portraits above a
    # two-line function about which side you are. Both blocks are back with their
    # code in shared/common.js.


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
    # THE BALANCE CONSTANTS ARE NOT PORTED ANY MORE.
    #
    # MAX_WALK_STEP_UP, GRACE_PERIOD, SHRINK_INTERVAL, CRUSH_AT_FRAC and the
    # mode table live in shared/common.js, which both builds load, so there is
    # nothing here to copy. These steps used to extract each one from
    # index.html by its own anchors "so the two builds cannot disagree about a
    # number again"; sharing the declaration is the stronger version of that
    # sentence.

    # THE TAKEDOWN RACE GUARD IS NOT PORTED ANY MORE. updateArenaShrink takes
    # the online body in full (it is not interface), and that body has since
    # replaced the exclusion list this step inserted with a classic-opts-in
    # test, so there is nothing left to copy.

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

    # hudFont IS NOT PORTED ANY MORE EITHER. It moved to shared/common.js once
    # closing the comment drift made the two copies identical - which is worth
    # noting, because the previous comment here said it could never move, on the
    # grounds that it calls hudUnitScale() and the builds do not share a canvas.
    # That was true of hudUnitScale's ORIGINAL split-screen version and stopped
    # being true when that converged; the reasoning was sound and the conclusion
    # still expired. Hence the fixed-point check rather than more reasoning.

    # THE FONT FAMILIES ARE NOT PORTED ANY MORE. HUD_FAMILY, ANNOUNCE_FAMILY and
    # announceFont live in shared/common.js, which both builds load, so copying
    # them across was copying a definition that is no longer in the source file
    # - this step died on its own start marker the moment they moved.
    #
    # hudFont stays ported, and legitimately so: it calls hudUnitScale(), which
    # measures the build's own HUD canvas, and the two builds do not have the
    # same canvas. That is the interface boundary, not drift.

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

    # THE SHARED SCRIPT TAGS, stripped and rewritten every run.
    #
    # Two faults lived here. The step was guarded on "is common.js absent",
    # which is also true when a PARTIAL set is present - so a build that already
    # had four tags got a second copy of all five, every module loaded twice,
    # and the page died with "Identifier 'PROC_MESH_BUILDERS' has already been
    # declared". And it spliced around the engine tag by index, which left a
    # stray closing tag in the file.
    #
    # Removing them all and writing the set back is idempotent by construction.
    #
    # The ORDER is load-bearing: roster and animation are pure data and timing
    # and may load before three.js, while props, characters and common build
    # THREE objects - shared/common.js opens with `const _fbVec = new
    # THREE.Vector3()`, which runs the moment it loads.
    PRE = ['roster.js', 'animation.js']
    POST = ['props.js', 'characters.js', 'common.js']
    for fn in PRE + POST:
        for form in ('<script src="../shared/%s"></script>' + chr(10),
                     '<script src="../shared/%s"></script>'):
            dst = dst.replace(form % fn, '')
    dst = dst.replace('<!-- Shared with the online build; see each file\'s header. Pure data' + chr(10)
                      + '     and timing, so these may load before the engine. -->' + chr(10), '')
    dst = dst.replace(chr(10) + '<!-- ...and these build THREE objects, some at load time. -->' + chr(10), '')

    engine = ('<script src="../three.min.js"' if '<script src="../three.min.js"' in dst
              else '<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"')
    i = dst.index(engine)
    close = dst.index('>', dst.index('</script>', i)) + 1     # the END of the engine tag
    pre_tags = ('<!-- Shared with the online build; see each file\'s header. Pure data' + chr(10)
                + '     and timing, so these may load before the engine. -->' + chr(10)
                + ''.join('<script src="../shared/%s"></script>' % f + chr(10) for f in PRE))
    post_tags = (chr(10) + '<!-- ...and these build THREE objects, some at load time. -->' + chr(10)
                 + ''.join('<script src="../shared/%s"></script>' % f + chr(10) for f in POST).rstrip())
    dst = dst[:i] + pre_tags + dst[i:close] + post_tags + dst[close:]
    print('  %-34s ok' % 'shared script tags')

    # THE SWING HELPERS ARE NOT PORTED ANY MORE either: _swingArm, _applyArms,
    # SWING_MAX_FWD and armsOf are in shared/common.js and readableJabs is in
    # shared/animation.js. Both builds load both files.
    # The animation BRANCHES are not ported either: animateWeapon reads the
    # shared envelope, and the branches that used to be patched here came
    # across with it the last time this ran. What is left of animateWeapon in
    # each build is the part that touches meshes.

    # THE VIEWMODEL PROP CONSTANTS ARE NOT PORTED ANY MORE. VM_PROP_YAW and
    # ARM_CHAIN are both in shared/common.js now, so there is no region left in
    # index.html to copy - the step died on its own start marker. Finished, and
    # finished for the right reason: the code is shared.

    # THE PHOTOGRAPHIC SURFACE LAYER IS NOT PORTED ANY MORE. PHOTO_SETS,
    # PHOTO_BASE, loadPhotoSet and attachPhotoSurface all live in
    # shared/common.js now, and PHOTO_BASE is already written against
    # AC_ASSET_BASE, so the '../assets/tex/' rewrite this step performed has no
    # subject left either.
    #
    # It is worth naming what went wrong here twice, because the fix below is
    # aimed at it. This step was guarded on PHOTO_SETS; that moved to shared and
    # the guard became permanently true, so the block went in every run. It was
    # re-keyed onto loadPhotoSet; loadPhotoSet has now moved to shared too and
    # the guard became permanently true AGAIN. Re-keying a guard onto whichever
    # name has not moved yet is not a fix, it is a wait.

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

    # The derived-texture cache is in shared/common.js now, so this step
    # would only re-create the second copy the verification refuses.
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

    # THE MUZZLE CAP STEP IS FINISHED. MUZZLE_FLASH_MAX and muzzleFlashes are
    # both in shared/common.js now, so the guard (keyed on the cap being absent)
    # is permanently true AND its anchor is gone - it ran every sync and failed
    # on the anchor. The original point stands and is worth keeping written
    # down: the committed build once had the pool and not the cap, and
    # "MUZZLE_FLASH_MAX is not defined" fired on every frame of a ranged attack.
    # Sharing the declaration is the stronger version of that fix.

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
        # The sword and the weapon table are NOT here any more: they live in
        # shared/props.js, which both builds load. This list is for things that
        # still have two copies, and it should keep getting shorter.
        # Nothing is left in this list: the sword, the weapon table, the bodies
        # and the swing envelope all live in shared/ now. It stays because the
        # next thing that turns out to be build-agnostic goes here on its way
        # out - and an empty list is the goal, not an oversight.
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

    # THE MAP THEME STEP IS FINISHED. MAP_THEMES, themeTintFade and the tint
    # helper are in shared/common.js, and the local build already carries
    # BASE_EXPOSURE and the per-theme exposure line this step used to install,
    # so every replacement it performed now has no subject. Left in place it
    # would insert shared code that the de-shadowing pass strips again on the
    # same run, which the fixed-point check reports as churn.

    # PHOTO_SETS IS NOT PORTED ANY MORE: it is in shared/common.js, which both
    # builds load. It was the clearest example of why - "the Voltaic Nexus
    # floor is still the brown carpet texture from above" was this build
    # holding a tile number that had been fixed online four batches earlier.

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


    if BLOCK_MISSING:
        print('  %-34s %d finished, nothing left to copy: %s'
              % ('retired port steps', len(BLOCK_MISSING),
                 ', '.join(sorted(set(BLOCK_MISSING)))))

    if BLOCK_MOVED:
        print('  %-34s %d step(s) now copy from shared/ and are inert: %s'
              % ('finished port steps', len(BLOCK_MOVED), ', '.join(sorted(set(BLOCK_MOVED)))))

    # COMMENT DRIFT, closed before the de-shadowing pass so anything it makes
    # identical is a candidate for shared/ on the next extraction run.
    dst, recommented = close_comment_drift(src, dst)
    if recommented:
        print('  %-34s %d definitions took the online notes' % ('comment drift', len(recommented)))

    # ------------------------------------- the match asset wait, shared and parallel
    # startMatch is interface (this build resets its own state and calls
    # startRound; the online one hands off to startMatchNow), but the ASSET WAIT
    # inside it is not - "are the models and textures ready" is the same question
    # in both, and it was being answered twice, sequentially, in both.
    #
    # matchAssetsReady runs the two fetches at once. Nothing in the textures
    # depends on the models. Once this build REFERENCES it,
    # port_missing_definitions carries the definition across by itself, because a
    # name referenced and nowhere defined is exactly what that step looks for.
    dst = rep(dst, """    withLoading(matchMap.name, () => Promise.resolve()
        .then(() => Promise.all([p1Choice, p2Choice].map(
            c => c && Promise.resolve(ensureCharModel(c.name)).catch(() => null))))
        .then(() => themeTexturesReady(themeFor(matchMap)))
        .then(() => {
            startRound(true);
            return new Promise(r => requestAnimationFrame(() => { renderViews(0); r(); }));
        })); // the first round of a match opens with the drop-in intro cinematic""",
             """    withLoading(matchMap.name, () => matchAssetsReady(
        [p1Choice, p2Choice].filter(Boolean).map(c => c.name), matchMap)
        .then(() => {
            startRound(true);   // opens with the drop-in intro cinematic
            return oneRenderedFrame();
        }));""",
             'parallel match asset wait', required=False)

    # ------------------------------------------------------ the build profile
    # The one fact this build declares about itself; everything downstream is
    # shared and asks it. See the tag's own comment in index.html for why it has
    # to sit at true top level rather than inside bootGame().
    #
    # Copied from the online build and flipped, rather than written out here, so
    # the comment above it cannot drift between the two.
    if 'AC_ONE_SIDE_PER_CLIENT' not in dst:
        prof = block(src, '<!-- THE BUILD PROFILE:', '<!-- Shared with the local build')
        prof = prof.replace(
            'const AC_ONE_SIDE_PER_CLIENT = true;   // online: a client drives p1 OR p2',
            'const AC_ONE_SIDE_PER_CLIENT = false;  // local: one keyboard drives BOTH sides')
        i = dst.index('<script src="../shared/roster.js"></script>')
        i = comment_start(dst, i)
        # Back up over the HTML comment the shared tags carry, so the profile
        # lands above it rather than between it and the tags it introduces.
        marker = '<!-- Shared with the online build'
        if marker in dst[:i]:
            i = dst.rindex(marker, 0, i)
        dst = dst[:i] + prof + dst[i:]
        print('  %-34s ok' % 'build profile')

    # ------------------------------------------------- CSS asset URLs, all of them
    # CSS url() resolves against the DOCUMENT, and this one is a directory down,
    # so every `url('assets/...')` copied from the online build asks for
    # /local/assets/... and 404s. The tableau did exactly that, which is why the
    # loading screen here was "just some lighting" - the background-image was
    # never being served.
    #
    # The @font-face block below already carried a hand-written version of this
    # rewrite, which is the tell: the rule is general and was being applied one
    # asset at a time, so the next one added to CSS was always going to arrive
    # broken. JS has AC_ASSET_BASE; CSS cannot call anything, so the path rewrite
    # is the instrument - it just has to cover every url(), not the remembered ones.
    #
    # Idempotent by shape: it matches `url('assets/` and emits `url('../assets/`,
    # which does not match.
    #
    # RUNS LAST, after every step that can insert CSS. It was originally
    # placed before them, which would have let a newly copied
    # `url('assets/...')` through for one whole run - the same one-run window
    # that let the tableau 404 sit there in the first place.
    n_css = 0
    for quote in ("'", '"'):
        pat = 'url(%sassets/' % quote
        n_css += dst.count(pat)
        dst = dst.replace(pat, 'url(%s../assets/' % quote)
    n_css += dst.count('url(assets/')
    dst = dst.replace('url(assets/', 'url(../assets/')
    print('  %-34s %d rewritten' % ('css asset urls', n_css))

    # EVERYTHING THAT IS NOT INTERFACE TAKES THE ONLINE BODY. This is what keeps
    # the two builds in step now that extraction has reached its limit: what is
    # left is one mutually-recursive core, so the answer is no longer "share it"
    # but "do not let it drift".
    # Supply what the local build is missing FIRST, so the bodies that need it
    # can be synced on the same run rather than the next one.
    dst, ported = port_missing_definitions(src, dst)
    if ported:
        print('  %-34s %d carried across: %s'
              % ('missing definitions', len(ported), ', '.join(ported)))

    dst, forced, needs_port = force_online_bodies(src, dst)
    if forced:
        print('  %-34s %d definitions took the online body' % ('drift closed', len(forced)))
    if needs_port:
        print('  %-34s %d definitions cannot: the local build lacks what they call'
              % ('needs a port, not a sync', len(needs_port)))
        for nm, missing in sorted(needs_port)[:8]:
            print('      %-28s needs %s' % (nm, ', '.join(missing)))

    # NOTHING THE SHARED MODULES DEFINE MAY ALSO BE DEFINED HERE. Run last, so
    # it cleans up after every step above rather than racing them.
    dst, deduped = strip_shared_duplicates(
        dst, [shared_src, anim_src, props_src, chars_src, common_src])
    if deduped:
        print('  %-34s %d removed (%s%s)'
              % ('re-declared from shared/', len(deduped), ', '.join(sorted(set(deduped))[:4]),
                 ', ...' if len(set(deduped)) > 4 else ''))

    # SHARED CODE MAY NOT REACH INTO bootGame(). The rule that makes shared/
    # work, and the one hand-moving code skips: the extractor enforces it with
    # its fixed point, but nothing enforced it on code moved by hand.
    reaching = shared_scope_violations(SHARED_FALLBACK, src)
    if reaching:
        print()
        print('SHARED CODE REACHES INTO bootGame() - refusing to write:')
        for n in reaching:
            print('   shared/ uses %s, which the build defines inside bootGame()' % n)
        print('   A shared module is a separate top-level script: it can be CALLED')
        print('   from in there but cannot see in, so this throws when the line runs.')
        print('   Move that definition to shared/ as well, or move the caller back.')
        return 1

    # ------------------------------------------- the engine path, one directory up
    # force_online_bodies checks that every NAME a copied body uses exists here.
    # It cannot check that a PATH is right, and loadThreeFallback differs by
    # exactly one string: the online build loads 'three.min.js' from the root,
    # this one lives a directory down. Unifying the body silently pointed the
    # CDN fallback at a file that is not there - which only shows when the CDN
    # is down, i.e. never in testing and exactly when it matters.
    #
    # So the body stays unified and the path is corrected here, AFTER
    # force_online_bodies has copied it - placing this before the copy meant
    # the copy simply put the root path back, which the guard below caught on
    # the very next run. The same ordering lesson as the CSS asset rewrite,
    # learned the same way.
    n_engine = dst.count("s.src = 'three.min.js';")
    dst = dst.replace("s.src = 'three.min.js';", "s.src = '../three.min.js';")
    if n_engine:
        print('  %-34s %d rewritten' % ('engine path (one directory up)', n_engine))

    # NO ROOT-RELATIVE ENGINE PATH. The check above rewrites it; this is the
    # proof, because a path fault is invisible until the CDN fails.
    if "s.src = 'three.min.js';" in dst:
        print()
        print('ENGINE PATH IS ROOT-RELATIVE - refusing to write:')
        print("   this build is one directory down, so 'three.min.js' is not there.")
        return 1

    # NOTHING MAY BE CALLED THAT NOTHING DEFINES. The backstop for the step
    # above: if a dangling call could not be ported - it needs something this
    # build genuinely lacks - that is a crash on a live path, not a warning.
    dangling = undefined_calls(dst, _def_names(src))
    if dangling:
        print()
        print('REFERENCES NOTHING DEFINES - refusing to write:')
        for n in dangling:
            print('   %s is used here but defined only in the online build' % n)
        print('   Port it, share it (art/promote_shared.py), or guard the call')
        print("   with typeof if it is genuinely meant to be optional.")
        return 1

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
        # Was "matchMode === 'timeattack') return;". The online build turned the
        # collapse from a list of exclusions into CLASSIC OPTS IN, so the string
        # is gone - and updateArenaShrink now takes the online body wholesale,
        # which is what this line was trying to approximate.
        'const clearZone',
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
    # The weapons, in the second shared tier (loaded after three.js).
    PROPS_REQUIRED = [
        'function buildSwordProp(', 'function buildWhipProp(', 'function buildOrbProp(',
        'function makeMat(', 'function getCachedGeometry(', 'function hexNum(',
    ]
    # The procedural bodies, third shared module.
    CHARS_REQUIRED = [
        'function buildHumanoidBase(', 'function buildKaelenMesh(',
        'function buildKarrigosMesh(', 'const PROC_MESH_BUILDERS = {',
    ]
    ANIM_REQUIRED = [
        'const SWING_TRAVEL_FRAMES', 'const SWING_WINDUP_FRAC',
        'const SWING_PRESTRIKE_T', 'const SWING_HOLD_RECOVERY_FRAC',
        'function swingT(', 'function actionPhase(', 'function readableJabs(',
    ]
    shared_missing = ([d for d in SHARED_REQUIRED if d not in shared_src]
                      + [d for d in ANIM_REQUIRED if d not in anim_src]
                      + [d for d in PROPS_REQUIRED if d not in props_src]
                      + [d for d in CHARS_REQUIRED if d not in chars_src])
    shadowed = ([d for d in SHARED_REQUIRED if d in dst]
                + [d for d in ANIM_REQUIRED if d in dst]
                + [d for d in PROPS_REQUIRED if d in dst]
                + [d for d in CHARS_REQUIRED if d in dst])
    # Anything shared/common.js defines must not ALSO be defined here: a local
    # copy shadows the shared one and silently reintroduces the drift.
    import re as _re
    for m in _re.finditer(r'(?m)^(?:function\s+([A-Za-z_$][\w$]*)\s*\(|'
                          r'const\s+([A-Za-z_$][\w$]*)\s*=)', common_src):
        name = m.group(1) or m.group(2) or m.group(3)
        pat = ('function %s(' % name) if m.group(1) else ('const %s =' % name)
        if _re.search(r'(?m)^' + _re.escape(pat), dst):
            shadowed.append(pat + '   (shared/common.js)')

    # SHARED COUNTS AS DEFINED. These lists were written when the local build
    # was expected to contain the whole game; most of what they name now lives
    # in a shared module that both builds load, so looking only at `dst` reports
    # the check's own staleness as a missing definition.
    #
    # It still catches what it was written for - a name that is in NEITHER - so
    # it is widened, not dropped.
    everywhere = dst + chr(10) + shared_src + chr(10) + anim_src + chr(10) + props_src \
        + chr(10) + chars_src + chr(10) + common_src
    missing = [d for d in REQUIRED if d not in everywhere]
    undefined = [c for c in CALLED
                 if ('function %s(' % c) not in everywhere
                 and ('const %s' % c) not in everywhere]
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
          % ('verified', len(REQUIRED),
             len(SHARED_REQUIRED) + len(ANIM_REQUIRED) + len(PROPS_REQUIRED)
             + len(CHARS_REQUIRED), len(CALLED)))

    if '--check' in sys.argv:
        # COMPARE, do not write. The point is to answer "is the committed local
        # build what this script would produce from the committed online one",
        # which is the question a pre-commit hook needs and the one nobody
        # remembers to ask by hand.
        current = io.open(DST, encoding='utf-8').read()
        if current == dst:
            print('\nlocal build is up to date with index.html')
            return 0
        print('\nLOCAL BUILD IS STALE: index.html has changes the local build does not.')
        print('   %d bytes here, %d bytes if regenerated.' % (len(current), len(dst)))
        print('   Run: python art/sync_local.py')
        return 1

    io.open(DST, 'w', encoding='utf-8', newline='').write(dst)
    print('\nlocal build: %d -> %d bytes' % (before, len(dst)))
    return check_fixed_point()


def check_fixed_point():
    """Run this script on its own output and fail if the output moves.

    This script PATCHES the existing local build rather than generating it,
    so every step needs its own correct guard, and a guard is nearly always
    "is this name absent". The shared extraction keeps moving names out of
    the build, so guards keep becoming permanently true and their blocks go
    back in on every run.

    That has happened four times now - PHOTO_SETS, faceUrl, the face-chip
    CSS, and loadPhotoSet - each found only after the file had quietly grown
    by kilobytes a run, and each "fixed" by re-keying the guard onto a name
    that had not moved YET. Re-keying is a wait, not a fix.

    Running the whole pipeline twice and comparing bytes is the property
    those guards are each trying to have, so it is asserted once, here,
    instead of forty times by hand. A step that grows the file now fails the
    sync that introduced it, at the moment it is introduced.
    """
    if os.environ.get('AC_SYNC_INNER'):
        return 0
    first = io.open(DST, encoding='utf-8').read()
    env = dict(os.environ, AC_SYNC_INNER='1')
    r = subprocess.run([sys.executable, os.path.abspath(__file__)],
                       capture_output=True, text=True, env=env)
    if r.returncode != 0:
        print('\nFIXED POINT: the second run failed:\n'
              + (r.stdout or '') + (r.stderr or ''))
        return 1
    second = io.open(DST, encoding='utf-8').read()
    if first == second:
        print('  %-34s ok (a second run changes nothing)' % 'fixed point')
        return 0

    # Name the step. Whatever a second run ADDS is what some guard let back in.
    print('\nFIXED POINT FAILED: a second sync changed the build by %+d bytes.'
          % (len(second) - len(first)))
    added = [l[2:] for l in difflib.unified_diff(
        first.splitlines(), second.splitlines(), n=0)
        if l.startswith('+') and not l.startswith('+++')]
    if added:
        print('  a second run re-inserts %d lines, beginning:' % len(added))
        for line in added[:6]:
            print('    ' + line.strip()[:96])
    print('  A port step is inserting a block its guard can no longer see.')
    print('  The guard is probably keyed on a name that moved to shared/:')
    print('  delete the step if the block is shared now, or make it strip-then-write.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
