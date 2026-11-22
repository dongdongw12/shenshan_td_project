"""
程序化生成 3 件样张的“替身模型”（.glb），用于：
1. 不依赖 Colab / 图生 3D，在本机回归测试 烘培 → 风格化 全链路与画风参数；
2. 图生 3D 搞不定的件（多半是竹箭楼）可以在此基础上手工细化，作为正式低模。

约定：Blender Z 向上，建筑正面朝 −Y（导出 glTF 后为 +Z，与 Hunyuan3D 输出一致），宽度沿 X。
贴图：每种颜色生成一张带轻微噪点的 128px 贴图，模拟 AI 贴图的颜色斑驳，检验后处理的平涂效果。

用法：
  blender -b -P pipeline/blender/make_proxy_assets.py -- --out /tmp/proxy_models [--ids house_lv2_tile,tower_bamboo]
"""

import argparse
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

PALETTE = {
    "lime_white": "#ede3cc", "tile_dark": "#3e4552", "tile_light": "#6b7482", "stone": "#7d8a8c",
    "malachite": "#3f8a63", "malachite_light": "#7fb98a", "pine_deep": "#24574a", "ochre": "#9a5a35",
    "ochre_light": "#c88f5f", "wood_dark": "#5c3a26", "cinnabar": "#b8352a", "gamboge": "#d9a838",
    "straw": "#c9a66b", "bamboo": "#6f9a52", "rope": "#a8743f",
}
_materials = {}


