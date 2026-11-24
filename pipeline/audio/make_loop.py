"""
把一首完整的曲子（如 Suno 生成的 2–3 分钟器乐）剪成游戏里能无缝循环的背景音乐。

做法：
1. ffmpeg 解成单声道 44.1kHz；跳过开头 --skip 秒（前奏）和结尾 --tail 秒（收尾渐弱）
2. 在 [起点 + min, 起点 + max] 秒里找一个“听起来和起点最像”的结尾点：比两处的频谱（对数幅度，余弦相似度），
   再在 ±25ms 里按波形相关微调对齐
3. 结尾后面多取 --xfade 秒，和开头交叉淡化：循环到结尾时自然接回开头
4. 响度对齐（RMS 到 --rms dBFS，峰值不超过 -1dB），输出单声道 mp3

用法：
  $PY -I pipeline/audio/make_loop.py in.mp3 client/assets/audio/bgm_day.mp3 --min 55 --max 90
"""

import argparse
import os
import subprocess
import tempfile

import numpy as np

SR = 44100


def decode(path):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def frames(x, at, n=4, size=4096):
    """at 秒附近 n 帧的对数幅度谱（拼成一个向量）"""
    i = int(at * SR)
    w = np.hanning(size)
    out = []
    for k in range(n):
        seg = x[i + k * size // 2: i + k * size // 2 + size]
        if len(seg) < size:
            seg = np.pad(seg, (0, size - len(seg)))
        out.append(np.log1p(np.abs(np.fft.rfft(seg * w))[:600]))
    v = np.concatenate(out)
    return v / (np.linalg.norm(v) + 1e-9)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--skip", type=float, default=4.0, help="跳过开头几秒")
    ap.add_argument("--tail", type=float, default=10.0, help="不要最后几秒（收尾）")
    ap.add_argument("--min", type=float, default=55.0)
    ap.add_argument("--max", type=float, default=95.0)
    ap.add_argument("--xfade", type=float, default=2.5)
    ap.add_argument("--rms", type=float, default=-20.0, help="目标 RMS（dBFS）")
    ap.add_argument("--kbps", type=int, default=96)
    a = ap.parse_args()

    x = decode(a.src)
    dur = len(x) / SR
    start = a.skip
    last = dur - a.tail - a.xfade
    hi = min(start + a.max, last)
    lo = min(start + a.min, hi)
    ref = frames(x, start)
    best, best_t = -1.0, hi
    for t in np.arange(lo, hi, 0.05):
        s = float(np.dot(ref, frames(x, t)))
        if s > best:
            best, best_t = s, t
    # 波形微调：结尾点附近 ±25ms 找和起点波形最相关的位置
    i0, i1 = int(start * SR), int(best_t * SR)
    win = int(0.05 * SR)
    a0 = x[i0:i0 + win]
    shifts = range(-int(0.025 * SR), int(0.025 * SR))
    corr = [float(np.dot(a0, x[i1 + d:i1 + d + win])) for d in shifts]
    i1 += list(shifts)[int(np.argmax(corr))]
    L = i1 - i0
    xf = int(a.xfade * SR)
    seg = x[i0:i0 + L + xf].copy()
    loop = seg[:L].copy()
    fin = np.sin(np.linspace(0, np.pi / 2, xf)) ** 2
    loop[:xf] = seg[:xf] * fin + seg[L:L + xf] * (1 - fin)
    rms = np.sqrt(np.mean(loop ** 2)) + 1e-9
    loop *= 10 ** (a.rms / 20) / rms
    peak = np.max(np.abs(loop))
    if peak > 0.89:
        loop *= 0.89 / peak
    with tempfile.TemporaryDirectory() as d:
        raw = os.path.join(d, "a.f32")
        loop.astype("<f4").tofile(raw)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", raw,
                        "-codec:a", "libmp3lame", "-b:a", f"{a.kbps}k", a.dst], check=True)
    print(f"{a.src}: 原长 {dur:.1f}s → 循环 {start:.1f}s–{start + L / SR:.1f}s（{L / SR:.1f}s，相似度 {best:.3f}），交叉淡化 {a.xfade}s → {a.dst}")


if __name__ == "__main__":
    main()
