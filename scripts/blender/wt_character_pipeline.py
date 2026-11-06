"""
WanderTales Guild — Blender character asset pipeline (Blender 4.x, headless).

STATUS: NOT EXECUTED. Blender was not installed on the machine where this was written.
The production assets in public/characters/ were built and QC'd by the equivalent Node pipeline
(scripts/pipeline/build.ts), which ran successfully. This script is the Blender-side equivalent
for when you want Blender's tools (Shrinkwrap, Data Transfer, Eevee thumbnails, manual polish).

Usage (headless):
  blender -b -P scripts/blender/wt_character_pipeline.py -- --project "H:/AI/WanderTales Guild" [--only hair_short,tunic_forest]

What it does for every asset in data/character_assets.json (fit rules mirror scripts/pipeline/fit.ts):
  1. opens a clean scene with the master character (assets/characters/base/source/chibi_base_mesh_rigged.glb)
  2. imports the asset GLB
  3. chooses a binding method per asset type — NOT one method for everything:
       shell_copy_weights / weight_transfer  -> Shrinkwrap (outside surface, offset) + Data Transfer
                                                 (nearest face interpolated vertex groups) from the body
       rigid_bone                             -> no weights; parent with an Armature modifier on ONE vertex group
       rigid_multi_bone                       -> per-side vertex groups (left/right bone)
       hybrid (capes, skirts)                 -> gradient vertex groups along the spine / hips
  4. tests deformation in the same poses as the Node QC (rest, arms_down, walk, head_turn, arms_up, crouch)
     by measuring vertices inside the posed body (BVH ray parity)
  5. exports GLB with only the asset mesh + armature, renders a 256px Eevee thumbnail
  6. writes reports/blender_qc.json; assets that fail are marked FAILED / NEEDS_REVIEW, never "ready"
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default

PROJECT = arg("--project", os.getcwd())
ONLY = set(filter(None, (arg("--only", "") or "").split(",")))
MASTER = os.path.join(PROJECT, "assets/characters/base/source/chibi_base_mesh_rigged.glb")
MANIFEST = os.path.join(PROJECT, "data/character_assets.json")
OUT = os.path.join(PROJECT, "build_blender")

POSES = {
    "rest": {},
    "arms_down": {"RightArm_09": [((0, 0, 1), 65)], "Left_Arm_017": [((0, 0, 1), -65)]},
    "walk": {"RightArm_09": [((0, 0, 1), 65), ((1, 0, 0), -25)], "Left_Arm_017": [((0, 0, 1), -65), ((1, 0, 0), 25)],
             "RightUpLeg_024": [((1, 0, 0), -30)], "Left_UpLeg_00": [((1, 0, 0), 30)]},
    "head_turn": {"Head_06": [((0, 1, 0), 35), ((1, 0, 0), 15)]},
    "arms_up": {"RightArm_09": [((0, 0, 1), -50)], "Left_Arm_017": [((0, 0, 1), 50)]},
    "crouch": {"RightUpLeg_024": [((1, 0, 0), -60)], "Left_UpLeg_00": [((1, 0, 0), -60)],
               "RightLeg_025": [((1, 0, 0), 70)], "Left_Leg_028": [((1, 0, 0), 70)], "Spine2_04": [((1, 0, 0), 15)]},
}
# glTF Y-up -> Blender Z-up: world axis (x, y, z)gl == (x, -z, y)bl
def gl_axis(a):
    return Vector((a[0], -a[2], a[1]))


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def master():
    objs = import_glb(MASTER)
    arm = next(o for o in objs if o.type == "ARMATURE")
    body = next(o for o in objs if o.type == "MESH" and "Body" in (o.data.name + o.name))
    return arm, body


def bake_world(obj):
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)


def bind_rigid(obj, arm, bone):
    obj.vertex_groups.clear()
    vg = obj.vertex_groups.new(name=bone)
    vg.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
    mod = obj.modifiers.new("Armature", "ARMATURE"); mod.object = arm


def bind_pair(obj, arm, right, left):
    obj.vertex_groups.clear()
    r, l = obj.vertex_groups.new(name=right), obj.vertex_groups.new(name=left)
    for v in obj.data.vertices:
        (r if v.co.x < 0 else l).add([v.index], 1.0, "REPLACE")
    mod = obj.modifiers.new("Armature", "ARMATURE"); mod.object = arm


def conform_and_transfer(obj, body, arm, offset=0.005):
    # 1) keep the garment outside the body
    sw = obj.modifiers.new("Shrinkwrap", "SHRINKWRAP")
    sw.target = body; sw.wrap_method = "NEAREST_SURFACEPOINT"; sw.wrap_mode = "OUTSIDE_SURFACE"; sw.offset = offset
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=sw.name)
    # 2) copy skin weights from the body (nearest face, interpolated)
    for g in body.vertex_groups:
        if g.name not in obj.vertex_groups:
            obj.vertex_groups.new(name=g.name)
    dt = obj.modifiers.new("WeightTransfer", "DATA_TRANSFER")
    dt.object = body; dt.use_vert_data = True; dt.data_types_verts = {"VGROUP_WEIGHTS"}
    dt.vert_mapping = "POLYINTERP_NEAREST"; dt.layers_vgroup_select_src = "ALL"; dt.layers_vgroup_select_dst = "NAME"
    bpy.ops.object.modifier_apply(modifier=dt.name)
    # 3) limit to 4 influences and normalize (glTF/three.js requirement)
    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    mod = obj.modifiers.new("Armature", "ARMATURE"); mod.object = arm


def bind_gradient(obj, arm):
    obj.vertex_groups.clear()
    chest, spine, hips = (obj.vertex_groups.new(name=n) for n in ("Spine2_04", "Spine1_03", "Hips_01"))
    for v in obj.data.vertices:
        y = v.co.z  # Blender Z == glTF Y
        if y > 0.16: chest.add([v.index], 1.0, "REPLACE")
        elif y > 0.11:
            t = (0.16 - y) / 0.05; chest.add([v.index], 1 - t, "REPLACE"); spine.add([v.index], t, "REPLACE")
        else:
            t = min(1.0, (0.11 - y) / 0.06); spine.add([v.index], 1 - t, "REPLACE"); hips.add([v.index], t, "REPLACE")
    mod = obj.modifiers.new("Armature", "ARMATURE"); mod.object = arm


def pose(arm, name):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1, 0, 0, 0)
    for bone, rots in POSES[name].items():
        pb = arm.pose.bones.get(bone)
        if not pb: continue
        for axis, deg in rots:
            world_axis = gl_axis(axis)
            local_axis = (arm.matrix_world @ pb.bone.matrix_local).to_3x3().inverted() @ world_axis
            pb.rotation_quaternion = pb.rotation_quaternion @ Matrix.Rotation(math.radians(deg), 4, local_axis.normalized()).to_quaternion()
    bpy.context.view_layer.update()


def evaluated_mesh(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    verts = [obj.matrix_world @ v.co for v in me.vertices]
    polys = [list(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    return verts, polys


def inside_ratio(asset, body):
    bv, bp = evaluated_mesh(body)
    tree = BVHTree.FromPolygons(bv, bp)
    av, _ = evaluated_mesh(asset)
    inside = 0
    for v in av:
        hits, origin, d = 0, v, Vector((0.0123, 0.0071, 1.0)).normalized()
        while True:
            loc, _n, _i, _dist = tree.ray_cast(origin, d)
            if loc is None: break
            hits += 1; origin = loc + d * 1e-5
        inside += hits % 2
    return inside / max(1, len(av))


def thumbnail(path):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items} else "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 256
    scene.render.film_transparent = True
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(cam)
    cam.location = (0.55, -0.9, 0.42); cam.rotation_euler = (math.radians(78), 0, math.radians(31)); scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(45), 0, math.radians(30))
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def run():
    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    os.makedirs(OUT, exist_ok=True)
    report = []
    for a in manifest["assets"]:
        if ONLY and a["id"] not in ONLY:
            continue
        reset_scene()
        arm, body = master()
        src = os.path.join(PROJECT, "public", a["file"])
        objs = [o for o in import_glb(src) if o.type == "MESH"]
        # the exported asset already carries the master skeleton; drop its duplicate armature
        for o in list(bpy.data.objects):
            if o.type == "ARMATURE" and o is not arm:
                bpy.data.objects.remove(o, do_unlink=True)
        result = {"id": a["id"], "method": a["method"], "clipping": {}, "status": "PASS", "notes": []}
        for obj in objs:
            obj.parent = None; bake_world(obj)
            for m in list(obj.modifiers): obj.modifiers.remove(m)
            if a["method"] == "rigid_bone":
                bind_rigid(obj, arm, {"hair": "Head_06", "headwear": "Head_06"}.get(a["category"], "Spine2_04"))
            elif a["method"] == "rigid_multi_bone":
                bind_pair(obj, arm, "RightArm_09", "Left_Arm_017")
            elif a["method"] == "hybrid" and a["slot"] == "back":
                bind_gradient(obj, arm)
            else:
                conform_and_transfer(obj, body, arm)
        for p in POSES:
            pose(arm, p)
            result["clipping"][p] = round(sum(inside_ratio(o, body) for o in objs) / max(1, len(objs)), 4)
        pose(arm, "rest")
        worst = max(result["clipping"].values())
        if worst > 0.15: result["status"] = "FAILED"
        elif worst > 0.06: result["status"] = "NEEDS_REVIEW"
        elif worst > 0.02: result["status"] = "WARNING"
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs + [arm]: o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, a["id"] + ".glb"), export_format="GLB", use_selection=True, export_skins=True, export_animations=False)
        thumbnail(os.path.join(OUT, a["id"] + ".png"))
        report.append(result)
        print(result["status"], a["id"], result["clipping"])
    json.dump(report, open(os.path.join(PROJECT, "reports/blender_qc.json"), "w"), indent=2)


if __name__ == "__main__":
    run()
