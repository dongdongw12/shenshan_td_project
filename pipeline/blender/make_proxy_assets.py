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
    "straw": "#c9a66b", "bamboo": "#6f9a52", "rope": "#a8743f", "water": "#5d8fb6", "azurite": "#2e5f8f", "ink": "#1c1510",
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


def build_tower_crossbow():
    """强弩箭楼：青石方座 + 粗木两层 + 带护栏射台 + 大弩 + 小青瓦四坡顶 + 红三角旗"""
    box("stone_base", (1.6, 1.6, 1.2), (0, 0, 0.6), "stone")
    for k, (x, y) in enumerate(((-0.65, -0.65), (0.65, -0.65), (0.65, 0.65), (-0.65, 0.65))):
        cyl(f"post{k}", 0.1, 2.4, (x, y, 2.4), "wood_dark", verts=8)
    for z in (2.0, 3.55):
        box(f"deck{z}", (1.7, 1.7, 0.14), (0, 0, z), "ochre")
    for k, (sx, sy, rx) in enumerate(((0, -1, 1), (0, 1, 1), (-1, 0, 0), (1, 0, 0))):
        box(f"rail{k}", (1.7, 0.08, 0.5) if rx else (0.08, 1.7, 0.5), (sx * 0.81, sy * 0.81, 3.87), "wood_dark")
    rod("brace_a", (-0.65, -0.68, 1.2), (0.65, -0.68, 1.95), 0.05, "wood_dark")
    rod("brace_b", (0.65, -0.68, 1.2), (-0.65, -0.68, 1.95), 0.05, "wood_dark")
    box("bow_stock", (0.16, 1.0, 0.12), (0, -0.45, 3.85), "wood_dark")
    rod("bow_arm", (-0.55, -0.85, 3.88), (0.55, -0.85, 3.88), 0.035, "ochre")
    for k, (x, y) in enumerate(((-0.75, -0.75), (0.75, -0.75), (0.75, 0.75), (-0.75, 0.75))):
        cyl(f"rpost{k}", 0.05, 0.8, (x, y, 4.0), "wood_dark", verts=8)
    _pyramid("roof", 1.45, 0.85, (0, 0, 4.8), "tile_dark")
    rod("flagpole", (0.95, -0.95, 4.3), (0.95, -0.95, 5.5), 0.025, "wood_dark")
    mesh_from("flag", [(0.95, -0.95, 5.45), (0.95, -0.95, 5.1), (0.95, -1.5, 5.3)], [(0, 1, 2)], "cinnabar")


def build_fish_weir():
    """溪边鱼梁：浅水 + 一排竹桩木栅 + 竹篓 + 小水车（2×1 格，沿 X）"""
    box("shallow", (3.8, 1.7, 0.05), (0, 0, 0.025), "water")
    for k in range(9):
        cyl(f"stake{k}", 0.05, 0.75, (-1.6 + k * 0.4, -0.2, 0.37), "bamboo", verts=6)
    rod("rail", (-1.7, -0.2, 0.55), (1.7, -0.2, 0.55), 0.04, "ochre")
    for k in range(3):
        bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=0.17, radius2=0.08, depth=0.4, location=(-1.0 + k * 0.7, 0.15, 0.2), rotation=(math.radians(90), 0, 0))
        assign(bpy.context.active_object, "straw")
    bpy.ops.mesh.primitive_torus_add(major_radius=0.6, minor_radius=0.05, location=(1.3, 0.4, 0.55), rotation=(0, math.radians(90), 0))
    assign(bpy.context.active_object, "ochre")
    for k in range(6):
        ang = k * math.pi / 3
        rod(f"spoke{k}", (1.3, 0.4, 0.55), (1.3, 0.4 + 0.6 * math.cos(ang), 0.55 + 0.6 * math.sin(ang)), 0.03, "wood_dark")
    cyl("axle_post", 0.06, 0.9, (1.3, 0.85, 0.45), "wood_dark", verts=6)
    for k in range(3):
        sphere(f"pebble{k}", 0.13, (-1.5 + k * 1.1, 0.7, 0.06), "stone", scale=(1.3, 1, 0.5), seg=8)


