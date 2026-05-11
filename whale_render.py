"""
BizControl — Underwater Whale Scene
הרץ בתוך Blender: Scripting → Paste → Run Script
דרישות: Blender 3.6+ | קובץ whale.glb בנתיב שמוגדר למטה
"""

import bpy, math, os

# ─── CONFIG ────────────────────────────────────────────────────────────────────
WHALE_PATH   = r"C:\whale.glb"          # נתיב למודל
OUTPUT_PATH  = r"C:\whale_render\\"     # תיקיית פלט
FRAMES       = 180                       # 6 שניות @ 30fps
RESOLUTION_X = 1920
RESOLUTION_Y = 1080
SAMPLES      = 128                       # גבוה יותר = איכות גבוהה יותר (לוקח זמן)
# ───────────────────────────────────────────────────────────────────────────────

os.makedirs(OUTPUT_PATH, exist_ok=True)

# ── Reset scene ────────────────────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
for col in bpy.data.collections:
    bpy.data.collections.remove(col)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.resolution_x = RESOLUTION_X
scene.render.resolution_y = RESOLUTION_Y
scene.render.fps = 30
scene.frame_start = 1
scene.frame_end = FRAMES
scene.render.image_settings.file_format = 'FFMPEG'
scene.render.ffmpeg.format = 'MPEG4'
scene.render.ffmpeg.codec = 'H264'
scene.render.ffmpeg.constant_rate_factor = 'MEDIUM'
scene.render.filepath = OUTPUT_PATH + "whale_loop"

# ── World — underwater deep blue ───────────────────────────────────────────────
world = bpy.data.worlds.new("Ocean")
scene.world = world
world.use_nodes = True
wnt = world.node_tree
wnt.nodes.clear()

bg = wnt.nodes.new('ShaderNodeBackground')
bg.inputs['Color'].default_value = (0.0, 0.04, 0.12, 1.0)
bg.inputs['Strength'].default_value = 0.3

env_out = wnt.nodes.new('ShaderNodeOutputWorld')
wnt.links.new(bg.outputs['Background'], env_out.inputs['Surface'])

# ── Volume scatter (underwater haze) ──────────────────────────────────────────
vol_mat = bpy.data.materials.new("OceanVolume")
vol_mat.use_nodes = True
vol_mat.node_tree.nodes.clear()

vol_scatter = vol_mat.node_tree.nodes.new('ShaderNodeVolumeScatter')
vol_scatter.inputs['Color'].default_value = (0.02, 0.18, 0.38, 1.0)
vol_scatter.inputs['Density'].default_value = 0.04
vol_scatter.inputs['Anisotropy'].default_value = 0.7

vol_out = vol_mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
vol_mat.node_tree.links.new(vol_scatter.outputs['Volume'], vol_out.inputs['Volume'])

# Volume cube
bpy.ops.mesh.primitive_cube_add(size=80)
vol_cube = bpy.context.active_object
vol_cube.name = "OceanVolume"
vol_cube.data.materials.append(vol_mat)
vol_cube.cycles_visibility.camera = True
vol_cube.cycles_visibility.shadow = False

# ── Sun light (from above — god rays source) ──────────────────────────────────
bpy.ops.object.light_add(type='SUN', location=(5, -5, 30))
sun = bpy.context.active_object
sun.data.energy = 8.0
sun.data.color = (0.6, 0.85, 1.0)
sun.data.angle = math.radians(5)
sun.rotation_euler = (math.radians(15), math.radians(10), 0)

# ── Area lights (caustics simulation) ─────────────────────────────────────────
for i in range(3):
    bpy.ops.object.light_add(type='AREA',
        location=(i*5 - 5, -3, 18))
    light = bpy.context.active_object
    light.data.energy = 2000
    light.data.color = (0.4, 0.75, 1.0)
    light.data.size = 8
    light.rotation_euler = (math.radians(20), 0, 0)

# Fill light from below (ocean floor bounce)
bpy.ops.object.light_add(type='AREA', location=(0, 0, -12))
fill = bpy.context.active_object
fill.data.energy = 300
fill.data.color = (0.1, 0.3, 0.6)
fill.data.size = 20

# ── Import whale model ─────────────────────────────────────────────────────────
if not os.path.exists(WHALE_PATH):
    raise FileNotFoundError(f"לא נמצא מודל לוייתן ב: {WHALE_PATH}\n"
                            "הורד מ-sketchfab.com ושמור כ-whale.glb")

bpy.ops.import_scene.gltf(filepath=WHALE_PATH)
whale_objects = [o for o in bpy.context.selected_objects]

