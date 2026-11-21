# -*- coding: utf-8 -*-
"""The menu clips - Victory, Defeat, Ready - written into every fighter's .glb.

    python art/menu_clips.py                              all fourteen, in place
    python art/menu_clips.py --preview kaelen OUT.glb     one copy, elsewhere

WHAT THEY ARE FOR. The six clips every fighter was built with - Idle, Walk,
Run, Jump, Hit, Death - are a fight's. The menus borrowed two of them: a
winner celebrated with Jump, a loser lay down with Death, and a fighter
answered a lock-in with Jump again. These are the menus' own:

    Victory   the results screen's winner. Loops, as a winner's does in every
              game that has one: a fist thrown up, a crouched double "yes!",
              again, then held high with the head turned to you.
    Defeat    the results screen's loser. Once, then held: a stagger, the
              knees go, and the head drops. Not dead - beaten.
    Ready     a lock-in on the select screen. Once: a wind-up, a strike, and a
              guard held up by the chin, before the stage settles into Idle.

WHY NOT BLENDER'S EXPORTER. These models were generated, rigged and exported
once (art/pipeline.py), then edited in place since (art/fix_hip_lobes.py). A
round trip through Blender's importer and exporter would rewrite all of that
- textures re-encoded, bones reoriented - to add some animation. So the clips
are computed here and APPENDED: every byte already in the file stays where it
is, and a re-run strips what the last run added (asset.extras.menuClips)
before adding it again. The poses were designed in Blender, by importing a
preview this writes and looking at it.

THE MATHS IS THE EXPORTER'S, checked against it. A pose is the notation of
pipeline.py's _mk_poses - per bone (swing, spread, twist) in degrees, the
right side mirrored - and a joint's glTF rotation is its rest rotation times
that pose as a Blender XYZ euler. Rebuilt this way, every key frame of the
existing Idle, Death, Jump and Hit matches the exported quaternions exactly
on all fourteen models. In between, the curve is a Hermite through the keys
with Catmull-Rom slopes, flattened at a turning point - Blender's own
auto-clamped curve, which the existing clips use, to within 3 degrees.

THE FEET ARE PLANTED, NOT AUTHORED. Hand-set hip heights cannot fit fourteen
bodies: the same kneel that put Kaelen's knees on the floor sank Lyra's 27cm
through it. So every frame, the lower body is skinned exactly as three.js
skins it, and the hips are moved up or down until its lowest point is where
it is at rest. Every vertex hangs from the hips, so that is exact. Only the
forward lean of the hips (`hipz`, as in pipeline.py) is authored.
"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_tool import Glb  # noqa: E402

FPS = 30
CHARS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'chars')
REF_HIP_HEIGHT = 0.95      # pipeline.py's scale_hint is the hip height over this

# ------------------------------------------------------------------- poses
# (swing, spread, twist), degrees. Swing: negative raises an arm forward and
# up, or a thigh forward; positive bends a knee, or the spine and head
# forward. Spread: away from the body. Twist: about the bone. A key is
# (frame, pose, hipz) at 30 frames a second.


def _sym(pose):
    """`"Foot.": v` means the same on both sides, written once."""
    out = {}
    for k, v in pose.items():
        if k.endswith('.'):
            out[k + 'L'] = v
            out[k + 'R'] = v
        else:
            out[k] = v
    return out


def _victory():
    up = _sym({
        "Spine": (-6, 0, 0), "Chest": (-7, 0, 0), "Head": (-12, 0, 0),
        "UpperArm.R": (-162, 16, 0), "LowerArm.R": (-22, 0, 0),
        "UpperArm.L": (6, 22, 0), "LowerArm.L": (-34, 0, 0),
        "UpperLeg.": (0, 7, 0), "LowerLeg.": (2, 0, 0),
    })
    # THE PUMP: the elbow drives DOWN to the ribs and the free fist pulls in,
    # knees giving - the whole body says "yes".
    pump = _sym({
        "Spine": (8, 0, 6), "Chest": (6, 0, 4), "Head": (-2, 0, 0),
        "UpperArm.R": (-36, 28, 0), "LowerArm.R": (-128, 0, 0),
        "UpperArm.L": (-28, 22, 0), "LowerArm.L": (-100, 0, 0),
        "UpperLeg.": (-20, 7, 0), "LowerLeg.": (36, 0, 0), "Foot.": (-16, 0, 0),
    })
    hold = dict(up)
    hold.update({"Chest": (-10, 0, 0), "Head": (-10, 0, 8)})
    return [(1, up, 0.0), (11, pump, 0.0), (21, up, 0.0), (31, pump, 0.0),
            (43, up, 0.0), (70, hold, 0.0), (97, up, 0.0)]


def _defeat():
    stagger = _sym({
        "Spine": (-5, 0, 0), "Chest": (-5, 0, 0), "Head": (-10, 0, 0),
        "UpperArm.": (6, 12, 0), "LowerArm.": (-14, 0, 0),
    })
    buckle = _sym({
        "Spine": (18, 0, 0), "Chest": (12, 0, 0), "Head": (24, 0, 0),
        "UpperArm.": (-8, 8, 0), "LowerArm.": (-12, 0, 0),
        "UpperLeg.": (-40, 4, 0), "LowerLeg.": (72, 0, 0), "Foot.": (-20, 0, 0),
    })
    knees = _sym({
        "Spine": (26, 0, 0), "Chest": (16, 0, 0), "Head": (34, 0, 0),
        "UpperArm.": (-12, 6, 0), "LowerArm.": (-10, 0, 0),
        "UpperLeg.": (-4, 6, 0), "LowerLeg.": (96, 0, 0), "Foot.": (40, 0, 0),
    })
    slump = dict(knees)
    slump.update({"Spine": (30, 0, 2), "Chest": (19, 0, 0), "Head": (38, 0, -4)})
    return [(1, {}, 0.0), (8, stagger, -0.02), (20, buckle, 0.0), (30, knees, 0.0),
            (40, slump, 0.0), (49, slump, 0.0)]


def _ready():
    windup = _sym({
        "Spine": (4, 0, -10), "Chest": (2, 0, -6),
        "UpperArm.R": (30, 10, 0), "LowerArm.R": (-70, 0, 0),
        "UpperArm.L": (-30, 10, 0), "LowerArm.L": (-60, 0, 0),
        "UpperLeg.": (-16, 4, 0), "LowerLeg.": (28, 0, 0), "Foot.": (-12, 0, 0),
    })
    # A planted crouch, both feet down: a lunge read as a back foot lifting
    # off the dais.
    stance = _sym({"UpperLeg.": (-14, 8, 0), "LowerLeg.": (26, 0, 0), "Foot.": (-12, 0, 0)})
    strike = dict(stance)
    strike.update({
        "Spine": (6, 0, 12), "Chest": (4, 0, 9), "Head": (0, 0, -8),
        "UpperArm.R": (-88, 6, 0), "LowerArm.R": (-4, 0, 0),
        "UpperArm.L": (-78, 16, 0), "LowerArm.L": (-118, 0, 0),
    })
    # THE GUARD: both fists up by the chin.
    guard = dict(stance)
    guard.update({
        "Spine": (10, 0, 6), "Chest": (4, 0, 2), "Head": (-6, 0, -4),
        "UpperArm.L": (-84, 16, 0), "LowerArm.L": (-120, 0, 0),
        "UpperArm.R": (-78, 16, 0), "LowerArm.R": (-116, 0, 0),
    })
    return [(1, {}, 0.0), (7, windup, -0.01), (12, strike, 0.03), (20, guard, 0.0),
            (31, guard, 0.0)]


CLIPS = {
    'Victory': dict(loop=True, keys=_victory()),
    'Defeat': dict(loop=False, keys=_defeat()),
    'Ready': dict(loop=False, keys=_ready()),
}

# ------------------------------------------------------------------- maths


def quat_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([aw * bx + ax * bw + ay * bz - az * by,
                     aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw,
                     aw * bw - ax * bx - ay * by - az * bz])


def _axis(axis, ang):
    s = math.sin(ang / 2)
    v = {'x': (s, 0, 0), 'y': (0, s, 0), 'z': (0, 0, s)}[axis]
    return np.array([v[0], v[1], v[2], math.cos(ang / 2)])


def pose_quat(bone, vals):
    """pipeline.py's apply(): Euler((swing, twist*s, spread*s), 'XYZ')."""
    swing, spread, twist = vals
    s = -1.0 if bone.endswith('.R') else 1.0
    x, y, z = math.radians(swing), math.radians(twist) * s, math.radians(spread) * s
    return quat_mul(_axis('z', z), quat_mul(_axis('y', y), _axis('x', x)))


