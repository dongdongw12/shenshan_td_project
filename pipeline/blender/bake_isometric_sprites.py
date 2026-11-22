"""
《深山传家：开荒守寨》Blender 4.x / 5.0 自动等距双光影烘培脚本（路线 B）

功能：
1. 导入单个或整批 .glb / .gltf / .obj 建筑模型；
2. 自动按 assets_manifest.json 归一化物理高度、水平居中、底面归零（min_z = 0）；
3. 设置标准 2:1 等距正交相机（俯角 35.264°，方位角 45°）与透明背景；
4. 开启 Freestyle 饱满粗墨线描边（明清木刻/工笔风格）；
5. 自动烘培并输出两套像素完全对齐的高清 PNG + 锚点元数据：
   - <id>_a<angle>_day.png   （白昼矿物重彩 + 柔和落地接触阴影）
   - <id>_a<angle>_night.png （深靛蓝夜色 + 门窗/灯笼暖橙辉光）
   - <id>_a<angle>_meta.json （像素尺寸、脚点锚点、正交视野宽度，供引擎直接对齐）

用法示例：
  blender -b -P pipeline/blender/bake_isometric_sprites.py -- \
    --input pipeline/raw_models \
    --out pipeline/baked_sprites \
    --manifest assets_manifest.json \
    --res 768 --samples 48 --ink-width 2.6 --device auto
"""

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

import bpy
from mathutils import Euler, Vector


SUPPORTED_EXTS = {".glb", ".gltf", ".obj", ".fbx"}


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    p = argparse.ArgumentParser(description="等距 2.5D 粗墨线双光影批量烘培脚本")
    p.add_argument("--input", required=True, help="单个模型文件或模型目录路径")
    p.add_argument("--out", required=True, help="输出 PNG 与 JSON 目录")
    p.add_argument("--manifest", default="", help="可选 assets_manifest.json 路径")
    p.add_argument("--res", type=int, default=768, help="输出方形分辨率（默认 768）")
    p.add_argument("--samples", type=int, default=48, help="Cycles 采样数（默认 48）")
    p.add_argument("--ink-width", type=float, default=2.6, help="Freestyle 粗墨线像素宽度")
    p.add_argument("--ink-hex", default="#1c1510", help="墨线颜色（十六进制）")
    p.add_argument("--device", default="auto", choices=["auto", "OPTIX", "CUDA", "CPU"])
    p.add_argument("--overwrite", action="store_true", help="覆盖已存在的输出文件")
    return p.parse_args(argv)


def hex_to_linear_rgb(hex_str: str):
    h = hex_str.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    def srgb_to_lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (srgb_to_lin(r), srgb_to_lin(g), srgb_to_lin(b))