def material(name, noise=0.07, seed=0):
    if name in _materials:
        return _materials[name]
    h = PALETTE[name].lstrip("#")
    rgb = np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    rng = np.random.default_rng(seed + len(_materials))
    size = 128
    # 低频 + 高频噪点，模拟 AI 贴图的斑驳与色偏
    low = rng.normal(0, 1, (8, 8, 1))
    low = np.kron(low, np.ones((size // 8, size // 8, 1)))
    high = rng.normal(0, 1, (size, size, 1))
    tex = np.clip(rgb[None, None, :] * (1 + noise * (0.7 * low + 0.5 * high)), 0, 1)
    tex = np.concatenate([tex, np.ones((size, size, 1))], axis=2)
    img = bpy.data.images.new(f"tex_{name}", size, size)  # 8bit sRGB 图：pixels 直接写 sRGB 值
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(tex.astype(np.float32).ravel())
    img.pack()

    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex_node = nt.nodes.new("ShaderNodeTexImage")
    tex_node.image = img
    nt.links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.8
    _materials[name] = mat
    return mat


def assign(obj, mat_name):
    obj.data.materials.clear()
    obj.data.materials.append(material(mat_name))
    return obj


def box(name, size, loc, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return assign(o, mat)


def cyl(name, r, depth, loc, mat, rot=(0, 0, 0), verts=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    return assign(o, mat)


def sphere(name, r, loc, mat, scale=(1, 1, 1), seg=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return assign(o, mat)


def rod(name, p0, p1, r, mat, verts=10):
    """两点之间的圆柱（竹竿、斜撑、梯子）。"""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    o = cyl(name, r, d.length, (p0 + p1) / 2, mat, verts=verts)
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return o


def mesh_from(name, verts, faces, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cube_project(cube_size=1.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    return assign(o, mat)


def gable_roof(name, length, half_depth, eave_z, ridge_z, thick, mat, curve=0.18):
    """硬山双坡屋面，坡面略带凹曲（明清屋面“举折”），厚度 thick。"""
    n = 6
    verts, faces = [], []
    xs = (-length / 2, length / 2)
    def profile(t):  # t: 0 檐口 → 1 屋脊；低于直线 = 下凹的明清屋面
        return eave_z + (ridge_z - eave_z) * (t - curve * math.sin(math.pi * t) * 0.5)
    rows = []
    for side in (-1, 1):
        for i in range(n + 1):
            t = i / n
            rows.append((side, i, side * half_depth * (1 - t), profile(t)))
    def vid(side, i, x_idx, layer):
        return ((0 if side == -1 else 1) * (n + 1) + i) * 4 + x_idx * 2 + layer
    for side, i, y, z in rows:
        for x in xs:
            verts.append((x, y, z + thick))
            verts.append((x, y, z))
    for side in (-1, 1):
        for i in range(n):
            a0, a1 = vid(side, i, 0, 0), vid(side, i, 1, 0)
            b0, b1 = vid(side, i + 1, 0, 0), vid(side, i + 1, 1, 0)
            faces.append((a0, a1, b1, b0))
            c0, c1 = vid(side, i, 0, 1), vid(side, i, 1, 1)
            d0, d1 = vid(side, i + 1, 0, 1), vid(side, i + 1, 1, 1)
            faces.append((c0, d0, d1, c1))
            faces.append((a0, b0, d0, c0))
            faces.append((a1, c1, d1, b1))
        e0, e1 = vid(side, 0, 0, 0), vid(side, 0, 1, 0)
        f0, f1 = vid(side, 0, 0, 1), vid(side, 0, 1, 1)
        faces.append((e0, f0, f1, e1))
    o = mesh_from(name, verts, faces, mat)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-4)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    return o


# ----------------------------------------------------------------------------- 三件样张

def build_house_lv2_tile():
    """三开间青瓦正房：台基 + 前廊柱 + 石灰墙 + 格窗 + 喜字门 + 硬山顶 + 翘脊 + 红灯笼。"""
    box("plinth", (4.0, 3.2, 0.32), (0, 0, 0.16), "stone")
    for k in range(3):
        box(f"step{k}", (1.3, 0.28, 0.11), (0, -1.6 - 0.28 * (2 - k) - 0.14 + 0.28 * 2, 0.055 + 0.105 * k), "stone")
    box("walls", (3.3, 2.2, 2.0), (0, 0.25, 1.32), "lime_white")
    for i, x in enumerate((-1.62, -0.55, 0.55, 1.62)):
        cyl(f"col{i}", 0.1, 2.05, (x, -1.12, 1.345), "cinnabar")
    box("beam", (3.5, 0.18, 0.2), (0, -1.12, 2.36), "cinnabar")
    box("door", (0.82, 0.06, 1.55), (0, -0.88, 1.1), "ochre")
    box("xi", (0.3, 0.02, 0.3), (0, -0.92, 1.35), "cinnabar")
    for i, x in enumerate((-1.1, 1.1)):
        box(f"win{i}", (0.78, 0.05, 0.7), (x, -0.88, 1.45), "wood_dark")
        for j in range(3):
            box(f"win{i}_m{j}", (0.04, 0.03, 0.66), (x - 0.24 + 0.24 * j, -0.92, 1.45), "ochre_light")
        box(f"win{i}_h", (0.74, 0.03, 0.04), (x, -0.92, 1.45), "ochre_light")
    gable_roof("roof", 4.1, 1.8, 2.38, 3.55, 0.16, "tile_dark")
    # 山墙
    for i, x in enumerate((-1.65, 1.65)):
        mesh_from(f"gable{i}", [(x, -1.1, 2.32), (x, 1.4, 2.32), (x, 0.0, 3.5)], [(0, 1, 2)], "lime_white")
    box("ridge", (3.6, 0.22, 0.2), (0, 0, 3.72), "tile_light")
    for i, s in enumerate((-1, 1)):
        box(f"ridge_end{i}", (0.28, 0.24, 0.42), (s * 1.86, 0, 3.86), "tile_light", rot=(0, math.radians(-s * 18), 0))
    for i, x in enumerate((-0.72, 0.72)):
        sphere(f"lantern{i}", 0.17, (x, -1.12, 1.95), "cinnabar", scale=(1, 1, 1.25))
        cyl(f"lantern{i}_cap", 0.09, 0.05, (x, -1.12, 2.18), "gamboge")


def build_tower_bamboo():
    """竹箭楼：四根粗竹柱 + 交叉斜撑 + 竹栏平台 + 茅草四坡顶 + 火把 + 竹梯。"""
    a = 0.62
    for i, (x, y) in enumerate(((-a, -a), (a, -a), (a, a), (-a, a))):
        rod(f"post{i}", (x * 1.08, y * 1.08, 0), (x, y, 3.5), 0.085, "bamboo")
        for k in range(1, 4):
            cyl(f"post{i}_node{k}", 0.095, 0.04, (x * (1.08 - 0.08 * k * 0.29), y * (1.08 - 0.08 * k * 0.29), k * 0.95), "malachite_light")
    for i, ((x0, y0), (x1, y1)) in enumerate((((-a, -a), (a, -a)), ((a, -a), (a, a)), ((a, a), (-a, a)), ((-a, a), (-a, -a)))):
        rod(f"brace{i}a", (x0 * 1.05, y0 * 1.05, 0.5), (x1 * 1.0, y1 * 1.0, 2.6), 0.05, "bamboo")
        rod(f"brace{i}b", (x1 * 1.05, y1 * 1.05, 0.5), (x0 * 1.0, y0 * 1.0, 2.6), 0.05, "bamboo")
        rod(f"ring{i}", (x0, y0, 2.0), (x1, y1, 2.0), 0.045, "rope")
    box("platform", (1.75, 1.75, 0.14), (0, 0, 3.55), "ochre_light")
    for i, (sx, sy, rx) in enumerate(((0, -1, 1), (0, 1, 1), (-1, 0, 0), (1, 0, 0))):
        size = (1.75, 0.08, 0.62) if rx else (0.08, 1.75, 0.62)
        box(f"rail{i}", size, (sx * 0.835, sy * 0.835, 3.93), "bamboo")
    for i, (x, y) in enumerate(((-0.85, -0.85), (0.85, -0.85), (0.85, 0.85), (-0.85, 0.85))):
        rod(f"roofpost{i}", (x, y, 3.6), (x, y, 4.35), 0.05, "bamboo")
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=1.55, radius2=0.0, depth=0.85, location=(0, 0, 4.72),
                                    rotation=(0, 0, math.radians(45)))
    roof = bpy.context.active_object
    roof.name = "thatch"
    assign(roof, "straw")
    rod("torch", (-0.9, -0.9, 3.6), (-1.0, -1.0, 4.35), 0.035, "wood_dark")
    sphere("torch_fire", 0.11, (-1.0, -1.0, 4.42), "gamboge", scale=(1, 1, 1.4))
    for i, x in enumerate((-0.28, 0.28)):
        rod(f"ladder_rail{i}", (x, -1.15, 0), (x, -0.75, 3.5), 0.04, "bamboo")
    for k in range(1, 10):
        t = k / 10
        rod(f"rung{k}", (-0.28, -1.15 + 0.4 * t, 3.5 * t), (0.28, -1.15 + 0.4 * t, 3.5 * t), 0.025, "rope")


def build_prop_pine_tree():
    """深山古松：虬曲树干 + 层叠云头针叶团 + 根部山石。"""
    pts = [(0, 0, 0), (0.15, 0.05, 1.1), (-0.05, 0.1, 2.2), (0.3, 0.0, 3.2), (0.65, -0.05, 4.0)]
    for i in range(len(pts) - 1):
        r = 0.32 - i * 0.055
        rod(f"trunk{i}", pts[i], pts[i + 1], r, "wood_dark", verts=10)
        sphere(f"knot{i}", r * 1.02, pts[i + 1], "wood_dark", seg=10)
    rod("branch0", (-0.05, 0.1, 2.3), (-1.2, -0.1, 3.0), 0.12, "wood_dark")
    rod("branch1", (0.3, 0.0, 3.2), (1.3, 0.2, 3.6), 0.1, "wood_dark")
    # 云头状针叶团：扁椭球 + 云纹置换，边缘起伏像版画里一簇簇的松针
    tex = bpy.data.textures.new("needle_clouds", type="CLOUDS")
    tex.noise_scale = 0.35
    clusters = [((-1.25, -0.1, 3.1), 1.0, "pine_deep"), ((-0.55, 0.3, 3.35), 0.7, "pine_deep"),
                ((1.35, 0.2, 3.7), 0.95, "pine_deep"), ((0.25, 0.1, 3.8), 0.75, "pine_deep"),
                ((0.65, -0.1, 4.35), 1.1, "malachite"), ((-0.3, 0.2, 4.6), 0.8, "malachite"),
                ((0.3, 0.05, 5.05), 0.7, "malachite_light")]
    for i, (c, r, m) in enumerate(clusters):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=r, location=c)
        o = bpy.context.active_object
        o.name = f"needles{i}"
        o.scale = (1.0, 0.85, 0.34)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        mod = o.modifiers.new("clouds", "DISPLACE")
        mod.texture = tex
        mod.strength = 0.22 * r
        mod.mid_level = 0.5
        bpy.ops.object.shade_smooth()
        assign(o, m)
    for i, (c, r) in enumerate((((0.45, -0.35, 0.12), 0.32), ((-0.4, -0.2, 0.1), 0.24), ((0.05, 0.45, 0.08), 0.2))):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=c)
        rock = bpy.context.active_object
        rock.name = f"rock{i}"
        rock.scale = (1.2, 1.0, 0.6)
        assign(rock, "stone")


BUILDERS = {
    "house_lv2_tile": build_house_lv2_tile,
    "tower_bamboo": build_tower_bamboo,
    "prop_pine_tree": build_prop_pine_tree,
}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--ids", default=",".join(BUILDERS))
    args = p.parse_args(argv)
    out = Path(args.out).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    for asset_id in [s.strip() for s in args.ids.split(",") if s.strip()]:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        _materials.clear()
        BUILDERS[asset_id]()
        path = out / f"{asset_id}.glb"
        bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", export_yup=True, export_apply=True)
        print(f"PROXY {asset_id} -> {path}", flush=True)


if __name__ == "__main__":
    main()
