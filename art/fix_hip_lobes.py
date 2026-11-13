# -*- coding: utf-8 -*-
"""Take the lobes off a fighter's hips, and give the legs back to the legs.

    python art/fix_hip_lobes.py kaelen            measure, change nothing
    python art/fix_hip_lobes.py kaelen --write    rewrite assets/chars/kaelen.glb
    python art/fix_hip_lobes.py --all             measure every fighter

Reported twice as "things sticking out of his hips". The first fix
(art/fix_kaelen_hips.py, since removed) got the right place and the wrong
thing, and it is worth saying exactly how, because its reasoning was careful
and its measurements were true:

  It measured the thigh's width band by band and found the leg swelling 25%
  wider than the belt above it. To keep the forearms - which hang through the
  same height - out of that measurement, it excluded every vertex whose
  DOMINANT JOINT was an arm bone. Then it narrowed the outer thigh by 35%.

  The lobes ARE the vertices it excluded. They are part of the body - connected
  to the legs, nowhere near connected to the arms - and they are weighted to
  the forearm and hand bones, because that is what was nearest when the model
  was auto-weighted. So the filter that was meant to keep the arms out removed
  the defect from its own measurement, the script planed down a thigh that had
  nothing wrong with it, and the lobes stayed exactly where they were.

WHAT THEY ARE. Stubs. The generated model had its hands resting against its
thighs; separating them left a lump on each thigh where the hand had been
fused on, about a hundred vertices a side, standing out from the leg's real
outline at |x| 0.25 to as far as 0.39. Being weighted to the arm, each lump
also MOVES with the forearm, which is why it reads as something attached to
him rather than as part of his leg.

HOW ARM IS TOLD FROM LEG, since neither obvious test works. Not by weight -
the weights are what is wrong. Not by position - the hands hang against the
thighs, and there is no gap in x to cut along. By CONNECTIVITY: cut the mesh
off below the armpits and see what is still joined to what. The legs hang from
the hips; the arms hang from nothing. Kaelen falls into one piece holding both
feet and two holding a hand each, and that is a fact about the mesh that no
weight and no pose can change.

WHAT THIS DOES
  1. Finds the lobes: vertices of the BODY piece that stand outside the leg's
     own outline (the outline being drawn from vertices no arm bone touches).
  2. Relaxes them - each to the average of its neighbours, with the ring where
     the lump meets the thigh held still. That is a soap film stretched over
     the hole the lump was covering: the lump becomes a patch of thigh.
  3. Takes every arm bone off every body vertex below the cut, and every leg
     and hip bone off every arm vertex, renormalising what is left. A vertex
     left with nothing takes the weights of its nearest clean neighbour.

AND WHAT IT DELIBERATELY DOES NOT. Nothing above the cut is touched: at the
shoulder an arm bone on a chest vertex is not a defect, it is a shoulder.
"""
import argparse
import glob
import os
import shutil
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_tool import Glb, COMPONENT

HERE = os.path.dirname(os.path.abspath(__file__))
CHARS = os.path.join(HERE, '..', 'assets', 'chars')

ARM = ('Shoulder', 'UpperArm', 'LowerArm', 'Hand')
LEG = ('Hips', 'UpperLeg', 'LowerLeg', 'Foot')

# The highest cut at which the hands are not joined to the feet, searched
# downward from the armpit. Fractions of the model's height.
CUTS = [0.74, 0.72, 0.70, 0.68, 0.66, 0.64, 0.62, 0.60, 0.58, 0.56]
# THE LEG'S OUTLINE IS DRAWN FROM VERTICES A LEG BONE DOMINATES - not from
# vertices free of arm weight, which was this script's own first attempt and
# its own first wrong answer. A trace of arm weight covers most of the outer
# thigh (2,117 body vertices on Kaelen), so "free of it" described a leg 0.15
# wide where the real edge is 0.25, and the lobe search then swallowed 530
# vertices, most of them honest thigh. Dominance is the test that survives the
# bleed: the true surface is still mostly the leg's, and only the stubs - which
# were fused to a hand - are mostly an arm's.
# How far outside the leg's clean outline a vertex has to stand before it is
# part of a lobe, as a fraction of the model's height. Kaelen's lobes clear
# the outline by up to 0.07; the surface noise of an honest thigh is under
# 0.004.
MARGIN = 0.010
# Lobes are looked for from here down to where the hanging arm ends.
BAND_TOP = 0.57
RELAX_PASSES = 400


