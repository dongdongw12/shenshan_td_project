"""t2i_concepts.safetensors_ok：截断 / 损坏的权重文件要能识别出来（云盘缓存中途断线会留下这种文件）。"""
import json
import os
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "colab"))
import t2i_concepts as t  # noqa: E402


def write_st(path, data_len=32, truncate=0, header_override=None):
    header = header_override if header_override is not None else json.dumps(
        {"w": {"dtype": "F32", "shape": [8], "data_offsets": [0, data_len]}, "__metadata__": {}}).encode()
    with open(path, "wb") as f:
        f.write(struct.pack("<Q", len(header)))
        f.write(header)
        f.write(b"\0" * (data_len - truncate))


class SafetensorsOk(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.p = os.path.join(self.dir, "m.safetensors")

    def test_complete_file(self):
        write_st(self.p)
        self.assertTrue(t.safetensors_ok(self.p))

    def test_truncated_data(self):
        write_st(self.p, truncate=5)
        self.assertFalse(t.safetensors_ok(self.p))

    def test_garbage_header_length(self):
        with open(self.p, "wb") as f:
            f.write(struct.pack("<Q", 10**12) + b"x" * 64)
        self.assertFalse(t.safetensors_ok(self.p))

    def test_non_json_header(self):
        write_st(self.p, header_override=b"<html>not a model</html>")
        self.assertFalse(t.safetensors_ok(self.p))

    def test_tiny_file(self):
        with open(self.p, "wb") as f:
            f.write(b"abc")
        self.assertFalse(t.safetensors_ok(self.p))


if __name__ == "__main__":
    unittest.main()
