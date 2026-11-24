"""
程序化角色（敌人 / 村民）：基础几何体刚性绑定到骨骼 + 关键帧行走循环。
造型敦实（大头、粗短腿，适合木刻粗墨线），由 bake_sprite_anim.py 逐帧渲染成序列帧。

五官：眼白 / 瞳仁 / 高光、眉、鼻、嘴、腮红、伤疤、眼罩、鼻孔、爪子等都是贴着头部曲面的薄片（_decal / _stroke），
标记为细节件（obj["feature"]=1）：放进 NoInk 集合不描外轮廓，物体索引 2，stylize_sprites 不平涂、原样贴回，
所以几像素大的眼睛也不会被 Kuwahara 抹掉。表情随角色与动作变：土匪横眉、攻击时张嘴吼；家人眉眼和善、干活时抿嘴。

约定：角色面朝 −Y（屏幕左下，与建筑正面一致），脚底在原点，单位米。
build(name) → (armature, meshes, frames)：frames 帧循环（第 1..frames 帧），首尾相接。
"""

import math

import bpy
from mathutils import Matrix, Vector

PALETTE = {
    "ink": "#1c1510", "fur_grey": "#7d8288", "fur_dark": "#4c5056", "fur_light": "#c9c2b2", "boar": "#6b4735",
    "boar_dark": "#3f2a20", "tusk": "#ede3cc", "cloth_dark": "#3e4552", "cloth_brown": "#5c3a26",
    "cloth_green": "#5c6b4a", "cloth_black": "#232a40", "sash": "#b8352a", "skin": "#e2c19a", "skin_dark": "#c99a70",
    "steel": "#9aa3a6", "wood": "#9a5a35", "shield": "#7a5232", "flame": "#f08a2c", "hat": "#d9a838",
    "pants": "#2e2a2a", "ochre": "#9a5a35", "azurite": "#2e5f8f", "apron": "#b8352a", "hair": "#1c1510",
    "child_green": "#3f8a63", "pants_blue": "#3e4552", "undershirt": "#e8dcc0", "wrap": "#b8ab8f", "straw": "#bfa070",
    # 五官
    "eye_white": "#f1e9d6", "pupil": "#1c1510", "glint": "#ffffff", "blush": "#d08a6a", "lip": "#a9462f",
    "mouth_in": "#5a1f17", "teeth": "#efe7d4", "scar": "#8f5a38", "wolf_eye": "#e0a93a", "boar_eye": "#7a2e1c",
    "snout_pink": "#b98473", "muzzle": "#b88d62", "moon": "#e8dcc0", "tongue": "#b5513d", "ear_in": "#b98473",
    "gold": "#c79c48",
}
_mats = {}
NO_INK = "NoInk"  # 与 bake_isometric_sprites.NO_INK_COLLECTION 一致


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


# ----------------------------------------------------------------------------- 五官（贴面薄片）

def _feature(o):
    """细节件：不描外轮廓（NoInk 集合）、物体索引 2（bake_sprite_anim 据此设置）"""
    o["feature"] = 1
    col = bpy.data.collections.get(NO_INK)
    if col is not None:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
    return o


def _surface(center, axes, x, z, push):
    """椭球（中心 center、半轴 axes）正面（−Y 一侧）横向 x、竖向 z（相对中心）处的点与法线"""
    a, b, c = axes
    t = 1 - (x / a) ** 2 - (z / c) ** 2
    y = -b * math.sqrt(max(t, 0.03))
    n = Vector((x / a ** 2, y / b ** 2, z / c ** 2)).normalized()
    return Vector(center) + Vector((x, y, z)) + n * push, n


