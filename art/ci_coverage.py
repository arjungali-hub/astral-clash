# -*- coding: utf-8 -*-
"""Every checker is named in a CI job, and every name in a CI job is a checker.

WHY THIS EXISTS. The workflow lists its checkers by hand, in four places: the
fast group and three sharded `tests:` lines. A new checker is therefore only run
if somebody remembers to add it - and fpscapcheck was written, committed and
would have sat there untouched, because nothing anywhere compares the list of
files to the list of names. With fifty checkers, one quietly dropping out of a
shard looks exactly like a suite that passes.

It checks both directions, because both have a failure mode:

  * a FILE WITH NO MENTION never runs. The suite still goes green, and the
    thing it was written to catch comes back.
  * a MENTION WITH NO FILE is a name that was renamed or deleted. run.js is
    asked for a checker that does not exist, and depending on how it handles
    that, the job either fails for a confusing reason or silently runs one
    fewer than it reports.

No browser and no node, so it belongs with the guards. Run:

    python art/ci_coverage.py
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKFLOW = os.path.join(ROOT, '.github', 'workflows', 'ci.yml')
TESTS = os.path.join(ROOT, 'tests')

# Not checkers: the harness, the mop, the runner. Same list run.js keeps, and
# for the same reason - these are machinery, not assertions.
NOT_TESTS = {'harness.js', 'cleanup.js', 'run.js'}


def checker_files():
    out = set()
    for name in sorted(os.listdir(TESTS)):
        if not name.endswith('.js') or name in NOT_TESTS:
            continue
        out.add(name[:-3])
    return out


def mentioned():
    """Every bare word on a line that invokes run.js, or continues one.

    The workflow writes these as shell continuations, so a `tests:` matrix
    value and a backslash-continued `node tests/run.js ...` both end up as
    runs of plain words. Anything with a slash, a dollar or a dash is shell
    rather than a checker name.
    """
    text = io.open(WORKFLOW, encoding='utf-8').read()
    names = set()
    for block in re.findall(r'(?:node tests/run\.js|tests:)(.*?)(?:\n\s*\n|\n\S)',
                            text + '\n\n', re.S):
        # Strip the continuations and any flags, then take the words.
        block = block.replace('\\', ' ')
        block = re.sub(r'--jobs\s+\d+', ' ', block)
        block = re.sub(r'\$\{\{[^}]*\}\}', ' ', block)
        for word in re.findall(r'[A-Za-z0-9_.-]+', block):
            if word.endswith('check') or word == 'smoke':
                names.add(word)
    return names


def main():
    files = checker_files()
    named = mentioned()

    unrun = sorted(files - named)
    missing = sorted(named - files)

    for n in unrun:
        print('UNRUN     tests/%s.js exists but no CI job names it' % n)
    for n in missing:
        print('NO FILE   CI names "%s" but tests/%s.js does not exist' % (n, n))

    print('%d checkers, %d named in CI, %d unrun, %d named without a file'
          % (len(files), len(named), len(unrun), len(missing)))

    if unrun or missing:
        print('')
        print('Add a new checker to one of the lists in .github/workflows/ci.yml:')
        print('  the fast group for anything that needs no browser or one quick page,')
        print('  or a slow shard (heavy / match / rest) for anything that plays a match.')
        return 1
    print('every checker runs somewhere')
    return 0


if __name__ == '__main__':
    sys.exit(main())
