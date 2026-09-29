# -*- coding: utf-8 -*-
"""Every line of the local build, classified by what keeps it in step.
Or by nothing, which is what this exists to find.

    python art/coverage.py            the summary
    python art/coverage.py --lines    every unkeyed line of code, with its region

WHY THIS EXISTS. "Does anything still need fixing twice?" was asked four times,
and three of my answers were wrong. Each time the gap was a surface with NO KEY -
nothing for a mechanism to match on:

    statements with no name       the top-level event listeners, including the
                                  single keyboard dispatcher
    markup with no id            structural divs; and containers, which the
                                  markup closer skipped wholesale
    declarations inside a rule    exempted whole because ONE of them differed
    blocks stepped over          @media and @keyframes, which the CSS scanner
                                  skips on purpose and nothing then looked inside

Every one was found by measuring rather than by reasoning about it, and every
one had a real fault in it. So the measuring is a script rather than an
afternoon: it asks the question of all 9,700 lines at once, and anything a
mechanism does not cover comes out the other end.

WHAT "COVERED" MEANS. A line is covered when some mechanism in
art/sync_local.py would carry a change to it from the online build to this one,
or would report it as an undocumented difference. It does NOT mean the line is
identical - INTERFACE entries are covered and deliberately differ.

READING THE OUTPUT. Comment prose and braces are counted apart from code: a
comment drifting is a documentation problem, not a bug, and close_comment_drift
already handles the ones attached to definitions. What matters is CODE with no
key, and the honest target for that number is zero, or a short list of lines
whose region explains them (the six tags of an HTML head, for instance).
"""
import io
import os
import re
import sys
from collections import Counter

NL = chr(10)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import sync_local as S          # noqa: E402
import extract_css as C         # noqa: E402


