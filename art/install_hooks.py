# -*- coding: utf-8 -*-
"""Install the repo's git hooks into .git/hooks.

.git/hooks is not tracked, so a hook committed to the repo does nothing until
somebody copies it into place. This is that copy, kept as a script rather than a
line in a README because an instruction nobody runs is the same as no hook.

    python art/install_hooks.py

What it installs: a pre-commit hook that refuses a commit whose local build is
stale. See art/hooks/pre-commit for why that particular failure is worth a hard
stop - it is a memory lapse rather than a code defect, so no amount of care in
the sync script can catch it.
"""
import io
import os
import shutil
import stat
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art', 'hooks')
DST = os.path.join(ROOT, '.git', 'hooks')


def main():
    if not os.path.isdir(DST):
        print('no .git/hooks here - is this a git checkout?')
        return 1
    installed = []
    for name in sorted(os.listdir(SRC)):
        src, dst = os.path.join(SRC, name), os.path.join(DST, name)
        if os.path.exists(dst) and io.open(dst, encoding='utf-8').read() == \
                io.open(src, encoding='utf-8').read():
            print('  %-14s already current' % name)
            continue
        shutil.copyfile(src, dst)
        # Git runs the hook directly, so it has to be executable even on
        # Windows, where the shell that runs it honours the bit.
        os.chmod(dst, os.stat(dst).st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
        installed.append(name)
        print('  %-14s installed' % name)
    if installed:
        print('\n%d hook(s) installed into .git/hooks' % len(installed))
    return 0


if __name__ == '__main__':
    sys.exit(main())