def build_prop_peddler_cart():
    """进山货郎担：独轮车 + 两个竹货筐（花布、糖葫芦）+ 小幌子 + 灯笼"""
    bpy.ops.mesh.primitive_torus_add(major_radius=0.28, minor_radius=0.05, location=(0, -0.55, 0.3), rotation=(0, math.radians(90), 0))
    assign(bpy.context.active_object, "wood_dark")
    box("cart_bed", (0.7, 1.1, 0.08), (0, 0, 0.55), "ochre")
    rod("handle_l", (-0.25, 0.4, 0.55), (-0.3, 1.0, 0.75), 0.03, "wood_dark")
    rod("handle_r", (0.25, 0.4, 0.55), (0.3, 1.0, 0.75), 0.03, "wood_dark")
    for k, y in enumerate((-0.25, 0.25)):
        cyl(f"basket{k}", 0.28, 0.4, (0, y, 0.8), "straw", verts=12)
    for k, c in enumerate(("cinnabar", "azurite", "malachite_light")):
        box(f"cloth{k}", (0.32, 0.12, 0.08), (0, -0.25, 1.02 + k * 0.06), c)
    for k in range(3):
        rod(f"stick{k}", (0.1 * (k - 1), 0.25, 0.9), (0.1 * (k - 1), 0.25, 1.4), 0.015, "wood_dark")
        for m in range(4):
            sphere(f"haw{k}{m}", 0.04, (0.1 * (k - 1), 0.25, 1.15 + m * 0.07), "cinnabar", seg=6)
    rod("pennant_pole", (0.3, 0.55, 0.6), (0.3, 0.55, 1.8), 0.02, "wood_dark")
    box("pennant", (0.03, 0.35, 0.45), (0.3, 0.38, 1.55), "lime_white")
    box("pennant_mark", (0.035, 0.12, 0.12), (0.3, 0.38, 1.58), "cinnabar")
    sphere("cart_lantern", 0.08, (-0.3, 0.9, 0.95), "cinnabar", scale=(1, 1, 1.3), seg=8)


def build_prop_stone_lantern():
    """山道石灯笼：方座 + 立柱 + 带窗孔灯室 + 起翘石盖 + 宝珠顶 + 苔点"""
    box("base", (0.55, 0.55, 0.2), (0, 0, 0.1), "stone")
    cyl("pillar", 0.12, 0.7, (0, 0, 0.55), "stone", verts=8)
    box("plate", (0.5, 0.5, 0.08), (0, 0, 0.94), "stone")
    box("chamber", (0.36, 0.36, 0.34), (0, 0, 1.15), "stone")
    box("window", (0.16, 0.38, 0.16), (0, 0, 1.15), "gamboge")
    _pyramid("cap", 0.48, 0.3, (0, 0, 1.47), "tile_light")
    sphere("jewel", 0.07, (0, 0, 1.66), "stone", seg=8)
    for k in range(3):
        sphere(f"moss{k}", 0.05, (0.2 - k * 0.15, -0.28, 0.2 + k * 0.4), "malachite", scale=(1.3, 0.5, 0.7), seg=6)


def build_prop_beacon_brazier():
    """守夜烽火盆：铁三脚架 + 黑铁火盆 + 块面火焰 + 石圈 + 备用柴"""
    for k in range(3):
        ang = k * 2 * math.pi / 3
        rod(f"leg{k}", (0.45 * math.cos(ang), 0.45 * math.sin(ang), 0), (0.15 * math.cos(ang), 0.15 * math.sin(ang), 1.1), 0.04, "tile_dark")
    bpy.ops.mesh.primitive_cone_add(vertices=14, radius1=0.25, radius2=0.45, depth=0.32, location=(0, 0, 1.25))
    assign(bpy.context.active_object, "tile_dark")
    for k, (r, h) in enumerate(((0.32, 0.55), (0.2, 0.75), (0.12, 0.9))):
        bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=r, radius2=0.0, depth=h, location=(0.05 * (k - 1), 0, 1.4 + h / 2))
        assign(bpy.context.active_object, "gamboge" if k else "cinnabar")
    for k in range(7):
        ang = k * 2 * math.pi / 7
        sphere(f"ring{k}", 0.12, (0.6 * math.cos(ang), 0.6 * math.sin(ang), 0.07), "stone", scale=(1.2, 1, 0.6), seg=8)
    for k in range(3):
        cyl(f"spare{k}", 0.06, 0.7, (0.75, -0.45 + k * 0.12, 0.35), "ochre", rot=(0, math.radians(20), 0), verts=6)


