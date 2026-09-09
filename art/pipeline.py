# Astral Clash character pipeline (Blender 5.x).
#
# Turns a raw Hyper3D Rodin generation into a game-ready skinned GLB:
#   orient upright -> ground -> clean -> MEASURE -> rig -> bind -> bake clips -> export
#
# Run inside Blender via the MCP bridge:
#   exec(open(r"C:\Users\arjun\Documents\astral-clash\art\pipeline.py").read())
#   process("Kaelen", "Kaelen_raw")
#
# Everything here is deliberately measurement-driven rather than hardcoded,
# because the roster is not one body type: it has a lean duelist, a 1.5x stone
# titan, and a knee-high skittering minion. Hardcoded joint heights would fit
# exactly one of them. See measure() for how joints are found.

import bpy
import math
import mathutils
from collections import defaultdict

RIG_TARGET_HEIGHT = 50.0   # world units in-game; must match index.html
FPS = 30


# ---------------------------------------------------------------- utilities

def _obj(name):
    ob = bpy.data.objects.get(name)
    if ob is None:
        raise KeyError("no such object: %s (have: %s)" % (name, [o.name for o in bpy.data.objects]))
    return ob


def _activate(ob, mode='OBJECT'):
    """Make `ob` the sole selected+active object. Operators over the MCP bridge
    only behave if the REAL selection state is set - bpy.context.temp_override
    silently fails for mode_set and transform_apply here."""
    for o in bpy.data.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    if bpy.context.mode != mode:
        bpy.ops.object.mode_set(mode=mode)


def orient_and_ground(ob):
    """Ground the mesh: feet to Z=0, centred on X/Y. Z is already up.

    This USED to pick the up axis as the longest extent, on the theory that
    Rodin's output axis is inconsistent. Measuring all thirteen generations
    showed otherwise: Blender's glTF importer normalises to Z-up every time, so
    Z was always already correct - and "longest extent" then actively broke the
    models whose arm span merely EDGED OUT their height. Ignis measured
    X=1.90 / Z=1.85 and Gorgonok X=1.90 / Z=1.86 (both wide T-poses), and
    Slagling is a squat creature at X=1.90 / Z=1.38. All three were rotated
    onto their side and rigged lying down, and the pipeline reported success:
    the giveaway was a "knee" measured 0.47 x H out from the spine.

    So: trust Z. The only rotation left is for a mesh whose Z extent is
    implausibly small - genuinely lying down rather than merely broad - where
    doing nothing would be worse than guessing.

    Transforms are baked into MESH DATA rather than applied via
    bpy.ops.object.transform_apply, which proved unreliable over the bridge."""
    me = ob.data
    ob.matrix_world = mathutils.Matrix.Identity(4)

    def extent(i):
        vals = [v.co[i] for v in me.vertices]
        return max(vals) - min(vals)

    ext = [extent(0), extent(1), extent(2)]
    # A standing figure is never less than ~40% as tall as it is wide. Below
    # that it really is on its side, and the longest axis is the safest guess.
    if ext[2] < 0.4 * max(ext[0], ext[1]):
        long_axis = ext.index(max(ext))
        if long_axis == 1:
            me.transform(mathutils.Matrix.Rotation(math.radians(90), 4, 'X'))
        elif long_axis == 0:
            me.transform(mathutils.Matrix.Rotation(math.radians(-90), 4, 'Y'))
    me.update()

    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    me.transform(mathutils.Matrix.Translation(
        (-(min(xs) + max(xs)) / 2.0, -(min(ys) + max(ys)) / 2.0, -min(zs))))
    me.update()
    return max(v.co.z for v in me.vertices)


