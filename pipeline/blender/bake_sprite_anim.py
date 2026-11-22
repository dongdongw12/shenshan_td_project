"""
角色序列帧烘培：程序化角色（make_characters.py）逐帧渲染 → 与建筑完全相同的工笔风格化 → 横排精灵表。

每个角色输出两个朝向（客户端水平镜像得到另外两个）：
  front = 面朝屏幕左下（世界 −Y）；back = 面朝屏幕左上（世界 −X）
每个朝向白昼 / 夜晚各一张表：<id>_<dir>_<day|night>.png（夜晚版由白昼版调色得到，敌人身上没有灯，保持可读），以及 <id>_anim.json（帧尺寸、锚点、帧数、fps）。
同一角色两个朝向共用一个画布尺寸与锚点（脚底中心），帧与帧像素对齐。

用法：
  blender -b -P pipeline/blender/bake_sprite_anim.py -- --chars wolf,swordsman --out /tmp/chars --scale 0.5 --samples 16
"""

import argparse
import json
import math
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Euler, Vector

HERE = Path(__file__).resolve().parent
for d in (HERE, HERE.parent / "style"):
    if str(d) not in sys.path:
        sys.path.insert(0, str(d))
import bake_isometric_sprites as bk  # noqa: E402
import make_characters as mc  # noqa: E402
import stylize_sprites as st  # noqa: E402

DIRS = {"front": 0.0, "back": -90.0}
ACTIONS = {"walk": 8, "attack": 6}  # 动作: 帧数
VILLAGER_ACTIONS = {**ACTIONS, "work": 8}  # 家人多一个“干活”（刨地 / 插秧）
VILLAGERS = {"hero", "wife", "child"}
ACTION_FPS = {"attack": 12, "work": 8}


def actions_for(name):
    return VILLAGER_ACTIONS if name in VILLAGERS else ACTIONS


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--chars", default="wolf,swordsman")
    p.add_argument("--out", required=True)
    p.add_argument("--profile", default="")
    p.add_argument("--scale", type=float, default=1.0)
    p.add_argument("--samples", type=int, default=24)
    p.add_argument("--frames", type=int, default=8)
    p.add_argument("--fps", type=int, default=10)
    p.add_argument("--device", default="auto")
    return p.parse_args(argv)


def night_from_day(rgba, tint=(0.52, 0.6, 0.92), strength=0.75):
    """敌人身上没有灯：夜晚版直接由白昼版压成月下夜靛（保持可读，不像建筑那样压到很暗）。墨线保持墨色。"""
    rgb = rgba[..., :3]
    lum = rgb.mean(-1, keepdims=True)
    moon = rgb * np.array(tint, dtype=np.float32) * 0.85 + lum * 0.08
    out = rgb + (moon - rgb) * strength
    return np.concatenate([np.clip(out, 0, 1), rgba[..., 3:4]], axis=-1).astype(np.float32)


def frame_bbox(meshes, frames):
    pts = []
    for f in range(1, frames + 1):
        bpy.context.scene.frame_set(f)
        bmin, bmax = bk.world_bbox(meshes)
        pts += [Vector((x, y, z)) for x in (bmin.x, bmax.x) for y in (bmin.y, bmax.y) for z in (bmin.z, bmax.z)]
    return pts


