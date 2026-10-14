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
import html
import io
import sys as _sys

# ENCODE THE REPORT. This prints strings lifted from a file full of accented
# characters, to a console that is cp1252 on Windows - and it crashed partway
# through its own --list output on the first U+2713. Reconfigured rather than
# wrapped at each print, so nothing added later can forget.
try:
    _sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# Proper nouns and non-words. A name is a name in every language.
KEEP = set([
    # A PLAYER NUMBER AND A SEPARATOR. What is left of the two-player coin line
    # once its words are in t() is "P1 +", " · P2 +" and the numbers - and P1,
    # P2 and a middle dot read the same in every language this ships in. Listed
    # rather than silently filtered, so the next fragment like it has to be
    # argued for too.
    'P1 + · P2 +',
    'Astral Clash', 'ASTRAL CLASH', 'Kaelen', 'Lyra', 'Gorgonok', 'Voss',
    'Draven', 'Seraphine', 'Nyx', 'Ignis', 'Aurelia', 'Thorne', 'Grint',
    'Slagling', 'Hollowkin', 'Karrigos',
    # Key names and a decorative arena sign. A key is called W/S in every
    # language, and listing them every run trains somebody to skip the output.
    'W/S', 'A/D', 'ARENA // FOUNDRY OF ASH',
])

NOT_PROSE = re.compile(
    r'^(?:[a-z-]+/[a-z0-9+.-]+'
    r'|#[0-9a-fA-F]{3,8}'
    r'|[a-z]+:[^ ]*'
    r'|[\w.-]+\.(?:js|css|html|png|jpg|webp|woff2?|glb|gltf|mp3|json)'
    r'|[A-Za-z_$][\w$]*'
    r'|[-\d.,%\s]+'
    r')$')
WORDY = re.compile(r'[A-Za-z]')


# The shared modules that put words on the screen. common.js owns showToast and
# the whole canvas HUD; the other three are the features whose own messages live
# beside their logic.
SHARED_FOR_AUDIT = ('common.js', 'replay.js', 'account.js', 'challenges.js')