def _canopy(name, clusters, tex_name="leaf_clouds"):
    """云头状树冠：几团扁椭球 + 云纹置换（同古松的针叶团做法，边缘起伏像版画里的一簇簇叶子）。"""
    tex = bpy.data.textures.get(tex_name) or bpy.data.textures.new(tex_name, type="CLOUDS")
    tex.noise_scale = 0.3
    for i, (c, r, m) in enumerate(clusters):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=r, location=c)
        o = bpy.context.active_object
        o.name = f"{name}{i}"
        o.scale = (1.0, 0.9, 0.55)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        mod = o.modifiers.new("clouds", "DISPLACE")
        mod.texture = tex
        mod.strength = 0.2 * r
        mod.mid_level = 0.5
        bpy.ops.object.shade_smooth()
        assign(o, m)


def build_house_lv3_courtyard():
    """青砖大院（3×3）：砖墙围合（墙帽 + 砖缝）+ 正房（朱柱前廊、格窗、门）与东西厢房（青瓦顶、格窗）
    + 朱红双扇大门（门钉、匾额、门楼）+ 石狮一对 + 院中石榴树（多子多福）+ 太平缸"""
    L = 5.6
    for k, (sx, sy, w, d) in enumerate(((0, -1, L, 0.3), (0, 1, L, 0.3), (-1, 0, 0.3, L), (1, 0, 0.3, L))):
        cx, cy = sx * (L / 2 - 0.15), sy * (L / 2 - 0.15)
        box(f"cwall{k}", (w, d, 1.6), (cx, cy, 0.8), "tile_light")
        box(f"cwall_cap{k}", (w + 0.12, d + 0.24, 0.12), (cx, cy, 1.66), "tile_dark")
        box(f"cwall_ridge{k}", (w + 0.02, 0.1 if d < w else d + 0.02, 0.1) if d < w else (0.1, d + 0.02, 0.1), (cx, cy, 1.77), "tile_dark")
        box(f"cwall{k}_base", (w + 0.06, d + 0.06, 0.5), (cx, cy, 0.25), "stone")  # 青石下碱
    # 门楼 + 双扇朱门 + 门钉 + 匾额
    gy = -L / 2 + 0.15
    for sd in (-1, 1):
        box(f"gate_pier{sd}", (0.3, 0.5, 2.1), (sd * 0.78, gy, 1.05), "tile_light")
        box(f"gate_leaf{sd}", (0.62, 0.08, 1.75), (sd * 0.32, gy - 0.2, 0.88), "cinnabar")
        for r in range(3):
            for c in range(2):
                sphere(f"stud{sd}_{r}{c}", 0.035, (sd * (0.18 + 0.2 * c), gy - 0.25, 0.5 + 0.38 * r), "gamboge", seg=6)
    box("gate_lintel", (1.9, 0.55, 0.22), (0, gy, 2.0), "wood_dark")
    box("gate_plaque", (0.8, 0.05, 0.3), (0, gy - 0.3, 1.93), "ink")
    box("gate_plaque_rim", (0.88, 0.04, 0.36), (0, gy - 0.28, 1.93), "gamboge")
    gable_roof("gate_roof", 2.3, 0.6, 2.1, 2.6, 0.1, "tile_dark", curve=0.2)
    bpy.context.active_object.location.y += gy
    for sd in (-1, 1):  # 石狮：须弥座 + 蹲身 + 圆头
        box(f"lion_base{sd}", (0.4, 0.5, 0.18), (sd * 1.2, gy - 0.45, 0.09), "stone")
        box(f"lion_body{sd}", (0.28, 0.36, 0.34), (sd * 1.2, gy - 0.42, 0.35), "stone")
        sphere(f"lion_head{sd}", 0.17, (sd * 1.2, gy - 0.52, 0.62), "stone", seg=10)
        sphere(f"lantern{sd}", 0.13, (sd * 0.55, gy - 0.35, 1.62), "cinnabar", scale=(1, 1, 1.25), seg=8)
    # 正房：台基 + 墙 + 前廊朱柱 + 门 + 两侧格窗 + 双坡顶
    hy = 1.6
    box("main_plinth", (4.4, 1.9, 0.22), (0, hy, 0.11), "stone")
    box("main_hall", (4.0, 1.4, 1.9), (0, hy + 0.15, 1.17), "lime_white")
    for i, x in enumerate((-1.85, -0.65, 0.65, 1.85)):
        cyl(f"main_col{i}", 0.08, 1.95, (x, hy - 0.72, 1.19), "cinnabar", verts=8)
    box("main_door", (0.7, 0.05, 1.35), (0, hy - 0.57, 0.9), "ochre")
    for i, x in enumerate((-1.25, 1.25)):
        box(f"main_win{i}", (0.8, 0.05, 0.6), (x, hy - 0.57, 1.3), "wood_dark")
        for j in range(4):
            box(f"main_win{i}_m{j}", (0.03, 0.03, 0.56), (x - 0.3 + 0.2 * j, hy - 0.6, 1.3), "ochre_light")
    gable_roof("main_roof", 4.5, 1.1, 2.05, 2.95, 0.12, "tile_dark")
    bpy.context.active_object.location.y += hy
    box("main_ridge", (4.1, 0.16, 0.14), (0, hy, 3.1), "tile_light")
    # 东西厢房：墙 + 朝院心的格窗 + 青瓦双坡（屋脊沿 Y）
    for sd in (-1, 1):
        wx = sd * 2.05
        box(f"wing{sd}", (1.05, 2.2, 1.5), (wx, -0.35, 0.85), "lime_white")
        box(f"wing{sd}_plinth", (1.4, 2.4, 0.18), (wx, -0.35, 0.09), "stone")
        for k, yy in enumerate((-1.0, 0.3)):
            box(f"wing{sd}_win{k}", (0.05, 0.6, 0.5), (wx - sd * 0.54, -0.35 + yy * 0.8, 1.1), "wood_dark")
            for j in range(3):
                box(f"wing{sd}_win{k}_m{j}", (0.03, 0.03, 0.46), (wx - sd * 0.57, -0.35 + yy * 0.8 - 0.2 + 0.2 * j, 1.1), "ochre_light")
        gable_roof(f"wing{sd}_roof", 2.5, 0.72, 1.6, 2.15, 0.1, "tile_dark")
        r = bpy.context.active_object
        r.rotation_euler = (0, 0, math.radians(90))
        r.location = (wx, -0.35, 0)
    # 院中石榴树：曲干 + 三团云头树冠 + 朱砂石榴果
    rod("tree_trunk0", (0.35, -0.75, 0.0), (0.25, -0.7, 0.9), 0.1, "wood_dark", verts=8)
    rod("tree_trunk1", (0.25, -0.7, 0.9), (0.45, -0.75, 1.5), 0.08, "wood_dark", verts=8)
    rod("tree_branch", (0.25, -0.7, 1.0), (-0.2, -0.8, 1.45), 0.06, "wood_dark", verts=8)
    _canopy("pom_leaves", [((0.45, -0.75, 1.75), 0.55, "malachite"), ((-0.15, -0.8, 1.6), 0.45, "pine_deep"),
                           ((0.15, -0.7, 2.1), 0.42, "malachite_light")])
    for k, (x, y, z) in enumerate(((0.75, -1.15, 1.6), (0.1, -1.15, 1.85), (-0.4, -1.1, 1.5), (0.5, -1.0, 2.15), (0.95, -0.8, 1.9))):
        sphere(f"pomegranate{k}", 0.07, (x, y, z), "cinnabar", seg=8)
    box("tree_bed", (0.9, 0.9, 0.16), (0.3, -0.75, 0.08), "stone")
    cyl("vat", 0.32, 0.55, (-0.95, -1.35, 0.28), "tile_dark", verts=14)
    cyl("vat_water", 0.27, 0.02, (-0.95, -1.35, 0.55), "water", verts=14)
    # 院心青石板甬道
    box("path", (0.9, 2.6, 0.04), (0, -1.3, 0.02), "stone")


