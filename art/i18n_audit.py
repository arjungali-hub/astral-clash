# -*- coding: utf-8 -*-
"""Which user-visible strings have no translation.

    python art/i18n_audit.py              a count, by where the string lives
    python art/i18n_audit.py --list       every untranslated string
    python art/i18n_audit.py --list es    just that language

WHY THIS EXISTS. art/strings.py counted what localising WOULD cost. This answers
the different question of what is still missing now that some of it is done -
and it found the gap the first pass left, which was not small:

  * the ROSTER was never touched. Ten fighters' names, titles, descriptions,
    attack names and special descriptions - the longest prose in the game, and
    the text a player reads while deciding who to be.
  * the LOCAL BUILD was never scanned at all. strings.py reads index.html, so
    every string that exists only in the split-screen build - "Back to Online
    Version", the sandbox explanation, "Reset Progress" and its warning - was
    outside the count and outside the tables.
  * the DAILY CHALLENGES arrived after the catalogue was written, so their ten
    sentences were never in it.

Each of those was invisible for the same reason: nothing compared the tables
against the game. A translation table is exactly the kind of thing that looks
finished because the screen you happened to look at was.

WHAT COUNTS as needing translation is deliberately narrower than strings.py.
Proper nouns stay: fighter names (Kaelen, Lyra) and the game's own title are not
translated, and listing them as missing every run would train somebody to ignore
the output.
"""
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# Proper nouns and non-words. A name is a name in every language.
KEEP = set("""
Astral Clash Kaelen Lyra Gorgonok Voss Draven Seraphine Nyx Ignis Aurelia Thorne
Grint Slagling Hollowkin Karrigos ASTRAL CLASH
""".split())

NOT_PROSE = re.compile(
    r'^(?:[a-z-]+/[a-z0-9+.-]+'
    r'|#[0-9a-fA-F]{3,8}'
    r'|[a-z]+:[^ ]*'
    r'|[\w.-]+\.(?:js|css|html|png|jpg|webp|woff2?|glb|gltf|mp3|json)'
    r'|[A-Za-z_$][\w$]*'
    r'|[-\d.,%\s]+'
    r')$')
WORDY = re.compile(r'[A-Za-z]')


def visible_strings():
    """Every string a player can read, from both builds and the shared data."""
    out = {}

    def add(group, s):
        s = ' '.join(str(s).split())
        if not s or s in KEEP:
            return
        if not WORDY.search(s):
            return
        # A bare identifier is markup plumbing, not a sentence - unless it has a
        # space in it, which makes it words.
        if ' ' not in s and NOT_PROSE.match(s):
            return
        out.setdefault(s, group)

    # ---- both builds' markup -------------------------------------------
    for label, rel in (('online markup', 'index.html'),
                       ('local markup', os.path.join('local', 'index.html'))):
        text = io.open(os.path.join(ROOT, rel), encoding='utf-8').read()
        i = text.index('<body')
        body = text[i:text.index('<script', i)]
        body = re.sub(r'<!--.*?-->', ' ', body, flags=re.S)
        for m in re.finditer(r'>([^<>{}]+)<', body):
            add(label, m.group(1))
        for attr in ('placeholder', 'title', 'aria-label'):
            for m in re.finditer(attr + r'="([^"]+)"', body):
                add(label, m.group(1))

    # ---- the roster and the modes --------------------------------------
    roster = io.open(os.path.join(ROOT, 'shared', 'roster.js'), encoding='utf-8').read()
    for key in ('title', 'desc', 'atkName', 'atkDesc', 'specialName', 'specialDesc'):
        for m in re.finditer(key + r":\s*'((?:[^'\\]|\\.)+)'", roster):
            add('roster', m.group(1).replace("\\'", "'"))

    common = io.open(os.path.join(ROOT, 'shared', 'common.js'), encoding='utf-8').read()
    blk = common[common.find('const MATCH_MODES'):]
    blk = blk[:blk.find('];') + 2]
    for key in ('name', 'blurb'):
        for m in re.finditer(key + r":\s*'((?:[^'\\]|\\.)+)'", blk):
            add('modes', m.group(1).replace("\\'", "'"))

    # ---- the daily challenges ------------------------------------------
    chal = io.open(os.path.join(ROOT, 'shared', 'challenges.js'), encoding='utf-8').read()
    for m in re.finditer(r"text:\s*'((?:[^'\\]|\\.)+)'", chal):
        add('challenges', m.group(1).replace("\\'", "'"))

    return out


def table_keys():
    """What the i18n tables currently translate, per language."""
    src = io.open(os.path.join(ROOT, 'shared', 'i18n.js'), encoding='utf-8').read()
    langs = {}
    for lang in ('es', 'fr'):
        keys = set()
        # Both tables, read as "the thing on the left of a colon".
        for table in ('I18N', 'I18N_HTML'):
            i = src.find('const ' + table + ' = {')
            if i < 0:
                continue
            j = src.find(lang + ': {', i)
            if j < 0:
                continue
            # To the matching close of this language's object.
            depth, k = 1, src.index('{', j + len(lang) + 1) + 1
            while depth and k < len(src):
                if src[k] == '{':
                    depth += 1
                elif src[k] == '}':
                    depth -= 1
                k += 1
            block = src[j:k]
            for m in re.finditer(r"""(?m)^\s*(['"])((?:[^'"\\]|\\.)+)\1\s*:""", block):
                keys.add(m.group(2))
        langs[lang] = keys
    return langs


def main():
    seen = visible_strings()
    tables = table_keys()
    want_lang = None
    for i, a in enumerate(sys.argv):
        if a == '--list' and i + 1 < len(sys.argv) and sys.argv[i + 1] in ('es', 'fr'):
            want_lang = sys.argv[i + 1]

    print('user-visible strings found: %d' % len(seen))
    by_group = {}
    for s, g in seen.items():
        by_group.setdefault(g, []).append(s)
    for g in sorted(by_group):
        print('   %-16s %4d' % (g, len(by_group[g])))
    print()

    worst = 0
    for lang in ('es', 'fr'):
        keys = tables[lang]
        missing = {}
        for s, g in seen.items():
            # A key matches if the table holds the string itself. Escapes in the
            # source are compared decoded on both sides by construction.
            if s not in keys:
                missing.setdefault(g, []).append(s)
        total = sum(len(v) for v in missing.values())
        worst = max(worst, total)
        print('%s: %d translated, %d MISSING' % (lang, len(keys), total))
        for g in sorted(missing):
            print('   %-16s %4d missing' % (g, len(missing[g])))
        if '--list' in sys.argv and (want_lang is None or want_lang == lang):
            for g in sorted(missing):
                print('   == ' + g)
                for s in sorted(missing[g]):
                    print('      ' + s)
        print()

    return 1 if worst else 0


if __name__ == '__main__':
    sys.exit(main())