def visible_strings():
    """Every string a player can read, from both builds and the shared data."""
    out = {}

    assembled = {}

    def add_assembled(group, s):
        # Same filters as add(), different destination. Anything that is already
        # a whole translatable string - it appears in `out` - is not a fragment,
        # so it is not reported twice.
        s = html.unescape(str(s))
        # AND THE SAME ESCAPE DECODING. Without it this bucket reported
        # "\u2713 Locked in" - the escape rather than the tick - which is the
        # identical bug add() had one layer up.
        if '\\u' in s:
            try:
                s = s.encode('ascii', 'backslashreplace').decode('unicode_escape')
            except Exception:
                pass
        s = ' '.join(s.split())
        if not s or s in KEEP or not WORDY.search(s):
            return
        if ' ' not in s and NOT_PROSE.match(s):
            return
        assembled.setdefault(s, group)

    def add(group, s):
        # DECODED FIRST. `&mdash;` reaches a text node as an em dash, and the
        # tables are keyed on what the node holds - so comparing raw markup
        # against them reported `Coins &amp; Unlocks` as untranslated while
        # `Coins & Unlocks` sat in the table.
        s = html.unescape(str(s))
        # AND THE JS ESCAPES. A source that writes '\u2026' reaches the screen
        # as an ellipsis, and the tables are keyed on the character - so
        # comparing the raw escape reported "Press a key\u2026" as untranslated
        # and no amount of translating it could ever have fixed that. Same
        # reasoning as the html.unescape above, one layer over.
        if '\\u' in s:
            try:
                s = s.encode('ascii', 'backslashreplace').decode('unicode_escape')
            except Exception:
                pass
        s = ' '.join(s.split())
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

    # ---- strings JAVASCRIPT builds -------------------------------------
    #
    # The audit read markup and three data tables and reported "0 MISSING"
    # while a hands-on pass found dozens of untranslated strings: the HUD,
    # "Confirm (Left Click)", the role suffixes, the Armory prices, every
    # Settings value chip. A green tick that measures the wrong thing is worse
    # than a red one.
    #
    # Not "every string literal" - that is impossible from source, because
    # 'p1', 'shop-title' and 'Unlocked' are the same shape and only one is
    # prose. These are POSITIONS that are user-visible by construction.
    js_positions = (
        # setOptState(id, TEXT, on) - the second argument is the chip a player
        # reads beside a settings label.
        r"setOptState" + chr(92) + r"(" + chr(92) + r"s*'(?:[^'" + chr(92)
        + chr(92) + r"]|" + chr(92) + chr(92) + r".)*'" + chr(92) + r"s*,"
        + chr(92) + r"s*'((?:[^'" + chr(92) + chr(92) + r"]|" + chr(92)
        + chr(92) + r".)+)'",
        # t(TEXT) - the direct lookup, for strings assembled in code.
        #
        # ADDED THE MOMENT t() STARTED BEING USED, because routing a string
        # through t() with no table entry changes nothing at all: the lookup
        # misses, the English falls through, and the audit reports a clean zero
        # because it was only ever reading markup. The fix for an untranslated
        # fragment would have silently produced an untranslated fragment.
        r"(?:^|[^A-Za-z0-9_$.])t" + chr(92) + r"(" + chr(92) + r"s*'((?:[^'"
        + chr(92) + chr(92) + r"]|" + chr(92) + chr(92) + r".)+)'" + chr(92) + r"s*" + chr(92) + r")",
        # showToast(TEXT)
        r"showToast" + chr(92) + r"(" + chr(92) + r"s*'((?:[^'" + chr(92)
        + chr(92) + r"]|" + chr(92) + chr(92) + r".)+)'",
        # fillText(TEXT, ...) - the canvas HUD. No DOM pass can see this one,
        # which makes it the part a rendered-output check would also miss.
        r"fillText" + chr(92) + r"(" + chr(92) + r"s*'((?:[^'" + chr(92)
        + chr(92) + r"]|" + chr(92) + chr(92) + r".)+)'",
        # direct writes
        r"textContent" + chr(92) + r"s*=" + chr(92) + r"s*'((?:[^'" + chr(92)
        + chr(92) + r"]|" + chr(92) + chr(92) + r".)+)'",
        r"placeholder" + chr(92) + r"s*=" + chr(92) + r"s*'((?:[^'" + chr(92)
        + chr(92) + r"]|" + chr(92) + chr(92) + r".)+)'",
    )
    js_sources = [('online markup', 'index.html'),
                  ('local markup', os.path.join('local', 'index.html'))]
    for name in SHARED_FOR_AUDIT:
        js_sources.append(('shared/' + name, os.path.join('shared', name)))
    for label, rel in js_sources:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            continue
        text = io.open(path, encoding='utf-8').read()
        for pat in js_positions:
            for m in re.finditer(pat, text):
                add(label, m.group(1).replace("\\'", "'"))

    # ---- prose assembled inside TEMPLATE LITERALS ----------------------
    #
    # The six positions above are call arguments; most of the interface is not.
    # buildShop's cards, the stat rows, the "Main Attack - ..." headings and the
    # HUD plates are all backtick strings written through innerHTML, invisible
    # to both the markup scan (it stops at the first <script>) and the call scan.
    #
    # A template literal is markup with holes in it. Blank the holes, then run
    # the markup extraction over what is left: `<span>${c.name}</span>` yields
    # nothing, and `<span>Unlocked</span>` yields "Unlocked".
    # A SENTINEL, not nothing. Blanking a ${} hole to the empty string loses the
    # one fact that decides where the string belongs: a text node that had a
    # hole in it is assembled from parts and needs t() at the source, and a text
    # node that never had one is a whole string a table entry reaches. Replacing
    # the hole with a character that cannot occur in markup keeps them apart.
    HOLE = chr(1)

    def _blank_holes(lit):
        out, i, n = [], 0, len(lit)
        while i < n:
            if lit[i] == '$' and i + 1 < n and lit[i + 1] == '{':
                depth, i = 1, i + 2
                while i < n and depth:
                    if lit[i] == '{':
                        depth += 1
                    elif lit[i] == '}':
                        depth -= 1
                    i += 1
                out.append(HOLE)
                continue
            out.append(lit[i])
            i += 1
        return ''.join(out)

    # INTO ASSEMBLED, not into `out`. What comes back from here is the text
    # between the ${} holes, and the node a player sees interleaves the two -
    # "Confirm (Left Click)", not "Confirm ()". No table entry can match a
    # fragment, so reporting these as missing translations would be asking a
    # translator to fix something only a code change can.
    for label, rel in js_sources:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            continue
        text = io.open(path, encoding='utf-8').read()
        # Backtick strings, non-greedy, skipping escaped backticks.
        for m in re.finditer(r'`((?:[^`' + chr(92) + chr(92) + r']|'
                             + chr(92) + chr(92) + r'.)*)`', text, re.S):
            frag = _blank_holes(m.group(1))
            # A REAL TAG, not just a '<'. The guard used to be `'<' not in frag`,
            # which every JS expression containing a less-than passes - so
            # `if (lateral > 140) ... const lateral = Math.hypot(...) <` was
            # extracted as prose. Six of the twenty-seven reported strings were
            # code read as markup.
            # A CLOSING TAG OR AN ATTRIBUTE, not merely an opening angle bracket.
            # `<[a-zA-Z/]` still let through literals that are mostly code and
            # happen to contain one tag-shaped sequence, which is how
            # "40) return; const ax = a.x + a.width / 2, ..." arrived as prose.
            # Real markup in this file always closes a tag or sets a class.
            if not ('</' in frag or 'class="' in frag):
                continue              # not markup; a selector, a class list, or code
            # ...and never extract from something carrying statement syntax. A
            # template literal that builds markup does not contain `return` or
            # `const` between its tags.
            if re.search(r'(?:^|[^A-Za-z])(?:return|const|let|function)[^A-Za-z]', frag):
                continue
            def _route(text):
                # The sentinel is the whole decision: with it, the node is built
                # from parts and no key can match; without it, the node is this
                # string and a table entry reaches it.
                if HOLE in text:
                    add_assembled(label, text.replace(HOLE, ''))
                else:
                    add(label, text)
            for t2 in re.finditer(r'>([^<>{}]+)<', frag):
                _route(t2.group(1))
            for attr in ('placeholder', 'title', 'aria-label', 'alt'):
                for t2 in re.finditer(attr + r'="([^"]+)"', frag):
                    _route(t2.group(1))

    # ---- the daily challenges ------------------------------------------
    chal = io.open(os.path.join(ROOT, 'shared', 'challenges.js'), encoding='utf-8').read()
    for m in re.finditer(r"text:\s*'((?:[^'\\]|\\.)+)'", chal):
        add('challenges', m.group(1).replace("\\'", "'"))

    for k in list(assembled):
        if k in out:
            del assembled[k]
    return out, assembled


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
            # ONE PATTERN PER QUOTE STYLE. A single pattern with a backreference
            # must exclude BOTH quote characters from the body, which makes a
            # double-quoted key containing an apostrophe invisible - and those are
            # exactly the keys that exist, since a key with an apostrophe HAS to be
            # double-quoted. The audit reported every one of them as untranslated
            # while the translation sat in the file.
            for pat in (r"(?m)^\s*'((?:[^'\\]|\\.)+)'\s*:",
                        r'(?m)^\s*"((?:[^"\\]|\\.)+)"\s*:'):
                for m in re.finditer(pat, block):
                    # UNESCAPED. A key containing a quote is stored with it escaped,
                    # and the raw match carries the backslashes - so the key never
                    # equalled the source string it was written for.
                    keys.add(m.group(1).replace('\\"', '"')
                             .replace("\\'", "'")
                             .replace('\\\\', '\\'))
        langs[lang] = keys
    return langs