def build_ancestral_hall():
    """家族祠堂：高台基 + 朱红立柱前廊 + 歇山青瓦顶（简化为双坡加起翘）+ 匾额 + 香炉"""
    box("terrace", (3.6, 3.0, 0.5), (0, 0, 0.25), "stone")
    for k in range(3):
        box(f"step{k}", (1.4, 0.3, 0.16), (0, -1.6 - 0.3 * (2 - k) + 0.6, 0.08 + 0.16 * k), "stone")
    box("hall", (3.0, 2.0, 2.2), (0, 0.3, 1.6), "lime_white")
    for i, x in enumerate((-1.35, -0.45, 0.45, 1.35)):
        cyl(f"col{i}", 0.11, 2.2, (x, -0.95, 1.6), "cinnabar", verts=10)
    box("plaque", (0.9, 0.06, 0.35), (0, -0.96, 2.45), "ink")
    box("plaque_rim", (0.98, 0.04, 0.42), (0, -0.94, 2.45), "gamboge")
    gable_roof("hall_roof", 3.9, 1.75, 2.7, 3.9, 0.16, "tile_dark", curve=0.22)
    for sd in (-1, 1):
        box(f"chiwen{sd}", (0.28, 0.24, 0.5), (sd * 1.75, 0, 4.1), "tile_light", rot=(0, math.radians(-sd * 15), 0))
    box("ridge", (3.4, 0.24, 0.2), (0, 0, 3.98), "tile_light")
    cyl("censer", 0.22, 0.3, (0, -2.2, 0.55), "tile_dark", verts=10)
    for k in range(3):
        rod(f"incense{k}", ((k - 1) * 0.06, -2.2, 0.7), ((k - 1) * 0.06, -2.2, 1.05), 0.012, "cinnabar")


