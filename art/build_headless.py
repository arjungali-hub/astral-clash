# -*- coding: utf-8 -*-
"""Batch-converts every raw generation into a rigged game GLB, headless.

    "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" \
        --background --factory-startup \
        --python art/build_headless.py -- [Name ...]

WHY HEADLESS RATHER THAN THROUGH THE BLENDER MCP BRIDGE. The bridge blocks
Blender's main thread while it runs code and times out after seconds, while a
single character takes minutes (the glTF import alone is ~45s). Worse, the two
obvious ways around that both fail: a worker thread and a bpy.app.timers
callback each lack an active-object context, so every `bpy.ops` call dies with
"Operator bpy.ops.object.mode_set.poll() Context missing active object". And
after a few timed-out calls the bridge's socket wedged - Blender sat at 0% CPU
and stopped executing anything at all.

`--background` is the right tool: a real main thread, a real (if minimal)
context, full stdout, a nonzero exit code on failure, and no dependency on the
user's interactive Blender session being healthy. `--factory-startup` keeps
addons and preferences out of it so a run is reproducible.
"""
import bpy
import os
import sys
import json
import glob
import traceback

ROOT = r"C:\Users\arjun\Documents\astral-clash"
RAW = os.path.join(ROOT, "art", "raw")
OUT = os.path.join(ROOT, "assets", "chars")

sys.path.insert(0, os.path.join(ROOT, "art"))
exec(open(os.path.join(ROOT, "art", "pipeline.py")).read())


def import_raw(name):
    """Imports art/raw/<name>.glb and returns ONE joined, transform-applied mesh."""
    path = os.path.join(RAW, name + ".glb")
    if not os.path.exists(path):
        raise RuntimeError("no raw model: " + path)
    before = set(o.name for o in bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o.name not in before]
    meshes = [o for o in new if o.type == 'MESH']
    if not meshes:
        raise RuntimeError("import produced no mesh")

    # Rodin wraps the mesh in an empty parent; drop it before joining so the
    # hierarchy transform is not baked in twice.
    for o in new:
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)

    for o in bpy.data.objects:
        o.select_set(False)
    if len(meshes) > 1:
        for m in meshes:
            m.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
        mesh = bpy.context.view_layer.objects.active
    else:
        mesh = meshes[0]

    # pipeline.py measures WORLD-space geometry, and Rodin bakes its scale into
    # the object transform - so apply it rather than reason about it.
    for o in bpy.data.objects:
        o.select_set(False)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mesh.name = name + "_raw"
    return mesh


def wipe():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)


def pending():
    have = set(os.path.splitext(os.path.basename(p))[0].lower()
               for p in glob.glob(os.path.join(OUT, "*.glb")))
    return [os.path.splitext(os.path.basename(p))[0]
            for p in sorted(glob.glob(os.path.join(RAW, "*.glb")))
            if os.path.splitext(os.path.basename(p))[0].lower() not in have]


def verify(name):
    """The checks that actually matter, asserted rather than assumed.

    Kaelen's first pass bound with 100% UNWEIGHTED vertices - 11,717 UV-seam
    duplicates that clean() now welds - and the symptom was a character who
    stood still while his skeleton walked away. It looked like an animation bug.
    """
    mesh = next((o for o in bpy.data.objects if o.type == 'MESH'), None)
    rig = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    if not mesh or not rig:
        return {"ok": False, "why": "no mesh or no rig"}
    unweighted = sum(1 for v in mesh.data.vertices if not v.groups)
    clips = sorted(a.name for a in bpy.data.actions)
    needed = ['Death', 'Hit', 'Idle', 'Jump', 'Run', 'Walk']
    bones = [b.name for b in rig.data.bones]
    # The names buildRiggedCharacter() looks up by hand.
    required_bones = ['Hips', 'Chest', 'Head', 'UpperArm.L', 'UpperArm.R', 'Hand.L', 'Hand.R']
    missing_bones = [b for b in required_bones if b not in bones]
    return {
        "ok": unweighted == 0 and not missing_bones and all(c in clips for c in needed),
        "verts": len(mesh.data.vertices),
        "unweighted": unweighted,
        "bones": len(bones),
        "missing_bones": missing_bones,
        "clips": clips,
    }


def main():
    argv = sys.argv
    args = argv[argv.index('--') + 1:] if '--' in argv else []
    todo = args or pending()
    print("=== BUILD START: %s ===" % ", ".join(todo), flush=True)
    failures = 0
    for name in todo:
        print("\n=== %s ===" % name, flush=True)
        try:
            wipe()
            mesh = import_raw(name)
            rep = process(name, mesh.name)
            v = verify(name)
            rep["verify"] = v
            print("%s %s" % (name, json.dumps(rep, default=str)), flush=True)
            if not v["ok"]:
                print("%s VERIFY FAILED: %s" % (name, json.dumps(v)), flush=True)
                failures += 1
        except Exception:
            print("%s EXCEPTION:\n%s" % (name, traceback.format_exc()), flush=True)
            failures += 1
    print("\n=== BUILD DONE: %d character(s), %d failure(s) ===" % (len(todo), failures), flush=True)
    # A nonzero exit is the whole point of running headless.
    sys.exit(1 if failures else 0)


main()