def main():
    seen, assembled = visible_strings()
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

    # ASSEMBLED AT RUNTIME - counted, listed, and deliberately not in the exit
    # code.
    #
    # These are the text pieces between a template literal's ${} holes. The node
    # a player sees interleaves them with values - "Confirm (Left Click)", not
    # "Confirm ()" - so localiseDOM, which keys on a whole text node, can never
    # match one and no table entry can fix it. The fix is at the source:
    # t('Confirm') + ' (' + keyLabel + ')', the way the arena label does it.
    #
    # They are real: every one below was independently found untranslated by a
    # hands-on pass. They are just not a translator's job, and folding them into
    # the exit code would hold the gate shut on work a table cannot do - a tick
    # that can never go green reports as much as no tick at all.
    if assembled:
        print('ASSEMBLED AT RUNTIME: %d string(s) no table entry can reach.' % len(assembled))
        print('  These are fragments around ${} holes in template literals, so the')
        print('  text node they end up in is never equal to any key. Translating')
        print('  them means calling t() at the source. Not counted as missing.')
        a_groups = {}
        for s2, g in assembled.items():
            a_groups.setdefault(g, []).append(s2)
        for g in sorted(a_groups):
            print('   %-16s %4d' % (g, len(a_groups[g])))
            if '--assembled' in sys.argv:
                for s2 in sorted(a_groups[g]):
                    print('      ' + s2)
        print('  (run with --assembled to list them)')
        print()

    worst = 0
    for lang in ('es', 'fr'):
        keys = tables[lang]
        # A PROSE BLOCK COVERS ITS OWN FRAGMENTS. localiseDOM replaces a <p>
        # wholesale, so the pieces its text splits into around <b> tags - ", and
        # heavy", ". Every", "above for how you move and aim" - are never looked
        # up individually and never need entries of their own.
        #
        # Without this the audit reported every one of them as missing, which is
        # both wrong and the kind of wrong that makes a report ignorable: a list
        # with fifty false entries does not get read for the three real ones.
        blocks = [k for k in keys if len(k) > 60]
        covered = lambda frag: any(frag in b for b in blocks)

        missing = {}
        for s, g in seen.items():
            if s in keys:
                continue
            # Fragments only. A whole sentence that merely appears inside a
            # longer one still deserves its own entry, so this is limited to
            # short pieces - the shape a split paragraph actually produces.
            # ANY LENGTH. The pieces a <p> splits into around its <b> tags are
            # often whole clauses, and capping this reported two dozen of them
            # as missing while their paragraph was translated in full.
            if covered(s):
                continue
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
