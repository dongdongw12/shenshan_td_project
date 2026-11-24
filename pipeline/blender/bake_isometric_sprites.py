"""
《深山传家：开荒守寨》Blender 5.x 等距 2.5D 双光影烘培脚本（路线 B · v2）

两种模式：
  stylized（默认）：统一世界比例 + 超采样渲染 → 多层 EXR 渲染通道 → stylize_sprites.py 做
                    “明清木刻粗墨线 + 矿物重彩工笔”风格化（归色、色阶晕染、内墨线、墨色地影、夜灯晕）
  classic        ：v1 行为，Cycles 直出 PNG + Freestyle 描边（仅用于对比）

stylized 模式要点：
1. 导入 .glb / .gltf / .obj / .fbx，按 assets_manifest.json 归一化：高度 = target_height_m，
   且底座（底部 25% 高度）不超出占地格（footprint × tile_size_m × footprint_fill；屋檐/树冠可出格），
   底面中心落在世界原点；
2. 全部资产共用固定比例 px_per_meter（style_profile.json），墨线粗细在所有资产上一致，客户端无需逐张缩放；
   画布尺寸按投影包围盒（含地面阴影）自适应，宽高对齐到 canvas_multiple；
3. 2:1 等距正交相机（俯角 30°，方位角 45°）；建筑正面（glTF +Z / Blender −Y）朝画面左下；
4. 主光从左前方来（正面亮、右侧面暗、阴影落在建筑后方），夜晚月光 + 暖橙灯笼；
5. 材质统一改成哑光（无高光），Freestyle 只画外轮廓（书法笔触粗细 + 轻微抖动），内线交给后处理；
6. 输出 <out>/_passes/<id>[_a<angle>]_{day,night}.exr + _render.json，随后调用 stylize_sprites.py 生成
   <out>/<id>[_a<angle>]_day.png / _night.png / _meta.json。

参数优先级：命令行显式传入 > assets_manifest.json 单件配置 > manifest defaults > style_profile.json > 内置默认。

用法：
  blender -b -P pipeline/blender/bake_isometric_sprites.py -- \
    --input pipeline/raw_models --out pipeline/baked_sprites \
    --manifest assets_manifest.json --profile pipeline/style/style_profile.json \
    --samples 48 --device auto
  快速预览加 --scale 0.5（比例减半，墨线同比变细，画面观感一致）。
"""

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector

SCRIPT_DIR = Path(__file__).resolve().parent
SUPPORTED_EXTS = {".glb", ".gltf", ".obj", ".fbx"}
NO_INK_COLLECTION = "NoInk"
OBJECT_PASS_INDEX = 1
FEATURE_PASS_INDEX = 2  # 五官等细节件：不描外轮廓、不平涂（stylize_sprites 原样贴回）

BUILTIN_PROFILE = {
    "scale": {"tile_size_m": 2.0, "px_per_meter": 128, "supersample": 2, "canvas_multiple": 8,
              "margin_px": 20, "footprint_fill": 0.96},
    "camera": {"elevation_deg": 30.0, "azimuth_deg": 45.0},
    "lighting": {
        "day": {"sun_euler_deg": [35.0, 0.0, 20.5], "sun_energy": 3.6, "sun_color": "#fff0d8",
                "sun_angle_deg": 3.0, "fill_euler_deg": [55.0, 0.0, 108.4], "fill_energy": 0.7,
                "fill_color": "#c8dcff", "world_color": "#9fb5ad", "world_strength": 0.55},
        "night": {"moon_euler_deg": [42.0, 0.0, -118.0], "moon_energy": 1.0, "moon_color": "#7aa2ff",
                  "world_color": "#1a2550", "world_strength": 0.5, "lantern_color": "#ff9a3c"},
    },
    "ink": {"color": "#1c1510", "outer_px": 3.0, "outer_min_ratio": 0.5, "calligraphy_angle_deg": 60.0,
            "wobble_px": 0.5, "freestyle_crease_deg": None},
}