def build_prop_bamboo_clump():
    """翠竹丛：八根粗细不一的竹竿（竹节清楚、略向一侧斜）+ 上部几团块面分明的叶簇（石绿 / 松青）+ 竹笋与小石。"""
    import random
    rnd = random.Random(7)
    stalks = []
    for k in range(8):
        ang = k * 2.4
        r0 = 0.12 + 0.3 * rnd.random()
        x0, y0 = math.cos(ang) * r0, math.sin(ang) * r0
        h = 3.4 + 1.3 * rnd.random()
        lean = 0.35 + 0.25 * rnd.random()
        x1, y1 = x0 + lean + 0.15 * math.cos(ang), y0 + 0.12 * math.sin(ang)
        rad = 0.045 + 0.02 * rnd.random()
        rod(f"stalk{k}", (x0, y0, 0), (x1, y1, h), rad, "bamboo", verts=8)
        for n in range(1, int(h / 0.55)):  # 竹节
            t = n * 0.55 / h
            cyl(f"stalk{k}_node{n}", rad * 1.25, 0.035, (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, h * t), "malachite_light", verts=8)
        stalks.append((x1, y1, h))
    # 竹叶：每个节点一簇 6~7 片狭长尖叶（压扁的四棱锥），向外下方张开 —— 版画里“个”字 / “介”字竹叶的块面
    from mathutils import Euler as _Eu
    leaf_n = 0
    for k, (x, y, h) in enumerate(stalks):
        tips = [(x + 0.05, y, h - 0.1), (x - 0.08, y + 0.05, h - 0.75)]
        if k % 2 == 0:
            tips.append((x + 0.02, y - 0.05, h - 1.35))
        for ci, (cx, cy, cz) in enumerate(tips):
            mat = "pine_deep" if (k + ci) % 3 == 0 else "malachite" if (k + ci) % 3 == 1 else "malachite_light"
            for m in range(5):
                yaw = m * (2 * math.pi / 5) + k * 0.7 + ci
                droop = math.radians(95 + 30 * rnd.random())  # 与竖直方向夹角，>90 就是往下垂
                length = 0.75 + 0.3 * rnd.random()
                bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.15, radius2=0.0, depth=length)
                leaf = bpy.context.active_object
                leaf.name = f"leaf{leaf_n}"
                leaf_n += 1
                leaf.scale = (1.0, 0.35, 1.0)
                bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
                # 锥尖朝 +Z；先绕 X 倾倒 droop，再绕 Z 转到 yaw；底面中心对准簇心
                rot = _Eu((droop, 0, yaw), "XYZ")
                tip_dir = Vector((0, 0, 1))
                tip_dir.rotate(rot)
                leaf.rotation_euler = rot
                leaf.location = (cx + tip_dir.x * length / 2, cy + tip_dir.y * length / 2, cz + tip_dir.z * length / 2)
                assign(leaf, mat)
    for k, (x, y) in enumerate(((0.45, -0.35), (-0.35, -0.3))):
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.08, radius2=0.0, depth=0.32, location=(x, y, 0.16))
        assign(bpy.context.active_object, "ochre_light")
    for k, (c, r) in enumerate((((0.55, 0.1, 0.08), 0.18), ((-0.5, 0.25, 0.07), 0.14))):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=c)
        rock = bpy.context.active_object
        rock.scale = (1.3, 1.0, 0.6)
        assign(rock, "stone")


