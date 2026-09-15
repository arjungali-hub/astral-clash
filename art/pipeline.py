# Astral Clash character pipeline (Blender 5.x).
#
# Turns a raw Hyper3D Rodin generation into a game-ready skinned GLB:
#   orient -> ground -> clean -> DE-NOISE -> MEASURE -> rig -> bind
#     -> smooth weights -> ARMS-DOWN REST POSE -> bake clips -> export
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


def _trace_arm(me, H, s, sh_x, sh_z, steps=14):
    """Follow one arm outward from the shoulder. Returns a polyline or None.

    Marches out in X, and at each step takes the geometry in a thin slab and
    keeps the CLUSTER OF Z NEAREST THE PREVIOUS STEP. Continuity is the whole
    trick: a slab out at arm's length also catches a cape, a wing, a weapon or
    a pauldron, and the median of all of it walks off the arm. Lyra's right
    side did exactly that in the first version - it drifted up her harp and
    ended at z = 1.78, above her own shoulder - while her left side traced
    cleanly. Picking the nearest cluster instead follows the limb.

    Works for a T-pose, an A-pose or arms already hanging, because it never
    assumes a height: it only assumes the arm is attached to the shoulder and
    continuous, which is what makes it an arm.
    """
    xs = sorted(v.co.x * s for v in me.vertices if v.co.x * s > 0 and v.co.z > 0.42 * H)
    if not xs:
        return None
    # 99.5th percentile, not the maximum: one stray vertex should not define
    # the hand, and these meshes do have strays.
    tip = xs[int(len(xs) * 0.995)]
    if tip < sh_x * 1.25:
        return None          # nothing out there; the arm is tucked in

    step = (tip - sh_x) / steps
    pts = [mathutils.Vector((sh_x, 0.0, sh_z))]
    z0, y0 = sh_z, 0.0
    for i in range(1, steps + 1):
        x = sh_x + step * i
        band = [v.co for v in me.vertices
                if abs(v.co.x * s - x) <= step * 0.8 and abs(v.co.z - z0) <= 0.13 * H]
        if len(band) < 4:
            break
        zs = sorted(v.z for v in band)
        groups = _clusters(zs, 0.05 * H)
        groups = [g for g in groups if g[2] >= 3]
        if not groups:
            break
        lo, hi, _n = min(groups, key=lambda g: abs((g[0] + g[1]) / 2.0 - z0))
        zc = (lo + hi) / 2.0
        if abs(zc - z0) > 0.09 * H:
            break            # a jump that big is a different structure
        inb = [v for v in band if lo - 1e-6 <= v.z <= hi + 1e-6]
        z0 = sum(v.z for v in inb) / len(inb)
        y0 = sum(v.y for v in inb) / len(inb)
        pts.append(mathutils.Vector((x, y0, z0)))
    return pts if len(pts) >= 4 else None


def _along(pts, frac):
    """The point `frac` of the way along a polyline, by arc length."""
    segs = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]
    total = sum(segs)
    if total <= 1e-9:
        return pts[0].copy()
    want = total * frac
    run = 0.0
    for i, L in enumerate(segs):
        if run + L >= want:
            t = 0.0 if L <= 1e-9 else (want - run) / L
            return pts[i] + (pts[i + 1] - pts[i]) * t
        run += L
    return pts[-1].copy()


