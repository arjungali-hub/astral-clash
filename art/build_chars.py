# -*- coding: utf-8 -*-
# Drives art/pipeline.py over the raw Rodin generations in art/raw/.
#
# Run inside Blender, one character per call (the MCP bridge gives each call a
# fresh namespace, so this file re-execs the pipeline itself):
#
#   exec(open(r"C:\Users\arjun\Documents\astral-clash\art\build_chars.py").read())
#   print(build_one("Lyra"))
#   print(build_all())                       # every pending character
#
# Why a driver rather than calling process() directly: a raw generation is not
# guaranteed to be ONE mesh object. Rodin usually returns a single "model" mesh,
# but it can split by material, and pipeline.py's measure()/bind() both assume a
# single object. Joining first makes the input shape predictable, and doing it
# here keeps pipeline.py about rigging rather than about import quirks.
import bpy
import json
import os
import glob

ROOT = r"C:\Users\arjun\Documents\astral-clash"
RAW = os.path.join(ROOT, "art", "raw")
OUT = os.path.join(ROOT, "assets", "chars")
PIPELINE = os.path.join(ROOT, "art", "pipeline.py")

exec(open(PIPELINE).read())


def _import_raw(name):
    """Imports art/raw/<name>.glb and returns ONE joined mesh object."""
    path = os.path.join(RAW, name + ".glb")
    if not os.path.exists(path):
        raise RuntimeError("no raw model: " + path)
    before = set(o.name for o in bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o.name not in before]
    meshes = [o for o in new if o.type == 'MESH']
    if not meshes:
        raise RuntimeError("import produced no mesh for " + name)

    # Drop anything that is not a mesh (Rodin adds an empty parent). Doing this
    # before the join keeps the transform hierarchy from being baked oddly.
    for o in new:
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)

    if len(meshes) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for m in meshes:
            m.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
        mesh = bpy.context.view_layer.objects.active
    else:
        mesh = meshes[0]

    # Rodin bakes its scale into the object transform; pipeline.py measures
    # WORLD-space geometry, so apply it rather than reason about it.
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mesh.name = name + "_raw"
    return mesh


def build_one(name):
    reset_scene()
    mesh = _import_raw(name)
    rep = process(name, mesh.name)
    return json.dumps(rep, default=str)


def pending():
    """Characters with a raw model but no exported GLB yet."""
    have = set(os.path.splitext(os.path.basename(p))[0].lower()
               for p in glob.glob(os.path.join(OUT, "*.glb")))
    out = []
    for p in sorted(glob.glob(os.path.join(RAW, "*.glb"))):
        n = os.path.splitext(os.path.basename(p))[0]
        if n.lower() not in have:
            out.append(n)
    return out


def build_all(limit=None):
    """Processes every pending character. Returns a list of report lines.

    One failure does not stop the run - a roster is worth more partially
    converted than not at all, and a character with no exported GLB simply
    falls back to its procedural mesh in-game (see buildRiggedCharacter).
    """
    todo = pending()
    if limit:
        todo = todo[:limit]
    lines = []
    for n in todo:
        try:
            lines.append(n + " OK " + build_one(n))
        except Exception as e:
            lines.append("%s FAILED %s" % (n, str(e)[:200]))
    return "\n".join(lines)


print("build_chars loaded. pending:", pending())
