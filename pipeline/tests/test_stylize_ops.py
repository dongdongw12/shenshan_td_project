"""风格化算子单测。需要 numpy：用 Blender 自带 Python 运行最省事：
  /Applications/Blender.app/Contents/Resources/5.3/python/bin/python3.13 -m unittest discover -s pipeline/tests -v
（没有 numpy 的环境会自动跳过本文件。）"""

import sys
import unittest
from pathlib import Path

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "style"))


@unittest.skipIf(np is None, "numpy 不可用")
class StylizeOpsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import stylize_sprites as s
        cls.s = s

    def test_box_blur_matches_naive(self):
        rng = np.random.default_rng(0)
        img = rng.random((20, 23)).astype(np.float32)
        r = 2
        p = np.pad(img, r, mode="edge")
        naive = np.zeros_like(img)
        for y in range(img.shape[0]):
            for x in range(img.shape[1]):
                naive[y, x] = p[y:y + 2 * r + 1, x:x + 2 * r + 1].mean()
        np.testing.assert_allclose(self.s.box_blur(img, r), naive, atol=1e-5)

    def test_kuwahara_keeps_step_edge_and_flattens_noise(self):
        rng = np.random.default_rng(1)
        img = np.zeros((40, 40, 3), np.float32)
        img[:, 20:] = 1.0
        noisy = np.clip(img + rng.normal(0, 0.05, img.shape).astype(np.float32), 0, 1)
        out = self.s.kuwahara(noisy, 3)
        self.assertLess(out[:, :17].std(), noisy[:, :17].std() * 0.6)   # 平涂
        self.assertLess(out[:, :18].mean(), 0.1)                        # 边缘不被抹糊
        self.assertGreater(out[:, 22:].mean(), 0.9)

    def test_soft_posterize_levels(self):
        x = np.linspace(0, 1, 1001, dtype=np.float32)
        y = self.s.soft_posterize(x, 3, 0.0)
        self.assertEqual(sorted(set(np.round(y.astype(np.float64), 4).tolist())), [0.0, 0.3333, 0.6667, 1.0])
        self.assertTrue(np.all(np.diff(self.s.soft_posterize(x, 3, 0.2)) >= -1e-6))  # 单调

    def test_lab_roundtrip(self):
        rng = np.random.default_rng(2)
        rgb = rng.random((16, 16, 3)).astype(np.float32)
        back = self.s.lab_to_linear(self.s.linear_to_lab(rgb))
        np.testing.assert_allclose(back, rgb, atol=2e-3)

    def test_srgb_roundtrip(self):
        x = np.linspace(0, 1, 101, dtype=np.float32)
        np.testing.assert_allclose(self.s.linear_to_srgb(self.s.srgb_to_linear(x)), x, atol=1e-5)

    def test_group_channels_blender5_multipart_names(self):
        h = np.zeros((2, 2), np.float32)
        named = {"ViewLayer.Diffuse Color.R": h, "ViewLayer.Diffuse Color.G": h + 1,
                 "ViewLayer.Diffuse Color.B": h + 2, "ViewLayer.Object Index.X": h + 5,
                 "ViewLayer.Combined.A": h + 9, "ViewLayer.Combined.R": h + 6,
                 "ViewLayer.Combined.G": h + 7, "ViewLayer.Combined.B": h + 8}
        g = self.s._group_channels(named)
        self.assertEqual(g["Diffuse Color"].shape, (2, 2, 3))
        self.assertEqual(g["Diffuse Color"][0, 0].tolist(), [0, 1, 2])
        self.assertEqual(g["Combined"][0, 0].tolist(), [6, 7, 8, 9])  # RGBA 顺序
        self.assertEqual(g["Object Index"].shape, (2, 2, 1))

    def test_bleed_fill_removes_black_fringe(self):
        img = np.zeros((30, 30, 3), np.float32)
        mask = np.zeros((30, 30), np.float32)
        img[10:20, 10:20] = [0.8, 0.2, 0.1]
        mask[10:20, 10:20] = 1
        filled = self.s.bleed_fill(img, mask)
        np.testing.assert_allclose(filled[5, 15], [0.8, 0.2, 0.1], atol=1e-4)
        np.testing.assert_allclose(filled[15, 15], [0.8, 0.2, 0.1], atol=1e-6)


if __name__ == "__main__":
    unittest.main()