def measure_arms(ob, H, sh_x, sh_z):
    """Elbow, wrist and fingertip as MEASURED 3-D points, or None.

    Both arms are traced and then averaged (with x mirrored), because the rig
    is built symmetric and a one-sided prop or cape should not tilt it. Where
    one side traced much shorter than the other, the longer trace wins rather
    than being averaged with a failure - a short trace means the march stopped
    early, not that the arm is short.

    Fractions along the arm are human proportions from the shoulder: upper arm
    to 47%, forearm to 85%, hand to the tip. Those are shared across the roster
    on purpose - what varies between a duelist and a stone titan is WHERE the
    arm goes, which is now measured, not how it divides up.
    """
    me = ob.data
    traces = {}
    for s in (1, -1):
        pts = _trace_arm(me, H, s, sh_x, sh_z)
        if pts:
            traces[s] = pts
    if not traces:
        return None

    def length(pts):
        return sum((pts[i + 1] - pts[i]).length for i in range(len(pts) - 1))

    if len(traces) == 2 and min(length(traces[1]), length(traces[-1])) < \
            0.6 * max(length(traces[1]), length(traces[-1])):
        keep = max(traces.items(), key=lambda kv: length(kv[1]))
        traces = {keep[0]: keep[1]}

    out = {}
    for label, frac in (("elbow", 0.47), ("wrist", 0.85), ("tip", 1.0)):
        acc = mathutils.Vector((0.0, 0.0, 0.0))
        for s, pts in traces.items():
            q = _along(pts, frac)
            acc += mathutils.Vector((abs(q.x), q.y, q.z))   # mirror onto +X
        out[label] = acc / len(traces)

    # Monotonic outward, and arm-LENGTHED in both directions. These are the
    # guards the old code lacked: it floored a nonsense measurement into a
    # plausible-looking number instead of rejecting it.
    #
    # The short check matters as much as the long one. Kaelen's arms actually
    # hang, so the march found his shoulder bulge, stepped off the end of it
    # and stopped: a 0.09-unit chain that passed the monotonic test and would
    # have rigged his whole arm as a stub beside his neck. A real arm is about
    # 0.42 H from shoulder to fingertip, so anything under 0.30 H is a march
    # that ended early - and for a figure standing at rest the anatomical
    # fallback is not a compromise, it is the placement it was verified on.
    if not (out["elbow"].x > sh_x and out["wrist"].x > out["elbow"].x):
        return None
    reach = (out["tip"] - mathutils.Vector((sh_x, 0, sh_z))).length
    if reach > 0.62 * H or reach < 0.30 * H:
        return None
    return {"elbow": out["elbow"], "wrist": out["wrist"], "tip": out["tip"],
            "sides": len(traces)}


