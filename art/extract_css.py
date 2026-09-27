# -*- coding: utf-8 -*-
"""Move the CSS both builds share into shared/ui.css.

The JavaScript side of this project has 480 shared definitions and a sync that
refuses to ship drift. The CSS had NONE: every rule was duplicated text in two
files, 326 rules against 280, and twenty selectors had already drifted apart.

That is not a tidiness problem. It is where the last two reported bugs came
from: ensureModalClose was shared and its `.modal-x` styling was not, so the
close button rendered as a full-width cyan bar; and the `.opt` settings rows
had to be ported by hand, after a shared function had already started writing
into markup that did not exist yet. Behaviour travelled and appearance did not.

WHAT MOVES, and why it is split by DECLARATION rather than by rule:

  * A rule identical in both builds moves whole.
  * A rule that differs keeps its shared DECLARATIONS in the shared file and
    leaves only what each build genuinely overrides. `.shop-card` has three
    declarations in common and three of its own on each side; `#shop-screen`
    has seven in common. Moving only whole rules would have left all of that
    duplicated.

CSS does the merging that JavaScript needed stubs and a build profile for: the
shared sheet loads first and a build writes only what it overrides.

THE RISK, and it is real: this MOVES RULES IN THE CASCADE. Two rules of equal
specificity are decided by order, so a rule that wins at line 900 can start
losing when it moves into a file that loads first. This project has already
shipped one of those - `.menu-section button` beating a bare `.modal-x`, giving
a close button 1040px wide.

Two things guard against that, and it is worth being exact about which does the
work. A selector that appears TWICE in one build is skipped outright - that is a
deliberate order-dependent override and moving either half would break it. But
NO static check here proves the general case: different selectors can tie on
specificity, and deciding which pairs can match the same element is most of a
CSS engine.

So the guarantee is empirical, not analytical. tests/cssparitycheck.js records
what the browser COMPUTES for 1,349 elements across seven screens at three
widths, before and after. Comparing the result rather than the rules is the
point: it does not care how the CSS is organised, only whether the page still
looks the same.

    python art/extract_css.py --dry-run
    python art/extract_css.py
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ONLINE = os.path.join(ROOT, 'index.html')
LOCAL = os.path.join(ROOT, 'local', 'index.html')
OUT = os.path.join(ROOT, 'shared', 'ui.css')

# A SCANNER, not a regex. The first attempt matched `^ {8}selector {`, and a
# multi-line selector defeated it:
#
#     #settings-screen, #audio-screen, #rebind-screen, #tutorial-screen,
#     #mapselect-screen, #modeselect-screen, #shop-screen, #lobby-screen {
#
# The CONTINUATION line looks exactly like a complete rule, so its
# declarations moved to the shared file under a TRUNCATED selector and the
# first four screens silently lost their padding and overflow.
# tests/cssparitycheck.js caught it by measuring; a regex was never going to.


def style_block(text):
    """The page's first <style> block, as (start, end) offsets."""
    i = text.index('<style>')
    j = text.index('</style>', i)
    return i + len('<style>'), j


WS = ' \t\r\n'


def scan_rules(text, lo, hi):
    """Top-level rules in [lo, hi): (selector, body, full_text).

    @media, @keyframes and anything else nested are STEPPED OVER whole. A
    rule inside one applies conditionally, and lifting it out changes WHEN it
    applies - which is how the first attempt made an `overflow: visible` rule
    belonging to a narrow window start applying at every width.
    """
    out = []
    i = lo
    sel_start = None
    while i < hi:
        c = text[i]
        if text.startswith('/*', i):
            j = text.find('*/', i + 2)
            j = hi if j < 0 else j + 2
            # A comment before any selector text is not part of a selector.
            if sel_start is not None and not text[sel_start:i].strip(WS):
                sel_start = None
            i = j
            continue
        if c in WS:
            i += 1
            continue
        if sel_start is None:
            sel_start = i
        if c == '{':
            selector = text[sel_start:i]
            if selector.lstrip().startswith('@'):
                depth, j = 1, i + 1
                while j < hi and depth:
                    if text[j] == '{':
                        depth += 1
                    elif text[j] == '}':
                        depth -= 1
                    j += 1
                i, sel_start = j, None
                continue
            j = text.find('}', i)
            if j < 0:
                break
            end = j + 1
            while end < hi and text[end] in ' \t':
                end += 1
            if end < hi and text[end] == chr(10):
                end += 1
            out.append((' '.join(selector.split()), text[i + 1:j],
                        text[sel_start:end]))
            i, sel_start = end, None
            continue
        i += 1
    return out


def parse(text):
    """selector -> (declarations, full match text), in document order."""
    a, b = style_block(text)
    out, order = {}, []
    for sel, body, full in scan_rules(text, a, b):
        if sel in out:          # same selector twice: order matters, skip both
            out[sel] = None
            continue
        out[sel] = (split_decls(body), full)
        order.append(sel)
    return {k: v for k, v in out.items() if v}, order