def hermite(frames, vals, cyclic=False):
    """{frame: value} through the keys, every frame from first to last."""
    n = len(frames)
    slope = []
    for i in range(n):
        if cyclic and (i == 0 or i == n - 1):
            # The loop's seam: the key before the last and the key after the
            # first are its neighbours, so the motion carries straight through.
            prev, nxt = vals[n - 2], vals[1]
            dt = (frames[n - 1] - frames[n - 2]) + (frames[1] - frames[0])
        elif 0 < i < n - 1:
            prev, nxt = vals[i - 1], vals[i + 1]
            dt = frames[i + 1] - frames[i - 1]
        else:
            slope.append(0.0)
            continue
        if (vals[i] - prev) * (nxt - vals[i]) <= 0:
            slope.append(0.0)
        else:
            slope.append((nxt - prev) / dt)
    out = {}
    for i in range(n - 1):
        f0, f1, v0, v1 = frames[i], frames[i + 1], vals[i], vals[i + 1]
        h = f1 - f0
        m0, m1 = slope[i] * h, slope[i + 1] * h
        for f in range(f0, f1 + 1):
            t = (f - f0) / h
            out[f] = ((2 * t ** 3 - 3 * t ** 2 + 1) * v0 + (t ** 3 - 2 * t ** 2 + t) * m0
                      + (-2 * t ** 3 + 3 * t ** 2) * v1 + (t ** 3 - t ** 2) * m1)
    return out


