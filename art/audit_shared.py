# -*- coding: utf-8 -*-
"""What is still duplicated between the two builds, and does it need to be?

Asked directly: "make sure every single thing that the local and online version
should share is now shared for them (basically everything except interface). You
should never have to update both for the same update. Confirm this, and if there
is a gap, fix it."

This answers it with a list rather than an opinion. It pulls every top-level
definition out of index.html and local/index.html, sets them against each other
and against shared/, and sorts what it finds into:

  SHARED      - defined once, in shared/. Nothing to do.
  DUPLICATED  - defined in BOTH builds. Each of these is a thing somebody could
                have to update twice, so each needs either a move or a reason.
  ONLINE ONLY / LOCAL ONLY - defined in one build. Fine by definition.

A DUPLICATED entry whose two copies are IDENTICAL is the loudest signal: there
is no per-build reason for it, it is just in the wrong place.

    python art/audit_shared.py            # the summary
    python art/audit_shared.py --names    # every duplicated name
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# A top-level definition: `function foo(` or `const foo =` / `let foo =` at
# column 0. Anything indented belongs to something else and is not a candidate.
DEF = re.compile(r'(?m)^(?:function\s+([A-Za-z_$][\w$]*)\s*\(|'
                 r'(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)')


def defs_with_bodies(text):
    """name -> source text, for every top-level definition."""
    out = {}
    hits = list(DEF.finditer(text))
    for k, m in enumerate(hits):
        name = m.group(1) or m.group(2)
        end = hits[k + 1].start() if k + 1 < len(hits) else len(text)
        out[name] = text[m.start():end]
    return out


def inline_script(path):
    """The game is one big inline <script>; read the file and take the lot."""
    return io.open(path, encoding='utf-8').read()


def main():
    online = defs_with_bodies(inline_script(os.path.join(ROOT, 'index.html')))
    local = defs_with_bodies(inline_script(os.path.join(ROOT, 'local', 'index.html')))

    shared = {}
    shared_dir = os.path.join(ROOT, 'shared')
    for fn in sorted(os.listdir(shared_dir)):
        if fn.endswith('.js'):
            for name, body in defs_with_bodies(inline_script(os.path.join(shared_dir, fn))).items():
                shared[name] = fn

    both = sorted(set(online) & set(local))
    identical, differing = [], []
    for name in both:
        a = re.sub(r'\s+', ' ', online[name]).strip()
        b = re.sub(r'\s+', ' ', local[name]).strip()
        (identical if a == b else differing).append(name)

    print('shared/      %4d definitions in %d files'
          % (len(shared), len([f for f in os.listdir(shared_dir) if f.endswith('.js')])))
    print('online only  %4d' % len(set(online) - set(local)))
    print('local only   %4d' % len(set(local) - set(online)))
    print('DUPLICATED   %4d  (%d byte-identical, %d differing)'
          % (len(both), len(identical), len(differing)))
    print('')
    print('Byte-identical duplicates are the ones with no per-build reason to')
    print('exist twice. Differing ones may be legitimate - the same name doing')
    print('a genuinely different job in a split-screen build - or may be drift.')

    if '--names' in sys.argv:
        print('')
        print('--- byte-identical in both builds ---')
        for n in identical:
            print('   ', n)
        print('')
        print('--- present in both but different ---')
        for n in differing:
            print('   %-34s online %5d chars, local %5d'
                  % (n, len(online[n]), len(local[n])))
    # Shadowing is the other failure: a build re-declaring something shared
    # silently wins over it.
    shadowed = sorted((set(online) | set(local)) & set(shared))
    if shadowed:
        print('')
        print('!!! SHADOWING shared/ definitions:')
        for n in shadowed:
            print('   %-34s also defined in %s' % (n, shared[n]))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
