# Blender startup script: enable the MCP addon, turn on the asset integrations
# we need (PolyHaven for arena PBR/HDRI, Hyper3D Rodin for character generation),
# and make sure the socket server is listening on 9876.
import bpy
import addon_utils

print("=== ASTRAL CLASH BLENDER BOOTSTRAP ===")

# The addon ships as scripts/addons/addon.py, so its module name is "addon".
for name in ("addon", "blender_mcp", "blender-mcp-main"):
    try:
        addon_utils.enable(name, default_set=True, persistent=True)
        print("enabled addon module:", name)
    except Exception as e:
        print("could not enable", name, "->", e)

scene = bpy.context.scene
try:
    scene.blendermcp_port = 9876
    scene.blendermcp_auto_start_server = True
    scene.blendermcp_use_polyhaven = True
    scene.blendermcp_use_hyper3d = True
    scene.blendermcp_use_polypizza = True
    print("scene props set")
except Exception as e:
    print("scene prop error:", e)

# Free-trial Rodin key, so text->3D generation is available without a private key.
try:
    bpy.ops.blendermcp.set_hyper3d_free_trial_api_key()
    print("hyper3d free trial key set; mode:", scene.blendermcp_hyper3d_mode)
except Exception as e:
    print("hyper3d trial key error:", e)

try:
    bpy.ops.blendermcp.start_server()
    print("start_server called; running =", scene.blendermcp_server_running)
except Exception as e:
    print("start_server error:", e)

print("=== BOOTSTRAP DONE ===")