def clean(ob):
    """Weld duplicate vertices and make the surface closed.

    This is load-bearing, not tidying: Rodin GLBs arrive with a duplicate vertex
    per UV-seam corner (Kaelen had 11,717 of 23,381), so the mesh is not a
    manifold surface and Blender's heat-diffusion auto-weighting fails for
    EVERY bone - producing a rig with 100% unweighted vertices that looks bound
    but cannot deform."""
    _activate(ob)
    before = len(ob.data.vertices)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0002)
    bpy.ops.mesh.delete_loose()
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.mesh.select_non_manifold()
    bpy.ops.object.mode_set(mode='OBJECT')
    nm = sum(1 for e in ob.data.edges if e.select)
    return {"verts_before": before, "verts_after": len(ob.data.vertices),
            "polys": len(ob.data.polygons), "non_manifold_edges": nm}


def _clusters(vals, gap):
    """Split a sorted 1-D value list wherever there is a gap wider than `gap`.
    Used to separate limbs from the torso at a given height."""
    if not vals:
        return []
    vals = sorted(vals)
    out, run = [], [vals[0]]
    for v in vals[1:]:
        if v - run[-1] > gap:
            out.append(run)
            run = [v]
        else:
            run.append(v)
    out.append(run)
    return [(min(r), max(r), len(r)) for r in out]


def measure(ob):
    """Locate joints from the mesh itself.

    Heights come from anatomical fractions of total height - verified against
    Kaelen, where the measured shoulder/elbow/wrist/hip/knee/ankle landed within
    a percent of 0.80/0.60/0.46/0.50/0.27/0.05 H. Sideways offsets are MEASURED,
    because those are what actually vary: how far an A-pose spreads the arms, how
    wide the stance is, how bulky the limbs are. That combination fits a lean
    duelist and a stone titan without per-character tuning."""
    me = ob.data
    H = max(v.co.z for v in me.vertices)
    front_is_neg_y = (abs(min(v.co.y for v in me.vertices))
                      > abs(max(v.co.y for v in me.vertices)))

    def slab(z, band=0.035):
        lo, hi = z - band * H, z + band * H
        return [v.co for v in me.vertices if lo <= v.co.z <= hi]

    def outer_centre(z, band=0.035):
        """Centre |x| of the outermost cluster at this height - a limb.

        Clusters on ABSOLUTE x, not signed x. Clustering signed x looks right
        and fails silently on the common case: when a character's arms hang
        near the body (an A-pose rather than a T-pose), each arm merges with
        the torso into ONE cluster spanning roughly -w..+w, and
        `abs(min + max) / 2` then cancels to about zero. Aurelia measured a
        wrist 0.001 units from her own spine, which would have built a
        degenerate arm chain buried inside the chest - and it reported success.
        On |x| the two limbs land in the SAME cluster at the right distance,
        which is what we actually want to measure.
        """
        vs = slab(z, band)
        if len(vs) < 8:
            return None
        cs = _clusters([abs(v.x) for v in vs], 0.045 * H)
        cs = [c for c in cs if c[2] >= 4]
        if not cs:
            return None
        far = max(cs, key=lambda c: c[1])      # the cluster reaching furthest out
        return (far[0] + far[1]) / 2.0

    def half_width(z, band=0.035):
        vs = slab(z, band)
        if not vs:
            return 0.05 * H
        return (max(v.x for v in vs) - min(v.x for v in vs)) / 2.0

    fr = {"hips": 0.50, "spine": 0.60, "chest": 0.70, "shoulder": 0.80,
          "neck": 0.875, "head_top": 0.99, "elbow": 0.60, "wrist": 0.46,
          "knee": 0.27, "ankle": 0.05}
    z = {k: v * H for k, v in fr.items()}

    shoulder_x = max(0.055 * H, half_width(z["shoulder"]) * 0.55)
    hip_x = max(0.04 * H, half_width(z["hips"]) * 0.42)

    # Measured, then sanity-floored. The `or` fallbacks only fire when the
    # cluster search returns None; they do NOT catch a measurement that
    # succeeded and is nonsense, which is how a 0.001 wrist got through. A limb
    # joint cannot be closer to the spine than the joint above it, so anything
    # that says otherwise is a failed measurement wearing a plausible type.
    wrist_x = max(outer_centre(z["wrist"]) or 0.18 * H, 0.75 * shoulder_x)
    elbow_x = max(outer_centre(z["elbow"]) or 0.16 * H, 0.85 * shoulder_x)
    knee_x = max(outer_centre(z["knee"]) or 0.09 * H, 0.55 * hip_x)
    ankle_x = max(outer_centre(z["ankle"]) or 0.11 * H, 0.5 * hip_x)

    # Toes point along the mesh's front.
    foot_y = (-1 if front_is_neg_y else 1) * 0.075 * H

    return {
        "H": H, "front_is_neg_y": front_is_neg_y,
        "z": z,
        "shoulder_x": shoulder_x, "elbow_x": elbow_x, "wrist_x": wrist_x,
        "hip_x": hip_x, "knee_x": knee_x, "ankle_x": ankle_x,
        "foot_y": foot_y,
    }


