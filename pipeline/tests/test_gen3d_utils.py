"""运行：python3 -m unittest discover -s pipeline/tests -v（纯标准库，无需 numpy）"""

import math
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "colab"))
import gen3d_utils as g  # noqa: E402


def box_vertices(w, d, h, yaw_deg=0.0, jitter=0.0, seed=0):
    """生成一个 w×d×h 的“房子”点云（含表面随机点），再绕 +Y 旋转 yaw_deg。"""
    rnd = random.Random(seed)
    pts = []
    for _ in range(3000):
        x = rnd.uniform(-w / 2, w / 2)
        z = rnd.uniform(-d / 2, d / 2)
        y = rnd.uniform(0, h)
        # 投到四面墙之一，模拟只有表面顶点的网格
        side = rnd.randrange(4)
        if side == 0:
            x = -w / 2
        elif side == 1:
            x = w / 2
        elif side == 2:
            z = -d / 2
        else:
            z = d / 2
        pts.append((x + rnd.uniform(-jitter, jitter), y, z + rnd.uniform(-jitter, jitter)))
    return g.rotate_y(pts, yaw_deg)


def footprint_extent(verts):
    xs = [v[0] for v in verts]
    zs = [v[2] for v in verts]
    return max(xs) - min(xs), max(zs) - min(zs)


class YawAlignTest(unittest.TestCase):
    def assert_aligned(self, w, d, yaw):
        verts = box_vertices(w, d, 4.0, yaw_deg=yaw, jitter=0.01)
        res = g.yaw_align_deg(verts)
        self.assertTrue(res["reliable"], res)
        fixed = g.rotate_y(verts, res["yaw_deg"])
        ex, ez = footprint_extent(fixed)
        # 对齐后外接矩形应接近原始 w×d（或 d×w，矩形 90° 对称）
        self.assertAlmostEqual(ex * ez, w * d, delta=w * d * 0.03, msg=(yaw, res, ex, ez))
        self.assertLessEqual(abs(res["yaw_deg"]), 45.0 + 1e-6)

    def test_rotated_rectangles_realign(self):
        for yaw in (-40, -25, -10, 0, 12, 25, 33, 44):
            with self.subTest(yaw=yaw):
                self.assert_aligned(6.0, 4.0, yaw)

    def test_square_tower(self):
        for yaw in (-30, 18, 41):
            with self.subTest(yaw=yaw):
                self.assert_aligned(2.0, 2.0, yaw)

    def test_minimal_rotation_keeps_front(self):
        # 概念图约 25° 三分之四视角 → 生成的房子偏 ~25°，应该只转回 ~25°，而不是转 65° 把侧面变正面
        verts = box_vertices(6.0, 4.0, 4.0, yaw_deg=25.0)
        res = g.yaw_align_deg(verts)
        self.assertAlmostEqual(abs(res["yaw_deg"]), 25.0, delta=1.0)
        fixed = g.rotate_y(verts, res["yaw_deg"])
        ex, ez = footprint_extent(fixed)
        self.assertGreater(ex, ez)  # 6m 正面仍沿 X 轴

    def test_round_footprint_is_unreliable(self):
        pts = []
        for i in range(720):
            t = math.radians(i * 0.5)
            pts.append((2.0 * math.cos(t), (i % 50) / 10.0, 2.0 * math.sin(t)))
        res = g.yaw_align_deg(pts)
        self.assertFalse(res["reliable"], res)
        self.assertEqual(res["yaw_deg"], 0.0)

    def test_subsample(self):
        verts = [(i, 0, 0) for i in range(100000)]
        self.assertEqual(len(g.subsample(verts, 20000)), 20000)
        self.assertEqual(len(g.subsample(verts[:10], 20000)), 10)


if __name__ == "__main__":
    unittest.main()