def load_manifest(manifest_path: str):
    if not manifest_path or not os.path.exists(manifest_path):
        return {}, {}
    with open(manifest_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    defaults = data.get("defaults", {})
    by_id = {item["id"]: item for item in data.get("assets", [])}
    return defaults, by_id


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 15

    # 色彩管理：保留饱和矿物重彩不发灰
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = 0.0
    return scene


def configure_device(scene, pref_device: str):
    prefs = bpy.context.preferences.addons.get("cycles")
    if pref_device == "CPU" or prefs is None:
        scene.cycles.device = "CPU"
        print("BAKE_DEVICE: CPU", flush=True)
        return

    c_prefs = prefs.preferences
    candidates = ["OPTIX", "CUDA"] if pref_device == "auto" else [pref_device]
    for backend in candidates:
        try:
            c_prefs.compute_device_type = backend
            c_prefs.get_devices()
            gpus = [d for d in c_prefs.devices if d.type == backend]
            if gpus:
                for d in c_prefs.devices:
                    d.use = d.type == backend
                scene.cycles.device = "GPU"
                print(f"BAKE_DEVICE: {backend} ({len(gpus)} GPU)", flush=True)
                return
        except Exception:
            continue

    scene.cycles.device = "CPU"
    print("BAKE_DEVICE: CPU (GPU fallback)", flush=True)


def configure_render_quality(scene, res: int, samples: int, ink_width: float, ink_hex: str):
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    scene.render.resolution_percentage = 100

    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.025
    scene.cycles.use_denoising = True
    try:
        scene.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 3
    scene.cycles.transparent_max_bounces = 8

    # 开启 Freestyle 粗墨线描边（轮廓 + 折痕 + 边界）
    scene.render.use_freestyle = True
    scene.render.line_thickness_mode = "ABSOLUTE"
    scene.render.line_thickness = ink_width

    view_layer = scene.view_layers[0]
    fs = view_layer.freestyle_settings
    fs.crease_angle = math.radians(128.0)

    while len(fs.linesets) > 0:
        fs.linesets.remove(fs.linesets[0])

    ls = fs.linesets.new("MingQingInkOutline")
    ls.select_silhouette = True
    ls.select_border = True
    ls.select_crease = True
    ls.select_external_contour = True
    ls.select_edge_mark = False
    ls.edge_type_combination = "OR"

    style = ls.linestyle
    style.color = hex_to_linear_rgb(ink_hex)
    style.thickness = ink_width
    style.thickness_position = "CENTER"
    style.caps = "ROUND"
    style.chaining = "PLAIN"
    style.use_same_object = False


def import_model(filepath: Path):
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

    imported = [obj for obj in bpy.data.objects if obj not in before]
    meshes = [obj for obj in imported if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh found in {filepath}")

    # 创建父空物体统一控制缩放与旋转
    root = bpy.data.objects.new(f"ROOT_{filepath.stem}", None)
    bpy.context.collection.objects.link(root)
    for obj in imported:
        if obj.parent is None:
            obj.parent = root
    return root, meshes


def world_bbox(meshes):
    bpy.context.view_layer.update()
    xs, ys, zs = [], [], []
    for obj in meshes:
        for corner in obj.bound_box:
            wc = obj.matrix_world @ Vector(corner)
            xs.append(wc.x)
            ys.append(wc.y)
            zs.append(wc.z)
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def normalize_asset(root, meshes, target_height_m: float):
    bmin, bmax = world_bbox(meshes)
    size = bmax - bmin
    if size.z > 1e-4 and target_height_m > 0:
        s = target_height_m / size.z
        root.scale = (s, s, s)
        bpy.context.view_layer.update()
        bmin, bmax = world_bbox(meshes)

    center_x = (bmin.x + bmax.x) * 0.5
    center_y = (bmin.y + bmax.y) * 0.5
    root.location = (-center_x, -center_y, -bmin.z)
    bpy.context.view_layer.update()
    return world_bbox(meshes)


def create_shadow_catcher(size_xy: float):
    bpy.ops.mesh.primitive_plane_add(size=max(12.0, size_xy * 3.5), location=(0, 0, -0.002))
    plane = bpy.context.active_object
    plane.name = "GroundShadowCatcher"
    plane.is_shadow_catcher = True
    # 地面不参与 Freestyle 描边，防止出现外框黑线
    plane.visible_diffuse = True
    return plane


def setup_isometric_camera(scene, bmin: Vector, bmax: Vector, padding: float):
    cam_data = bpy.data.cameras.new("IsoCam")
    cam_data.type = "ORTHO"
    cam_obj = bpy.data.objects.new("IsoCam", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    # 标准 2:1 等距视角：X 轴俯角 54.736°（即水平俯视 35.264°），Z 轴旋转 45°
    cam_obj.rotation_euler = Euler((math.radians(54.7356), 0.0, math.radians(45.0)), "XYZ")

    # 让画面视觉中心略高于地面中心，保证底座与屋脊都在安全区内
    center = Vector((0.0, 0.0, (bmin.z + bmax.z) * 0.46))
    dist = 32.0
    forward = cam_obj.rotation_euler.to_matrix() @ Vector((0.0, 0.0, -1.0))
    cam_obj.location = center - forward * dist

    # 计算包围盒在相机平面上的最大跨度，自动匹配 ortho_scale
    cam_inv = cam_obj.matrix_world.inverted()
    bpy.context.view_layer.update()
    proj_x, proj_y = [], []
    for x in (bmin.x, bmax.x):
        for y in (bmin.y, bmax.y):
            for z in (bmin.z, bmax.z):
                local = cam_inv @ Vector((x, y, z))
                proj_x.append(local.x)
                proj_y.append(local.y)

    span = max(max(proj_x) - min(proj_x), max(proj_y) - min(proj_y))
    cam_data.ortho_scale = max(2.2, span * padding)

    # 计算世界原点 (0,0,0) 在最终成图里的标准化锚点坐标，供引擎精准对齐脚底
    origin_local = cam_inv @ Vector((0.0, 0.0, 0.0))
    anchor_u = 0.5 + (origin_local.x / cam_data.ortho_scale)
    anchor_v = 0.5 - (origin_local.y / cam_data.ortho_scale)  # 从顶部向下（Canvas/PNG 坐标）
    return cam_obj, (round(anchor_u, 4), round(anchor_v, 4)), round(cam_data.ortho_scale, 3)


def clear_lights():
    for obj in list(bpy.data.objects):
        if obj.type == "LIGHT":
            bpy.data.objects.remove(obj, do_unlink=True)


def set_world_color(scene, rgb, strength: float):
    if scene.world is None:
        scene.world = bpy.data.worlds.new("BakeWorld")
    scene.world.use_nodes = True
    nodes = scene.world.node_tree.nodes
    bg = nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (*rgb, 1.0)
        bg.inputs[1].default_value = strength


def setup_day_lighting(scene):
    clear_lights()
    # 柔和青绿山谷天光，防止暗面死黑
    set_world_color(scene, (0.58, 0.68, 0.64), 0.72)

    # 主太阳光（暖阳，斜 45° 打出明快立体感）
    sun_data = bpy.data.lights.new("DaySun", type="SUN")
    sun_data.energy = 3.4
    sun_data.color = (1.0, 0.94, 0.82)
    sun_data.angle = math.radians(4.5)
    sun = bpy.data.objects.new("DaySun", sun_data)
    sun.rotation_euler = Euler((math.radians(48), math.radians(16), math.radians(28)), "XYZ")
    bpy.context.collection.objects.link(sun)

    # 辅补光（弱冷蓝天光从背面勾勒屋檐）
    fill_data = bpy.data.lights.new("DayFill", type="SUN")
    fill_data.energy = 0.85
    fill_data.color = (0.76, 0.88, 1.0)
    fill = bpy.data.objects.new("DayFill", fill_data)
    fill.rotation_euler = Euler((math.radians(60), 0.0, math.radians(-135)), "XYZ")
    bpy.context.collection.objects.link(fill)


def setup_night_lighting(scene, night_light_cfg: dict, bmax: Vector):
    clear_lights()
    # 深靛蓝夜空底色
    set_world_color(scene, (0.045, 0.075, 0.19), 0.55)

    # 银蓝月光轮廓灯
    moon_data = bpy.data.lights.new("NightMoon", type="SUN")
    moon_data.energy = 1.15
    moon_data.color = (0.48, 0.64, 1.0)
    moon_data.angle = math.radians(6.0)
    moon = bpy.data.objects.new("NightMoon", moon_data)
    moon.rotation_euler = Euler((math.radians(42), 0.0, math.radians(-118)), "XYZ")
    bpy.context.collection.objects.link(moon)

    # 建筑门窗 / 箭楼火把的暖橙灯火（仅对带灯建筑启用）
    if night_light_cfg and night_light_cfg.get("enabled", False):
        energy = float(night_light_cfg.get("energy", 75.0))
        lz = float(night_light_cfg.get("z", max(1.0, bmax.z * 0.42)))
        front_dist = max(1.2, max(bmax.x, bmax.y) * 0.88)

        lamp_data = bpy.data.lights.new("WarmLantern", type="POINT")
        lamp_data.energy = energy
        lamp_data.color = (1.0, 0.56, 0.18)
        lamp_data.shadow_soft_size = 0.45
        lamp = bpy.data.objects.new("WarmLantern", lamp_data)
        # 放在朝向相机（东南/正南门面）的位置，让门窗和屋檐泛暖光
        lamp.location = (front_dist * 0.72, -front_dist * 0.72, lz)
        bpy.context.collection.objects.link(lamp)


def bake_single_model(model_path: Path, out_dir: Path, defaults: dict, meta_by_id: dict, args):
    asset_id = model_path.stem
    item = meta_by_id.get(asset_id, {})

    res = int(item.get("res", defaults.get("res", args.res)))
    samples = int(item.get("samples", defaults.get("samples", args.samples)))
    ink_width = float(item.get("ink_width", defaults.get("ink_width", args.ink_width)))
    padding = float(item.get("ortho_padding", defaults.get("ortho_padding", 1.38)))
    target_h = float(item.get("target_height_m", 3.5))
    angles = item.get("angles", defaults.get("angles", [0]))
    night_cfg = item.get("night_light", {"enabled": True, "energy": 60, "z": target_h * 0.4})

    for angle in angles:
        suffix = "" if len(angles) == 1 and angle == 0 else f"_a{angle}"
        day_out = out_dir / f"{asset_id}{suffix}_day.png"
        night_out = out_dir / f"{asset_id}{suffix}_night.png"
        meta_out = out_dir / f"{asset_id}{suffix}_meta.json"

        if not args.overwrite and day_out.exists() and night_out.exists() and meta_out.exists():
            print(f"SKIP {asset_id}{suffix} (already baked)", flush=True)
            continue

        t0 = time.time()
        scene = reset_scene()
        configure_device(scene, args.device)
        configure_render_quality(scene, res, samples, ink_width, args.ink_hex)

        root, meshes = import_model(model_path)
        root.rotation_euler = Euler((0.0, 0.0, math.radians(angle)), "XYZ")
        bmin, bmax = normalize_asset(root, meshes, target_h)

        create_shadow_catcher(max(bmax.x - bmin.x, bmax.y - bmin.y))
        _, anchor_uv, ortho_scale = setup_isometric_camera(scene, bmin, bmax, padding)

        # 1) 烘培白昼精灵图
        setup_day_lighting(scene)
        scene.render.filepath = str(day_out)
        bpy.ops.render.render(write_still=True)

        # 2) 烘培黑夜点灯精灵图
        setup_night_lighting(scene, night_cfg, bmax)
        scene.render.filepath = str(night_out)
        bpy.ops.render.render(write_still=True)

        # 3) 写入引擎对齐元数据
        meta = {
            "id": asset_id,
            "name": item.get("name", asset_id),
            "angle": angle,
            "resolution": [res, res],
            "anchor_uv": list(anchor_uv),
            "anchor_px": [round(anchor_uv[0] * res), round(anchor_uv[1] * res)],
            "ortho_scale": ortho_scale,
            "target_height_m": target_h,
            "footprint": item.get("footprint", "1x1"),
            "day_file": day_out.name,
            "night_file": night_out.name,
        }
        with open(meta_out, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)

        dt = time.time() - t0
        print(f"BAKED {asset_id}{suffix} ({res}px, {samples}spp) in {dt:.1f}s", flush=True)


def main():
    args = parse_args()
    in_path = Path(args.input).expanduser().resolve()
    out_dir = Path(args.out).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    defaults, meta_by_id = load_manifest(args.manifest)

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
    for model_path in files:
        bake_single_model(model_path, out_dir, defaults, meta_by_id, args)
    print("ALL_BAKED_DONE", flush=True)


if __name__ == "__main__":
    main()