def bake_char(name, out, profile, profile_path, args):
    sc, cam_cfg, light_cfg = profile["scale"], profile["camera"], profile["lighting"]
    ppm = float(sc["px_per_meter"]) * args.scale
    ss = max(1, int(sc.get("supersample", 1)))
    style = st.load_profile(profile_path or None)
    pass_dir = out / "_passes"
    pass_dir.mkdir(parents=True, exist_ok=True)

    # 先算两个朝向所有帧的联合包围盒，保证两个朝向画布一致
    all_pts = []
    for action, nfr in actions_for(name).items():
        for yaw in DIRS.values():
            bk.reset_scene(True)
            arm, meshes, frames = mc.build(name, nfr, action)
            arm.rotation_euler = Euler((0, 0, math.radians(yaw)), "XYZ")
            bpy.context.view_layer.update()
            all_pts += frame_bbox(meshes, frames)

    meta = None
    for action, nfr in actions_for(name).items():
      for dname, yaw in DIRS.items():
        t0 = time.time()
        scene = bk.reset_scene(True)
        bk.configure_device(scene, args.device)
        bk.ensure_no_ink_collection(scene)
        arm, meshes, frames = mc.build(name, nfr, action)
        for o in meshes:
            o.pass_index = bk.OBJECT_PASS_INDEX
        bk.make_materials_matte(meshes)
        arm.rotation_euler = Euler((0, 0, math.radians(yaw)), "XYZ")
        res_x, res_y, anchor_uv, _ = bk.setup_camera_fixed_scale(
            scene, all_pts, ppm, float(sc["margin_px"]) * args.scale * 0.5, int(sc["canvas_multiple"]),
            float(cam_cfg["elevation_deg"]), float(cam_cfg["azimuth_deg"]))
        bk.configure_cycles(scene, res_x * ss, res_y * ss, args.samples)
        ink = dict(profile["ink"])
        ink["outer_px"] = float(ink["outer_px"]) * 0.8  # 角色小，外轮廓略细一档
        bk.configure_freestyle(scene, ink, ss * args.scale, True, None)
        bk.enable_passes(scene)
        bk.set_output_multilayer_exr(scene)
        info = {"supersample": ss, "preview_scale": args.scale, "px_per_meter": ppm}
        bk.setup_day_lighting(scene, light_cfg["day"])
        day_frames = []
        for f in range(1, frames + 1):
            scene.frame_set(f)
            path = pass_dir / f"{name}_{action}_{dname}_{f:02d}.exr"
            bk.render_to(scene, path)
            passes = st.read_exr_passes(path)
            C, A = st.stylize_image(passes, passes, style, info, "day")
            day_frames.append(st.finalize(C, A, res_x, res_y))
        day_sheet = np.concatenate(day_frames, axis=1)
        suffix = "" if action == "walk" else f"_{action}"
        st.write_png(out / f"{name}_{dname}{suffix}_day.png", day_sheet)
        st.write_png(out / f"{name}_{dname}{suffix}_night.png", night_from_day(day_sheet))
        meta = meta or {
            "id": name, "frames": ACTIONS["walk"], "fps": args.fps, "frame_size": [res_x, res_y],
            "anchor_px": [round(anchor_uv[0] * res_x, 2), round(anchor_uv[1] * res_y, 2)],
            "px_per_meter": ppm, "dirs": {}, "actions": {},
            "mirror_note": "front=面朝左下、back=面朝左上；朝右的两个方向水平镜像",
        }
        files = {"day": f"{name}_{dname}{suffix}_day.png", "night": f"{name}_{dname}{suffix}_night.png"}
        if action == "walk":
            meta["dirs"][dname] = files
        act = meta["actions"].setdefault(action, {"frames": frames, "fps": ACTION_FPS.get(action, args.fps), "dirs": {}})
        act["dirs"][dname] = files
        print(f"BAKED_ANIM {name}/{action}/{dname} {frames}f {res_x}x{res_y} in {time.time() - t0:.1f}s", flush=True)
    with open(out / f"{name}_anim.json", "w", encoding="utf-8") as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=2)


def main():
    args = parse_args()
    out = Path(args.out).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    profile_path = bk.find_profile(args.profile)
    profile = bk.deep_merge(bk.BUILTIN_PROFILE, bk.load_json(profile_path))
    for name in [c for c in args.chars.split(",") if c]:
        bake_char(name, out, profile, profile_path, args)
    print("ALL_ANIM_DONE", flush=True)


if __name__ == "__main__":
    main()