# Group whale
bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0, 0, 0))
whale_empty = bpy.context.active_object
whale_empty.name = "WhaleRoot"
for obj in whale_objects:
    obj.parent = whale_empty

# Scale and position
whale_empty.scale = (0.8, 0.8, 0.8)
whale_empty.location = (0, 0, -1)
whale_empty.rotation_euler = (0, 0, math.radians(180))

# ── Whale animation — swimming path ───────────────────────────────────────────
# Slow glide from right to left, gentle vertical wave
for frame in range(1, FRAMES + 1):
    t = (frame - 1) / FRAMES  # 0..1
    progress = t * 2 * math.pi

    x = 12 - t * 20                          # swim left
    y = -3
    z = -1 + math.sin(progress * 1.5) * 1.0  # gentle rise/fall

    whale_empty.location = (x, y, z)
    whale_empty.keyframe_insert(data_path="location", frame=frame)

    # Gentle banking
    roll = math.sin(progress * 1.5) * math.radians(8)
    yaw  = math.sin(progress * 0.5) * math.radians(5)
    whale_empty.rotation_euler = (0, yaw, math.radians(180) + roll)
    whale_empty.keyframe_insert(data_path="rotation_euler", frame=frame)

# Smooth interpolation
for fcurve in whale_empty.animation_data.action.fcurves:
    for kp in fcurve.keyframe_points:
        kp.interpolation = 'BEZIER'
        kp.easing = 'EASE_IN_OUT'

# ── Camera ────────────────────────────────────────────────────────────────────
bpy.ops.object.camera_add(location=(0, -18, 1))
cam = bpy.context.active_object
cam.name = "OceanCam"
cam.data.lens = 50
cam.data.clip_end = 200
scene.camera = cam

# Camera slow dolly — follows whale gently
for frame in range(1, FRAMES + 1):
    t = (frame - 1) / FRAMES
    progress = t * 2 * math.pi

    cx = -2 + math.sin(progress * 0.3) * 2
    cy = -18 + math.sin(progress * 0.2) * 1.5
    cz = 1 + math.sin(progress * 0.4) * 0.8

    cam.location = (cx, cy, cz)
    cam.keyframe_insert(data_path="location", frame=frame)

    # Always look slightly toward whale
    cam.rotation_euler = (
        math.radians(88),
        0,
        math.radians(0) + math.sin(progress * 0.3) * math.radians(5)
    )
    cam.keyframe_insert(data_path="rotation_euler", frame=frame)

# Track constraint to whale
track = cam.constraints.new('TRACK_TO')
track.target = whale_empty
track.track_axis = 'TRACK_NEGATIVE_Z'
track.up_axis = 'UP_Y'

# ── Caustics plane (animated texture) ─────────────────────────────────────────
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 15))
caustic_plane = bpy.context.active_object
caustic_plane.name = "CausticPlane"

cmat = bpy.data.materials.new("Caustics")
cmat.use_nodes = True
cmat.node_tree.nodes.clear()

tex = cmat.node_tree.nodes.new('ShaderNodeTexWave')
tex.inputs['Scale'].default_value = 8
tex.inputs['Distortion'].default_value = 4
tex.inputs['Detail'].default_value = 8

emission = cmat.node_tree.nodes.new('ShaderNodeEmission')
emission.inputs['Strength'].default_value = 1.5
emission.inputs['Color'].default_value = (0.5, 0.8, 1.0, 1.0)

cmat_out = cmat.node_tree.nodes.new('ShaderNodeOutputMaterial')
cmat.node_tree.links.new(tex.outputs['Color'], emission.inputs['Strength'])
cmat.node_tree.links.new(emission.outputs['Emission'], cmat_out.inputs['Surface'])

caustic_plane.data.materials.append(cmat)
caustic_plane.cycles_visibility.camera = False  # invisible to camera, only lighting

# Animate caustics movement
for frame in range(1, FRAMES + 1):
    t = frame / 30.0
    caustic_plane.location = (math.sin(t * 0.3) * 2, math.cos(t * 0.2) * 2, 15)
    caustic_plane.keyframe_insert(data_path="location", frame=frame)

# ── Render ────────────────────────────────────────────────────────────────────
print("\n" + "="*50)
print("🐋 מתחיל רנדור...")
print(f"   {FRAMES} פריימים | {SAMPLES} samples")
print(f"   פלט: {OUTPUT_PATH}")
print("="*50 + "\n")

bpy.ops.render.render(animation=True)

print("\n✅ הרנדור הושלם!")
print(f"קובץ: {OUTPUT_PATH}whale_loop.mp4")
print("העתק את הקובץ ל: web/public/whale.mp4")
