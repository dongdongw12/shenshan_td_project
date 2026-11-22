"""
程序化角色（敌人 / 村民）：基础几何体刚性绑定到骨骼 + 关键帧行走循环。
造型敦实简单（适合木刻粗墨线），由 bake_sprite_anim.py 逐帧渲染成序列帧。

约定：角色面朝 −Y（屏幕左下，与建筑正面一致），脚底在原点，单位米。
build(name) → (armature, meshes, frames)：frames 帧行走循环（第 1..frames 帧），首尾相接。
"""

import math

import bpy
from mathutils import Vector

PALETTE = {
    "ink": "#1c1510", "fur_grey": "#7d8288", "fur_dark": "#4c5056", "boar": "#6b4735", "boar_dark": "#3f2a20",
    "tusk": "#ede3cc", "cloth_dark": "#3e4552", "cloth_brown": "#5c3a26", "cloth_green": "#5c6b4a", "cloth_black": "#232a40",
    "sash": "#b8352a", "skin": "#e2c19a", "steel": "#9aa3a6", "wood": "#9a5a35", "shield": "#7a5232", "flame": "#f08a2c",
    "hat": "#d9a838", "pants": "#2e2a2a", "ochre": "#9a5a35", "azurite": "#2e5f8f", "apron": "#b8352a", "hair": "#1c1510",
    "child_green": "#3f8a63", "pants_blue": "#3e4552",
}
_mats = {}