def measure(ob):
    """Locate joints from the mesh itself.

    Heights come from anatomical fractions of total height - verified against
    Kaelen, where the measured shoulder/elbow/wrist/hip/knee/ankle landed within
    a percent of 0.80/0.60/0.46/0.50/0.27/0.05 H. Sideways offsets are MEASURED,
    because those are what actually vary: how wide the stance is, how bulky the
    limbs are.

    THE ARMS ARE THE EXCEPTION, and it took a while to see why. A fraction of
    height only locates a joint on a figure standing at rest, which Kaelen was
    and the other thirteen generations are not - they arrive A-posed, hands
    0.34-0.57 H out to the side. Their elbow and wrist are traced from the
    geometry by measure_arms() instead; elbow_x/wrist_x below survive only as
    the fallback for a figure whose arms really do hang, and as report values."""
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

    # The arm, traced rather than assumed. See measure_arms: the fixed elbow
    # and wrist HEIGHTS above are only right for a figure whose arms hang, and
    # the generations are A-posed.
    arm = measure_arms(ob, H, shoulder_x, z["shoulder"])

    # Toes point along the mesh's front.
    foot_y = (-1 if front_is_neg_y else 1) * 0.075 * H

    return {
        "H": H, "front_is_neg_y": front_is_neg_y,
        "z": z,
        "arm": arm,
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

    # The arm chain, from measure_arms when the trace succeeded. THE BONES MUST
    # LIE INSIDE THE ARM: placed at anatomical heights instead, they ran down
    # through the torso of every A-posed generation, and heat diffusion then
    # weighted the torso and the coat to them while the real arm followed
    # whatever bone happened to be nearest. Gorgonok's fist swinging behind
    # him and Ignis' hands at his waist were both this.
    arm = m.get("arm")

    def arm_pts(s):
        if arm:
            e, w, t = arm["elbow"], arm["wrist"], arm["tip"]
            return ((e.x * s, e.y, e.z), (w.x * s, w.y, w.z), (t.x * s, t.y, t.z))
        # Fallback: the old anatomical placement, for a figure whose arms are
        # already down (the trace returns None, having found nothing out to
        # the side) - which is exactly the case it was verified on.
        return ((m["elbow_x"] * s, 0, z["elbow"]),
                (m["wrist_x"] * s, 0, z["wrist"]),
                (m["wrist_x"] * 1.04 * s, 0, z["wrist"] - 0.042 * H))

    def side(s):
        L = '.L' if s > 0 else '.R'
        elbow, wrist, tip = arm_pts(s)
        return [
            ("Shoulder" + L, "Chest",
             (m["shoulder_x"] * 0.28 * s, 0, z["shoulder"] + 0.005 * H),
             (m["shoulder_x"] * s, 0, z["shoulder"])),
            ("UpperArm" + L, "Shoulder" + L,
             (m["shoulder_x"] * s, 0, z["shoulder"]), elbow),
            ("LowerArm" + L, "UpperArm" + L, elbow, wrist),
            # The hand bone points at the MEASURED fingertip, which is what
            # index.html's prop transplant reads to place a weapon in the grip.
            ("Hand" + L, "LowerArm" + L, wrist, tip),
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


# ------------------------------------------------ surface, weights, rest pose

# HOW HARD TO PUSH, PER CHARACTER.
#
# `noise` is the Laplacian threshold as a fraction of local edge length: lower
# means more vertices are treated as noise. `passes` is how many
# measure-and-smooth rounds to run, and `global_factor`/`global_iters` are the
# gentle whole-surface pass that follows.
#
# The defaults suit the armoured humanoids, which is most of the roster. The
# overrides exist because two of these characters are SUPPOSED to be rough, and
# a global setting cannot tell the difference between a reconstruction artefact
# and a design feature:
#
#   Slagling  - a cracked crust creature. Its whole read is broken, uneven
#               plating; smoothing it to the default leaves a wet pebble.
#   Karrigos  - carved stone. Same argument: the chisel marks are the character.
#   Hollowkin - the opposite case. It is a gaunt, near-skeletal figure where
#               the reconstruction left the most visible mottling, on large flat
#               planes of skin that show every bump.
#   Grint     - big ears and thin limbs, where noise reads as lumps rather than
#               as texture.
SURFACE_DEFAULT = {"noise": 0.34, "passes": 3, "smooth_factor": 0.55,
                   "global_iters": 1, "global_factor": 0.4, "shade_angle": 50.0}
SURFACE_TUNING = {
    "Slagling":  {"noise": 0.62, "passes": 1, "global_iters": 0, "shade_angle": 35.0},
    "Karrigos":  {"noise": 0.58, "passes": 1, "global_iters": 0, "shade_angle": 35.0},
    "Hollowkin": {"noise": 0.26, "passes": 4, "global_iters": 2, "global_factor": 0.5},
    "Grint":     {"noise": 0.28, "passes": 4},
    "Gorgonok":  {"noise": 0.30, "passes": 4},   # huge smooth muscle masses
    "Ignis":     {"noise": 0.30, "passes": 4},
}


def surface_settings(name):
    cfg = dict(SURFACE_DEFAULT)
    cfg.update(SURFACE_TUNING.get(name, {}))
    return cfg


def _laplacian_stats(me, select_above=None):
    """Per-vertex Laplacian offset / local edge length.

    Returns (mean, p99, worst, n_selected). When `select_above` is given, every
    vertex over that ratio is SELECTED and the rest deselected, ready for
    vertices_smooth in edit mode.

    Why a ratio and not an absolute distance: the roster spans a knee-high
    creature and a 1.5x stone titan, and the meshes have similar vertex counts,
    so edge length is the only scale that means the same thing for both.
    """
    nb = [[] for _ in range(len(me.vertices))]
    elen = [0.0] * len(me.vertices)
    ecount = [0] * len(me.vertices)
    for e in me.edges:
        a, b = e.vertices
        nb[a].append(b)
        nb[b].append(a)
        d = (me.vertices[a].co - me.vertices[b].co).length
        elen[a] += d; elen[b] += d
        ecount[a] += 1; ecount[b] += 1

    ratios = []
    for i, v in enumerate(me.vertices):
        if not nb[i] or not ecount[i]:
            ratios.append(0.0)
            continue
        avg = mathutils.Vector((0.0, 0.0, 0.0))
        for j in nb[i]:
            avg += me.vertices[j].co
        avg /= len(nb[i])
        local = elen[i] / ecount[i]
        ratios.append(0.0 if local <= 1e-9 else (v.co - avg).length / local)

    picked = 0
    if select_above is not None:
        for i, r in enumerate(ratios):
            hot = r > select_above
            me.vertices[i].select = hot
            if hot:
                picked += 1

    srt = sorted(ratios)
    mean = sum(srt) / len(srt) if srt else 0.0
    p99 = srt[int(len(srt) * 0.99)] if srt else 0.0
    return mean, p99, (srt[-1] if srt else 0.0), picked


def smooth_surface(mesh, name=None):
    """Targeted de-noising, then a gentle global pass, then edge-aware shading.

    MUST run before measure() and bind(): it moves vertices, and both the joint
    measurement and the weights are computed from where they are.
    """
    cfg = surface_settings(name or mesh.name)
    me = mesh.data
    before = _laplacian_stats(me)

    treated = 0
    for _ in range(cfg["passes"]):
        _activate(mesh, 'OBJECT')
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_mode(type='VERT')
        bpy.ops.mesh.select_all(action='DESELECT')
        bpy.ops.object.mode_set(mode='OBJECT')
        # Selection is set in OBJECT mode, where vertex .select is writable;
        # edit mode reads it when it rebuilds its BMesh. Doing it the other way
        # round silently selects nothing.
        _, _, _, picked = _laplacian_stats(me, select_above=cfg["noise"])
        treated = max(treated, picked)
        if not picked:
            break
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.vertices_smooth(factor=cfg["smooth_factor"], repeat=1)
        bpy.ops.mesh.select_all(action='DESELECT')
        bpy.ops.object.mode_set(mode='OBJECT')

    # The gentle whole-surface pass, for the low-frequency waviness that is not
    # a spike anywhere in particular. Kept small: this is the one that costs
    # volume and crispness everywhere.
    if cfg["global_iters"]:
        _activate(mesh, 'OBJECT')
        mod = mesh.modifiers.new(name="ACSmooth", type='SMOOTH')
        mod.factor = cfg["global_factor"]
        mod.iterations = cfg["global_iters"]
        bpy.ops.object.modifier_apply(modifier=mod.name)

    # SHADING BY ANGLE, not everything-smooth.
    #
    # The previous pass called shade_smooth() on the whole mesh, which averages
    # the normal across a plate's edge too - so armour reads as soft, melted
    # metal and the surface's own waviness is exaggerated rather than hidden.
    # Smoothing only below the angle keeps a hard edge hard.
    _activate(mesh, 'OBJECT')
    shading = "auto %.0f deg" % cfg["shade_angle"]
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(cfg["shade_angle"]))
    except Exception:
        bpy.ops.object.shade_smooth()
        shading = "smooth (no auto)"
    mesh.data.update()

    after = _laplacian_stats(me)
    return {"noise_gate": cfg["noise"], "passes": cfg["passes"],
            "treated": treated,
            "mean": [round(before[0], 4), round(after[0], 4)],
            "p99": [round(before[1], 3), round(after[1], 3)],
            "worst": [round(before[2], 3), round(after[2], 3)],
            "shading": shading}


# The groups whose weights get softened before the arms come down. Only the
# arm chain and its neighbours: smoothing EVERY group is how you get mushy
# legs, traded for nothing, since nothing down there gets re-posed.
_ARM_WEIGHT_GROUPS = ("Shoulder", "UpperArm", "LowerArm", "Hand", "Chest")


def smooth_arm_weights(mesh, repeat=4, factor=0.5):
    """Softens the shoulder weights so the joint survives being re-posed.

    Heat diffusion produces a SHARP shoulder: a vertex belongs almost entirely
    to UpperArm or almost entirely to Chest, with little blend across the
    deltoid. That is exactly the distribution that collapses under a large
    rotation - there is no gradient for the deformation to spread over, so the
    two halves shear past each other instead of bending.

    Smoothing costs a little crispness and buys a shoulder that can be posed,
    which is what set_rest_pose_arms_down() below needs. Groups are smoothed
    one at a time (the operator's ALL mode would take the legs with it), then
    everything is renormalised - smoothing a subset of groups leaves the
    per-vertex weights summing to less than 1, which shows up as a limb that
    shrinks toward its bone.
    """
    # EDIT mode with everything selected: vertex_group_smooth's poll fails in
    # OBJECT mode ("context is incorrect"), which the first run of this pass
    # hit for all nine groups - it reported a failure per group and smoothed
    # nothing. It operates on the SELECTED vertices, so the select_all is not
    # decoration either.
    _activate(mesh, 'EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    done, failed = [], []
    for base in _ARM_WEIGHT_GROUPS:
        for name in (base, base + ".L", base + ".R"):
            grp = mesh.vertex_groups.get(name)
            if grp is None:
                continue
            mesh.vertex_groups.active_index = grp.index
            try:
                bpy.ops.object.vertex_group_smooth(
                    group_select_mode='ACTIVE', factor=factor, repeat=repeat)
                done.append(name)
            except Exception as e:
                failed.append("%s: %s" % (name, str(e)[:60]))
    bpy.ops.object.mode_set(mode='OBJECT')
    try:
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    except Exception as e:
        failed.append("normalize: %s" % str(e)[:40])
    return {"smoothed": len(done), "repeat": repeat, "factor": factor,
            "failed": failed}


# WHERE A RELAXED ARM POINTS, as an absolute direction rather than a rotation
# off the generated pose. Degrees from straight down: OUT is lateral, FWD is
# toward the mesh's front.
#
# Absolute on purpose. The first version of this pass rotated 68 degrees down
# from wherever the bone already was, which crossed Draven's arms in front of
# his crotch - his rig's arms were already near-vertical, because measure()
# found no arm cluster at wrist height and fell back to 0.75 * shoulder_x. The
# roster is not one generated pose (some arrive in a T-pose, some already
# slack), so no single relative rotation is right for all of it. An absolute
# target is: the stance comes out the same either way, and running the pass
# twice changes nothing the second time.
#
# 20 degrees out clears a generated body's hips, which are wider than a human's,
# without reading as a shrug. The forward angles are what separate a relaxed
# stance from a soldier at attention.
REST_ARM_OUT = 20.0
REST_ARM_FWD = 8.0
REST_FOREARM_OUT = 11.0       # the elbow keeps a slight inward bend
REST_FOREARM_FWD = 17.0


def _aim_pose_bone(rig, name, target):
    """Point a pose bone along `target` (armature space).

    Direction-based, like the viewmodel's _aimBone in index.html and for the
    same reason: it needs no knowledge of which local channel does what. Bones
    must be done parent-first - pb.y_axis reads the CURRENT posed direction, so
    a forearm aimed after its upper arm is aimed relative to where the elbow
    actually ended up.
    """
    pb = rig.pose.bones.get(name)
    if pb is None:
        return None
    cur = pb.y_axis.copy()
    cur.normalize()
    t = target.copy()
    t.normalize()
    q = cur.rotation_difference(t)
    loc = pb.matrix.translation.copy()
    M = (mathutils.Matrix.Translation(loc)
         @ q.to_matrix().to_4x4()
         @ mathutils.Matrix.Translation(-loc))
    pb.matrix = M @ pb.matrix
    bpy.context.view_layer.update()
    return round(math.degrees(q.angle), 1)


def set_rest_pose_arms_down(mesh, rig, front_is_neg_y=True):
    """Makes arms-down the BIND pose rather than a runtime rotation.

    Reported as "when characters are at rest, their arms should be at their
    sides, not open and facing sideways". They were out because what you see at
    rest IS the bind pose - the game rotates bones itself and never plays the
    baked Idle clip - and these models are generated arms-out, because that is
    what automatic weighting needs (limbs touching the torso weld together in
    clean() and then bleed weights across the seam).

    Four steps, and the middle two are the point:
      1. aim the arm bones at where a relaxed arm hangs,
      2. APPLY the armature modifier, writing the deformed shape into the mesh
         data while leaving the vertex groups alone - they name the same bones
         and the same vertices either way,
      3. pose.armature_apply(), making that pose the rest pose,
      4. re-attach an armature modifier.

    Afterwards the mesh IS arms-down, the rest pose IS arms-down, the weights
    still describe the same vertices, and the game rotates nothing - so there
    is no runtime collapse to suffer. Whatever the shoulder deformation costs
    is paid once, here, where smooth_arm_weights() has already softened it.

    The game's own animation still means what it meant: bringing an arm down is
    a rotation about the world fore/aft axis, which is the arm bone's local Z
    (measured: local Z is world +Y for both sides), so local Z is PRESERVED and
    _applyArms' "negative local X is forward" holds in the new rest exactly as
    it did in the old one.
    """
    front = -1.0 if front_is_neg_y else 1.0

    def target(out_deg, fwd_deg, lat):
        """A direction: mostly down, `out_deg` out to `lat`, `fwd_deg` forward.

        Built from angles rather than rotated out of a documented bone channel.
        Misapplying the _mk_poses convention to a T-pose - where local X runs
        ALONG the arm - is what made the first-person arm hang straight down
        for three render cycles, and a direction cannot make that mistake.
        """
        o, f = math.radians(out_deg), math.radians(fwd_deg)
        v = mathutils.Vector((lat * math.sin(o),
                              front * math.sin(f),
                              -math.cos(o) * math.cos(f)))
        v.normalize()
        return v

    _activate(rig, 'POSE')
    angles = {}
    for side in ("L", "R"):
        # Which way is "out" for this side is read off the rig, not assumed.
        # The .L/.R naming says which side a bone is, not which direction that
        # is in world space, and a symmetric pair is exactly where an assumed
        # sign goes unnoticed - see the "every arm bone is at x=0" wrong
        # diagnosis, which was really the lateral axis mapping through a
        # rotation.
        ref = rig.data.bones.get("UpperArm." + side)
        if ref is None:
            continue
        lat = 1.0 if ref.head_local.x >= 0 else -1.0

        a = _aim_pose_bone(rig, "UpperArm." + side,
                           target(REST_ARM_OUT, REST_ARM_FWD, lat))
        if a is not None:
            angles["UpperArm." + side] = a
        # The forearm is aimed absolutely too - after the upper arm has moved,
        # so what it inherits is already the new shoulder.
        a = _aim_pose_bone(rig, "LowerArm." + side,
                           target(REST_FOREARM_OUT, REST_FOREARM_FWD, lat))
        if a is not None:
            angles["LowerArm." + side] = a

    bpy.ops.object.mode_set(mode='OBJECT')

    arm_mods = [m for m in mesh.modifiers if m.type == 'ARMATURE']
    if not arm_mods:
        return {"error": "no armature modifier to bake", "angles": angles}
    keep = arm_mods[0].object or rig

    _activate(mesh, 'OBJECT')
    bpy.ops.object.modifier_apply(modifier=arm_mods[0].name)

    _activate(rig, 'POSE')
    bpy.ops.pose.armature_apply()
    bpy.ops.object.mode_set(mode='OBJECT')

    _activate(mesh, 'OBJECT')
    mod = mesh.modifiers.new(name="Armature", type='ARMATURE')
    mod.object = keep
    mesh.parent = keep
    mesh.parent_type = 'OBJECT'    # the modifier deforms; PARSKEL must not too

    # Did the arms actually come down? Cheap, and it is the one thing worth
    # measuring: every failure mode here - a missing bone, a sign picked wrong,
    # a modifier that silently did not apply - shows up as an arm still out,
    # and therefore as a span that never narrowed.
    span = (max(v.co.x for v in mesh.data.vertices)
            - min(v.co.x for v in mesh.data.vertices))
    height = max(v.co.z for v in mesh.data.vertices)
    return {"out_deg": REST_ARM_OUT, "fwd_deg": REST_ARM_FWD,
            "bones": angles, "span": round(span, 3),
            "span_over_height": round(span / height, 3) if height else None}


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
    # Before measuring: smoothing moves vertices, and the joint measurement is
    # taken from where they are.
    report["surface"] = smooth_surface(mesh, name)
    m = measure(mesh)
    report["measured"] = {
        "H": round(m["H"], 3),
        "front_is_neg_y": m["front_is_neg_y"],
        "shoulder_x": round(m["shoulder_x"], 3),
        "arm_traced": (None if not m.get("arm") else
                       {"sides": m["arm"]["sides"],
                        "elbow": [round(v, 3) for v in m["arm"]["elbow"]],
                        "wrist": [round(v, 3) for v in m["arm"]["wrist"]],
                        "tip": [round(v, 3) for v in m["arm"]["tip"]]}),
        "wrist_x": round(m["wrist_x"], 3),
        "knee_x": round(m["knee_x"], 3),
        "ankle_x": round(m["ankle_x"], 3),
    }
    rig = build_rig(name, m)
    report["bones"] = len(rig.data.bones)
    report["bind"] = bind(mesh, rig)
    # Soften the shoulder, then make arms-down the rest pose. In this order:
    # the smoothing is what lets a 68-degree shoulder rotation bake cleanly,
    # and both happen before the clips so the clips are authored against the
    # NEW rest rather than the T-pose.
    report["weights"] = smooth_arm_weights(mesh)
    report["restpose"] = set_rest_pose_arms_down(
        mesh, rig, front_is_neg_y=m["front_is_neg_y"])
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