def build_prop_wood_bridge():
    """溪上木桥（2×1，沿 X 跨溪）：青石桥墩 + 微拱的赭石木板桥面 + 两侧木栏 + 桥下一段溪水与卵石。"""
    L = 3.6
    box("water", (L + 0.2, 1.7, 0.04), (0, 0, 0.02), "water")
    for k, (x, y) in enumerate(((-1.3, 0.55), (0.6, -0.6), (1.2, 0.5), (-0.4, -0.55))):
        sphere(f"pebble{k}", 0.09, (x, y, 0.05), "stone", scale=(1.3, 1, 0.5), seg=8)
    for sd in (-1, 1):
        box(f"pier{sd}", (0.6, 1.4, 0.55), (sd * (L / 2 - 0.25), 0, 0.27), "stone")
        box(f"pier{sd}_cap", (0.66, 1.46, 0.08), (sd * (L / 2 - 0.25), 0, 0.58), "tile_light")
    n = 12
    for k in range(n):
        x = -L / 2 + (k + 0.5) * L / n
        z = 0.62 + 0.28 * math.cos(math.pi * x / L)  # 微拱
        box(f"plank{k}", (L / n - 0.03, 1.2, 0.07), (x, 0, z), "ochre" if k % 2 else "ochre_light",
            rot=(0, -math.atan2(-0.28 * math.pi / L * math.sin(math.pi * x / L), 1), 0))
    for sd in (-1, 1):
        y = sd * 0.58
        posts = []
        for k in range(5):
            x = -L / 2 + 0.2 + k * (L - 0.4) / 4
            z = 0.62 + 0.28 * math.cos(math.pi * x / L)
            rod(f"post{sd}_{k}", (x, y, z), (x, y, z + 0.55), 0.04, "wood_dark", verts=8)
            posts.append((x, y, z + 0.5))
        for k in range(4):
            rod(f"rail{sd}_{k}", posts[k], posts[k + 1], 0.03, "wood_dark", verts=6)
    sphere("bridge_lantern", 0.1, (-L / 2 + 0.2, -0.58, 1.38), "cinnabar", scale=(1, 1, 1.3), seg=8)