# ----------------------------------------------------------------------------- 参数与配置

def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(description="等距 2.5D 粗墨线双光影批量烘培脚本")
    p.add_argument("--input", required=True, help="单个模型文件或模型目录")
    p.add_argument("--out", required=True, help="输出目录")
    p.add_argument("--manifest", default="", help="assets_manifest.json 路径")
    p.add_argument("--profile", default="", help="style_profile.json 路径（默认自动查找）")
    p.add_argument("--mode", default="stylized", choices=["stylized", "classic"])
    p.add_argument("--scale", type=float, default=1.0, help="stylized：px_per_meter 倍率，预览用 0.5")
    p.add_argument("--res", type=int, default=None, help="classic：方形分辨率")
    p.add_argument("--samples", type=int, default=None, help="Cycles 采样数（默认 manifest 或 48）")
    p.add_argument("--ink-width", type=float, default=None, help="外轮廓墨线像素宽度（覆盖 profile）")
    p.add_argument("--ink-hex", default=None, help="墨线颜色")
    p.add_argument("--elevation", type=float, default=None, help="相机俯角，30 = 标准 2:1")
    p.add_argument("--device", default="auto", choices=["auto", "OPTIX", "CUDA", "METAL", "CPU"])
    p.add_argument("--overwrite", action="store_true", help="覆盖已存在的输出")
    p.add_argument("--skip-stylize", action="store_true", help="stylized：只渲染通道，不做后处理")
    return p.parse_args(argv)


def load_json(path):
    if path and os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def deep_merge(base, override):
    out = dict(base)
    for k, v in (override or {}).items():
        out[k] = deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def find_profile(explicit):
    candidates = [explicit] if explicit else []
    candidates += [str(SCRIPT_DIR.parent / "style" / "style_profile.json"), str(SCRIPT_DIR / "style_profile.json")]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return ""


def hex_to_linear_rgb(hex_str):
    h = hex_str.lstrip("#")
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(int(h[i:i + 2], 16)) for i in (0, 2, 4))


def parse_footprint(fp, angle):
    try:
        a, b = (float(x) for x in str(fp).lower().split("x"))
    except ValueError:
        a, b = 1.0, 1.0
    if int(round(angle)) % 180 == 90:
        a, b = b, a
    return a, b


# ----------------------------------------------------------------------------- 场景

def reset_scene(stylized):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.film_transparent = True
    scene.render.resolution_percentage = 100
    if stylized:
        # 通道是线性数据，色调映射由 stylize_sprites.py 自己做
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "None"
    else:
        try:
            scene.view_settings.view_transform = "AgX"
            scene.view_settings.look = "AgX - Medium High Contrast"
        except Exception:
            scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = 0.0
    return scene


def configure_device(scene, pref):
    addon = bpy.context.preferences.addons.get("cycles")
    if pref == "CPU" or addon is None:
        scene.cycles.device = "CPU"
        print("BAKE_DEVICE: CPU", flush=True)
        return
    prefs = addon.preferences
    candidates = ["OPTIX", "CUDA", "METAL"] if pref == "auto" else [pref]
    for backend in candidates:
        try:
            prefs.compute_device_type = backend
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == backend]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == backend
                scene.cycles.device = "GPU"
                print(f"BAKE_DEVICE: {backend} ({len(gpus)} GPU)", flush=True)
                return
        except Exception:
            continue
    scene.cycles.device = "CPU"
    print("BAKE_DEVICE: CPU (GPU fallback)", flush=True)


def configure_cycles(scene, res_x, res_y, samples):
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.use_denoising = True
    try:
        scene.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 2
    scene.cycles.transparent_max_bounces = 8


def set_output_png(scene):
    s = scene.render.image_settings
    try:
        s.media_type = "IMAGE"
    except Exception:
        pass
    s.file_format = "PNG"
    s.color_mode = "RGBA"
    s.color_depth = "8"
    s.compression = 15