def _trs(t, q, s):
    x, y, z, w = q
    m = np.eye(4)
    m[:3, :3] = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]) * np.asarray(s)[None, :]
    m[:3, 3] = t
    return m


class LowerBody(object):
    """The legs and feet, skinned as three.js skins them: enough to ask how
    low the body reaches in a given pose."""

    def __init__(self, g):
        j = g.json
        self.nodes = j['nodes']
        self.parent = {c: i for i, n in enumerate(self.nodes) for c in n.get('children', [])}
        skin = j['skins'][0]
        self.joints = skin['joints']
        # glTF matrices are column-major.
        self.ibm = g.accessor(skin['inverseBindMatrices']).astype(np.float64).reshape(-1, 4, 4).transpose(0, 2, 1)
        _name, prim = g.skinned_primitive()
        pos = g.accessor(prim['attributes']['POSITION']).astype(np.float64)
        jts = g.accessor(prim['attributes']['JOINTS_0']).astype(np.int64)
        wts = g.accessor(prim['attributes']['WEIGHTS_0']).astype(np.float64)
        wacc = j['accessors'][prim['attributes']['WEIGHTS_0']]
        if wacc['componentType'] == 5121:
            wts /= 255.0
        elif wacc['componentType'] == 5123:
            wts /= 65535.0
        names = [self.nodes[n]['name'] for n in self.joints]
        legs = [i for i, n in enumerate(names) if n.split('.')[0] in ('UpperLeg', 'LowerLeg', 'Foot')]
        keep = (np.isin(jts, legs) & (wts > 0)).any(axis=1)
        self.pos = np.c_[pos[keep], np.ones(int(keep.sum()))]
        self.jts, self.wts = jts[keep], wts[keep]

    def lowest(self, local):
        """Lowest skinned y, with `local` {node: 4x4} overriding rest TRS."""
        world = {}

        def w(n):
            if n not in world:
                m = local.get(n)
                if m is None:
                    nd = self.nodes[n]
                    m = _trs(nd.get('translation', [0, 0, 0]), nd.get('rotation', [0, 0, 0, 1]),
                             nd.get('scale', [1, 1, 1]))
                p = self.parent.get(n)
                world[n] = w(p) @ m if p is not None else m
            return world[n]

        jy = np.stack([(w(n) @ self.ibm[i])[1] for i, n in enumerate(self.joints)])
        return float(np.einsum('vk,vkc,vc->v', self.wts, jy[self.jts], self.pos).min())


def bake(clip, joints, node, rest_rot, rest_t, rest_s, scale, body):
    """(times, {bone: (n,4) quats}, (n,3) hip translations) for one clip."""
    keys = clip['keys']
    frames = [k[0] for k in keys]
    span = list(range(frames[0], frames[-1] + 1))
    times = np.array([(f - frames[0]) / FPS for f in span], np.float32)
    rots = {}
    for bone in joints:
        comps = [hermite(frames, [k[1].get(bone, (0, 0, 0))[c] for k in keys], clip['loop'])
                 for c in range(3)]
        qs, prev = [], None
        for f in span:
            q = quat_mul(rest_rot[bone], pose_quat(bone, (comps[0][f], comps[1][f], comps[2][f])))
            if prev is not None and float(np.dot(prev, q)) < 0:
                q = -q                  # one hemisphere, so nothing interpolates the long way
            qs.append(q)
            prev = q
        rots[bone] = np.array(qs, np.float32)
    hz = hermite(frames, [k[2] for k in keys], clip['loop'])
    floor = body.lowest({})
    hips = []
    for i, f in enumerate(span):
        t = [rest_t['Hips'][0], rest_t['Hips'][1], rest_t['Hips'][2] + hz[f] * scale]
        local = {node[b]: _trs(rest_t[b] if b != 'Hips' else t, rots[b][i], rest_s[b]) for b in joints}
        t[1] += floor - body.lowest(local)          # planted: as low as at rest, no lower
        hips.append(t)
    return times, rots, np.array(hips, np.float32)