def build_prop_plum_tree():
    """红梅：黑褐虬曲枝干向两侧伸展，满枝朱砂 / 朱膘梅花簇（无叶），根部小青石。"""
    trunk = [(0, 0, 0), (0.12, 0.02, 0.8), (-0.08, 0.05, 1.6), (0.15, 0.0, 2.3)]
    for i in range(len(trunk) - 1):
        r = 0.2 - i * 0.04
        rod(f"trunk{i}", trunk[i], trunk[i + 1], r, "wood_dark", verts=10)
        sphere(f"tknot{i}", r * 1.05, trunk[i + 1], "wood_dark", seg=10)
    branches = [
        ((-0.08, 0.05, 1.6), (-0.9, -0.1, 2.3), (-1.5, 0.05, 2.5)),
        ((0.12, 0.02, 1.1), (0.9, 0.1, 1.7), (1.5, -0.05, 2.0)),
        ((0.15, 0.0, 2.3), (0.4, -0.05, 3.1), (0.1, 0.05, 3.7)),
        ((0.15, 0.0, 2.3), (0.95, 0.05, 2.9), (1.3, -0.1, 3.4)),
        ((-0.08, 0.05, 1.9), (-0.5, 0.0, 2.9), (-0.9, 0.1, 3.4)),
    ]
    blossoms = []
    for bi, (a, b, c) in enumerate(branches):
        rod(f"br{bi}a", a, b, 0.07, "wood_dark", verts=8)
        rod(f"br{bi}b", b, c, 0.045, "wood_dark", verts=8)
        for t in (0.35, 0.7, 1.0):
            for (p0, p1) in ((a, b), (b, c)):
                blossoms.append(tuple(p0[i] + (p1[i] - p0[i]) * t for i in range(3)))
    import random
    rnd = random.Random(3)
    for k, (x, y, z) in enumerate(blossoms):
        for m in range(3):
            dx, dy, dz = (rnd.random() - 0.5) * 0.35, (rnd.random() - 0.5) * 0.3, (rnd.random() - 0.3) * 0.25
            sphere(f"plum{k}_{m}", 0.07 + 0.03 * rnd.random(), (x + dx, y + dy, z + dz), "cinnabar" if (k + m) % 3 else "gamboge" if m == 2 and k % 5 == 0 else "cinnabar", seg=8)
    for k, (c, r) in enumerate((((0.35, -0.3, 0.08), 0.2), ((-0.3, -0.2, 0.06), 0.15))):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=c)
        rock = bpy.context.active_object
        rock.scale = (1.3, 1.0, 0.6)
        assign(rock, "stone")


def build_tower_rolling_log():
    """滚木礌石楼（2×2）：青石厚墙 + 木构平台 + 一排滚木 + 圆石堆 + 绳闸 + 青瓦顶"""
    box("stone_mass", (3.2, 3.2, 2.6), (0, 0, 1.3), "stone")
    for k in range(4):
        box(f"course{k}", (3.22, 3.22, 0.05), (0, 0, 0.55 + k * 0.6), "tile_light")
    box("deck", (3.4, 3.4, 0.16), (0, 0, 2.7), "ochre")
    for k in range(6):
        rod(f"log{k}", (-1.3 + k * 0.5, -1.55, 3.0), (-1.3 + k * 0.5, -0.4, 3.0), 0.2, "wood_dark")
    for k in range(5):
        sphere(f"boulder{k}", 0.25, (0.9 + (k % 2) * 0.4, 0.5 + (k // 2) * 0.35, 3.0 + (k // 4) * 0.3), "stone", seg=10)
    rod("gate_bar", (-1.6, -1.65, 3.25), (1.6, -1.65, 3.25), 0.06, "rope")
    for k, (x, y) in enumerate(((-1.5, -1.5), (1.5, -1.5), (1.5, 1.5), (-1.5, 1.5))):
        cyl(f"rp{k}", 0.08, 1.4, (x, y, 3.45), "wood_dark", verts=8)
    gable_roof("rl_roof", 3.8, 1.9, 4.1, 5.0, 0.15, "tile_dark", curve=0.15)


BUILDERS = {
    "tower_crossbow": build_tower_crossbow,
    "fish_weir": build_fish_weir,
    "prop_peddler_cart": build_prop_peddler_cart,
    "prop_stone_lantern": build_prop_stone_lantern,
    "prop_beacon_brazier": build_prop_beacon_brazier,
    "house_lv3_courtyard": build_house_lv3_courtyard,
    "ancestral_hall": build_ancestral_hall,
    "tower_rolling_log": build_tower_rolling_log,
    "house_lv1_thatch": build_house_lv1_thatch,
    "house_wing_room": build_house_wing_room,
    "hunt_lodge": build_hunt_lodge,
    "granary": build_granary,
    "tower_oil_fire": build_tower_oil_fire,
    "house_lv2_tile": build_house_lv2_tile,
    "tower_bamboo": build_tower_bamboo,
    "prop_pine_tree": build_prop_pine_tree,
    "prop_bamboo_clump": build_prop_bamboo_clump,
    "prop_wood_bridge": build_prop_wood_bridge,
    "prop_plum_tree": build_prop_plum_tree,
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
