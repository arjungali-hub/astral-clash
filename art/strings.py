# -*- coding: utf-8 -*-
"""Every user-visible string in the game, and therefore what localisation costs.

    python art/strings.py            the count, by where it lives
    python art/strings.py --list     every string
    python art/strings.py --out FILE a catalogue, one string per line

WHY THIS AND NOT THE EXTRACTION ITSELF. Localising this game means lifting every
string into a table and routing it through a lookup. That is a change to every
screen, in two builds, fighting machinery that currently keeps those builds in
step by comparing their text - and there is nobody asking for a second language
yet. Started on a guess it would be a large, risky change with no audience.

So this answers the question the decision actually turns on: HOW BIG IS IT. A
200-string job is an afternoon and a translator; a 2,000-string job is a project
with a budget. Nobody knew which this was, and the roadmap entry said "the
longer it waits the more strings there are" without ever saying how many.

It also gives a translator something to read today, which is the one piece of
groundwork that cannot be wrong later.

WHAT COUNTS. Text a player can see: markup text nodes, button labels,
placeholders, titles and aria-labels, and the string literals in code that reach
textContent, innerHTML or the HUD. Identifiers, CSS, element ids, colours, URLs
and debug output do not - and are excluded by shape rather than by a list, so the
count does not quietly drift as code moves.
"""
import io
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# A string is a candidate only if it reads like prose: at least one space or at
# least four letters, and it must contain a letter at all.
WORDY = re.compile(r'[A-Za-z]')
# Shapes that are never shown to a player, whatever they contain.
NOT_PROSE = re.compile(
    r'^(?:[a-z-]+/[a-z0-9+.-]+'           # media types
    r'|#[0-9a-fA-F]{3,8}'                  # colours
    r'|[a-z]+:[^ ]*'                       # urls, data:, javascript:
    r'|[\w.-]+\.(?:js|css|html|png|jpg|webp|woff2?|glb|gltf|mp3|json)'
    r'|[A-Za-z_$][\w$]*'                   # a bare identifier or key
    r'|[-\d.,%\s]+'                        # numbers, percentages, spacing
    r')$')
# Properties whose value is machinery, not words.
MACHINERY = re.compile(
    r'(?:getElementById|querySelector(?:All)?|classList|setAttribute|getAttribute'
    r'|addEventListener|safeLSGet|safeLSSet|localStorage|\.style\.|dataset'
    r'|console\.|netSend|JSON\.parse|new Audio|createElement|\.src\s*=)')


def markup_strings(text):
    """Text nodes, and the attributes a player reads."""
    i = text.index('<body')
    body = text[i:text.index('<script', i)]
    body = re.sub(r'<!--.*?-->', ' ', body, flags=re.S)
    out = []
    for m in re.finditer(r'>([^<>{}]+)<', body):
        t = ' '.join(m.group(1).split())
        if t and WORDY.search(t) and not NOT_PROSE.match(t):
            out.append(t)
    for attr in ('placeholder', 'title', 'aria-label', 'value'):
        for m in re.finditer(attr + r'="([^"]+)"', body):
            t = ' '.join(m.group(1).split())
            if t and WORDY.search(t) and not NOT_PROSE.match(t):
                out.append(t)
    return out


def code_strings(text):
    """String literals on lines that put text in front of somebody."""
    i = text.index('<body')
    code = text[text.index('<script', i):]
    out = []
    for line in code.splitlines():
        t = line.strip()
        if t.startswith('//') or t.startswith('*'):
            continue
        # Only lines that deliver text. innerHTML and textContent are the two
        # doors to the DOM; fillText is the door to the HUD canvas.
        if not re.search(r'innerHTML|textContent|innerText|fillText|'
                         r'rebindNote|showToast|announceResult|setOptState', t):
            continue
        if MACHINERY.search(t) and 'innerHTML' not in t and 'textContent' not in t:
            continue
        for m in re.finditer(r"'([^'\\]{2,})'|\"([^\"\\]{2,})\"|`([^`\\$]{2,})`", t):
            s = m.group(1) or m.group(2) or m.group(3)
            s = ' '.join(s.split())
            if not s or not WORDY.search(s) or NOT_PROSE.match(s):
                continue
            # Needs to read like words, not a token.
            if ' ' not in s and len(re.findall(r'[A-Za-z]', s)) < 4:
                continue
            out.append(s)
    return out


def shared_strings():
    """The roster and the mode list: names, titles and blurbs a player reads."""
    out = []
    p = os.path.join(ROOT, 'shared', 'roster.js')
    t = io.open(p, encoding='utf-8').read()
    for key in ('name', 'title', 'desc', 'atkName', 'atkDesc', 'specialName', 'specialDesc'):
        for m in re.finditer(key + r":\s*'([^']{2,})'", t):
            out.append(' '.join(m.group(1).split()))
    c = io.open(os.path.join(ROOT, 'shared', 'common.js'), encoding='utf-8').read()
    blk = c[c.find('const MATCH_MODES'):c.find('const MATCH_MODES') + 2600]
    for key in ('name', 'blurb'):
        for m in re.finditer(key + r":\s*'([^']{2,})'", blk):
            out.append(' '.join(m.group(1).split()))
    return out


def main():
    src = io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    groups = {
        'markup (labels, headings, help)': markup_strings(src),
        'code (HUD, toasts, dynamic panels)': code_strings(src),
        'shared data (roster, modes)': shared_strings(),
    }
    uniq, seen = {}, set()
    for name, items in groups.items():
        fresh = []
        for s in items:
            if s not in seen:
                seen.add(s)
                fresh.append(s)
        uniq[name] = fresh

    total = sum(len(v) for v in uniq.values())
    words = sum(len(s.split()) for v in uniq.values() for s in v)
    print('user-visible strings, de-duplicated across the game')
    for name, v in uniq.items():
        print('   %-36s %4d' % (name, len(v)))
    print('   %-36s %4d  (%d words)' % ('TOTAL', total, words))
    print()
    print('A TRANSLATOR AND AN AFTERNOON, then - not a budgeted project. That is')
    print('the number the roadmap entry was missing.')
    print()
    print('Counted honestly, with one known seam: a template literal is split at')
    print('each ${...}, so a sentence with a name in the middle arrives as two')
    print('fragments. That inflates the COUNT slightly and leaves the word total')
    print('about right - and the fragments are exactly the strings an extraction')
    print('would have to rejoin, so seeing them here is useful rather than noise.')
    print()
    longest = sorted((s for v in uniq.values() for s in v), key=len, reverse=True)[:3]
    print('longest, which is where the translation cost really sits:')
    for s in longest:
        print('   %d chars: %s...' % (len(s), s[:72]))

    if '--list' in sys.argv:
        print()
        for name, v in uniq.items():
            print('== ' + name)
            for s in sorted(v):
                print('   ' + s)

    for i, a in enumerate(sys.argv):
        if a == '--out' and i + 1 < len(sys.argv):
            with io.open(sys.argv[i + 1], 'w', encoding='utf-8', newline='') as f:
                for name, v in uniq.items():
                    f.write('# ' + name + '\n')
                    for s in sorted(v):
                        f.write(s + '\n')
            print('\ncatalogue written to ' + sys.argv[i + 1])
    return 0


if __name__ == '__main__':
    sys.exit(main())
