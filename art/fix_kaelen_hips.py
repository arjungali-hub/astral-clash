# -*- coding: utf-8 -*-
"""Take the flare off Kaelen's outer thighs.

    python art/fix_kaelen_hips.py            measure, change nothing
    python art/fix_kaelen_hips.py --write    rewrite assets/chars/kaelen.glb

Reported as "weird things on both sides of his hips sticking out". Two
explanations were checked and discarded before this one:

  * not the weapons - he carries exactly one, and it is under HandL
  * not a bolted-on armour plate - in the upper-thigh band only 8 of 324
    vertices sit outboard of 0.27, and the histogram of |x| is one smooth
    distribution rather than two clusters with a gap between them

It is the thigh itself. Measured half-widths down the right side:

    belt        y 1.02-1.12    0.228
    upper thigh y 0.86-0.96    0.286
    mid thigh   y 0.74-0.84    0.298     <- widest point of the whole leg
    above knee  y 0.60-0.70    0.244

So the leg swells about 25% wider than both the belt above it and the leg
below it, at exactly the height a viewer reads as the hip line, and the suit's
trim runs along the bulge and draws the eye straight to it. From a distance
that silhouette is a pair of flares sticking out either side.

WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT. Only the OUTBOARD side of
each leg moves: vertices inboard of the leg's own centre line are left where
they are, so the gap between the legs, the crotch and the inner surfaces are
untouched and the legs do not get thin. One centre line per side rather than a
per-slice one, and a smoothstep window in y, because both of those are
continuous - a centre that jumped from slice to slice would crease the surface
along a ring.

The arms hang through this exact height band and reach |x| 0.572, far outboard
of anything on the leg, so they are excluded by DOMINANT JOINT rather than by
position. Selecting on x alone would have planed the forearms down with it.
"""
import argparse
import os
import shutil
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_tool import Glb

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, '..', 'assets', 'chars', 'kaelen.glb')

# The window the narrowing applies over, in model units (the model is 1.899
# tall). Zero outside y0..y3, full strength across y1..y2, smoothstepped in
# between so there is no edge where the change starts.
Y0, Y1, Y2, Y3 = 0.62, 0.74, 0.96, 1.10
# How much of each vertex's outboard offset to take away at full strength.
# Chosen by measuring three, not by eye - the resulting right-side profile:
#
#     strength    belt   upper   mid   knee
#        0.25    0.218   0.251  0.260  0.241   bulge reduced, still there
#        0.35    0.214   0.238  0.245  0.241   mid thigh level with the knee
#        0.45    0.210   0.224  0.231  0.241   thigh now NARROWER than the
#                                              leg below it - taper inverted
#
# 0.35: the widest point of the leg stops being the hip line, and the leg runs
# straight from the belt to the knee. 0.45 fixes the flare by introducing the
# opposite deformity, which is why the strongest setting is not the best one.
STRENGTH = 0.35


def smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def window(y):
    """0 outside, 1 across the middle, smooth at both edges."""
    up = smoothstep((y - Y0) / (Y1 - Y0))
    down = 1.0 - smoothstep((y - Y2) / (Y3 - Y2))
    return np.minimum(up, down)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--strength', type=float, default=STRENGTH)
    args = ap.parse_args()

    g = Glb(MODEL)
    name, prim = g.skinned_primitive()
    pos = g.accessor(prim['attributes']['POSITION']).astype(np.float64)
    jn = g.joint_names()
    dj, _ = g.dominant_joint(prim)

    # The lower body only. Note these are the DOMINANT joints: a vertex the
    # hip and the thigh share goes with whichever holds more weight, which is
    # what keeps the junction between them continuous.
    lower = [i for i, n in enumerate(jn)
             if n.startswith('UpperLeg') or n.startswith('LowerLeg') or n == 'Hips']
    sel = np.isin(dj, lower)

    w = window(pos[:, 1]) * sel.astype(np.float64)
    moved = w > 1e-6
    print('model: %s   %d vertices' % (name, len(pos)))
    print('lower body: %d   inside the window: %d' % (sel.sum(), moved.sum()))

    new = pos.copy()
    for label, side in (('right', +1), ('left', -1)):
        on = sel & (np.sign(pos[:, 0]) == side) & (np.abs(pos[:, 0]) > 1e-6)
        band = on & (pos[:, 1] >= Y1) & (pos[:, 1] < Y2)
        if band.sum() < 20:
            print('  %-5s skipped - only %d vertices in the band' % (label, band.sum()))
            continue
        # THE LEG'S OWN AXIS, which is not the median of the selection.
        #
        # Taking the median of everything in `sel` put the centre at 0.061,
        # because that set includes the hips and the inner thigh, which crowd
        # around x=0 and drag a median straight through them. Scaling about
        # that point treats most of the limb as "outboard" and planes 32% off
        # it: the measured result was a mid thigh of 0.203 against a belt of
        # 0.228, which is not a fixed silhouette, it is a thin leg.
        #
        # The midpoint between the inner and outer SURFACES of this leg is the
        # actual axis, so take it from this side's thigh vertices alone and
        # from the two extremes rather than the bulk. One number for the whole
        # window, so the scaling stays continuous in y.
        # WHICH THIGH BONE IS ON THIS SIDE IS A QUESTION FOR THE GEOMETRY, not
        # for the name. Picking UpperLeg.R for x>0 put the right leg's centre
        # at -0.146 - the suffixes are the character's own left and right, so
        # they are mirrored against +x, and scaling about a centre on the far
        # side of the body planed 52% off the thigh. Take whichever thigh bone
        # actually has its vertices on this side.
        cands = [i for i, n in enumerate(jn) if n.startswith('UpperLeg')]
        thigh = [i for i in cands
                 if (dj == i).any() and np.sign(pos[dj == i, 0].mean()) == side]
        tb = np.isin(dj, thigh) & (pos[:, 1] >= Y1) & (pos[:, 1] < Y2)
        ref = pos[tb, 0] if tb.sum() >= 20 else pos[band, 0]
        cx = 0.5 * float(np.percentile(ref, 5) + np.percentile(ref, 95))
        spread = float(np.percentile(pos[band, 0] * side, 99))
        # Outboard only.
        out = on & moved & ((pos[:, 0] - cx) * side > 0)
        k = 1.0 - args.strength * w[out]
        new[out, 0] = cx + (pos[out, 0] - cx) * k
        print('  %-5s centre %+.3f  p99 %.3f  outboard vertices %d  max pull %.4f'
              % (label, cx, spread, out.sum(),
                 float(np.abs(pos[out, 0] - new[out, 0]).max())))

    def p99(lo, hi, p=pos):
        b = p[(p[:, 1] >= lo) & (p[:, 1] < hi) & sel & (p[:, 0] > 0)]
        return float(np.percentile(b[:, 0], 99)) if len(b) else float('nan')

    print('')
    print('%-13s %8s %8s' % ('right side p99', 'before', 'after'))
    for label, lo, hi in (('belt       ', 1.02, 1.12),
                          ('upper thigh', 0.86, 0.96),
                          ('mid thigh  ', 0.74, 0.84),
                          ('above knee ', 0.60, 0.70)):
        print('%-13s %8.3f %8.3f' % (label, p99(lo, hi), p99(lo, hi, new)))

    # Nothing outside the lower body may move, at all. This is the assertion
    # that would have caught selecting on x and taking the forearms with it.
    untouched = ~sel
    delta = np.abs(new - pos).max(axis=1)
    assert delta[untouched].max() == 0.0, 'something outside the lower body moved'
    assert delta[sel & (pos[:, 1] > Y3)].max() == 0.0, 'moved above the window'
    assert delta[sel & (pos[:, 1] < Y0)].max() == 0.0, 'moved below the window'
    print('')
    print('largest single vertex move: %.4f  (%.2f%% of body height)'
          % (delta.max(), 100.0 * delta.max() / (pos[:, 1].max() - pos[:, 1].min())))

    if not args.write:
        print('')
        print('measured only. pass --write to rewrite the model.')
        return

    # The backup goes in art/raw/, NOT beside the model. Everything under
    # assets/ is served, so a .orig next to it would ship two megabytes of
    # dead weight to every visitor; art/raw/*.glb is git-ignored and is
    # already where the other intermediates live. Git has the original too -
    # `git show HEAD:assets/chars/kaelen.glb` - so this is a convenience for
    # re-running with a different strength, not the only copy.
    backup = os.path.join(HERE, 'raw', 'kaelen.rigged.orig.glb')
    if not os.path.exists(backup):
        shutil.copyfile(MODEL, backup)
        print('kept the original at art/raw/%s' % os.path.basename(backup))
    g.write_positions(prim, new)
    g.write_vec3(prim, 'NORMAL', g.recompute_normals(prim, new))
    total = g.save(MODEL)
    print('wrote %s  (%d KB)' % (MODEL, total // 1024))


if __name__ == '__main__':
    main()
