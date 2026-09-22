# -*- coding: utf-8 -*-
"""Move definitions the LOCAL build is missing into shared/, so it gets them.

art/extract_shared.py can only move what both builds already define the same
way, so it can never close the gap that actually matters now: the local build is
missing whole features. Four of them turned up as one-line holes in functions
the builds otherwise share -

    openModal      has no ensureModalClose(el)   -> local modals have no close X
    setMatchMode   has no warmModelsForMode(id)  -> local stalls on mode switch
    resetCrush     has no releaseCrushBorrowed() -> fighters vanish after a crush
    onWindowResize has no composer.setSize(w, h) -> local has no bloom at all

- because the helper each one calls exists only in the online build.

A definition the local build lacks can still live in shared/, as long as it
reaches for nothing build-specific. Putting it there hands it to the local build
for free. That does NOT by itself make the local build use it - its own call
sites still have to be fixed - but it turns "port a feature by hand" into "add
one line", which is a different size of job and a much smaller risk.

WHAT IS DELIBERATELY LEFT BEHIND: peer-to-peer networking, room codes and the
lobby. Those are the interface the user drew a line around, they exist only in
the online build by design, and nobody will ever have to update them in two
places. Sharing them would be dead weight in the local build and would blur the
boundary this whole exercise is meant to make legible.

    python art/promote_shared.py --dry-run
    python art/promote_shared.py
"""
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract_shared as E

ROOT = E.ROOT
OUT = E.OUT

# Network, lobby and room-code machinery stays in the online build. Matched on
# the name, which is reliable here only because this codebase names these things
# consistently - netFoo, roomBar, NET_BAZ, LOBBY_QUX.
#
# The matching is deliberately anchored rather than a substring test. A plain
# case-insensitive "host" also matches hpGhost, and a rule that quietly holds
# back an unrelated definition is worse than one that lets a constant through:
# the first is invisible, the second is a line in the dry run.
UPPER_PREFIXES = ('NET_', 'ROOM_', 'LOBBY_', 'PEER_', 'HOST_')
CAMEL_PREFIXES = ('net', 'room', 'lobby', 'peer', 'host', 'remote', 'spectat')
CAMEL_INFIXES = ('Net', 'Room', 'Lobby', 'Peer', 'Host', 'Remote', 'Spectat')
NET_EXTRA = {'coopIsHost', 'coopIsPuppet', 'onlineModes', 'startOnline', 'enterRoom',
             'ACCOUNT', 'accountOf', 'myProg', 'LOCAL_SIDE', 'isLocalSide',
             'localPlayerNumber', 'localFighter', 'localCamera', 'otherSide'}


def is_online_business(name):
    if name in NET_EXTRA or name.startswith(UPPER_PREFIXES):
        return True
    if name.isupper():
        return False
    return name.startswith(CAMEL_PREFIXES) or any(k in name for k in CAMEL_INFIXES)


def main():
    dry = '--dry-run' in sys.argv
    online_path = os.path.join(ROOT, 'index.html')
    online = E.definitions(io.open(online_path, encoding='utf-8').read())
    local = E.definitions(io.open(os.path.join(ROOT, 'local', 'index.html'),
                                 encoding='utf-8').read())

    shared_names, existing_common = set(), ''
    for fn in os.listdir(os.path.join(ROOT, 'shared')):
        if not fn.endswith('.js'):
            continue
        text = io.open(os.path.join(ROOT, 'shared', fn), encoding='utf-8').read()
        shared_names |= set(E.definitions(text))
        if fn == 'common.js':
            existing_common = text

    build_names = set(online) | set(local)
    cands = [n for n in online
             if n not in local and n not in E.NEVER and not is_online_business(n)]

    # Same fixed point the extractor uses: a definition may go only when every
    # free name it touches is a builtin, already shared, or going with it.
    movable, changed = set(), True
    while changed:
        changed = False
        for n in cands:
            if n in movable:
                continue
            refs = set(E.IDENT.findall(online[n][1])) - E.BUILTIN - {n}
            if not {r for r in refs
                    if r in build_names and r not in shared_names and r not in movable}:
                movable.add(n)
                changed = True

    ordered = [n for n in online if n in movable]
    held = [n for n in online if n not in local and n not in E.NEVER
            and is_online_business(n)]
    print('%d definitions the local build lacks; %d promotable, %d held back as '
          'online business' % (len(cands) + len(held), len(ordered), len(held)))
    if dry:
        for n in ordered:
            print('   %-34s %s' % (n, online[n][0]))
        return 0
    if not ordered:
        print('nothing to promote')
        return 0

    body = [online[n][1].rstrip() + chr(10) for n in ordered]
    io.open(OUT, 'w', encoding='utf-8', newline='').write(
        existing_common.rstrip() + chr(10) * 2 + chr(10).join(body))
    print('wrote shared/common.js (+%d definitions, %d total)'
          % (len(ordered), len(E.definitions(io.open(OUT, encoding='utf-8').read()))))

    src = io.open(online_path, encoding='utf-8').read()
    for n in ordered:
        chunk = online[n][1]
        assert src.count(chunk) == 1, '%s appears %d times' % (n, src.count(chunk))
        src = src.replace(chunk, '', 1)
    io.open(online_path, 'w', encoding='utf-8', newline='').write(src)
    print('  removed %d definitions from index.html' % len(ordered))
    print('\nThe local build can now SEE these. Making it USE them is a separate,'
          '\nmuch smaller job: fix its call sites (see the four named in this'
          "\nfile's header) and let art/sync_local.py's drift check confirm it.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