def split_decls(body):
    """Declarations, comments kept with the declaration they follow."""
    out, buf, depth = [], '', 0
    i = 0
    while i < len(body):
        c = body[i]
        if body.startswith('/*', i):
            j = body.find('*/', i + 2)
            j = len(body) if j < 0 else j + 2
            buf += body[i:j]
            i = j
            continue
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
        if c == ';' and depth == 0:
            if buf.strip():
                out.append(buf.strip())
            buf = ''
        else:
            buf += c
        i += 1
    if buf.strip():
        out.append(buf.strip())
    return out


def norm(d):
    """A declaration with its comments and spacing removed, for comparing."""
    d = re.sub(r'/\*.*?\*/', '', d, flags=re.S)
    return ' '.join(d.split()).rstrip(';')


def main():
    dry = '--dry-run' in sys.argv
    on_text = io.open(ONLINE, encoding='utf-8').read()
    lo_text = io.open(LOCAL, encoding='utf-8').read()
    on, on_order = parse(on_text)
    lo, _ = parse(lo_text)

    # `on` has had duplicate selectors dropped (the same selector twice is a
    # deliberate order-dependent override), so a name in `on_order` is not
    # necessarily still in the table.
    both = [s for s in on_order if s in on and s in lo]

    moved_whole, moved_partial, skipped = [], [], []
    shared_rules = []
    for sel in both:
        on_d, on_full = on[sel]
        lo_d, lo_full = lo[sel]
        on_n = [norm(d) for d in on_d]
        lo_n = [norm(d) for d in lo_d]
        common = [d for d, n in zip(on_d, on_n) if n in lo_n]
        if not common:
            skipped.append((sel, 'nothing in common'))
            continue
        if on_n == lo_n:
            moved_whole.append(sel)
        else:
            moved_partial.append((sel, len(common), len(on_d) - len(common), len(lo_d) - len(common)))
        shared_rules.append((sel, common))

    print('%d selectors in both builds: %d move whole, %d move their shared '
          'declarations, %d skipped'
          % (len(both), len(moved_whole), len(moved_partial), len(skipped)))
    shared_decls = sum(len(c) for _, c in shared_rules)
    print('%d declarations move out of duplication' % shared_decls)
    if dry:
        for sel, same, oa, ob in moved_partial[:12]:
            print('   %-36s %d shared, %d online-only, %d local-only' % (sel[:36], same, oa, ob))
        return 0

    header = '''/* Astral Clash - the CSS both builds share.
 *
 * GENERATED by art/extract_css.py. Loaded by index.html and local/index.html
 * BEFORE each one's own <style>, so a build overrides simply by restating a
 * property - which is the merging that the JavaScript side needed a build
 * profile and stub functions to achieve.
 *
 * It exists because behaviour was being shared and appearance was not.
 * ensureModalClose moved to shared/ and its `.modal-x` styling did not, so the
 * close button rendered as a full-width cyan bar; the `.opt` settings rows had
 * to be ported by hand after a shared function was already writing into markup
 * that did not exist. Both were the same bug wearing different clothes.
 *
 * Rules that could TIE on specificity with a rule left behind are deliberately
 * not here: equal specificity is decided by order, and moving a rule into a
 * file that loads first changes the order. tests/cssparitycheck.js is what
 * proves nothing moved - it compares what the browser computes for 1,349
 * elements across seven screens at three widths.
 */
'''
    body = []
    for sel, decls in shared_rules:
        body.append('%s {\n%s\n}\n' % (sel, '\n'.join('    %s;' % d for d in decls)))
    io.open(OUT, 'w', encoding='utf-8', newline='').write(header + '\n' + '\n'.join(body))
    print('wrote shared/ui.css (%d rules, %d declarations)' % (len(shared_rules), shared_decls))

    # Rewrite each build: drop what moved, keep what it genuinely overrides.
    for path, table, text in ((ONLINE, on, on_text), (LOCAL, lo, lo_text)):
        new = text
        removed = 0
        for sel, common in shared_rules:
            decls, full = table[sel]
            common_n = {norm(d) for d in common}
            keep = [d for d in decls if norm(d) not in common_n]
            indent = re.match(r'\s*', full).group(0)
            if keep:
                repl = '%s%s {\n%s\n%s}\n' % (indent, sel,
                                              '\n'.join('%s    %s;' % (indent, d) for d in keep),
                                              indent)
            else:
                repl = ''
            assert new.count(full) == 1, '%s: %r appears %d times' % (path, sel, new.count(full))
            new = new.replace(full, repl, 1)
            removed += 1
        io.open(path, 'w', encoding='utf-8', newline='').write(new)
        print('  %-18s %d rules rewritten' % (os.path.basename(path), removed))
    return 0


if __name__ == '__main__':
    sys.exit(main())