# Void elements have no closing tag; searching for one runs to the end of
# the document.
VOID_TAGS = ('input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'track')


def classify(dst, src):
    """(cover, spans, regions) for every line of dst."""
    lines = dst.splitlines()
    cover = [None] * len(lines)
    spans, idx = [], 0
    for k, l in enumerate(dst.splitlines(True)):
        spans.append((idx, idx + len(l), k))
        idx += len(l)

    def mark(lo, hi, tag):
        for a, b, k in spans:
            if a < hi and b > lo and cover[k] is None:
                cover[k] = tag

    a0, b0 = C.style_block(dst)
    # CSS rules, then the at-rule blocks the rule scanner steps over.
    for sel, _body, full in C.scan_rules(dst, a0, b0):
        i = dst.find(full)
        if i >= 0:
            mark(i, i + len(full), 'css')
    for _kind, _cond, text in S._at_blocks(dst[a0:b0]):
        i = dst.find(text)
        if i >= 0:
            mark(i, i + len(text), 'css-at-rule')

    # JS definitions, from the sync's own scanner so the two cannot disagree.
    hits = list(S._DEF_RE.finditer(dst))
    starts = [S.comment_start(dst, m.start()) for m in hits]
    for k, m in enumerate(hits):
        end = starts[k + 1] if k + 1 < len(hits) else len(dst)
        mark(starts[k], S.definition_span(dst, m.start(), end), 'js-definition')

    # Markup elements carrying an id.
    mk0 = dst.index('<body')
    mk1 = dst.index('<script', mk0)
    for m in re.finditer(r'<(\w+)([^>]*\bid="([a-zA-Z][\w-]*)"[^>]*)>', dst[mk0:mk1]):
        tag = m.group(1).lower()
        if tag in VOID_TAGS:
            mark(mk0 + m.start(), mk0 + m.end(), 'markup-id')
            continue
        # THE WHOLE SUBTREE. markup_container_drift compares a shared
        # container's entire subtree against the other build's and names any
        # difference at any similarity, so every line inside one is keyed.
        # Crediting only the opening tag under-reported this by ~170 lines.
        depth, i = 1, mk0 + m.end()
        rx = re.compile(r'<(/?)' + re.escape(tag) + r'\b')
        while depth and i < mk1:
            mm = rx.search(dst, i, mk1)
            if not mm:
                break
            depth += -1 if mm.group(1) else 1
            i = mm.end()
        mark(mk0 + m.start(), i, 'markup-subtree')

    # The document head, compared as a region by head_drift.
    for t in S.head_lines(dst):
        i = dst.find(t)
        if i >= 0:
            mark(i, i + len(t), 'head-region')

    # Top-level statements the statement-set guard compares as a whole region.
    # Brace-matched blocks are one normalised statement, so find the opener and
    # span to the end of the block rather than looking for the joined text.
    for t in S.top_level_statements(dst):
        first = t.split(' ')[0]
        i = dst.find(NL + first)
        while i >= 0:
            j = dst.find(NL, i + 1)
            depth = 0
            k2 = i + 1
            while k2 < len(dst):
                if dst[k2] in '([{':
                    depth += 1
                elif dst[k2] in ')]}':
                    depth -= 1
                elif dst[k2] == ';' and depth <= 0:
                    break
                k2 += 1
            mark(i + 1, max(j, k2) + 1, 'statement-set')
            break

    # Top-level listeners and button wiring.
    for bodies in S.listeners(dst).values():
        for body in bodies:
            i = dst.find(body)
            if i >= 0:
                mark(i, i + len(body), 'listener')
    # BRACE-MATCHED, not "up to the first semicolon". A click handler written as
    # a multi-line arrow has semicolons inside it, so stopping at the first one
    # left its whole body looking unkeyed and inflated this report by ~90 lines.
    for m in re.finditer(r"(?m)^document\.getElementById\('([^']+)'\)", dst):
        # Match from addEventListener's own paren, not from the start of the
        # line: the first balanced pair is getElementById('x') itself, so
        # matching from there broke immediately and left every multi-line
        # handler body looking unkeyed.
        call = dst.find('addEventListener(', m.start())
        stop = dst.find(chr(10), m.start())
        if call < 0 or (stop > 0 and call > stop + 200):
            j = dst.find(';', m.end())
            mark(m.start(), j + 1 if j > 0 else m.end(), 'wiring')
            continue
        depth, i = 0, dst.index('(', call)
        while i < len(dst):
            if dst[i] in '([{':
                depth += 1
            elif dst[i] in ')]}':
                depth -= 1
                if depth == 0:
                    break
            i += 1
        j = dst.find(';', i)
        mark(m.start(), j + 1 if j > 0 else i + 1, 'wiring')

    def region(k):
        off = spans[k][0]
        if off < a0:
            return 'head'
        if off < b0:
            return 'style'
        if off < mk0:
            return 'gap'
        if off < mk1:
            return 'markup'
        return 'script'

    return lines, cover, region


def kind_of(lines, k, in_block):
    """'comment', 'brace' or 'code', tracking /* */ and <!-- --> across lines."""
    t = lines[k].strip()
    if in_block:
        return 'comment', not (('*/' in t) or ('-->' in t))
    if t.startswith('//'):
        return 'comment', False
    if t.startswith('/*') or t.startswith('<!--'):
        closed = ('*/' in t[2:]) or ('-->' in t)
        return 'comment', not closed
    if t in ('}', '};', '});', ')', ');', '{', '</script>', '<script>', '</style>'):
        return 'brace', False
    return 'code', False


def main():
    dst = io.open(os.path.join(ROOT, 'local', 'index.html'), encoding='utf-8').read()
    src = io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    lines, cover, region = classify(dst, src)
    src_lines = set(l.strip() for l in src.splitlines() if l.strip())

    by_tag = Counter(t or 'NOTHING' for t in cover)
    print('local build: %d lines' % len(lines))
    for tag, n in by_tag.most_common():
        print('   %-16s %5d' % (tag, n))

    # Only DUPLICATED lines matter: a line unique to this build cannot need
    # fixing in two places.
    unkeyed, in_block = [], False
    for k in range(len(lines)):
        kind, in_block = kind_of(lines, k, in_block)
        if cover[k] is not None or not lines[k].strip():
            continue
        if lines[k].strip() not in src_lines:
            continue
        unkeyed.append((k, region(k), kind))

    print()
    print('duplicated lines with NO key: %d' % len(unkeyed))
    for kind, n in Counter(x[2] for x in unkeyed).most_common():
        print('   %-16s %5d' % (kind, n))
    code = [x for x in unkeyed if x[2] == 'code']
    print()
    print('CODE with no key: %d' % len(code))
    for reg, n in Counter(x[1] for x in code).most_common():
        print('   %-16s %5d' % (reg, n))

    if '--lines' in sys.argv:
        print()
        for k, reg, _ in code:
            print('   [%-6s] %s' % (reg, lines[k].strip()[:100]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