class Model(object):
    def __init__(self, path):
        self.path = path
        self.g = Glb(path)
        _name, self.prim = self.g.skinned_primitive()
        at = self.prim['attributes']
        self.pos = self.g.accessor(at['POSITION']).astype(np.float64)
        self.J = self.g.accessor(at['JOINTS_0']).astype(np.int64)
        self.W = self.g.accessor(at['WEIGHTS_0']).astype(np.float64)
        w_acc = self.g.json['accessors'][at['WEIGHTS_0']]
        self.w_scale = 1.0
        if w_acc['componentType'] != 5126:
            self.w_scale = float(np.iinfo(COMPONENT[w_acc['componentType']]).max)
            self.W = self.W / self.w_scale
        self.tri = self.g.accessor(self.prim['indices']).reshape(-1).astype(np.int64).reshape(-1, 3)
        self.names = self.g.joint_names()
        self.arm_j = np.array([n.split('.')[0] in ARM for n in self.names])
        self.leg_j = np.array([n.split('.')[0] in LEG for n in self.names])
        top = self.J[np.arange(len(self.J)), np.argmax(self.W, axis=1)]
        self.arm_dom = self.arm_j[top]          # an arm bone holds most of it
        self.y0 = self.pos[:, 1].min()
        self.H = self.pos[:, 1].max() - self.y0
        # A glb splits a vertex wherever its UV or normal changes; connectivity
        # and smoothing both want the surface, not the seams.
        key = np.round(self.pos / (self.H * 1e-5)).astype(np.int64)
        _u, weld = np.unique(key, axis=0, return_inverse=True)
        self.weld = weld.reshape(-1)
        self.nw = int(self.weld.max()) + 1

    def frac(self, y):
        return (y - self.y0) / self.H

    def share(self, mask):
        """Per vertex: how much of its weight sits on the joints in `mask`."""
        return np.where(mask[self.J], self.W, 0.0).sum(axis=1)

    def pieces(self):
        """(cut, body, arm): the body and arm vertices below the highest cut
        that separates them, or (None, None, None) if nothing does."""
        for cut in CUTS:
            parent = np.arange(self.nw)

            def find(a):
                while parent[a] != a:
                    parent[a] = parent[parent[a]]
                    a = parent[a]
                return a
            below = self.frac(self.pos[:, 1]) < cut
            keep = below[self.tri].all(axis=1)
            for a, b, c in self.weld[self.tri[keep]]:
                ra, rb = find(a), find(b)
                if ra != rb:
                    parent[rb] = ra
                ra, rc = find(a), find(c)
                if ra != rc:
                    parent[rc] = ra
            root = np.array([find(w) for w in self.weld])
            feet = set(root[below & (self.frac(self.pos[:, 1]) < 0.10)])
            reach = np.abs(self.pos[below, 0]).max()
            hands = set(root[below & (np.abs(self.pos[:, 0]) > 0.92 * reach)])
            if feet & hands:
                continue
            body = below & np.isin(root, list(feet))
            arm = below & np.isin(root, list(hands))
            return cut, body, arm
        return None, None, None

    def outline(self, body):
        """The leg's own half-width at each height, per side, from vertices a
        leg bone dominates. Returns a function (y_fraction, side) -> |x|."""
        clean = body & ~self.arm_dom
        f = self.frac(self.pos[:, 1])
        edges = np.linspace(0.0, 0.80, 81)
        table = {}
        for side in (1, -1):
            sel = clean & (np.sign(self.pos[:, 0]) == side)
            widths = np.zeros(len(edges) - 1)
            for i in range(len(edges) - 1):
                m = sel & (f >= edges[i] - 0.01) & (f < edges[i + 1] + 0.01)
                widths[i] = np.abs(self.pos[m, 0]).max() if m.any() else 0.0
            table[side] = widths

        def at(yf, side):
            i = np.clip(np.searchsorted(edges, yf, side='right') - 1, 0, len(edges) - 2)
            return table[1][i] if side > 0 else table[-1][i]
        return at

    def lobes(self, body, arm):
        """Welded ids of the lobe vertices, and of the ring that holds them."""
        outline = self.outline(body)
        f = self.frac(self.pos[:, 1])
        side = np.sign(self.pos[:, 0])
        out = np.array([outline(f[i], side[i]) for i in range(len(self.pos))])
        beyond = np.abs(self.pos[:, 0]) - out
        low = self.frac(self.pos[arm, 1].min()) - 0.04 if arm.any() else 0.36
        band = body & (f > low) & (f < BAND_TOP)
        seed = band & (beyond > MARGIN * self.H) & self.arm_dom
        if not seed.any():
            return np.zeros(self.nw, bool), np.zeros(self.nw, bool), beyond
        # Edges of the welded surface, restricted to the body piece.
        nbr = [set() for _ in range(self.nw)]
        for a, b, c in self.weld[self.tri]:
            nbr[a].update((b, c)); nbr[b].update((a, c)); nbr[c].update((a, b))
        self.nbr = nbr
        in_band = np.zeros(self.nw, bool)
        in_band[self.weld[band]] = True
        w_beyond = np.full(self.nw, -1e9)
        np.maximum.at(w_beyond, self.weld, beyond)
        region = np.zeros(self.nw, bool)
        region[self.weld[seed]] = True
        # Grow down the lump to its base: neighbours that still stand outside
        # the outline, by more than surface noise, are part of it.
        floor = 0.25 * MARGIN * self.H
        frontier = set(np.flatnonzero(region))
        while frontier:
            nxt = set()
            for v in frontier:
                for n in nbr[v]:
                    if not region[n] and in_band[n] and w_beyond[n] > floor:
                        region[n] = True
                        nxt.add(n)
            frontier = nxt
        ring = np.zeros(self.nw, bool)
        for v in np.flatnonzero(region):
            for n in nbr[v]:
                if not region[n]:
                    ring[n] = True
        return region, ring, beyond

    def relax(self, region):
        """A soap film over the hole: every lobe vertex to the mean of its
        neighbours, the ring fixed, until it stops moving."""
        wpos = np.zeros((self.nw, 3))
        wpos[self.weld] = self.pos
        ids = np.flatnonzero(region)
        lists = [np.array(sorted(self.nbr[v])) for v in ids]
        for _ in range(RELAX_PASSES):
            new = np.array([wpos[l].mean(axis=0) for l in lists])
            wpos[ids] = new
        moved = region[self.weld]
        out = self.pos.copy()
        out[moved] = wpos[self.weld[moved]]
        return out, moved

    def normals_for(self, pos, touched):
        """Normals from the WELDED surface, written only where something
        moved. Recomputing per glb vertex would give the two halves of every
        UV seam different normals and draw the seams as creases."""
        tri = self.weld[self.tri]
        wpos = np.zeros((self.nw, 3))
        wpos[self.weld] = pos
        fn = np.cross(wpos[tri[:, 1]] - wpos[tri[:, 0]], wpos[tri[:, 2]] - wpos[tri[:, 0]])
        acc = np.zeros((self.nw, 3))
        for k in range(3):
            np.add.at(acc, tri[:, k], fn)
        ln = np.linalg.norm(acc, axis=1, keepdims=True)
        ln[ln == 0] = 1.0
        acc /= ln
        nrm = self.g.accessor(self.prim['attributes']['NORMAL']).astype(np.float64)
        nrm[touched] = acc[self.weld[touched]]
        return nrm

    def reweigh(self, pos, body, arm):
        """Arm bones off the body, leg and hip bones off the arms."""
        J, W = self.J.copy(), self.W.copy()
        changed = 0
        for piece, forbidden in ((body, self.arm_j), (arm, self.leg_j)):
            bad = forbidden[J] & (W > 0)
            rows = piece & bad.any(axis=1)
            if not rows.any():
                continue
            changed += int(rows.sum())
            W[rows] = np.where(forbidden[J[rows]], 0.0, W[rows])
            left = W.sum(axis=1)
            orphan = rows & (left < 0.05)
            ok = rows & ~orphan
            W[ok] = W[ok] / left[ok][:, None]
            if orphan.any():
                # Nothing of its own left: take the nearest vertex of the same
                # piece that never had the problem.
                donors = np.flatnonzero(piece & ~bad.any(axis=1))
                for i in np.flatnonzero(orphan):
                    d = np.linalg.norm(pos[donors] - pos[i], axis=1)
                    k = donors[int(np.argmin(d))]
                    J[i], W[i] = self.J[k], self.W[k]
        J = np.where(W > 0, J, 0)
        return J, W, changed

    def write(self, pos, nrm, J, W, out_path):
        at = self.prim['attributes']
        self.g.write_positions(self.prim, pos)
        self.g.write_vec3(self.prim, 'NORMAL', nrm)
        for key, data in (('JOINTS_0', J), ('WEIGHTS_0', W * self.w_scale)):
            acc = self.g.json['accessors'][at[key]]
            dt = COMPONENT[acc['componentType']]
            base, stride = self.g.accessor_offset(at[key])
            raw = np.ascontiguousarray((np.rint(data) if dt != np.float32 else data).astype(dt))
            width = raw.shape[1] * raw.dtype.itemsize
            if stride == width:
                self.g.bin[base:base + raw.nbytes] = raw.tobytes()
            else:
                for i in range(len(raw)):
                    o = base + i * stride
                    self.g.bin[o:o + width] = raw[i].tobytes()
        return self.g.save(out_path)