def set_output_multilayer_exr(scene):
    s = scene.render.image_settings
    try:
        s.media_type = "MULTI_LAYER_IMAGE"  # Blender 5.x
        s.file_format = "OPEN_EXR"
    except Exception:
        s.file_format = "OPEN_EXR_MULTILAYER"  # Blender 4.x
    s.color_depth = "32"
    s.exr_codec = "ZIP"


def enable_passes(scene):
    vl = scene.view_layers[0]
    vl.use_pass_combined = True
    vl.use_pass_z = True
    vl.use_pass_normal = True
    vl.use_pass_diffuse_color = True
    vl.use_pass_object_index = True
    vl.use_pass_ambient_occlusion = True


def ensure_no_ink_collection(scene):
    col = bpy.data.collections.get(NO_INK_COLLECTION) or bpy.data.collections.new(NO_INK_COLLECTION)
    if col.name not in scene.collection.children:
        scene.collection.children.link(col)
    return col


def configure_freestyle(scene, ink, px_scale, as_pass, crease_deg):
    """外轮廓墨线：书法笔触（随方向粗细变化）+ 轻微手绘抖动。px_scale = 超采样 × 预览倍率。"""
    scene.render.use_freestyle = True
    scene.render.line_thickness_mode = "ABSOLUTE"
    width = float(ink["outer_px"]) * px_scale
    # 注意：ABSOLUTE 模式下全局 line_thickness 是线型粗细的“倍率”，必须保持 1.0，粗细只在线型里设
    scene.render.line_thickness = 1.0

    vl = scene.view_layers[0]
    fs = vl.freestyle_settings
    fs.as_render_pass = as_pass
    if crease_deg:
        fs.crease_angle = math.radians(float(crease_deg))
    while len(fs.linesets) > 0:
        fs.linesets.remove(fs.linesets[0])

    ls = fs.linesets.new("MingQingInkOutline")
    ls.select_silhouette = True
    ls.select_border = True
    ls.select_external_contour = True
    ls.select_crease = bool(crease_deg)
    ls.select_edge_mark = False
    ls.edge_type_combination = "OR"
    ls.select_by_collection = True
    ls.collection = ensure_no_ink_collection(scene)
    ls.collection_negation = "EXCLUSIVE"

    style = ls.linestyle
    style.color = hex_to_linear_rgb(ink["color"])
    style.thickness = width
    style.thickness_position = "CENTER"
    style.caps = "ROUND"
    style.chaining = "PLAIN"
    style.use_same_object = False

    ratio = float(ink.get("outer_min_ratio", 1.0))
    if ratio < 0.999:
        brush = style.thickness_modifiers.new(name="Calligraphy", type="CALLIGRAPHY")
        brush.orientation = math.radians(float(ink.get("calligraphy_angle_deg", 60.0)))
        brush.thickness_min = width * ratio
        brush.thickness_max = width
        brush.blend = "MIX"
        brush.influence = 1.0
    wobble = float(ink.get("wobble_px", 0.0)) * px_scale
    if wobble > 0:
        noise = style.geometry_modifiers.new(name="HandWobble", type="PERLIN_NOISE_1D")
        noise.frequency = 6.0
        noise.amplitude = wobble
        noise.octaves = 2
        noise.seed = 7


# ----------------------------------------------------------------------------- 模型

def import_model(filepath):
    ext = filepath.suffix.lower()
    before = set(bpy.data.objects)
    if ext in {".glb", ".gltf"}:
        bpy.ops.import_scene.gltf(filepath=str(filepath))
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=str(filepath))
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(filepath))
    else:
        raise ValueError(f"Unsupported extension: {ext}")
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh found in {filepath}")
    root = bpy.data.objects.new(f"ROOT_{filepath.stem}", None)
    bpy.context.collection.objects.link(root)
    for o in imported:
        if o.parent is None:
            o.parent = root
    for o in meshes:
        o.pass_index = OBJECT_PASS_INDEX
    return root, meshes


