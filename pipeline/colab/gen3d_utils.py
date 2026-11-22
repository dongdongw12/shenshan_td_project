"""
《深山传家》图生 3D 后处理小工具（纯 Python，无第三方依赖，Colab 与本机均可 import / 测试）。

核心功能：根据模型的水平投影（脚印）求最小面积外接矩形，算出把建筑墙面对齐世界坐标轴所需的偏航角，
让 Blender 等距相机看到的是标准 2:1 菱形占地，而不是斜着的房子。

坐标约定：Hunyuan3D 输出 glTF（Y 轴向上，概念图视角朝 +Z），因此脚印平面为 (x, z)。
返回的 yaw 角为绕 +Y 轴的右手旋转角（与 trimesh.transformations.rotation_matrix(rad, [0, 1, 0]) 一致）。
"""

import math


def convex_hull(points):
    """Andrew 单调链凸包，points 为 [(x, y), ...]，返回逆时针顶点列表。"""
    pts = sorted(set((float(x), float(y)) for x, y in points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def _rect_area_at(hull, theta):
    c, s = math.cos(theta), math.sin(theta)
    us = [x * c + y * s for x, y in hull]
    vs = [-x * s + y * c for x, y in hull]
    return (max(us) - min(us)) * (max(vs) - min(vs))


def _normalize_quarter(theta):
    """把角度折叠到 (-pi/4, pi/4]，矩形每 90° 对称，取最小旋转量。"""
    q = math.pi / 2
    theta = math.fmod(theta, q)
    if theta > q / 2:
        theta -= q
    elif theta <= -q / 2:
        theta += q
    return theta


def min_area_rect(points):
    """旋转卡壳求最小面积外接矩形。返回 (theta, area, worst_area)：
    theta 为矩形一条边相对 +x 轴的角度（弧度，已折叠到 (-45°, 45°]），
    worst_area 为所有候选方向中最大的外接矩形面积（用于判断朝向是否可信）。"""
    hull = convex_hull(points)
    if len(hull) < 3:
        return 0.0, 0.0, 0.0
    best_theta, best_area, worst_area = 0.0, float("inf"), 0.0
    n = len(hull)
    for i in range(n):
        x0, y0 = hull[i]
        x1, y1 = hull[(i + 1) % n]
        if x0 == x1 and y0 == y1:
            continue
        theta = math.atan2(y1 - y0, x1 - x0)
        area = _rect_area_at(hull, theta)
        if area < best_area:
            best_theta, best_area = theta, area
        worst_area = max(worst_area, area)
    # 再在 45° 方向上补测一次，避免凸包边太少时低估 worst_area
    worst_area = max(worst_area, _rect_area_at(hull, best_theta + math.pi / 4))
    return _normalize_quarter(best_theta), best_area, worst_area


def yaw_align_deg(vertices_xyz, min_gain=0.04):
    """计算把建筑墙面对齐到 X/Z 轴所需的绕 +Y 偏航角（度）。

    vertices_xyz: [(x, y, z), ...]，glTF Y-up 坐标。
    min_gain: 最佳方向比最差方向至少省出多少比例的外接矩形面积才视为“有明确朝向”；
              圆形/近似圆形的脚印（树、灯笼）返回 0 并标记 reliable=False。
    返回 dict: {yaw_deg, reliable, gain}
    """
    footprint = [(v[0], v[2]) for v in vertices_xyz]
    theta, best, worst = min_area_rect(footprint)
    if worst <= 0:
        return {"yaw_deg": 0.0, "reliable": False, "gain": 0.0}
    gain = 1.0 - best / worst
    reliable = gain >= min_gain
    # 在 (x, z) 平面里把边角度 theta 转回 0，等价于绕 +Y 轴右手旋转 theta：
    #   x' = x cos(t) + z sin(t),  z' = -x sin(t) + z cos(t)
    yaw = math.degrees(theta) if reliable else 0.0
    return {"yaw_deg": round(yaw, 3), "reliable": reliable, "gain": round(gain, 4)}


def rotate_y(vertices_xyz, yaw_deg):
    """绕 +Y 轴右手旋转（纯 Python，供测试；Colab 中用 trimesh.apply_transform）。"""
    t = math.radians(yaw_deg)
    c, s = math.cos(t), math.sin(t)
    return [(x * c + z * s, y, -x * s + z * c) for x, y, z in vertices_xyz]


def subsample(vertices, max_points=20000):
    """顶点过多时等间隔抽样，保证纯 Python 凸包秒出。"""
    n = len(vertices)
    if n <= max_points:
        return list(vertices)
    step = n / float(max_points)
    return [vertices[int(i * step)] for i in range(max_points)]