# ------------------------------------------------------------------- the file


def _append(g, arr, gltf_type, minmax=False):
    """Append a float32 array to the binary chunk as a new accessor."""
    data = np.ascontiguousarray(arr, np.float32).tobytes()
    while len(g.bin) % 4:
        g.bin.append(0)
    off = len(g.bin)
    g.bin.extend(data)
    j = g.json
    j['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
    acc = {'bufferView': len(j['bufferViews']) - 1, 'componentType': 5126,
           'count': int(arr.shape[0]), 'type': gltf_type}
    if minmax:
        flat = np.asarray(arr, np.float32).reshape(arr.shape[0], -1)
        acc['min'] = [float(x) for x in flat.min(axis=0)]
        acc['max'] = [float(x) for x in flat.max(axis=0)]
    j['accessors'].append(acc)
    return len(j['accessors']) - 1


def strip(g):
    """Undo a previous run: everything it appended sits after a recorded mark."""
    mark = g.json.get('asset', {}).get('extras', {}).get('menuClips')
    if not mark:
        return False
    j = g.json
    j['animations'] = j['animations'][:mark['animations']]
    j['accessors'] = j['accessors'][:mark['accessors']]
    j['bufferViews'] = j['bufferViews'][:mark['bufferViews']]
    del g.bin[mark['bin']:]
    del j['asset']['extras']['menuClips']
    if not j['asset']['extras']:
        del j['asset']['extras']
    return True


def write_clips(src, dst):
    g = Glb(src)
    strip(g)
    j = g.json
    j['buffers'][0]['byteLength'] = len(g.bin)
    j['asset'].setdefault('extras', {})['menuClips'] = {
        'animations': len(j['animations']), 'accessors': len(j['accessors']),
        'bufferViews': len(j['bufferViews']), 'bin': len(g.bin)}
    joint_ids = j['skins'][0]['joints']
    joints = [j['nodes'][i]['name'] for i in joint_ids]
    node = {j['nodes'][i]['name']: i for i in joint_ids}
    rest_rot = {n: np.array(j['nodes'][node[n]].get('rotation', [0, 0, 0, 1]), float) for n in joints}
    rest_t = {n: list(j['nodes'][node[n]].get('translation', [0, 0, 0])) for n in joints}
    rest_s = {n: list(j['nodes'][node[n]].get('scale', [1, 1, 1])) for n in joints}
    scale = rest_t['Hips'][1] / REF_HIP_HEIGHT
    body = LowerBody(g)
    one = _append(g, np.zeros((1, 1), np.float32), 'SCALAR', minmax=True)   # a held value's one key
    for name, clip in CLIPS.items():
        times, rots, hips = bake(clip, joints, node, rest_rot, rest_t, rest_s, scale, body)
        t_acc = _append(g, times.reshape(-1, 1), 'SCALAR', minmax=True)
        samplers, channels = [], []

        def channel(bone, path, values, steady):
            if steady:
                acc_in, interp = one, 'STEP'
                values = values[:1]
            else:
                acc_in, interp = t_acc, 'LINEAR'
            acc_out = _append(g, values, {4: 'VEC4', 3: 'VEC3'}[values.shape[1]])
            samplers.append({'input': acc_in, 'output': acc_out, 'interpolation': interp})
            channels.append({'sampler': len(samplers) - 1, 'target': {'node': node[bone], 'path': path}})

        for bone in joints:
            q = rots[bone]
            channel(bone, 'rotation', q, bool(np.allclose(q, q[0], atol=1e-7)))
            if bone == 'Hips':
                channel(bone, 'translation', hips, bool(np.allclose(hips, hips[0], atol=1e-7)))
            else:
                channel(bone, 'translation', np.array([rest_t[bone]], np.float32), True)
            channel(bone, 'scale', np.array([rest_s[bone]], np.float32), True)
        j['animations'].append({'name': name, 'samplers': samplers, 'channels': channels})
    j['buffers'][0]['byteLength'] = len(g.bin)
    return g.save(dst)


def main(argv):
    if len(argv) >= 3 and argv[0] == '--preview':
        src = os.path.join(CHARS, argv[1].lower() + '.glb')
        print('%s -> %s: %d bytes' % (src, argv[2], write_clips(src, argv[2])))
        return
    for fname in sorted(os.listdir(CHARS)):
        if not fname.endswith('.glb'):
            continue
        p = os.path.join(CHARS, fname)
        before = os.path.getsize(p)
        after = write_clips(p, p)
        print('  %-14s %9d -> %9d bytes  (+%s)' % (fname, before, after, ', '.join(CLIPS)))


if __name__ == '__main__':
    main(sys.argv[1:])