def make_materials_matte(meshes):
    """工笔/木刻没有高光：去掉金属度、镜面与清漆，粗糙度拉满。"""
    zero_inputs = ["Metallic", "Specular IOR Level", "Specular", "Coat Weight", "Sheen Weight",
                   "Transmission Weight"]
    seen = set()
    for obj in meshes:
        for slot in obj.material_slots:
            mat = slot.material
            if mat is None or mat.name in seen or not mat.use_nodes:
                continue
            seen.add(mat.name)
            for node in mat.node_tree.nodes:
                if node.type != "BSDF_PRINCIPLED":
                    continue
                for name in zero_inputs:
                    sock = node.inputs.get(name)
                    if sock is not None and not sock.is_linked:
                        sock.default_value = 0.0
                rough = node.inputs.get("Roughness")
                if rough is not None:
                    for link in list(rough.links):
                        mat.node_tree.links.remove(link)
                    rough.default_value = 1.0
                metal = node.inputs.get("Metallic")
                if metal is not None:
                    for link in list(metal.links):
                        mat.node_tree.links.remove(link)
                    metal.default_value = 0.0


def world_bbox(meshes):
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    bmin = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    bmax = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return bmin, bmax


def base_extent(meshes, bmin, bmax, frac):
    """模型底部 frac 高度以内的顶点水平跨度（台基/柱脚）。屋檐、树冠可以出格，底座必须在格子里。"""
    import numpy as np
    zcut = bmin.z + (bmax.z - bmin.z) * frac
    xs_min, xs_max, ys_min, ys_max = [], [], [], []
    for o in meshes:
        n = len(o.data.vertices)
        if n == 0:
            continue
        co = np.empty(n * 3, dtype=np.float64)
        o.data.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        m = np.array(o.matrix_world, dtype=np.float64)
        w = co @ m[:3, :3].T + m[:3, 3]
        w = w[w[:, 2] <= zcut]
        if len(w):
            xs_min.append(w[:, 0].min()); xs_max.append(w[:, 0].max())
            ys_min.append(w[:, 1].min()); ys_max.append(w[:, 1].max())
    if not xs_min:
        return bmax.x - bmin.x, bmax.y - bmin.y
    return max(xs_max) - min(xs_min), max(ys_max) - min(ys_min)


def normalize_asset(root, meshes, target_h, fit, fp_m, fill, base_frac=0.25):
    """高度对齐 target_h；fit=height_clamped 时同时保证底座（底部 25% 高度）不超出占地格。"""
    bmin, bmax = world_bbox(meshes)
    size = bmax - bmin
    s_h = target_h / size.z if size.z > 1e-4 else 1.0
    s, limited_by = s_h, "height"
    if fit == "height_clamped" and fp_m:
        bx, by = base_extent(meshes, bmin, bmax, base_frac)
        s_x = fill * fp_m[0] / max(bx, 1e-4)
        s_y = fill * fp_m[1] / max(by, 1e-4)
        if min(s_x, s_y) < s_h:
            s, limited_by = min(s_x, s_y), "footprint"
    root.scale = (s, s, s)
    bpy.context.view_layer.update()
    bmin, bmax = world_bbox(meshes)
    root.location = (-(bmin.x + bmax.x) * 0.5, -(bmin.y + bmax.y) * 0.5, -bmin.z)
    bpy.context.view_layer.update()
    bmin, bmax = world_bbox(meshes)
    return bmin, bmax, limited_by


def create_shadow_catcher(size_xy):
    bpy.ops.mesh.primitive_plane_add(size=max(16.0, size_xy * 4.0), location=(0, 0, -0.002))
    plane = bpy.context.active_object
    plane.name = "GroundShadowCatcher"
    plane.is_shadow_catcher = True
    plane.pass_index = 0
    no_ink = bpy.data.collections[NO_INK_COLLECTION]
    for col in list(plane.users_collection):
        col.objects.unlink(plane)
    no_ink.objects.link(plane)
    return plane


# ----------------------------------------------------------------------------- 相机

def camera_rotation(elevation_deg, azimuth_deg):
    return Euler((math.radians(90.0 - elevation_deg), 0.0, math.radians(azimuth_deg)), "XYZ")