def _mat(name):
    if name in _mats:
        return _mats[name]
    h = PALETTE[name].lstrip("#")
    rgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*lin, 1.0)
    bsdf.inputs["Roughness"].default_value = 1.0
    if name == "flame":
        bsdf.inputs["Emission Color"].default_value = (*lin, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 3.0
    _mats[name] = m
    return m


def _assign(o, mat):
    o.data.materials.clear()
    o.data.materials.append(_mat(mat))
    return o


def _box(name, size, loc, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _assign(o, mat)


def _ell(name, r, loc, mat, scale=(1, 1, 1), seg=14):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _assign(o, mat)


def _cyl(name, r, depth, loc, mat, rot=(0, 0, 0), verts=10):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    return _assign(o, mat)


def _cone(name, r1, r2, depth, loc, mat, rot=(0, 0, 0), verts=10):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    return _assign(o, mat)


# ----------------------------------------------------------------------------- 骨骼

def _armature(bones):
    """bones: [(name, head, tail, parent)]"""
    data = bpy.data.armatures.new("rig")
    arm = bpy.data.objects.new("rig", data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, head, tail, parent in bones:
        b = data.edit_bones.new(name)
        b.head, b.tail = Vector(head), Vector(tail)
        if parent:
            b.parent = data.edit_bones[parent]
            b.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
    return arm


def _bind(arm, obj, bone):
    mw = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    obj.matrix_world = mw


def _key(arm, bone, frame, rot=None, loc=None):
    pb = arm.pose.bones[bone]
    if rot is not None:
        pb.rotation_euler = [math.radians(a) for a in rot]
        pb.keyframe_insert("rotation_euler", frame=frame)
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert("location", frame=frame)


def _cyclic(arm):
    """关键帧改线性 + 循环，保证首尾无缝"""
    ad = arm.animation_data
    if not ad or not ad.action:
        return
    try:
        curves = ad.action.fcurves
    except AttributeError:  # Blender 5.x：分层动作
        curves = [fc for layer in ad.action.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]
    for fc in curves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
        fc.modifiers.new("CYCLES")


# ----------------------------------------------------------------------------- 角色

QUAD = {
    # kind: (整体缩放, 身体色, 深色, 是否有獠牙, 尾巴长短, 步幅)
    "wolf": (1.0, "fur_grey", "fur_dark", False, 2.2, 30),
    "boar": (1.05, "boar", "boar_dark", True, 0.9, 22),
    "bear_king": (1.9, "fur_dark", "ink", False, 0.6, 16),
}


def build_wolf(frames=8, kind="wolf", action="walk"):
    """四足兽（狼 / 野猪 / 黑熊王共用一套骨骼）：敦实身体、大头、粗短腿（对角步态）"""
    k, body_c, dark_c, tusks, tail_len, stride = QUAD[kind]
    hip_z = 0.42
    arm = _armature([
        ("body", (0, 0.35, hip_z), (0, -0.35, hip_z), None),
        ("head", (0, -0.38, hip_z + 0.1), (0, -0.75, hip_z + 0.14), "body"),
        ("tail", (0, 0.4, hip_z + 0.05), (0, 0.85, hip_z - 0.05), "body"),
        ("leg_fl", (0.14, -0.24, hip_z - 0.04), (0.14, -0.24, 0.0), "body"),
        ("leg_fr", (-0.14, -0.24, hip_z - 0.04), (-0.14, -0.24, 0.0), "body"),
        ("leg_bl", (0.14, 0.24, hip_z - 0.04), (0.14, 0.24, 0.0), "body"),
        ("leg_br", (-0.14, 0.24, hip_z - 0.04), (-0.14, 0.24, 0.0), "body"),
    ])
    parts = []
    fat = 1.2 if kind != "wolf" else 1.0
    parts.append((_ell("w_body", 0.33, (0, 0.02, hip_z + 0.04), body_c, scale=(0.78 * fat, 1.45, 0.8 * fat)), "body"))
    parts.append((_ell("w_ruff", 0.27, (0, -0.28, hip_z + 0.1), dark_c, scale=(0.9 * fat, 0.85, 1.05 * fat)), "body"))
    parts.append((_ell("w_head", 0.2, (0, -0.52, hip_z + 0.2), body_c, scale=(0.9, 1.05, 0.88)), "head"))
    snout_r = 0.13 if kind == "boar" else 0.11
    snout_len = 0.16 if kind == "bear_king" else 0.3   # 熊是短而宽的吻部
    parts.append((_cone("w_snout", snout_r, 0.08 if kind == "bear_king" else 0.06 if kind != "wolf" else 0.04, snout_len,
                        (0, -0.66 - snout_len / 2, hip_z + 0.15), dark_c, rot=(math.radians(95), 0, 0)), "head"))
    for sd in (-1, 1):
        if kind == "bear_king":
            parts.append((_ell(f"w_ear{sd}", 0.07, (sd * 0.13, -0.48, hip_z + 0.38), dark_c), "head"))
        else:
            parts.append((_cone(f"w_ear{sd}", 0.07, 0.0, 0.2 if kind == "wolf" else 0.12, (sd * 0.1, -0.5, hip_z + 0.42), dark_c, rot=(0, math.radians(sd * 12), 0)), "head"))
    if kind == "bear_king":
        parts.append((_ell("w_tail", 0.07, (0, 0.5, hip_z - 0.05), dark_c), "tail"))  # 熊尾巴小且低
    else:
        parts.append((_ell("w_tail", 0.12, (0, 0.62, hip_z + 0.0), dark_c, scale=(0.8, tail_len, 0.8)), "tail"))
    for name, (x, y) in {"leg_fl": (0.14, -0.24), "leg_fr": (-0.14, -0.24), "leg_bl": (0.14, 0.24), "leg_br": (-0.14, 0.24)}.items():
        parts.append((_cone(f"w_{name}", 0.085 * (1.25 if kind != "wolf" else 1), 0.06, hip_z - 0.02, (x, y, (hip_z - 0.02) / 2), dark_c, verts=8), name))
        parts.append((_ell(f"w_paw_{name}", 0.07, (x, y - 0.03, 0.04), "ink", scale=(1, 1.3, 0.6), seg=8), name))
    if tusks:
        for sd in (-1, 1):
            parts.append((_cone(f"w_tusk{sd}", 0.035, 0.0, 0.16, (sd * 0.08, -0.82, hip_z + 0.2), "tusk", rot=(math.radians(-30), 0, 0)), "head"))
    if kind == "bear_king":
        parts.append((_box("w_sash", (0.58, 0.07, 0.56), (0, -0.12, hip_z + 0.06), "sash"), "body"))
    for o, b in parts:
        _bind(arm, o, b)
    arm.scale = (k, k, k)
    if action == "attack":
        # 扑咬：身体前压、头猛地下探再抬起，前腿蹬地
        for f in range(frames + 1):
            ph = f / frames
            lunge = math.sin(ph * math.pi)  # 0→1→0
            _key(arm, "body", f + 1, rot=(-12 * lunge, 0, 0), loc=(0, -0.12 * lunge, -0.03 * lunge))
            _key(arm, "head", f + 1, rot=(-28 * math.sin(ph * 2 * math.pi) * (1 - ph * 0.3), 0, 0))
            for leg, sgn in (("leg_fl", 1), ("leg_fr", 1), ("leg_bl", -1), ("leg_br", -1)):
                _key(arm, leg, f + 1, rot=(sgn * 22 * lunge, 0, 0))
            _key(arm, "tail", f + 1, rot=(20 * lunge, 0, 0))
        _cyclic(arm)
        return arm, [o for o, _ in parts], frames
    for f in range(frames + 1):
        t = f / frames * 2 * math.pi
        sw = stride * math.sin(t)
        _key(arm, "leg_fl", f + 1, rot=(sw, 0, 0))
        _key(arm, "leg_br", f + 1, rot=(sw, 0, 0))
        _key(arm, "leg_fr", f + 1, rot=(-sw, 0, 0))
        _key(arm, "leg_bl", f + 1, rot=(-sw, 0, 0))
        _key(arm, "body", f + 1, loc=(0, 0, 0.03 * abs(math.sin(t))))
        _key(arm, "head", f + 1, rot=(5 * math.sin(2 * t), 0, 0))
        _key(arm, "tail", f + 1, rot=(10, 0, 20 * math.sin(t)))
    _cyclic(arm)
    return arm, [o for o, _ in parts], frames


def build_bandit(variant="swordsman", frames=8, action="walk"):
    """土匪：腿、躯干（带红腰带）、头（红头巾）、双臂、按变体持道具"""
    cloth = {"swordsman": "cloth_dark", "shield": "cloth_brown", "scout": "cloth_green", "arsonist": "cloth_brown", "chief": "cloth_black",
             "hero": "ochre", "wife": "azurite", "child": "child_green"}[variant]
    villager = variant in ("hero", "wife", "child")
    s = 1.25 if variant == "chief" else 0.68 if variant == "child" else 1.0
    arm = _armature([
        ("hips", (0, 0, 0.9 * s), (0, 0, 1.05 * s), None),
        ("chest", (0, 0, 1.05 * s), (0, 0, 1.45 * s), "hips"),
        ("head", (0, 0, 1.45 * s), (0, 0, 1.75 * s), "chest"),
        ("arm_l", (0.24 * s, 0, 1.38 * s), (0.28 * s, 0, 0.95 * s), "chest"),
        ("arm_r", (-0.24 * s, 0, 1.38 * s), (-0.28 * s, 0, 0.95 * s), "chest"),
        ("leg_l", (0.1 * s, 0, 0.9 * s), (0.1 * s, 0, 0.0), "hips"),
        ("leg_r", (-0.1 * s, 0, 0.9 * s), (-0.1 * s, 0, 0.0), "hips"),
    ])
    parts = []
    for side, bone in ((1, "leg_l"), (-1, "leg_r")):
        parts.append((_box(f"b_leg{side}", (0.15 * s, 0.17 * s, 0.85 * s), (side * 0.1 * s, 0, 0.45 * s), "pants_blue" if villager else "pants"), bone))
        parts.append((_box(f"b_foot{side}", (0.15 * s, 0.24 * s, 0.08 * s), (side * 0.1 * s, -0.04 * s, 0.04 * s), "ink"), bone))
    parts.append((_box("b_torso", (0.42 * s, 0.26 * s, 0.6 * s), (0, 0, 1.2 * s), cloth), "chest"))
    parts.append((_box("b_sash", (0.44 * s, 0.28 * s, 0.08 * s), (0, 0, 1.0 * s), "sash" if not villager else "ink"), "hips"))
    parts.append((_ell("b_head", 0.14 * s, (0, 0, 1.6 * s), "skin"), "head"))
    if not villager:
        parts.append((_cyl("b_band", 0.145 * s, 0.06 * s, (0, 0, 1.66 * s), "sash", verts=14), "head"))
    if variant == "hero":
        parts.append((_cone("b_hat", 0.34, 0.03, 0.2, (0, 0, 1.8), "hat"), "head"))
        parts.append((_cyl("b_hoe", 0.025, 1.2, (-0.3, -0.05, 1.05), "wood", rot=(math.radians(-12), 0, 0)), "arm_r"))
        parts.append((_box("b_hoe_blade", (0.05, 0.22, 0.14), (-0.3, -0.18, 0.47), "steel"), "arm_r"))
    if variant == "wife":
        parts.append((_box("b_apron", (0.3, 0.04, 0.5), (0, -0.15, 1.0), "apron"), "chest"))
        parts.append((_ell("b_bun", 0.08, (0, 0.1, 1.72), "hair"), "head"))
        parts.append((_ell("b_hair", 0.145, (0, 0.02, 1.64), "hair", scale=(1, 1, 0.75)), "head"))
    if variant == "child":
        parts.append((_ell("b_tuft", 0.05, (0, 0, 1.6 * s + 0.11), "hair"), "head"))
    for side, bone in ((1, "arm_l"), (-1, "arm_r")):
        parts.append((_box(f"b_arm{side}", (0.11 * s, 0.13 * s, 0.48 * s), (side * 0.27 * s, 0, 1.15 * s), cloth), bone))
        parts.append((_ell(f"b_hand{side}", 0.06 * s, (side * 0.28 * s, 0, 0.9 * s), "skin"), bone))
    if variant in ("swordsman", "chief"):
        parts.append((_box("b_blade", (0.04, 0.06, 0.7 * s), (-0.3 * s, -0.12 * s, 1.15 * s), "steel", rot=(math.radians(-25), 0, 0)), "arm_r"))
    if variant == "shield":
        parts.append((_box("b_shield", (0.08, 0.5, 0.65), (0.36, -0.12, 1.05), "shield"), "arm_l"))
    if variant == "arsonist":
        parts.append((_cyl("b_torch", 0.03, 0.5, (-0.3, -0.12, 1.1), "wood", rot=(math.radians(-20), 0, 0)), "arm_r"))
        parts.append((_ell("b_flame", 0.09, (-0.3, -0.21, 1.37), "flame", scale=(1, 1, 1.6)), "arm_r"))
    if variant == "chief":
        parts.append((_cyl("b_pole", 0.025, 1.5, (0.32 * s, 0.1, 1.5 * s), "wood"), "chest"))
        parts.append((_box("b_flag", (0.03, 0.5, 0.4), (0.32 * s, 0.37, 2.05 * s), "cloth_black"), "chest"))
    if variant == "scout":
        parts.append((_cone("b_hat", 0.3, 0.02, 0.18, (0, 0, 1.77), "hat"), "head"))
    for o, b in parts:
        _bind(arm, o, b)
    if action == "attack":
        # 劈砍：右臂举过头顶 → 猛劈下；盾匪用盾顶撞；身体随之前倾，弓步站定
        for f in range(frames + 1):
            ph = f / frames
            if ph < 0.45:
                raise_ = ph / 0.45
                arm_r = -150 * raise_          # 举起（绕 X 轴向后上方）
            else:
                down = min(1.0, (ph - 0.45) / 0.25)
                arm_r = -150 + 200 * down      # 劈下到身前
            lean = math.sin(ph * math.pi)
            _key(arm, "arm_r", f + 1, rot=(arm_r if variant != "shield" else -20 * lean, 0, 0))
            _key(arm, "arm_l", f + 1, rot=(-60 * lean if variant == "shield" else 15, 0, 0))
            _key(arm, "chest", f + 1, rot=(-14 * lean, 0, 0))
            _key(arm, "leg_l", f + 1, rot=(-18, 0, 0))
            _key(arm, "leg_r", f + 1, rot=(16, 0, 0))
            _key(arm, "hips", f + 1, loc=(0, -0.06 * lean, -0.04))
        _cyclic(arm)
        return arm, [o for o, _ in parts], frames
    for f in range(frames + 1):
        t = f / frames * 2 * math.pi
        sw = 30 * math.sin(t)
        _key(arm, "leg_l", f + 1, rot=(sw, 0, 0))
        _key(arm, "leg_r", f + 1, rot=(-sw, 0, 0))
        _key(arm, "arm_l", f + 1, rot=(-sw * 0.8, 0, 0))
        _key(arm, "arm_r", f + 1, rot=(sw * 0.5 - 15, 0, 0))
        _key(arm, "hips", f + 1, loc=(0, 0, 0.035 * abs(math.sin(t))))
        _key(arm, "chest", f + 1, rot=(-4, 0, 3 * math.sin(t)))
    _cyclic(arm)
    return arm, [o for o, _ in parts], frames


BUILDERS = {
    "wolf": lambda frames=8, action="walk": build_wolf(frames, "wolf", action),
    "boar": lambda frames=8, action="walk": build_wolf(frames, "boar", action),
    "bear_king": lambda frames=8, action="walk": build_wolf(frames, "bear_king", action),
    "swordsman": lambda frames=8, action="walk": build_bandit("swordsman", frames, action),
    "shield": lambda frames=8, action="walk": build_bandit("shield", frames, action),
    "scout": lambda frames=8, action="walk": build_bandit("scout", frames, action),
    "arsonist": lambda frames=8, action="walk": build_bandit("arsonist", frames, action),
    "second_chief": lambda frames=8, action="walk": build_bandit("chief", frames, action),
    "chief": lambda frames=8, action="walk": build_bandit("chief", frames, action),
    # 家人（白天在村里干活走动，当家的夜里守主屋）
    "hero": lambda frames=8, action="walk": build_bandit("hero", frames, action),
    "wife": lambda frames=8, action="walk": build_bandit("wife", frames, action),
    "child": lambda frames=8, action="walk": build_bandit("child", frames, action),
}


def build(name, frames=8, action="walk"):
    """action: walk（行走循环）| attack（攻击循环）"""
    _mats.clear()
    return BUILDERS[name](frames, action)
