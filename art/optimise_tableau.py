# -*- coding: utf-8 -*-
"""Ship the loading tableau as WebP, not as a 3.8 MB PNG.

    python art/optimise_tableau.py

WHY THIS EXISTS. Reported: "the loading screen takes too long to load
(ironic). For the majority of the time you are waiting, it shows the blank
screen with glowing lights in the background, and only shows the actual screen
for a fraction of a second before the game loads."

That is exactly what was happening, and the cause is the loading screen's own
artwork. `.ld-art` carries a 1920x1080 PNG of 3,772 KB, and the browser does
not begin fetching it until the loading screen is first displayed - that is the
moment the element enters layout. So the vignette and the two radial-gradient
fighter glows (.ld-glowA / .ld-glowB) paint instantly, you watch those while
several megabytes arrive, and the tableau lands just as the match finishes
loading and the screen is dismissed. The loading screen was waiting on itself.

The PNG stays as the master: art/render_tableau.js renders it out of the game
so the loading screen shows the actual fighters, arena and lighting, and
re-running that script is how the art follows the game. This converts that
master into what actually ships.

WHY WEBP, AND WHY NOT JPEG. Measured on the real file:

    original PNG RGBA   3,772 KB
    JPEG q88              333 KB   11.3x
    WebP q86              196 KB   19.2x
    PNG RGB optimised   2,086 KB    1.8x

WebP wins by a wide margin, and support is not a concern: the game already
requires WebGL 2 and ships a .woff2 font, both of which land in browsers no
earlier than WebP did.

The alpha channel is dropped because it carries nothing - every pixel is
opacity 255, verified rather than assumed. It was pure file size.

Quality 86 rather than something higher because of where the image ends up:
inset 14% from each side, at opacity .92, beneath a vignette and two blurred
radial glows. There is nowhere for a compression artefact to be visible.
"""
import io
import os
import sys

try:
    from PIL import Image
except ImportError:
    print('Pillow is needed: python -m pip install Pillow')
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'loading-tableau.png')
DST = os.path.join(ROOT, 'assets', 'loading-tableau.webp')

QUALITY = 86


def main():
    if not os.path.exists(SRC):
        print('missing master: %s' % SRC)
        print('run art/render_tableau.js first - it renders the tableau out of the game')
        return 1

    im = Image.open(SRC)
    before = os.path.getsize(SRC)

    # STATED, not assumed. If a future tableau genuinely uses transparency this
    # should say so rather than silently flatten it onto black.
    if im.mode in ('RGBA', 'LA'):
        lo, hi = im.getchannel('A').getextrema()
        if lo != 255:
            print('WARNING: this tableau has real transparency (alpha from %d).' % lo)
            print('Flattening it would change the image. Check the loading screen after.')
        im = im.convert('RGB')
    else:
        im = im.convert('RGB')

    im.save(DST, 'WEBP', quality=QUALITY, method=6)
    after = os.path.getsize(DST)

    print('%s  %dx%d' % (os.path.basename(SRC), im.size[0], im.size[1]))
    print('  master   %7.0f KB  (PNG, kept as the source of truth)' % (before / 1024.0))
    print('  shipped  %7.0f KB  (WebP q%d, %.1fx smaller)'
          % (after / 1024.0, QUALITY, float(before) / after))
    return 0


if __name__ == '__main__':
    sys.exit(main())