def light_direction(euler_deg):
    """太阳光在 Blender 里沿自身 −Z 方向照射，返回传播方向（世界坐标）。"""
    rot = Euler(tuple(math.radians(a) for a in euler_deg), "XYZ").to_matrix()
    return rot @ Vector((0.0, 0.0, -1.0))


def frame_points(bmin, bmax, sun_dir):
    """包围盒 8 角 + 顶面 4 角沿主光投到地面的阴影点，保证阴影不被裁掉。"""
    pts = [Vector((x, y, z)) for x in (bmin.x, bmax.x) for y in (bmin.y, bmax.y) for z in (bmin.z, bmax.z)]
    if sun_dir.z < -1e-3:
        for x in (bmin.x, bmax.x):
            for y in (bmin.y, bmax.y):
                top = Vector((x, y, bmax.z))
                t = -top.z / sun_dir.z
                pts.append(top + sun_dir * t)
    return pts


def setup_camera_fixed_scale(scene, points, ppm, margin_px, multiple, elevation, azimuth):
    """固定 px_per_meter 的正交相机：画布按投影跨度自适应。返回 (res_x, res_y, anchor_uv, ortho_w)。"""
    cam_data = bpy.data.cameras.new("IsoCam")
    cam_data.type = "ORTHO"
    cam_data.sensor_fit = "HORIZONTAL"
    cam = bpy.data.objects.new("IsoCam", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam

    rot = camera_rotation(elevation, azimuth).to_matrix()
    right, up, forward = rot.col[0], rot.col[1], -rot.col[2]
    xs = [p.dot(right) for p in points]
    ys = [p.dot(up) for p in points]
    margin_m = margin_px / ppm
    span_x = max(xs) - min(xs) + 2 * margin_m
    span_y = max(ys) - min(ys) + 2 * margin_m
    res_x = int(math.ceil(span_x * ppm / multiple) * multiple)
    res_y = int(math.ceil(span_y * ppm / multiple) * multiple)
    cx = (max(xs) + min(xs)) * 0.5
    cy = (max(ys) + min(ys)) * 0.5

    dist = 60.0
    cam.rotation_euler = camera_rotation(elevation, azimuth)
    cam.location = right * cx + up * cy - forward * dist
    cam_data.clip_start = 0.1
    cam_data.clip_end = dist * 2.5
    ortho_w = res_x / ppm
    cam_data.ortho_scale = ortho_w

    # 世界原点（占地中心、地面）在画面中的位置（0–1，自上而下）
    anchor_u = 0.5 + (0.0 - cx) / ortho_w
    anchor_v = 0.5 - (0.0 - cy) / (res_y / ppm)
    return res_x, res_y, (anchor_u, anchor_v), ortho_w


def setup_camera_autofit_square(scene, bmin, bmax, padding, elevation):
    """classic 模式（v1 行为）：方形画布，包围盒自动撑满。"""
    cam_data = bpy.data.cameras.new("IsoCam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("IsoCam", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    cam.rotation_euler = camera_rotation(elevation, 45.0)
    center = Vector((0.0, 0.0, (bmin.z + bmax.z) * 0.46))
    forward = cam.rotation_euler.to_matrix() @ Vector((0.0, 0.0, -1.0))
    cam.location = center - forward * 32.0
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    loc = [inv @ Vector((x, y, z)) for x in (bmin.x, bmax.x) for y in (bmin.y, bmax.y) for z in (bmin.z, bmax.z)]
    span = max(max(p.x for p in loc) - min(p.x for p in loc), max(p.y for p in loc) - min(p.y for p in loc))
    cam_data.ortho_scale = max(2.2, span * padding)
    o = inv @ Vector((0.0, 0.0, 0.0))
    return (0.5 + o.x / cam_data.ortho_scale, 0.5 - o.y / cam_data.ortho_scale), cam_data.ortho_scale


# ----------------------------------------------------------------------------- 灯光

def clear_lights():
    for obj in list(bpy.data.objects):
        if obj.type == "LIGHT":
            bpy.data.objects.remove(obj, do_unlink=True)


def set_world(scene, hex_color, strength):
    if scene.world is None:
        scene.world = bpy.data.worlds.new("BakeWorld")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (*hex_to_linear_rgb(hex_color), 1.0)
        bg.inputs[1].default_value = strength


def add_sun(name, euler_deg, energy, hex_color, angle_deg=2.0, shadow=True):
    data = bpy.data.lights.new(name, type="SUN")
    data.energy = energy
    data.color = hex_to_linear_rgb(hex_color)
    data.angle = math.radians(angle_deg)
    data.use_shadow = shadow
    obj = bpy.data.objects.new(name, data)
    obj.rotation_euler = Euler(tuple(math.radians(a) for a in euler_deg), "XYZ")
    bpy.context.collection.objects.link(obj)
    return obj


def setup_day_lighting(scene, cfg):
    clear_lights()
    set_world(scene, cfg["world_color"], cfg["world_strength"])
    add_sun("DaySun", cfg["sun_euler_deg"], cfg["sun_energy"], cfg["sun_color"], cfg.get("sun_angle_deg", 3.0))
    add_sun("DayFill", cfg["fill_euler_deg"], cfg["fill_energy"], cfg["fill_color"], 10.0, shadow=False)


def setup_night_lighting(scene, cfg, lamp_cfg, bmax):
    clear_lights()
    set_world(scene, cfg["world_color"], cfg["world_strength"])
    # 月光不投影：夜晚精灵沿用白昼的地影（后处理里减淡），避免月影落到画布外被裁
    add_sun("NightMoon", cfg["moon_euler_deg"], cfg["moon_energy"], cfg["moon_color"], 6.0, shadow=False)
    if lamp_cfg and lamp_cfg.get("enabled", False):
        energy = float(lamp_cfg.get("energy", 75.0))
        lz = float(lamp_cfg.get("z", max(1.0, bmax.z * 0.42)))
        front = max(1.2, max(bmax.x, bmax.y) * 0.88)
        data = bpy.data.lights.new("WarmLantern", type="POINT")
        data.energy = energy
        data.color = hex_to_linear_rgb(cfg.get("lantern_color", "#ff9a3c"))
        data.shadow_soft_size = 0.45
        data.use_shadow = False  # 低位点光的影子会无限拉长出画布
        lamp = bpy.data.objects.new("WarmLantern", data)
        # 放在正面（−Y）偏左，暖光主要照亮门窗所在的正面
        lamp.location = (-front * 0.25, -front * 0.95, lz)
        bpy.context.collection.objects.link(lamp)


def setup_classic_day(scene):
    clear_lights()
    set_world(scene, "#c6d6cf", 0.72)
    add_sun("DaySun", (48, 16, 28), 3.4, "#fff0d2", 4.5)
    add_sun("DayFill", (60, 0, -135), 0.85, "#c2e1ff", 10.0, shadow=False)


# ----------------------------------------------------------------------------- 主流程

def render_to(scene, path):
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def bake_single_model(model_path, out_dir, manifest, profile, profile_path, args):
    asset_id = model_path.stem
    defaults = manifest.get("defaults", {})
    item = {a["id"]: a for a in manifest.get("assets", [])}.get(asset_id, {})
    if not item:
        print(f"WARN {asset_id} 不在 manifest 中，使用默认尺寸", flush=True)

    def pick(cli_value, key, fallback):
        if cli_value is not None:
            return cli_value
        return item.get(key, defaults.get(key, fallback))

    stylized = args.mode == "stylized"
    sc, cam_cfg, light_cfg = profile["scale"], profile["camera"], profile["lighting"]
    ink = dict(profile["ink"])
    if args.ink_width is not None:
        ink["outer_px"] = args.ink_width
    elif "ink_width" in item or "ink_width" in defaults:
        ink["outer_px"] = float(item.get("ink_width", defaults.get("ink_width")))
    if args.ink_hex:
        ink["color"] = args.ink_hex

    samples = int(pick(args.samples, "samples", 48))
    elevation = float(pick(args.elevation, "camera_elevation_deg", cam_cfg["elevation_deg"]))
    target_h = float(item.get("target_height_m", 3.5))
    fit = item.get("fit", defaults.get("fit", "height_clamped"))
    angles = item.get("angles", defaults.get("angles", [0]))
    lamp_cfg = item.get("night_light", {"enabled": True, "energy": 60, "z": target_h * 0.4})
    ppm = float(sc["px_per_meter"]) * args.scale
    ss = max(1, int(sc.get("supersample", 1))) if stylized else 1
    pass_dir = out_dir / "_passes"

    for angle in angles:
        suffix = "" if len(angles) == 1 and angle == 0 else f"_a{angle}"
        stem = f"{asset_id}{suffix}"
        final_files = [out_dir / f"{stem}_day.png", out_dir / f"{stem}_night.png", out_dir / f"{stem}_meta.json"]
        if not args.overwrite and all(p.exists() for p in final_files):
            print(f"SKIP {stem} (already baked)", flush=True)
            continue

        t0 = time.time()
        scene = reset_scene(stylized)
        configure_device(scene, args.device)
        ensure_no_ink_collection(scene)

        root, meshes = import_model(model_path)
        root.rotation_euler = Euler((0.0, 0.0, math.radians(angle)), "XYZ")
        fp_cells = parse_footprint(item.get("footprint", "1x1"), angle)
        fp_m = (fp_cells[0] * sc["tile_size_m"], fp_cells[1] * sc["tile_size_m"])
        bmin, bmax, limited_by = normalize_asset(root, meshes, target_h, fit, fp_m, float(sc["footprint_fill"]))
        create_shadow_catcher(max(bmax.x - bmin.x, bmax.y - bmin.y))

        if not stylized:
            res = int(pick(args.res, "res", 768))
            configure_cycles(scene, res, res, samples)
            configure_freestyle(scene, dict(ink, outer_min_ratio=1.0, wobble_px=0.0), 1.0, False, 128.0)
            anchor_uv, ortho = setup_camera_autofit_square(scene, bmin, bmax, 1.38, elevation)
            set_output_png(scene)
            setup_classic_day(scene)
            render_to(scene, final_files[0])
            setup_night_lighting(scene, light_cfg["night"], lamp_cfg, bmax)
            render_to(scene, final_files[1])
            meta = {"id": asset_id, "name": item.get("name", asset_id), "angle": angle, "mode": "classic",
                    "resolution": [res, res], "anchor_uv": [round(anchor_uv[0], 4), round(anchor_uv[1], 4)],
                    "anchor_px": [round(anchor_uv[0] * res), round(anchor_uv[1] * res)],
                    "ortho_scale": round(ortho, 3), "px_per_meter": round(res / ortho, 3),
                    "camera_elevation_deg": elevation, "day_file": final_files[0].name,
                    "night_file": final_files[1].name}
            with open(final_files[2], "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)
            print(f"BAKED {stem} classic ({res}px, {samples}spp) in {time.time() - t0:.1f}s", flush=True)
            continue

        make_materials_matte(meshes)
        sun_dir = light_direction(light_cfg["day"]["sun_euler_deg"])
        res_x, res_y, anchor_uv, ortho_w = setup_camera_fixed_scale(
            scene, frame_points(bmin, bmax, sun_dir), ppm, float(sc["margin_px"]) * args.scale,
            int(sc["canvas_multiple"]), elevation, float(cam_cfg["azimuth_deg"]))
        configure_cycles(scene, res_x * ss, res_y * ss, samples)
        configure_freestyle(scene, ink, ss * args.scale, True, ink.get("freestyle_crease_deg"))
        enable_passes(scene)
        set_output_multilayer_exr(scene)
        pass_dir.mkdir(parents=True, exist_ok=True)

        day_exr, night_exr = pass_dir / f"{stem}_day.exr", pass_dir / f"{stem}_night.exr"
        setup_day_lighting(scene, light_cfg["day"])
        render_to(scene, day_exr)
        setup_night_lighting(scene, light_cfg["night"], lamp_cfg, bmax)
        render_to(scene, night_exr)

        tile_w = math.sqrt(2) * sc["tile_size_m"] * ppm
        render_info = {
            "id": asset_id, "name": item.get("name", asset_id), "angle": angle, "mode": "stylized",
            "stem": stem, "day_exr": day_exr.name, "night_exr": night_exr.name,
            "resolution": [res_x, res_y], "supersample": ss, "preview_scale": args.scale,
            "anchor_uv": [round(anchor_uv[0], 5), round(anchor_uv[1], 5)],
            "anchor_px": [round(anchor_uv[0] * res_x, 2), round(anchor_uv[1] * res_y, 2)],
            "px_per_meter": ppm, "ortho_width_m": round(ortho_w, 4),
            "camera_elevation_deg": elevation, "camera_azimuth_deg": cam_cfg["azimuth_deg"],
            "tile_size_m": sc["tile_size_m"],
            "tile_px": [round(tile_w, 2), round(tile_w * math.sin(math.radians(elevation)), 2)],
            "footprint": item.get("footprint", "1x1"), "fit_limited_by": limited_by,
            "target_height_m": target_h, "actual_height_m": round(bmax.z - bmin.z, 3),
            "actual_size_m": [round(bmax.x - bmin.x, 3), round(bmax.y - bmin.y, 3)],
            "front_faces": "screen lower-left (Blender -Y / glTF +Z)",
            "samples": samples, "night_light": lamp_cfg,
        }
        with open(pass_dir / f"{stem}_render.json", "w", encoding="utf-8") as f:
            json.dump(render_info, f, ensure_ascii=False, indent=2)
        print(f"RENDERED {stem} {res_x}x{res_y} (x{ss} supersample, {samples}spp) in {time.time() - t0:.1f}s",
              flush=True)

        if not args.skip_stylize:
            stylize_mod = import_stylizer()
            t1 = time.time()
            stylize_mod.stylize_asset(pass_dir / f"{stem}_render.json", out_dir, profile_path)
            print(f"BAKED {stem} stylized in {time.time() - t1:.1f}s", flush=True)


def import_stylizer():
    for d in (SCRIPT_DIR.parent / "style", SCRIPT_DIR):
        if (d / "stylize_sprites.py").exists():
            if str(d) not in sys.path:
                sys.path.insert(0, str(d))
            import stylize_sprites  # noqa: E402
            return stylize_sprites
    raise FileNotFoundError("找不到 stylize_sprites.py（应在 pipeline/style/ 或与本脚本同目录）")


def main():
    args = parse_args()
    in_path = Path(args.input).expanduser().resolve()
    out_dir = Path(args.out).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = load_json(args.manifest)
    profile_path = find_profile(args.profile)
    profile = deep_merge(BUILTIN_PROFILE, load_json(profile_path))
    print(f"PROFILE: {profile_path or '(builtin)'} | MODE: {args.mode}", flush=True)

    if in_path.is_file():
        files = [in_path]
    elif in_path.is_dir():
        files = sorted(p for p in in_path.iterdir() if p.suffix.lower() in SUPPORTED_EXTS)
    else:
        raise FileNotFoundError(f"Input path not found: {in_path}")
    if not files:
        print(f"No 3D models found in {in_path}", flush=True)
        return

    print(f"START_BAKE: {len(files)} model(s) -> {out_dir}", flush=True)
    failed = []
    for model_path in files:
        try:
            bake_single_model(model_path, out_dir, manifest, profile, profile_path, args)
        except Exception as exc:  # 单件失败不中断批量
            import traceback
            traceback.print_exc()
            print(f"Error baking {model_path.name}: {exc}", flush=True)
            failed.append(model_path.name)
    print("ALL_BAKED_DONE" + (f" (failed: {failed})" if failed else ""), flush=True)
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