# --------------------------------------------------------------------- rig

def build_rig(name, m):
    """A 19-bone humanoid skeleton placed from the measurements.

    Bone names use .L/.R; three.js sanitizes those to `UpperArmL` on import,
    which index.html's findBone() handles."""
    rig_name = name + "Rig"
    old = bpy.data.objects.get(rig_name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)

    arm_data = bpy.data.armatures.new(rig_name)
    rig = bpy.data.objects.new(rig_name, arm_data)
    bpy.context.scene.collection.objects.link(rig)

    z, H = m["z"], m["H"]

    def side(s):
        L = '.L' if s > 0 else '.R'
        return [
            ("Shoulder" + L, "Chest",
             (m["shoulder_x"] * 0.28 * s, 0, z["shoulder"] + 0.005 * H),
             (m["shoulder_x"] * s, 0, z["shoulder"])),
            ("UpperArm" + L, "Shoulder" + L,
             (m["shoulder_x"] * s, 0, z["shoulder"]), (m["elbow_x"] * s, 0, z["elbow"])),
            ("LowerArm" + L, "UpperArm" + L,
             (m["elbow_x"] * s, 0, z["elbow"]), (m["wrist_x"] * s, 0, z["wrist"])),
            ("Hand" + L, "LowerArm" + L,
             (m["wrist_x"] * s, 0, z["wrist"]),
             (m["wrist_x"] * 1.04 * s, 0, z["wrist"] - 0.042 * H)),
            ("UpperLeg" + L, "Hips",
             (m["hip_x"] * s, 0, z["hips"]), (m["knee_x"] * s, 0, z["knee"])),
            ("LowerLeg" + L, "UpperLeg" + L,
             (m["knee_x"] * s, 0, z["knee"]), (m["ankle_x"] * s, 0, z["ankle"])),
            ("Foot" + L, "LowerLeg" + L,
             (m["ankle_x"] * s, 0, z["ankle"]),
             (m["ankle_x"] * 1.08 * s, m["foot_y"], z["ankle"] * 0.25)),
        ]

    spec = [
        ("Hips", None, (0, 0, z["hips"]), (0, 0, z["spine"])),
        ("Spine", "Hips", (0, 0, z["spine"]), (0, 0, z["chest"])),
        ("Chest", "Spine", (0, 0, z["chest"]), (0, 0, z["shoulder"])),
        ("Neck", "Chest", (0, 0, z["shoulder"]), (0, 0, z["neck"])),
        ("Head", "Neck", (0, 0, z["neck"]), (0, 0, z["head_top"])),
    ] + side(1) + side(-1)

    _activate(rig, mode='EDIT')
    eb = arm_data.edit_bones
    for b in list(eb):
        eb.remove(b)
    for bname, parent, head, tail in spec:
        b = eb.new(bname)
        b.head = mathutils.Vector(head)
        b.tail = mathutils.Vector(tail)
        b.use_connect = False
    for bname, parent, _h, _t in spec:
        if parent:
            eb[bname].parent = eb[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    rig.show_in_front = True
    return rig


def bind(mesh, rig):
    """Heat-diffusion auto weights. Requires clean() to have run first."""
    for mod in list(mesh.modifiers):
        if mod.type == 'ARMATURE':
            mesh.modifiers.remove(mod)
    mesh.vertex_groups.clear()
    mesh.parent = None

    for o in bpy.data.objects:
        o.select_set(False)
    mesh.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig   # parent target must be active
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')

    # Sweep up whatever heat diffusion missed.
    #
    # ARMATURE_AUTO leaves a vertex unweighted when it is not enclosed by any
    # bone's falloff - typically a detached or nearly-detached shell like a
    # ragged robe hem or a floating shoulder ornament. Those vertices then
    # stay put in world space while the rest of the body animates, which reads
    # as the mesh tearing. Kaelen's first pass had 100% of them (UV-seam
    # duplicates, now welded by clean()); Nyx had 20 on her robe hem.
    #
    # The fix is unconditional rather than per-character: assign any orphan to
    # the bone whose segment it is closest to, at full weight. A rigid patch of
    # hem following the nearest bone is correct-looking; a patch following
    # nothing is not.
    bones = [b for b in rig.data.bones]
    if bones:
        # Bone segments in MESH-local space (the mesh is now parented to the
        # rig, and both share the world origin after orient_and_ground).
        segs = []
        for b in bones:
            grp = mesh.vertex_groups.get(b.name)
            if grp is None:
                grp = mesh.vertex_groups.new(name=b.name)
            segs.append((b.head_local.copy(), b.tail_local.copy(), grp))

        def nearest_group(co):
            best, bestd = None, None
            for head, tail, grp in segs:
                ab = tail - head
                denom = ab.dot(ab)
                t = 0.0 if denom <= 1e-12 else max(0.0, min(1.0, (co - head).dot(ab) / denom))
                d = (co - (head + ab * t)).length
                if bestd is None or d < bestd:
                    best, bestd = grp, d
            return best

        rescued = 0
        for v in mesh.data.vertices:
            if sum(g.weight for g in v.groups) <= 1e-6:
                grp = nearest_group(v.co)
                if grp is not None:
                    grp.add([v.index], 1.0, 'REPLACE')
                    rescued += 1
    else:
        rescued = 0

    unweighted = 0
    for v in mesh.data.vertices:
        if sum(g.weight for g in v.groups) <= 1e-6:
            unweighted += 1
    return {"groups": len(mesh.vertex_groups), "unweighted": unweighted,
            "rescued": rescued, "verts": len(mesh.data.vertices)}


# ------------------------------------------------------------------- clips

# Semantic channels, measured from the bone axes rather than assumed:
#   swing  -> local X, negative = forward, SAME sign on both sides
#             (local Z is world +Y for left and right alike)
#   spread -> local Z, mirrored on .R
#   twist  -> local Y, mirrored on .R
# Spine-chain bones (local Y is world up): X = lean forward, Y = twist, Z = side-bend.

def _mk_poses():
    LEAN = {"Spine": (14, 0, 0), "Chest": (7, 0, 0), "Head": (-10, 0, 0)}

    def contact(fwd):
        o, b = ('R', 'L') if fwd == 'R' else ('L', 'R')
        return {
            "UpperLeg." + o: (-26, 0, 0), "LowerLeg." + o: (6, 0, 0), "Foot." + o: (-8, 0, 0),
            "UpperLeg." + b: (18, 0, 0), "LowerLeg." + b: (22, 0, 0), "Foot." + b: (12, 0, 0),
            "UpperArm." + b: (-22, 4, 0), "LowerArm." + b: (-25, 0, 0),
            "UpperArm." + o: (16, 4, 0), "LowerArm." + o: (-12, 0, 0),
            "Spine": (4, 0, 6 if fwd == 'R' else -6),
            "Chest": (2, 0, 4 if fwd == 'R' else -4),
            "Head": (0, 0, -4 if fwd == 'R' else 4),
        }

    def passing(up):
        o, b = ('L', 'R') if up == 'L' else ('R', 'L')
        return {
            "UpperLeg." + b: (-4, 0, 0), "LowerLeg." + b: (4, 0, 0), "Foot." + b: (-2, 0, 0),
            "UpperLeg." + o: (-6, 0, 0), "LowerLeg." + o: (48, 0, 0), "Foot." + o: (-6, 0, 0),
            "UpperArm." + o: (-8, 4, 0), "LowerArm." + o: (-18, 0, 0),
            "UpperArm." + b: (4, 4, 0), "LowerArm." + b: (-14, 0, 0),
            "Spine": (5, 0, 0), "Chest": (3, 0, 0),
        }

    def run_contact(fwd):
        o, b = ('R', 'L') if fwd == 'R' else ('L', 'R')
        p = dict(LEAN)
        p.update({
            "UpperLeg." + o: (-52, 0, 0), "LowerLeg." + o: (28, 0, 0), "Foot." + o: (-14, 0, 0),
            "UpperLeg." + b: (34, 0, 0), "LowerLeg." + b: (52, 0, 0), "Foot." + b: (16, 0, 0),
            "UpperArm." + b: (-58, 6, 0), "LowerArm." + b: (-78, 0, 0),
            "UpperArm." + o: (40, 6, 0), "LowerArm." + o: (-52, 0, 0),
            "Spine": (14, 0, 9 if fwd == 'R' else -9),
            "Chest": (7, 0, 5 if fwd == 'R' else -5),
        })
        return p

    def run_passing(up):
        o, b = ('L', 'R') if up == 'L' else ('R', 'L')
        p = dict(LEAN)
        p.update({
            "UpperLeg." + b: (-14, 0, 0), "LowerLeg." + b: (16, 0, 0),
            "UpperLeg." + o: (-24, 0, 0), "LowerLeg." + o: (96, 0, 0), "Foot." + o: (-16, 0, 0),
            "UpperArm." + o: (-24, 6, 0), "LowerArm." + o: (-66, 0, 0),
            "UpperArm." + b: (12, 6, 0), "LowerArm." + b: (-58, 0, 0),
        })
        return p

    idle0 = {"Spine": (1, 0, 0), "UpperArm.L": (0, 3, 0), "UpperArm.R": (0, 3, 0),
             "LowerArm.L": (-6, 0, 0), "LowerArm.R": (-6, 0, 0)}
    idle1 = {"Spine": (-2, 0, 0), "Chest": (-3, 0, 0), "Head": (2, 0, 1),
             "UpperArm.L": (2, 6, 0), "UpperArm.R": (2, 6, 0),
             "LowerArm.L": (-10, 0, 0), "LowerArm.R": (-10, 0, 0)}
    idle2 = {"Spine": (1, 0, 1), "Chest": (0, 0, 1), "Head": (-1, 0, -2),
             "UpperArm.L": (-1, 3, 0), "UpperArm.R": (-1, 3, 0),
             "LowerArm.L": (-5, 0, 0), "LowerArm.R": (-5, 0, 0)}

    crouch = {"UpperLeg.L": (-38, 0, 0), "LowerLeg.L": (62, 0, 0), "Foot.L": (-24, 0, 0),
              "UpperLeg.R": (-38, 0, 0), "LowerLeg.R": (62, 0, 0), "Foot.R": (-24, 0, 0),
              "Spine": (16, 0, 0), "Chest": (8, 0, 0),
              "UpperArm.L": (34, 8, 0), "UpperArm.R": (34, 8, 0),
              "LowerArm.L": (-20, 0, 0), "LowerArm.R": (-20, 0, 0)}
    launch = {"UpperLeg.L": (6, 0, 0), "LowerLeg.L": (4, 0, 0), "Foot.L": (16, 0, 0),
              "UpperLeg.R": (6, 0, 0), "LowerLeg.R": (4, 0, 0), "Foot.R": (16, 0, 0),
              "Spine": (-6, 0, 0), "Chest": (-4, 0, 0),
              "UpperArm.L": (-84, 10, 0), "UpperArm.R": (-84, 10, 0),
              "LowerArm.L": (-26, 0, 0), "LowerArm.R": (-26, 0, 0)}
    air = {"UpperLeg.L": (-30, 0, 0), "LowerLeg.L": (54, 0, 0),
           "UpperLeg.R": (-12, 0, 0), "LowerLeg.R": (28, 0, 0),
           "Spine": (6, 0, 0), "UpperArm.L": (-40, 14, 0), "UpperArm.R": (-30, 14, 0),
           "LowerArm.L": (-40, 0, 0), "LowerArm.R": (-34, 0, 0)}

    hit1 = {"Spine": (-14, 0, 0), "Chest": (-10, 0, 0), "Head": (-16, 0, 6),
            "UpperArm.L": (18, 14, 0), "UpperArm.R": (14, 12, 0),
            "LowerArm.L": (-34, 0, 0), "LowerArm.R": (-28, 0, 0),
            "UpperLeg.L": (10, 0, 0), "UpperLeg.R": (-6, 0, 0), "LowerLeg.R": (14, 0, 0)}
    hit2 = {"Spine": (-4, 0, 0), "Chest": (-3, 0, 0), "Head": (-4, 0, 2),
            "UpperArm.L": (6, 8, 0), "UpperArm.R": (4, 7, 0),
            "LowerArm.L": (-16, 0, 0), "LowerArm.R": (-14, 0, 0)}

    d1 = {"Spine": (-10, 0, 0), "Chest": (-8, 0, 0), "Head": (-14, 0, 0),
          "UpperLeg.L": (-16, 0, 0), "LowerLeg.L": (20, 0, 0),
          "UpperArm.L": (20, 16, 0), "UpperArm.R": (18, 14, 0)}
    d2 = {"Spine": (22, 0, 4), "Chest": (16, 0, 3), "Head": (20, 0, -6),
          "UpperLeg.L": (-64, 0, 0), "LowerLeg.L": (78, 0, 0),
          "UpperLeg.R": (-42, 0, 0), "LowerLeg.R": (56, 0, 0),
          "UpperArm.L": (-30, 20, 0), "UpperArm.R": (-24, 18, 0),
          "LowerArm.L": (-50, 0, 0), "LowerArm.R": (-44, 0, 0)}
    d3 = {"Spine": (30, 0, 8), "Chest": (20, 0, 6), "Head": (26, 0, -10),
          "UpperLeg.L": (-88, 0, 0), "LowerLeg.L": (96, 0, 0),
          "UpperLeg.R": (-70, 0, 0), "LowerLeg.R": (84, 0, 0),
          "UpperArm.L": (-14, 26, 0), "UpperArm.R": (-10, 24, 0),
          "LowerArm.L": (-30, 0, 0), "LowerArm.R": (-26, 0, 0)}

    return {
        "Walk": [(1, contact('R'), 0.0), (9, passing('L'), 0.028),
                 (16, contact('L'), 0.0), (24, passing('R'), 0.028), (31, contact('R'), 0.0)],
        "Run": [(1, run_contact('R'), 0.0), (7, run_passing('L'), 0.055),
                (13, run_contact('L'), 0.0), (19, run_passing('R'), 0.055), (25, run_contact('R'), 0.0)],
        "Idle": [(1, idle0, 0.0), (40, idle1, 0.012), (80, idle2, -0.006), (121, idle0, 0.0)],
        "Jump": [(1, crouch, -0.09), (6, launch, 0.04), (16, air, 0.0), (30, air, 0.0)],
        "Hit": [(1, {}, 0.0), (4, hit1, -0.02), (11, hit2, 0.0), (18, {}, 0.0)],
        "Death": [(1, {}, 0.0), (8, d1, -0.05), (24, d2, -0.55), (40, d3, -0.80), (52, d3, -0.80)],
    }


def bake_clips(rig, scale_hint=1.0):
    """Author the six locomotion clips as Blender actions.

    Hip translation is scaled by the character's own height so a titan's bob is
    proportional rather than a fixed distance that would be invisible on it and
    violent on a minion."""
    bpy.context.scene.render.fps = FPS
    _activate(rig, mode='POSE')
    for pb in rig.pose.bones:
        pb.rotation_mode = 'XYZ'
    names = [b.name for b in rig.data.bones]
    Rad = math.radians

    def apply(bone, vals):
        if bone not in rig.pose.bones:
            return
        swing, spread, twist = vals
        s = -1.0 if bone.endswith('.R') else 1.0
        rig.pose.bones[bone].rotation_euler = mathutils.Euler(
            (Rad(swing), Rad(twist) * s, Rad(spread) * s), 'XYZ')

    made = []
    for clip, poses in _mk_poses().items():
        old = bpy.data.actions.get(clip)
        if old:
            bpy.data.actions.remove(old)
        act = bpy.data.actions.new(clip)
        rig.animation_data_create()
        rig.animation_data.action = act
        for frame, d, hipz in poses:
            for pb in rig.pose.bones:
                pb.rotation_euler = (0, 0, 0)
                pb.location = (0, 0, 0)
            for bone, vals in d.items():
                apply(bone, vals)
            rig.pose.bones["Hips"].location = (0.0, 0.0, hipz * scale_hint)
            for bname in names:
                rig.pose.bones[bname].keyframe_insert('rotation_euler', frame=frame)
            rig.pose.bones["Hips"].keyframe_insert('location', frame=frame)
        made.append(clip)

    for pb in rig.pose.bones:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.ops.object.mode_set(mode='OBJECT')
    return made


def export(name, mesh, rig, out_dir=r"C:\Users\arjun\Documents\astral-clash\assets\chars"):
    import os
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, name.lower() + ".glb")

    for o in bpy.data.objects:
        o.select_set(False)
    mesh.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig

    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=False,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_bake_animation=False,
        export_optimize_animation_size=True,
        export_yup=True,
        export_skins=True,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        export_image_format='AUTO',
    )
    return path, os.path.getsize(path)