def _decal(name, center, axes, x, z, w, h, mat, spin=0.0, push=0.003, th=0.0018):
    """贴面椭圆薄片：宽 w、高 h（米），在面内转 spin 度（逆时针为正，从正面看）"""
    p, n = _surface(center, axes, x, z, push)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=1, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.scale = (w / 2, th, h / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    tilt = -math.asin(max(-1.0, min(1.0, n.z)))
    turn = math.atan2(n.x, -n.y)
    o.matrix_world = (Matrix.Translation(p) @ Matrix.Rotation(turn, 4, "Z") @ Matrix.Rotation(tilt, 4, "X")
                      @ Matrix.Rotation(math.radians(-spin), 4, "Y"))
    _assign(o, mat)
    return _feature(o)


def _stroke(name, center, axes, pts, t, mat, push=0.004):
    """贴面笔画：沿折线 pts=[(x, z), …] 的一串圆头短段，粗 t"""
    out = []
    for i in range(len(pts) - 1):
        (x0, z0), (x1, z1) = pts[i], pts[i + 1]
        ang = math.degrees(math.atan2(z1 - z0, x1 - x0))
        out.append(_decal(f"{name}{i}", center, axes, (x0 + x1) / 2, (z0 + z1) / 2, math.hypot(x1 - x0, z1 - z0) + t, t,
                          mat, spin=ang, push=push + 0.0004 * i))
    return out


def _mirror(pts):
    return [(-x, z) for x, z in pts]


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


# ----------------------------------------------------------------------------- 四足兽

QUAD = {
    # kind: (整体缩放, 身体色, 深色, 是否有獠牙, 尾巴长短, 步幅)
    "wolf": (1.0, "fur_grey", "fur_dark", False, 2.2, 30),
    "boar": (1.05, "boar", "boar_dark", True, 0.9, 22),
    "bear_king": (1.9, "fur_dark", "ink", False, 0.6, 16),
}


def _beast_face(kind, hc, ha, hip_z, action):
    """兽脸：眼（眼白 / 瞳 / 高光）、横眉、鼻、鼻孔、獠牙 / 犬齿。返回 [(obj, bone)]"""
    parts = []
    attack = action == "attack"
    if kind == "wolf":
        ex, ez, ew, eh, slant = 0.09, 0.064, 0.078, 0.046, 16
        eye_c, pupil_w, pupil_h = "wolf_eye", 0.022, 0.042
    elif kind == "boar":
        ex, ez, ew, eh, slant = 0.094, 0.072, 0.05, 0.04, 10
        eye_c, pupil_w, pupil_h = "boar_eye", 0.026, 0.03
    else:  # 熊：小黑眼
        ex, ez, ew, eh, slant = 0.088, 0.072, 0.048, 0.046, 0
        eye_c, pupil_w, pupil_h = "pupil", 0.0, 0.0
    for sd in (-1, 1):
        x = sd * ex
        # 墨色眼眶（比眼大一圈）→ 眼 → 瞳 → 高光：小尺寸下靠眼眶读出眼睛
        parts.append((_decal(f"f_rim{sd}", hc, ha, x, ez, ew + 0.022, eh + 0.02, "ink", spin=-sd * slant, push=0.002), "head"))
        parts.append((_decal(f"f_eye{sd}", hc, ha, x, ez, ew, eh, eye_c, spin=-sd * slant, push=0.0045), "head"))
        if pupil_w:
            parts.append((_decal(f"f_pupil{sd}", hc, ha, x - sd * 0.004, ez, pupil_w, pupil_h, "pupil", push=0.007), "head"))
        parts.append((_decal(f"f_glint{sd}", hc, ha, x + sd * 0.01, ez + 0.01, 0.015, 0.015, "glint", push=0.0095), "head"))
        # 横眉：外高内低（凶相），攻击时压得更低
        lift = -0.008 if attack else 0.0
        parts += [(o, "head") for o in _stroke(f"f_brow{sd}", hc, ha,
                                               [(sd * (ex + 0.045), ez + 0.06), (sd * (ex - 0.005), ez + 0.036 + lift),
                                                (sd * (ex - 0.045), ez + 0.012 + lift * 2)], 0.026, "ink")]
    return parts


def build_wolf(frames=8, kind="wolf", action="walk"):
    """四足兽（狼 / 野猪 / 黑熊王共用一套骨骼）：敦实身体、大头、粗短腿（对角步态）；攻击时张嘴露牙"""
    k, body_c, dark_c, tusks, tail_len, stride = QUAD[kind]
    hip_z = 0.42
    arm = _armature([
        ("body", (0, 0.35, hip_z), (0, -0.35, hip_z), None),
        ("head", (0, -0.38, hip_z + 0.1), (0, -0.75, hip_z + 0.14), "body"),
        ("jaw", (0, -0.6, hip_z + 0.1), (0, -0.9, hip_z + 0.07), "head"),
        ("tail", (0, 0.4, hip_z + 0.05), (0, 0.85, hip_z - 0.05), "body"),
        ("leg_fl", (0.14, -0.24, hip_z - 0.04), (0.14, -0.24, 0.0), "body"),
        ("leg_fr", (-0.14, -0.24, hip_z - 0.04), (-0.14, -0.24, 0.0), "body"),
        ("leg_bl", (0.14, 0.24, hip_z - 0.04), (0.14, 0.24, 0.0), "body"),
        ("leg_br", (-0.14, 0.24, hip_z - 0.04), (-0.14, 0.24, 0.0), "body"),
    ])
    parts = []
    fat = 1.2 if kind != "wolf" else 1.0
    parts.append((_ell("w_body", 0.33, (0, 0.02, hip_z + 0.04), body_c, scale=(0.78 * fat, 1.45, 0.8 * fat)), "body"))
    ruff_c, ruff_a = (0, -0.28, hip_z + 0.1), (0.27 * 0.9 * fat, 0.27 * 0.85, 0.27 * 1.05 * fat)
    parts.append((_ell("w_ruff", 0.27, ruff_c, dark_c, scale=(0.9 * fat, 0.85, 1.05 * fat)), "body"))
    hc, ha = (0, -0.52, hip_z + 0.2), (0.2 * 0.9, 0.2 * 1.05, 0.2 * 0.88)
    parts.append((_ell("w_head", 0.2, hc, body_c, scale=(0.9, 1.05, 0.88)), "head"))
    snout_r = 0.13 if kind == "boar" else 0.12 if kind == "bear_king" else 0.11
    snout_len = 0.17 if kind == "bear_king" else 0.3   # 熊是短而宽的吻部
    snout_tip_r = 0.08 if kind == "bear_king" else 0.065 if kind == "boar" else 0.045
    snout_c = "muzzle" if kind == "bear_king" else dark_c
    tip_y = -0.66 - snout_len
    parts.append((_cone("w_snout", snout_r, snout_tip_r, snout_len, (0, -0.66 - snout_len / 2, hip_z + 0.16), snout_c,
                        rot=(math.radians(95), 0, 0), verts=14), "head"))
    # 下颌：闭嘴时藏在吻部下面只露下巴，攻击时张开（嘴里暗红 + 舌头）
    jaw_len = snout_len * 0.85
    parts.append((_cone("w_jaw", snout_r * 0.72, snout_tip_r * 0.8, jaw_len, (0, -0.64 - jaw_len / 2, hip_z + 0.085),
                        "fur_light" if kind == "wolf" else snout_c, rot=(math.radians(93), 0, 0), verts=12), "jaw"))
    parts.append((_ell("w_mouth_in", snout_r * 0.7, (0, -0.66 - snout_len * 0.45, hip_z + 0.115), "mouth_in",
                       scale=(0.85, snout_len * 2.2, 0.35), seg=12), "head"))
    parts.append((_ell("w_tongue", snout_r * 0.45, (0, -0.66 - snout_len * 0.45, hip_z + 0.1), "tongue",
                       scale=(0.9, snout_len * 2.6, 0.3), seg=10), "jaw"))
    # 牙：狼和熊上颌两颗犬齿（攻击张嘴时最显眼）
    if kind != "boar":
        fang = 0.055 if kind == "wolf" else 0.05
        for sd in (-1, 1):
            parts.append((_feature(_cone(f"w_fang{sd}", 0.016, 0.0, fang, (sd * snout_tip_r * 0.75, tip_y + 0.05, hip_z + 0.1),
                                         "teeth", rot=(math.radians(180), 0, 0), verts=6)), "head"))
    # 鼻头
    nose_r = 0.05 if kind == "bear_king" else 0.035
    if kind == "boar":
        parts.append((_cyl("w_snout_disc", snout_tip_r * 1.05, 0.03, (0, tip_y - 0.005, hip_z + 0.135), "snout_pink",
                           rot=(math.radians(95), 0, 0), verts=14), "head"))
        for sd in (-1, 1):
            parts.append((_feature(_ell(f"w_nostril{sd}", 0.016, (sd * 0.024, tip_y - 0.022, hip_z + 0.135), "ink",
                                        scale=(1, 0.4, 1.3), seg=8)), "head"))
    else:
        parts.append((_ell("w_nose", nose_r, (0, tip_y + 0.005, hip_z + 0.17 - (0.0 if kind == "bear_king" else 0.015)), "ink",
                           scale=(1.15, 0.9, 0.85), seg=10), "head"))
    parts += _beast_face(kind, hc, ha, hip_z, action)
    # 耳朵（内耳粉色）
    for sd in (-1, 1):
        if kind == "bear_king":
            parts.append((_ell(f"w_ear{sd}", 0.07, (sd * 0.13, -0.48, hip_z + 0.38), dark_c), "head"))
            parts.append((_feature(_ell(f"w_ear_in{sd}", 0.04, (sd * 0.13, -0.545, hip_z + 0.38), "ear_in", scale=(1, 0.25, 1), seg=10)), "head"))
        else:
            h_ear = 0.2 if kind == "wolf" else 0.12
            parts.append((_cone(f"w_ear{sd}", 0.07, 0.0, h_ear, (sd * 0.1, -0.5, hip_z + 0.42), dark_c, rot=(0, math.radians(sd * 12), 0)), "head"))
            parts.append((_feature(_cone(f"w_ear_in{sd}", 0.04, 0.0, h_ear * 0.7, (sd * 0.098, -0.553, hip_z + 0.405), "ear_in",
                                         rot=(math.radians(-8), math.radians(sd * 12), 0), verts=8)), "head"))
    # 身上的细节
    if kind == "wolf":
        parts.append((_ell("w_chest", 0.16, (0, -0.45, hip_z - 0.02), "fur_light", scale=(0.9, 0.6, 1.1)), "body"))  # 浅色胸毛
        for sd in (-1, 1):  # 腮毛
            parts.append((_cone(f"w_cheek{sd}", 0.06, 0.0, 0.13, (sd * 0.17, -0.5, hip_z + 0.14), body_c,
                                rot=(0, math.radians(sd * 70), 0), verts=6), "head"))
    if kind == "boar":  # 背上一溜鬃毛
        for i, y in enumerate((-0.34, -0.2, -0.06, 0.08, 0.22)):
            parts.append((_cone(f"w_bristle{i}", 0.05, 0.0, 0.14 - 0.015 * i, (0, y, hip_z + 0.37 - 0.02 * i), "boar_dark",
                                rot=(math.radians(25), 0, 0), verts=6), "body"))
    if kind == "bear_king":
        parts.append((_box("w_sash", (0.58, 0.07, 0.56), (0, -0.12, hip_z + 0.06), "sash"), "body"))
        # 胸前白月牙（黑熊）
        parts += [(o, "body") for o in _stroke("f_moon", ruff_c, ruff_a,
                                               [(-0.17, -0.06), (-0.09, -0.13), (0.0, -0.155), (0.09, -0.13), (0.17, -0.06)],
                                               0.045, "moon", push=0.006)]
    if kind == "bear_king":
        parts.append((_ell("w_tail", 0.07, (0, 0.5, hip_z - 0.05), dark_c), "tail"))  # 熊尾巴小且低
    else:
        parts.append((_ell("w_tail", 0.12, (0, 0.62, hip_z + 0.0), dark_c, scale=(0.8, tail_len, 0.8)), "tail"))
        if kind == "wolf":
            parts.append((_ell("w_tail_tip", 0.08, (0, 0.62 + 0.12 * tail_len * 0.8, hip_z - 0.01), "fur_light", scale=(0.8, 1.3, 0.8)), "tail"))
    for name, (x, y) in {"leg_fl": (0.14, -0.24), "leg_fr": (-0.14, -0.24), "leg_bl": (0.14, 0.24), "leg_br": (-0.14, 0.24)}.items():
        parts.append((_cone(f"w_{name}", 0.085 * (1.25 if kind != "wolf" else 1), 0.06, hip_z - 0.02, (x, y, (hip_z - 0.02) / 2), dark_c, verts=8), name))
        parts.append((_ell(f"w_paw_{name}", 0.07, (x, y - 0.03, 0.04), "ink", scale=(1, 1.3, 0.6), seg=8), name))
        if kind != "boar":  # 爪子
            for cx in (-0.03, 0.0, 0.03):
                parts.append((_feature(_cone(f"w_claw_{name}{cx}", 0.012, 0.0, 0.04, (x + cx, y - 0.115, 0.03), "tusk",
                                             rot=(math.radians(100), 0, 0), verts=5)), name))
    if tusks:
        for sd in (-1, 1):
            parts.append((_cone(f"w_tusk{sd}", 0.035, 0.0, 0.17, (sd * 0.08, tip_y + 0.12, hip_z + 0.2), "tusk",
                                rot=(math.radians(-30), 0, 0)), "head"))
    for o, b in parts:
        _bind(arm, o, b)
    arm.scale = (k, k, k)
    if action == "attack":
        # 扑咬：身体前压、头猛地下探再抬起，前腿蹬地，嘴张开
        for f in range(frames + 1):
            ph = f / frames
            lunge = math.sin(ph * math.pi)  # 0→1→0
            _key(arm, "body", f + 1, rot=(-12 * lunge, 0, 0), loc=(0, -0.12 * lunge, -0.03 * lunge))
            _key(arm, "head", f + 1, rot=(-28 * math.sin(ph * 2 * math.pi) * (1 - ph * 0.3), 0, 0))
            _key(arm, "jaw", f + 1, rot=(-(14 if kind == "boar" else 32) * (0.35 + 0.65 * lunge), 0, 0))
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
        _key(arm, "jaw", f + 1, rot=(-6 if kind == "wolf" else 0, 0, 0))  # 狼走路微张嘴、露犬齿
        _key(arm, "tail", f + 1, rot=(10, 0, 20 * math.sin(t)))
    _cyclic(arm)
    return arm, [o for o, _ in parts], frames


# ----------------------------------------------------------------------------- 人形

HEAD_TURN = 30.0  # 人头朝镜头转的角度（见 build_bandit）

# 表情：眉形（相对眼睛）、嘴形；攻击 / 干活会换嘴
FACE = {
    #            眉      眼          嘴(行走)   嘴(攻击)  嘴(干活)  其他
    "swordsman": ("angry", "normal", "frown", "shout", None, ("scar",)),
    "shield": ("unibrow", "normal", "frown", "shout", None, ("mustache",)),
    "scout": ("angry", "squint", "smirk", "shout", None, ()),
    "arsonist": ("angry", "wild", "grin", "grin", None, ()),
    "chief": ("heavy", "normal", "frown", "shout", None, ("beard", "mustache")),
    "second_chief": ("heavy", "normal", "smirk", "shout", None, ("eyepatch", "mustache")),
    "hero": ("kind", "normal", "smile", "grit", "grit", ()),
    "wife": ("soft", "lashes", "lips", "o", "lips", ("blush",)),
    "child": ("soft", "big", "open_smile", "o", "open_smile", ("blush",)),
}


def _human_face(variant, hc, ha, s, action):
    """人脸：眼白 + 瞳仁 + 高光、眉、鼻、嘴、腮红、胡子 / 伤疤 / 眼罩。坐标相对头心，单位米（已乘 s）"""
    brow, eye, walk_m, attack_m, work_m, extras = FACE[variant]
    mouth = attack_m if action == "attack" else (work_m or walk_m) if action == "work" else walk_m
    P = []

    def S(v):
        return v * s

    ex, ez = S(0.07), S(0.0)
    ew, eh, pw, ph = S(0.074), S(0.05), S(0.04), S(0.046)
    if eye == "squint":
        eh, ph = S(0.026), S(0.026)
    elif eye == "wild":
        ew, eh, pw, ph = S(0.08), S(0.064), S(0.026), S(0.028)
    elif eye == "big":
        ew, eh, pw, ph = S(0.08), S(0.068), S(0.052), S(0.058)
    for sd in (-1, 1):
        if "eyepatch" in extras and sd == 1:
            continue
        x = sd * ex
        P.append(_decal(f"f_rim{sd}", hc, ha, x, ez, ew + S(0.014), eh + S(0.014), "ink", push=0.002))
        P.append(_decal(f"f_eye{sd}", hc, ha, x, ez, ew, eh, "eye_white", push=0.0042))
        P.append(_decal(f"f_pupil{sd}", hc, ha, x - sd * S(0.006), ez - S(0.002), pw, ph, "pupil", push=0.0062))
        P.append(_decal(f"f_glint{sd}", hc, ha, x - sd * S(0.0), ez + S(0.011), S(0.015), S(0.015), "glint", push=0.0085))
        # 上眼线（墨）：让眼睛在小尺寸下也有形
        P += _stroke(f"f_lid{sd}", hc, ha, [(x - sd * ew * 0.5, ez + eh * 0.15), (x, ez + eh * 0.55), (x + sd * ew * 0.55, ez + eh * 0.25)],
                     S(0.011), "ink", push=0.0065)
        if eye == "lashes":
            P += _stroke(f"f_lash{sd}", hc, ha, [(x + sd * ew * 0.5, ez + eh * 0.3), (x + sd * ew * 0.75, ez + eh * 0.75)], S(0.009), "ink", push=0.007)
        # 眉
        if brow == "angry":
            pts = [(sd * S(0.112), ez + S(0.085)), (sd * S(0.07), ez + S(0.07)), (sd * S(0.03), ez + S(0.045))]
            t = S(0.026)
        elif brow == "heavy":
            pts = [(sd * S(0.118), ez + S(0.088)), (sd * S(0.07), ez + S(0.072)), (sd * S(0.026), ez + S(0.05))]
            t = S(0.034)
        elif brow == "unibrow":
            pts = [(sd * S(0.112), ez + S(0.082)), (sd * S(0.06), ez + S(0.068)), (0.0, ez + S(0.06))]
            t = S(0.03)
        elif brow == "kind":
            pts = [(sd * S(0.105), ez + S(0.065)), (sd * S(0.07), ez + S(0.08)), (sd * S(0.035), ez + S(0.074))]
            t = S(0.022)
        else:  # soft
            pts = [(sd * S(0.1), ez + S(0.074)), (sd * S(0.068), ez + S(0.088)), (sd * S(0.036), ez + S(0.082))]
            t = S(0.016)
        if action == "attack" and brow in ("kind", "soft"):  # 家人着急：眉头上扬
            pts = [(sd * S(0.1), ez + S(0.058)), (sd * S(0.065), ez + S(0.07)), (sd * S(0.032), ez + S(0.08))]
        P += _stroke(f"f_brow{sd}", hc, ha, pts, t, "ink", push=0.005)
    # 鼻：深一号肤色的小团 + 一笔鼻底
    P.append(_decal("f_nose", hc, ha, 0.0, S(-0.038), S(0.034), S(0.03), "skin_dark", push=0.004))
    P += _stroke("f_nostril", hc, ha, [(S(-0.014), S(-0.052)), (S(0.0), S(-0.056)), (S(0.014), S(-0.052))], S(0.008), "ink", push=0.0055)
    # 嘴
    mz = S(-0.09)
    if mouth == "frown":
        P += _stroke("f_mouth", hc, ha, [(S(-0.045), mz - S(0.012)), (S(-0.015), mz + S(0.002)), (S(0.015), mz + S(0.002)), (S(0.045), mz - S(0.012))], S(0.017), "ink")
    elif mouth == "smirk":
        P += _stroke("f_mouth", hc, ha, [(S(-0.04), mz - S(0.004)), (S(0.0), mz - S(0.002)), (S(0.03), mz + S(0.006)), (S(0.05), mz + S(0.016))], S(0.012), "ink")
    elif mouth == "smile":
        P += _stroke("f_mouth", hc, ha, [(S(-0.045), mz + S(0.01)), (S(-0.018), mz - S(0.006)), (S(0.018), mz - S(0.006)), (S(0.045), mz + S(0.01))], S(0.017), "ink")
    elif mouth == "grit":
        P.append(_decal("f_mouth", hc, ha, 0.0, mz, S(0.06), S(0.022), "teeth", push=0.004))
        P += _stroke("f_mouth_l", hc, ha, [(S(-0.034), mz + S(0.011)), (S(0.034), mz + S(0.011))], S(0.008), "ink", push=0.006)
        P += _stroke("f_mouth_l2", hc, ha, [(S(-0.034), mz - S(0.011)), (S(0.034), mz - S(0.011))], S(0.008), "ink", push=0.006)
    elif mouth == "shout":
        P.append(_decal("f_mouth", hc, ha, 0.0, mz - S(0.006), S(0.062), S(0.05), "mouth_in", push=0.004))
        P.append(_decal("f_teeth", hc, ha, 0.0, mz + S(0.012), S(0.048), S(0.013), "teeth", push=0.0065))
        P.append(_decal("f_tongue", hc, ha, 0.0, mz - S(0.022), S(0.034), S(0.014), "tongue", push=0.0065))
    elif mouth == "grin":
        P.append(_decal("f_mouth", hc, ha, 0.0, mz, S(0.078), S(0.03), "teeth", push=0.004))
        P += _stroke("f_mouth_l", hc, ha, [(S(-0.046), mz + S(0.01)), (S(0.0), mz - S(0.004)), (S(0.046), mz + S(0.01))], S(0.009), "ink", push=0.006)
        P += _stroke("f_mouth_l2", hc, ha, [(S(-0.04), mz - S(0.012)), (S(0.0), mz - S(0.018)), (S(0.04), mz - S(0.012))], S(0.009), "ink", push=0.006)
    elif mouth == "lips":
        P.append(_decal("f_mouth", hc, ha, 0.0, mz + S(0.004), S(0.04), S(0.018), "lip", push=0.004))
        P += _stroke("f_mouth_l", hc, ha, [(S(-0.022), mz + S(0.006)), (S(0.0), mz + S(0.001)), (S(0.022), mz + S(0.006))], S(0.006), "ink", push=0.006)
    elif mouth == "open_smile":
        P.append(_decal("f_mouth", hc, ha, 0.0, mz + S(0.004), S(0.05), S(0.03), "mouth_in", push=0.004))
        P.append(_decal("f_tongue", hc, ha, 0.0, mz - S(0.004), S(0.03), S(0.013), "tongue", push=0.006))
    elif mouth == "o":
        P.append(_decal("f_mouth", hc, ha, 0.0, mz, S(0.03), S(0.034), "mouth_in", push=0.004))
    # 其他
    if "blush" in extras:
        for sd in (-1, 1):
            P.append(_decal(f"f_blush{sd}", hc, ha, sd * S(0.1), S(-0.045), S(0.048), S(0.03), "blush", push=0.0035))
    if "scar" in extras:
        P += _stroke("f_scar", hc, ha, [(S(-0.12), S(0.04)), (S(-0.095), S(-0.01)), (S(-0.07), S(-0.06))], S(0.01), "scar", push=0.006)
    if "mustache" in extras:
        for sd in (-1, 1):
            P += _stroke(f"f_mus{sd}", hc, ha, [(sd * S(0.008), S(-0.066)), (sd * S(0.04), S(-0.07)), (sd * S(0.066), S(-0.095)), (sd * S(0.074), S(-0.12))],
                         S(0.02), "hair", push=0.007)
    if "eyepatch" in extras:
        P.append(_decal("f_patch", hc, ha, S(0.068), S(0.004), S(0.075), S(0.065), "ink", push=0.006))
        P += _stroke("f_strap", hc, ha, [(S(-0.17), S(0.09)), (S(0.0), S(0.06)), (S(0.068), S(0.03)), (S(0.17), S(0.0))], S(0.012), "ink", push=0.007)
    return P


def build_bandit(variant="swordsman", frames=8, action="walk"):
    """人形（土匪 / 当家 / 家人）：腿、躯干（腰带）、大头（五官、头巾 / 发髻 / 斗笠）、双臂、按角色持道具"""
    cloth = {"swordsman": "cloth_dark", "shield": "cloth_brown", "scout": "cloth_green", "arsonist": "cloth_brown",
             "chief": "cloth_black", "second_chief": "cloth_dark", "hero": "ochre", "wife": "azurite", "child": "child_green"}[variant]
    villager = variant in ("hero", "wife", "child")
    boss = variant in ("chief", "second_chief")
    s = 1.25 if boss else 0.68 if variant == "child" else 1.0
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
        if variant != "wife":  # 绑腿
            parts.append((_box(f"b_wrap{side}", (0.165 * s, 0.185 * s, 0.24 * s), (side * 0.1 * s, 0, 0.2 * s), "wrap"), bone))
        parts.append((_box(f"b_foot{side}", (0.15 * s, 0.24 * s, 0.08 * s), (side * 0.1 * s, -0.04 * s, 0.04 * s), "straw" if villager else "ink"), bone))
    if variant == "wife":  # 长裙
        parts.append((_cone("b_skirt", 0.3 * s, 0.22 * s, 0.62 * s, (0, 0, 0.62 * s), cloth, verts=14), "hips"))
    parts.append((_box("b_torso", (0.42 * s, 0.26 * s, 0.6 * s), (0, 0, 1.2 * s), cloth), "chest"))
    # 交领：里衣白领口斜着露出来（右衽）
    for sd in (-1, 1):  # 两片领子从肩颈斜下来在胸口交成 V（左片压右片）
        parts.append((_box(f"b_collar{sd}", (0.055 * s, 0.02 * s, 0.24 * s), (sd * 0.06 * s, -0.132 * s - (0.002 if sd > 0 else 0), 1.38 * s),
                           "undershirt", rot=(0, math.radians(sd * 30), 0)), "chest"))
    sash_c = "ink" if villager else "sash"
    parts.append((_box("b_sash", (0.44 * s, 0.28 * s, 0.08 * s), (0, 0, 1.0 * s), sash_c), "hips"))
    parts.append((_box("b_sash_tail", (0.06 * s, 0.03 * s, 0.2 * s), (0.13 * s, -0.145 * s, 0.88 * s), sash_c,
                       rot=(0, math.radians(-8), 0)), "hips"))
    # 大头：半径 0.19（原 0.14），五官才看得见
    hr = 0.19 * s
    hc, ha = (0, 0, 1.64 * s), (hr, hr * 0.96, hr * 1.04)
    parts.append((_ell("b_head", hr, hc, "skin", scale=(1, 0.96, 1.04), seg=20), "head"))
    for sd in (-1, 1):  # 耳朵
        parts.append((_ell(f"b_ear{sd}", 0.04 * s, (sd * hr * 0.98, 0.01 * s, 1.63 * s), "skin", scale=(0.45, 0.8, 1.25), seg=10), "head"))
    parts += [(o, "head") for o in _human_face(variant, hc, ha, s, action)]
    # 头发 / 头巾 / 帽子
    hair_cap = _ell("b_hair", hr * 1.03, (0, 0.035 * s, 1.69 * s), "hair", scale=(1, 0.95, 0.82), seg=18)
    parts.append((hair_cap, "head"))
    if not villager:
        # 红头巾：箍在眉毛上方（不盖住眉眼），脑后打结垂两条
        parts.append((_cone("b_band", 0.181 * s, 0.14 * s, 0.075 * s, (0, 0.006 * s, 1.768 * s), "sash", verts=20), "head"))
        parts.append((_box("b_band_knot", (0.05 * s, 0.05 * s, 0.05 * s), (0.05 * s, 0.17 * s, 1.765 * s), "sash"), "head"))
        parts.append((_box("b_band_tail", (0.045 * s, 0.02 * s, 0.17 * s), (0.07 * s, 0.19 * s, 1.67 * s), "sash", rot=(math.radians(12), 0, 0)), "head"))
    if variant == "hero":
        parts.append((_cone("b_hat", 0.38, 0.03, 0.2, (0, 0, 1.92), "hat", verts=18), "head"))
        parts.append((_cyl("b_hoe", 0.025, 1.2, (-0.3, -0.05, 1.05), "wood", rot=(math.radians(-12), 0, 0)), "arm_r"))
        parts.append((_box("b_hoe_blade", (0.05, 0.22, 0.14), (-0.3, -0.18, 0.47), "steel"), "arm_r"))
    if variant == "wife":
        parts.append((_box("b_apron", (0.3, 0.04, 0.5), (0, -0.15, 1.0), "apron"), "chest"))
        parts.append((_ell("b_bun", 0.085, (0, 0.13, 1.79), "hair"), "head"))
        parts.append((_cyl("b_pin", 0.008, 0.26, (0, 0.13, 1.82), "gold", rot=(0, math.radians(80), math.radians(20)), verts=6), "head"))
        parts.append((_ell("b_flower", 0.03, (0.09, 0.08, 1.8), "sash", seg=8), "head"))
    if variant == "child":  # 两个总角（小发髻）
        for sd in (-1, 1):
            parts.append((_ell(f"b_tuft{sd}", 0.05, (sd * 0.085, 0.01, 1.64 * s + 0.125), "hair"), "head"))
            parts.append((_cyl(f"b_tie{sd}", 0.03, 0.02, (sd * 0.085, 0.01, 1.64 * s + 0.085), "sash", verts=8), "head"))
    for side, bone in ((1, "arm_l"), (-1, "arm_r")):
        parts.append((_box(f"b_arm{side}", (0.11 * s, 0.13 * s, 0.48 * s), (side * 0.27 * s, 0, 1.15 * s), cloth), bone))
        parts.append((_box(f"b_cuff{side}", (0.12 * s, 0.14 * s, 0.06 * s), (side * 0.275 * s, 0, 0.95 * s), "undershirt" if villager else "wrap"), bone))
        parts.append((_ell(f"b_hand{side}", 0.06 * s, (side * 0.28 * s, 0, 0.88 * s), "skin"), bone))
    if variant in ("swordsman", "chief", "second_chief"):
        parts.append((_box("b_blade", (0.04, 0.06, 0.7 * s), (-0.3 * s, -0.12 * s, 1.15 * s), "steel", rot=(math.radians(-25), 0, 0)), "arm_r"))
        parts.append((_box("b_guard", (0.1, 0.05, 0.03), (-0.3 * s, -0.04 * s, 0.86 * s), "gold", rot=(math.radians(-25), 0, 0)), "arm_r"))
    if variant == "shield":
        parts.append((_box("b_shield", (0.08, 0.5, 0.65), (0.36, -0.12, 1.05), "shield"), "arm_l"))
        parts.append((_cyl("b_boss", 0.07, 0.03, (0.405, -0.12, 1.05), "steel", rot=(0, math.radians(90), 0), verts=12), "arm_l"))
    if variant == "arsonist":
        parts.append((_cyl("b_torch", 0.03, 0.5, (-0.3, -0.12, 1.1), "wood", rot=(math.radians(-20), 0, 0)), "arm_r"))
        parts.append((_ell("b_flame", 0.09, (-0.3, -0.21, 1.37), "flame", scale=(1, 1, 1.6)), "arm_r"))
    if variant == "chief":
        parts.append((_cyl("b_pole", 0.025, 1.5, (0.32 * s, 0.1, 1.5 * s), "wood"), "chest"))
        parts.append((_box("b_flag", (0.03, 0.5, 0.4), (0.32 * s, 0.37, 2.05 * s), "cloth_black"), "chest"))
        parts.append((_ell("b_beard", 0.1 * s, (0, -0.09 * s, 1.43 * s), "hair", scale=(1.1, 0.75, 1.15)), "head"))  # 下巴胡子，不挡嘴
    if variant == "second_chief":
        parts.append((_box("b_vest", (0.44 * s, 0.27 * s, 0.4 * s), (0, 0.002, 1.27 * s), "cloth_brown"), "chest"))
    if variant == "scout":
        parts.append((_cone("b_hat", 0.32, 0.02, 0.18, (0, 0, 1.9), "hat", verts=18), "head"))
    # 侧脸改“半侧脸”：头和头上所有东西绕竖轴朝镜头转 HEAD_TURN 度（身体不转）。
    # 镜头在 (+X, −Y) 方向，角色面朝 −Y，五官本来只露半边、远眼贴着轮廓线；转过来两只眼和嘴都看得见
    turn = Matrix.Translation(Vector(hc)) @ Matrix.Rotation(math.radians(HEAD_TURN), 4, "Z") @ Matrix.Translation(-Vector(hc))
    for o, b in parts:
        if b == "head":
            o.matrix_world = turn @ o.matrix_world
    for o, b in parts:
        _bind(arm, o, b)
    if action == "work":
        # 干活（只给家人）：当家的双手抡锄头刨地；阿莲 / 孩子弯腰插秧、两手交替往下点
        for f in range(frames + 1):
            ph = f / frames
            if variant == "hero":
                if ph < 0.5:
                    a = -120 * (ph / 0.5)                         # 慢慢举锄过肩
                    bend = 6 * (ph / 0.5)
                elif ph < 0.7:
                    k = (ph - 0.5) / 0.2
                    a = -120 + 165 * k                           # 猛地刨下去
                    bend = 6 - 34 * k
                else:
                    k = (ph - 0.7) / 0.3
                    a = 45 * (1 - k)                             # 拔锄回正
                    bend = -28 * (1 - k)
                _key(arm, "arm_r", f + 1, rot=(a, 0, 0))
                _key(arm, "arm_l", f + 1, rot=(a * 0.85, 0, -12))
                _key(arm, "chest", f + 1, rot=(bend, 0, 0))
                _key(arm, "leg_l", f + 1, rot=(-16, 0, 0))
                _key(arm, "leg_r", f + 1, rot=(14, 0, 0))
                _key(arm, "hips", f + 1, loc=(0, 0, -0.05 * max(0.0, -bend) / 28))
            else:
                t = ph * 2 * math.pi
                _key(arm, "chest", f + 1, rot=(-38 + 5 * math.sin(t), 0, 0))
                _key(arm, "head", f + 1, rot=(18, 0, 0))
                _key(arm, "arm_l", f + 1, rot=(35 + 50 * max(0.0, math.sin(t)), 0, 8))
                _key(arm, "arm_r", f + 1, rot=(35 + 50 * max(0.0, -math.sin(t)), 0, -8))
                _key(arm, "leg_l", f + 1, rot=(-10, 0, 0))
                _key(arm, "leg_r", f + 1, rot=(10, 0, 0))
                _key(arm, "hips", f + 1, loc=(0, 0.04, -0.06))
        _cyclic(arm)
        return arm, [o for o, _ in parts], frames
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
    "second_chief": lambda frames=8, action="walk": build_bandit("second_chief", frames, action),
    "chief": lambda frames=8, action="walk": build_bandit("chief", frames, action),
    # 家人（白天在村里干活走动，当家的夜里守主屋）
    "hero": lambda frames=8, action="walk": build_bandit("hero", frames, action),
    "wife": lambda frames=8, action="walk": build_bandit("wife", frames, action),
    "child": lambda frames=8, action="walk": build_bandit("child", frames, action),
}


def build(name, frames=8, action="walk"):
    """action: walk（行走循环）| attack（攻击循环）| work（干活，只给家人）"""
    _mats.clear()
    return BUILDERS[name](frames, action)
