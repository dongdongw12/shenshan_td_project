"""
程序化生成模型（.glb）：3 件样张的“替身模型”+ 5 件正式程序化资产（稻田青苗/金穗、篱笆、青砖墙、捕兽夹）。替身用于：
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
    "straw": "#c9a66b", "bamboo": "#6f9a52", "rope": "#a8743f", "water": "#5d8fb6",
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


def _rice_field(ripe):
    """2×2 格稻田：田埂围一圈、田面水光、成行的稻丛（青苗 / 金穗）。正式资产就用程序化版本。"""
    size = 3.8
    h = size / 2
    box("paddy_water", (size - 0.3, size - 0.3, 0.06), (0, 0, 0.03), "water")
    # 田埂：四条土埂
    box("ridge_s", (size, 0.32, 0.22), (0, -h + 0.16, 0.11), "ochre_light")
    box("ridge_n", (size, 0.32, 0.22), (0, h - 0.16, 0.11), "ochre_light")
    box("ridge_w", (0.32, size, 0.22), (-h + 0.16, 0, 0.11), "ochre_light")
    box("ridge_e", (0.32, size, 0.22), (h - 0.16, 0, 0.11), "ochre_light")
    # 稻丛：每丛 6 片向外斜伸的细叶（青苗）/ 叶 + 低垂稻穗（金穗）；行距放宽，露出田面水光
    blade = "straw" if ripe else "malachite_light"
    blade2 = "gamboge" if ripe else "malachite"
    rows, cols = 5, 5
    for r in range(rows):
        for c in range(cols):
            x = -h + 0.75 + c * (size - 1.5) / (cols - 1)
            y = -h + 0.75 + r * (size - 1.5) / (rows - 1)
            hgt = (0.75 if ripe else 0.55) * (0.9 + 0.2 * ((r * 7 + c * 3) % 5) / 4)
            for k in range(6):
                ang = k * math.pi / 3 + (r + c) * 0.4
                tilt = 0.32 + 0.1 * (k % 2)
                top = (x + math.cos(ang) * hgt * tilt, y + math.sin(ang) * hgt * tilt, 0.06 + hgt)
                rod(f"blade_{r}_{c}_{k}", (x, y, 0.06), top, 0.028, blade if k % 2 else blade2, verts=5)
                if ripe and k % 2 == 0:  # 低垂的稻穗：从叶尖向外下垂
                    droop = (top[0] + math.cos(ang) * 0.12, top[1] + math.sin(ang) * 0.12, top[2] - 0.14)
                    rod(f"ear_{r}_{c}_{k}", top, droop, 0.045, "gamboge", verts=6)


def build_farm_rice_young():
    _rice_field(False)


def build_farm_rice_ripe():
    _rice_field(True)


def build_fence_wood():
    """1 格一段的尖木篱笆（沿 X 方向）：五根削尖木桩 + 两道横木 + 麻绳。"""
    for k in range(5):
        x = -0.8 + k * 0.4
        hgt = 1.45 + ((k * 37) % 5) * 0.05
        cyl(f"stake{k}", 0.11, hgt, (x, 0, hgt / 2), "wood_dark", verts=8)
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.11, radius2=0.0, depth=0.35, location=(x, 0, hgt + 0.175))
        tip = bpy.context.active_object
        tip.name = f"tip{k}"
        assign(tip, "ochre_light")
    for k, z in enumerate((0.45, 1.05)):
        rod(f"rail{k}", (-0.95, -0.12, z), (0.95, -0.12, z), 0.05, "ochre")
        for m in range(5):
            cyl(f"rope{k}_{m}", 0.125, 0.06, (-0.8 + m * 0.4, 0, z), "rope", verts=8)


def build_wall_brick():
    """1 格一段的青砖墙（沿 X 方向）：石基 + 砖墙身 + 小青瓦墙帽。"""
    box("wall_base", (2.0, 0.7, 0.35), (0, 0, 0.175), "stone")
    box("wall_body", (2.0, 0.55, 2.0), (0, 0, 1.35), "tile_light")
    # 砖缝：几道浅凹的横向线脚，给内墨线一点结构
    for k in range(1, 5):
        box(f"course{k}", (2.02, 0.57, 0.04), (0, 0, 0.35 + k * 0.4), "stone")
    box("wall_cap_base", (2.1, 0.75, 0.12), (0, 0, 2.41), "tile_dark")
    gable_roof("wall_cap", 2.2, 0.48, 2.45, 2.75, 0.08, "tile_dark", curve=0.1)


def build_trap_bear():
    """精铁捕兽夹：一对带齿的半圆铁颚 + 底盘 + 铁链和地钉。"""
    cyl("trap_plate", 0.35, 0.05, (0, 0, 0.025), "tile_dark", verts=16)
    for side in (-1, 1):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.45, minor_radius=0.04, location=(0, 0, 0.12), rotation=(math.radians(90 + side * 35), 0, 0))
        jaw = bpy.context.active_object
        jaw.name = f"jaw{side}"
        assign(jaw, "tile_light")
        for k in range(7):
            ang = math.pi * (k + 0.5) / 7
            x = 0.45 * math.cos(ang)
            bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.04, radius2=0.0, depth=0.16, location=(x, side * 0.18, 0.12 + 0.3 * math.sin(ang) * 0.6),
                                            rotation=(math.radians(-side * 50), 0, 0))
            t = bpy.context.active_object
            t.name = f"tooth{side}_{k}"
            assign(t, "stone")
    for k in range(4):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.06, minor_radius=0.015, location=(0.5 + k * 0.1, 0, 0.04), rotation=(0, math.radians(90 * (k % 2)), 0))
        assign(bpy.context.active_object, "tile_light")
    cyl("stake", 0.035, 0.3, (0.95, 0, 0.12), "wood_dark", verts=6)


def _pyramid(name, radius, depth, loc, mat):
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=radius, radius2=0.0, depth=depth, location=loc, rotation=(0, 0, math.radians(45)))
    o = bpy.context.active_object
    o.name = name
    return assign(o, mat)


def build_house_lv1_thatch():
    """漏风茅草屋：夯土墙 + 厚茅草双坡顶 + 歪木门 + 小窗 + 柴堆（开局的家）"""
    box("earth_base", (3.0, 2.6, 0.2), (0, 0.1, 0.1), "stone")
    box("earth_walls", (2.7, 2.2, 1.7), (0, 0.15, 1.05), "ochre_light")
    for k in range(3):  # 夯土层线
        box(f"earth_course{k}", (2.72, 2.22, 0.04), (0, 0.15, 0.6 + k * 0.45), "ochre")
    box("door", (0.7, 0.06, 1.25), (0.3, -0.96, 0.85), "wood_dark", rot=(0, math.radians(3), 0))
    box("window", (0.45, 0.05, 0.4), (-0.75, -0.96, 1.25), "straw")
    gable_roof("thatch", 3.3, 1.75, 1.75, 2.95, 0.32, "straw", curve=0.05)
    box("thatch_ridge", (3.3, 0.35, 0.22), (0, 0, 3.05), "gamboge")
    for k in range(3):
        rod(f"press{k}", (-1.6, -1.4 + k * 0.05, 2.0 + k * 0.35), (1.6, -1.4 + k * 0.05, 2.0 + k * 0.35), 0.04, "wood_dark")
    for k in range(5):
        cyl(f"firewood{k}", 0.09, 0.9, (1.15 + (k % 3) * 0.19, -1.1, 0.12 + (k // 3) * 0.17), "ochre", rot=(math.radians(90), 0, 0), verts=8)


def build_house_wing_room():
    """家族厢房：青石台基 + 白灰墙 + 小青瓦顶 + 格窗 + 红灯笼 + 摇篮"""
    box("plinth", (3.4, 2.8, 0.28), (0, 0, 0.14), "stone")
    box("walls", (3.0, 2.2, 1.8), (0, 0.15, 1.18), "lime_white")
    box("door", (0.75, 0.06, 1.35), (-0.55, -0.97, 0.96), "ochre")
    box("win", (0.8, 0.05, 0.65), (0.65, -0.97, 1.35), "wood_dark")
    for k in range(3):
        box(f"win_m{k}", (0.04, 0.03, 0.6), (0.4 + k * 0.25, -1.0, 1.35), "ochre_light")
    gable_roof("roof", 3.5, 1.6, 2.05, 3.1, 0.14, "tile_dark")
    box("ridge", (3.2, 0.2, 0.16), (0, 0, 3.22), "tile_light")
    sphere("lantern", 0.15, (-0.05, -1.05, 1.8), "cinnabar", scale=(1, 1, 1.25))
    box("cradle", (0.55, 0.35, 0.25), (1.2, -1.05, 0.42), "ochre_light")
    rod("pole", (-1.45, -1.25, 1.3), (-0.2, -1.25, 1.3), 0.025, "bamboo")
    for k in range(3):
        box(f"cloth{k}", (0.22, 0.03, 0.3), (-1.25 + k * 0.38, -1.25, 1.12), ("cinnabar", "malachite_light", "lime_white")[k])


def build_hunt_lodge():
    """林间猎棚：原木墙 + 茅草树皮顶 + 墙上兽皮与弓 + 晾肉架 + 树墩"""
    box("lodge_base", (2.8, 2.4, 0.15), (0, 0.1, 0.075), "stone")
    box("lodge_walls", (2.5, 2.0, 1.6), (0, 0.15, 0.95), "wood_dark")
    for k in range(5):  # 原木横纹
        rod(f"log_f{k}", (-1.28, -0.86, 0.3 + k * 0.32), (1.28, -0.86, 0.3 + k * 0.32), 0.07, "ochre")
        rod(f"log_s{k}", (1.26, -0.85, 0.3 + k * 0.32), (1.26, 1.15, 0.3 + k * 0.32), 0.07, "ochre")
    box("lodge_door", (0.6, 0.06, 1.15), (-0.6, -0.92, 0.75), "wood_dark")
    box("hide1", (0.6, 0.04, 0.5), (0.45, -0.94, 1.3), "ochre_light", rot=(0, math.radians(8), 0))
    box("hide2", (0.04, 0.55, 0.45), (1.33, 0.4, 1.15), "straw")
    bpy.ops.mesh.primitive_torus_add(major_radius=0.35, minor_radius=0.025, location=(0.95, -0.95, 1.35), rotation=(math.radians(90), 0, 0))
    bow = bpy.context.active_object; bow.name = "bow"; bow.scale = (0.4, 1, 1); assign(bow, "wood_dark")
    gable_roof("lodge_roof", 3.0, 1.55, 1.65, 2.75, 0.25, "straw", curve=0.08)
    for k in range(2):
        rod(f"rack_post{k}", (-1.6 + k * 0.9, -1.5, 0), (-1.6 + k * 0.9, -1.5, 1.2), 0.04, "wood_dark")
    rod("rack_bar", (-1.65, -1.5, 1.15), (-0.65, -1.5, 1.15), 0.035, "wood_dark")
    for k in range(4):
        box(f"jerky{k}", (0.08, 0.04, 0.32), (-1.5 + k * 0.25, -1.5, 0.95), "cinnabar")
    cyl("stump", 0.28, 0.35, (1.35, -1.45, 0.17), "ochre", verts=12)


def build_granary():
    """防潮粮仓：四根木柱架高 + 防鼠石盘 + 木板仓 + 茅草四坡顶 + 木梯 + 麻袋"""
    for k, (x, y) in enumerate(((-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0))):
        cyl(f"post{k}", 0.13, 1.0, (x, y, 0.5), "wood_dark", verts=10)
        cyl(f"guard{k}", 0.26, 0.08, (x, y, 1.02), "stone", verts=14)
    box("floor", (2.5, 2.5, 0.16), (0, 0, 1.12), "ochre")
    box("bin", (2.3, 2.3, 1.5), (0, 0, 1.95), "ochre_light")
    for k in range(5):
        box(f"plank{k}", (0.03, 2.32, 1.5), (-1.15 + k * 0.575, 0, 1.95), "ochre")
    box("bin_door", (0.6, 0.05, 0.8), (0.2, -1.17, 1.85), "wood_dark")
    _pyramid("granary_roof", 2.2, 1.3, (0, 0, 3.35), "straw")
    for i, x in enumerate((-0.05, 0.4)):
        rod(f"ladder_rail{i}", (x, -1.85, 0), (x, -1.2, 1.2), 0.035, "wood_dark")
    for k in range(1, 5):
        t = k / 5
        rod(f"ladder_rung{k}", (-0.05, -1.85 + 0.65 * t, 1.2 * t), (0.4, -1.85 + 0.65 * t, 1.2 * t), 0.025, "rope")
    for k in range(3):
        sphere(f"sack{k}", 0.24, (-1.2 + k * 0.35, -1.55, 0.22), "straw", scale=(1, 0.85, 1.2), seg=12)


def build_tower_oil_fire():
    """火油连弩塔：青砖底层 + 木构上层 + 平台火盆 + 黑陶油罐 + 朱砂四坡顶"""
    box("brick_base", (1.5, 1.5, 2.2), (0, 0, 1.1), "tile_light")
    for k in range(4):
        box(f"brick_course{k}", (1.52, 1.52, 0.04), (0, 0, 0.45 + k * 0.45), "stone")
    box("timber", (1.4, 1.4, 1.3), (0, 0, 2.85), "ochre")
    for k, (x, y) in enumerate(((-0.7, -0.7), (0.7, -0.7), (0.7, 0.7), (-0.7, 0.7))):
        cyl(f"tpost{k}", 0.07, 1.4, (x, y, 2.85), "wood_dark", verts=8)
    box("platform", (1.8, 1.8, 0.14), (0, 0, 3.57), "wood_dark")
    for k, (sx, sy, rx) in enumerate(((0, -1, 1), (0, 1, 1), (-1, 0, 0), (1, 0, 0))):
        box(f"parapet{k}", (1.8, 0.08, 0.45) if rx else (0.08, 1.8, 0.45), (sx * 0.86, sy * 0.86, 3.86), "ochre")
    box("crossbow", (0.18, 0.9, 0.12), (0, -0.4, 3.95), "wood_dark")
    rod("bow_arm", (-0.45, -0.75, 3.98), (0.45, -0.75, 3.98), 0.03, "wood_dark")
    cyl("brazier", 0.2, 0.2, (0.6, -0.6, 3.75), "tile_dark", verts=12)
    sphere("fire", 0.17, (0.6, -0.6, 3.95), "gamboge", scale=(1, 1, 1.5))
    for k in range(3):
        sphere(f"jar{k}", 0.16, (-0.6 + k * 0.3, 0.6, 3.78), "tile_dark", scale=(1, 1, 1.3), seg=12)
    for k, (x, y) in enumerate(((-0.85, -0.85), (0.85, -0.85), (0.85, 0.85), (-0.85, 0.85))):
        cyl(f"roofpost{k}", 0.05, 0.9, (x, y, 4.1), "wood_dark", verts=8)
    _pyramid("oil_roof", 1.55, 1.0, (0, 0, 5.05), "cinnabar")


BUILDERS = {
    "house_lv1_thatch": build_house_lv1_thatch,
    "house_wing_room": build_house_wing_room,
    "hunt_lodge": build_hunt_lodge,
    "granary": build_granary,
    "tower_oil_fire": build_tower_oil_fire,
    "house_lv2_tile": build_house_lv2_tile,
    "tower_bamboo": build_tower_bamboo,
    "prop_pine_tree": build_prop_pine_tree,
    # 以下是正式资产（规整/重复/很薄，程序化比图生 3D 更好）
    "farm_rice_young": build_farm_rice_young,
    "farm_rice_ripe": build_farm_rice_ripe,
    "fence_wood": build_fence_wood,
    "wall_brick": build_wall_brick,
    "trap_bear": build_trap_bear,
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