def process(name, raw_name, keep_others_hidden=True):
    """Full pipeline for one character. Returns a report dict."""
    mesh = _obj(raw_name)
    mesh.name = name
    report = {"name": name}

    report["height_blender"] = round(orient_and_ground(mesh), 4)
    report["clean"] = clean(mesh)
    m = measure(mesh)
    report["measured"] = {
        "H": round(m["H"], 3),
        "front_is_neg_y": m["front_is_neg_y"],
        "shoulder_x": round(m["shoulder_x"], 3),
        "wrist_x": round(m["wrist_x"], 3),
        "knee_x": round(m["knee_x"], 3),
        "ankle_x": round(m["ankle_x"], 3),
    }
    rig = build_rig(name, m)
    report["bones"] = len(rig.data.bones)
    report["bind"] = bind(mesh, rig)
    report["clips"] = bake_clips(rig, scale_hint=m["H"] / 1.9)
    path, size = export(name, mesh, rig)
    report["export"] = {"path": path, "bytes": size}

    if keep_others_hidden:
        for o in bpy.data.objects:
            if o.type in ('MESH', 'ARMATURE') and o.name not in (name, rig.name):
                o.hide_viewport = True
                o.hide_render = True
    return report


def reset_scene():
    """Remove every mesh/armature so the next character starts clean."""
    for o in list(bpy.data.objects):
        if o.type in ('MESH', 'ARMATURE'):
            bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    return "scene reset"


print("pipeline loaded: process(name, raw_name), reset_scene()")
