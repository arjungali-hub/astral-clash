# -*- coding: utf-8 -*-
"""Move everything both builds define IDENTICALLY into shared/, in bulk.

Asked for directly: "make sure every single thing that the local and online
version should share is now shared for them... You should never have to update
both for the same update."

art/audit_shared.py answers whether that is true; this makes it true. It:

  1. reads every top-level definition out of both builds,
  2. keeps the ones that are BYTE-IDENTICAL in both - no per-build reason to
     exist twice,
  3. keeps only those whose every free name is a builtin, a shared definition
     or another definition being moved in the same pass (computed to a fixed
     point, so a helper and the helper it calls move together),
  4. writes them to a shared module IN THEIR ORIGINAL ORDER, and deletes them
     from both builds.

WHAT IT REFUSES TO MOVE, and why:

  * The entry points (bootGame, loadScriptsThen). Everything inside bootGame
    sits at column 0 in this file, so a naive reading of "top-level" picks the
    whole game up by its first three lines.
  * `var`, which this file does not use anyway.

`let` IS moved, after checking what it means here. These are per-match state
declarations - `let arenaTime = 0`, `let audioSettings = {...}` - and the two
builds declare them identically. Each build is its own page and its own
JavaScript realm, so a shared declaration is not shared state between them; it
is the same starting value written once. A build still assigns it freely at
runtime. Moving them also unblocks 21 functions that could not travel while the
state they read stayed behind.
  * Anything reaching for a name that only exists in one build. The fixed point
    above handles the chains.

    python art/extract_shared.py --dry-run     # what it would move
    python art/extract_shared.py               # move it
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'shared', 'common.js')

# Column-0 definitions only. Anything indented belongs to something else.
# `class` is a definition too. Leaving it out made `class Fighter` invisible to
# every tool here AND absorbed its 1,681 lines into the preceding chunk, which
# is why steerAroundObstacles was reported as differing by 176 lines when the
# difference was entirely in the class below it.
DEF = re.compile(r'(?m)^(?:function\s+([A-Za-z_$][\w$]*)\s*\(|'
                 r'(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=|'
                 r'(class)\s+([A-Za-z_$][\w$]*)\b)')
IDENT = re.compile(r'\b([A-Za-z_$][\w$]*)\b')

# Never moved: the entry points, and the pair of names that only make sense
# inside the page that owns them.
NEVER = {'bootGame', 'loadScriptsThen', 'loadThreeFallback', 'startGame'}

BUILTIN = set('''
THREE Math JSON Object Array String Number Boolean Date Promise Set Map WeakMap Symbol
document window console performance localStorage sessionStorage navigator location history
requestAnimationFrame cancelAnimationFrame setTimeout clearTimeout setInterval clearInterval
parseInt parseFloat isNaN isFinite Error TypeError RangeError encodeURIComponent
decodeURIComponent fetch AudioContext webkitAudioContext Peer atob btoa Image Audio Blob URL
CanvasRenderingContext2D HTMLCanvasElement getComputedStyle matchMedia structuredClone
'''.split())


def comment_start(text, i):
    """Index of the start of the run of `//` lines directly above `i`.

    A definition's leading comment is the block that explains it, and the whole
    value of this codebase is in those blocks - so it has to travel with the
    definition rather than stay behind with whatever happened to precede it.
    """
    start = text.rfind(chr(10), 0, i) + 1
    while start > 0:
        prev_end = start - 1
        prev_start = text.rfind(chr(10), 0, prev_end) + 1
        if not text[prev_start:prev_end].strip().startswith('//'):
            break
        start = prev_start
    return start


def definition_span(text, start, chunk_end):
    """Where a definition really ends: matched braces, or its semicolon.

    Falls back to the whole chunk when the scan looks wrong (it does not
    understand regex literals), because being wrong in the familiar way beats
    being wrong in a new one. Mirrors art/sync_local.py, which is where this was
    worked out and validated against 1,000 definitions.
    """
    i, n = start, len(text)
    depth, seen_brace, quote = 0, False, None
    is_block = text.startswith('function', start) or text.startswith('class', start)
    end = None
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
                end = i + 1
                break
        elif c == ';' and not is_block and depth == 0:
            end = i + 1
            break
        i += 1
    if end is None or end > chunk_end or end <= start or text[end - 1] not in '};':
        return chunk_end
    nl = text.find(chr(10), end)
    if nl != -1 and not text[end:nl].strip():
        return nl + 1
    return end

def definitions(text):
    """name -> (kind, source), for every column-0 definition.

    The source INCLUDES the comment block above the definition. Chunking from
    the definition itself left a definition's explanation in the previous chunk,
    so moving one moved the code and left the reasoning behind. It hid because
    definitions move in runs and an adjacent comment still reads correctly - it
    only showed at a boundary, when matchAssetsReady was ported into the local
    build and landed under a comment describing modelsReady instead.

    Boundaries still tile the file exactly (each chunk ends where the next one's
    comment begins), so removal and replacement stay consistent.
    """
    out = {}
    hits = list(DEF.finditer(text))
    starts = [comment_start(text, m.start()) for m in hits]
    for k, m in enumerate(hits):
        name = m.group(1) or m.group(3) or m.group(5)
        kind = 'function' if m.group(1) else (m.group(2) or m.group(4))
        chunk_end = starts[k + 1] if k + 1 < len(hits) else len(text)
        # The definition ENDS where it ends. Running to the next one swept up
        # whatever top-level statements sat between them, which made two
        # identical functions look different because of the wiring after them -
        # and, worse, moved that wiring across builds. randomPick is identical
        # in both; its chunk was not.
        end = definition_span(text, m.start(), chunk_end)
        out[name] = (kind, text[starts[k]:end])
    return out


def norm(s):
    return re.sub(r'\s+', ' ', s).strip()


def main():
    dry = '--dry-run' in sys.argv
    online_src = io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    local_src = io.open(os.path.join(ROOT, 'local', 'index.html'), encoding='utf-8').read()
    online, local = definitions(online_src), definitions(local_src)

    # EVERY shared module counts, common.js included. Excluding it made this
    # script rewrite common.js from scratch on a second run: the definitions
    # moved by the FIRST run were no longer in either build, so they were not
    # candidates, and the file came back holding only the new batch. That
    # deletes working code - caught immediately, but the lesson is that this
    # script appends to a body of work rather than producing it fresh.
    shared_names = set()
    existing_common = ''
    for fn in os.listdir(os.path.join(ROOT, 'shared')):
        if not fn.endswith('.js'):
            continue
        text = io.open(os.path.join(ROOT, 'shared', fn), encoding='utf-8').read()
        shared_names |= set(definitions(text))
        if fn == 'common.js':
            existing_common = text

    build_names = set(online) | set(local)
    # Identical in both, a const or a function, and not an entry point.
    candidates = [n for n in online
                  if n in local and n not in NEVER
                  and online[n][0] in ('function', 'const', 'let')   # never 'class'
                  and norm(online[n][1]) == norm(local[n][1])]

    movable, changed = set(), True
    while changed:
        changed = False
        for n in candidates:
            if n in movable:
                continue
            refs = set(IDENT.findall(online[n][1])) - BUILTIN - {n}
            if not {r for r in refs
                    if r in build_names and r not in shared_names and r not in movable}:
                movable.add(n)
                changed = True

    ordered = [n for n in online if n in movable]
    print('%d identical candidates, %d movable' % (len(candidates), len(ordered)))
    if dry:
        for n in ordered:
            print('   %-34s %s' % (n, online[n][0]))
        return 0
    if not ordered:
        print('nothing to move')
        return 0

    header = '''// Astral Clash - everything both builds define identically.
//
// Loaded as a plain script by index.html and local/index.html, after three.js
// and the other shared modules.
//
// This file is GENERATED by art/extract_shared.py, which moves anything the two
// builds define byte-for-byte identically and that depends on nothing
// build-specific. It exists because of a standing requirement: "you should
// never have to update both for the same update".
//
// What is deliberately NOT here: the entry points, and anything reaching for
// something only one build has - a HUD canvas, a renderer, a split-screen
// viewport. art/audit_shared.py lists what is still duplicated and why.

'''
    body = []
    for n in ordered:
        body.append(online[n][1].rstrip() + chr(10))
    if existing_common:
        # Append to what is already there, keeping its header.
        io.open(OUT, 'w', encoding='utf-8', newline='').write(
            existing_common.rstrip() + chr(10) * 2 + chr(10).join(body))
    else:
        io.open(OUT, 'w', encoding='utf-8', newline='').write(header + chr(10).join(body))
    print('wrote shared/common.js (+%d definitions, %d total)'
          % (len(ordered), len(definitions(io.open(OUT, encoding='utf-8').read()))))

    for path, table in ((os.path.join(ROOT, 'index.html'), online),
                        (os.path.join(ROOT, 'local', 'index.html'), local)):
        src = io.open(path, encoding='utf-8').read()
        for n in ordered:
            chunk = table[n][1]
            assert src.count(chunk) == 1, '%s: %s appears %d times' % (path, n, src.count(chunk))
            src = src.replace(chunk, '', 1)
        io.open(path, 'w', encoding='utf-8', newline='').write(src)
        print('  removed %d definitions from %s' % (len(ordered), os.path.basename(path)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