def run(name, write, out_path=None, src=None):
    path = src or os.path.join(CHARS, name + '.glb')
    m = Model(path)
    cut, body, arm = m.pieces()
    if cut is None:
        print('%-10s the hands and the feet are one piece at every cut - not separable this way' % name)
        return False
    arm_share, leg_share = m.share(m.arm_j), m.share(m.leg_j)
    region, ring, beyond = m.lobes(body, arm)
    lobe = region[m.weld]
    worst = beyond[lobe].max() / m.H if lobe.any() else 0.0
    bled_body = int((body & (arm_share > 0.02)).sum())
    bled_arm = int((arm & (leg_share > 0.02)).sum())
    print('%-10s cut %2.0f%%  body %5d  arms %5d | lobes: %4d vertices, standing out up to %.3f of height'
          ' | arm weight on body: %4d, leg weight on arms: %4d' % (
              name, cut * 100, body.sum(), arm.sum(), lobe.sum(), worst, bled_body, bled_arm))
    if lobe.any():
        for side, tag in ((1, 'left  (+x)'), (-1, 'right (-x)')):
            s = lobe & (np.sign(m.pos[:, 0]) == side)
            if s.any():
                print('             %s %4d vertices, |x| up to %.3f, y %2.0f%%..%2.0f%%' % (
                    tag, s.sum(), np.abs(m.pos[s, 0]).max(),
                    m.frac(m.pos[s, 1].min()) * 100, m.frac(m.pos[s, 1].max()) * 100))
    if not write:
        return True
    pos = m.pos
    touched = np.zeros(len(pos), bool)
    if lobe.any():
        pos, moved = m.relax(region)
        touched = moved | ring[m.weld]
        after = np.abs(pos[moved, 0]).max()
        print('             relaxed: widest lobe vertex |x| %.3f -> %.3f' % (np.abs(m.pos[moved, 0]).max(), after))
    nrm = m.normals_for(pos, touched)
    J, W, changed = m.reweigh(pos, body, arm)
    dest = out_path or path
    if dest == path:
        backup = path + '.bak'
        if not os.path.exists(backup):
            shutil.copyfile(path, backup)
    total = m.write(pos, nrm, J, W, dest)
    print('             reweighed %d vertices; wrote %s (%d bytes)' % (changed, os.path.relpath(dest), total))
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('name', nargs='?')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--src', help='read this .glb instead of assets/chars/<name>.glb')
    ap.add_argument('--out', help='write here instead of over the source')
    a = ap.parse_args()
    if a.all:
        for p in sorted(glob.glob(os.path.join(CHARS, '*.glb'))):
            run(os.path.basename(p)[:-4], False)
        return 0
    if not a.name:
        ap.error('name a fighter, or --all')
    return 0 if run(a.name.lower(), a.write, a.out, a.src) else 1


if __name__ == '__main__':
    sys.exit(main())
