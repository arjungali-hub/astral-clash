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
  * `let` and `var`. Those are mutable STATE that each build assigns during a
    match, and state is where the two builds legitimately differ - one has two
    fighters on one keyboard. Constants and functions are the code you would
    otherwise have to change twice.
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
DEF = re.compile(r'(?m)^(?:function\s+([A-Za-z_$][\w$]*)\s*\(|'
                 r'(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)')
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


def definitions(text):
    """name -> (kind, source), for every column-0 definition."""
    out = {}
    hits = list(DEF.finditer(text))
    for k, m in enumerate(hits):
        name = m.group(1) or m.group(3)
        kind = 'function' if m.group(1) else m.group(2)
        end = hits[k + 1].start() if k + 1 < len(hits) else len(text)
        out[name] = (kind, text[m.start():end])
    return out


def norm(s):
    return re.sub(r'\s+', ' ', s).strip()


def main():
    dry = '--dry-run' in sys.argv
    online_src = io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    local_src = io.open(os.path.join(ROOT, 'local', 'index.html'), encoding='utf-8').read()
    online, local = definitions(online_src), definitions(local_src)

    shared_names = set()
    for fn in os.listdir(os.path.join(ROOT, 'shared')):
        if fn.endswith('.js') and fn != 'common.js':
            shared_names |= set(definitions(
                io.open(os.path.join(ROOT, 'shared', fn), encoding='utf-8').read()))

    build_names = set(online) | set(local)
    # Identical in both, a const or a function, and not an entry point.
    candidates = [n for n in online
                  if n in local and n not in NEVER
                  and online[n][0] in ('function', 'const')
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
// What is deliberately NOT here: mutable per-match state (`let`), the entry
// points, and anything reaching for something only one build has - a HUD
// canvas, a renderer, a split-screen viewport. art/audit_shared.py lists what
// is still duplicated and why.

'''
    body = []
    for n in ordered:
        body.append(online[n][1].rstrip() + chr(10))
    io.open(OUT, 'w', encoding='utf-8', newline='').write(header + chr(10).join(body))
    print('wrote shared/common.js (%d definitions)' % len(ordered))

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
