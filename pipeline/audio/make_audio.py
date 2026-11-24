"""
程序化合成《深山传家》全部音乐和音效（不依赖任何外部采样，没有版权问题），输出 mp3 到 client/assets/audio/。

乐器（numpy 加法合成）：
- 古筝 zheng：12 个泛音、高次泛音衰减快、轻微非谐（琴弦刚度），拨弦噪声起音，支持“按音”滑音和揉弦
- 竹笛 dizi：基音 + 2、3 次泛音，慢起音、延迟揉音，带气息噪声
- 大鼓 drum：音高从 120Hz 往下掉的正弦 + 低通噪声“咚”；小鼓 / 鼓边“咔”
- 锣 gong：一组不协和泛音、长衰减、起音后音高微升
- 木鱼 / 梆子 wood、碰铃 bell
- 混响：指数衰减噪声做冲激响应，FFT 卷积

音乐用五声音阶：白天 D 宫（D E F# A B），慢、舒展；夜里 B 羽（B D E F# A），鼓点紧、低音持续。
用法（Blender 自带 Python 即可，只要 numpy；mp3 用 ffmpeg 转）：
  $PY -I pipeline/audio/make_audio.py --out client/assets/audio          # 只出音效
  $PY -I pipeline/audio/make_audio.py --out client/assets/audio --music  # 另出合成版背景音乐 bgm_*_synth.mp3
正式背景音乐是 Suno 生成后用 make_loop.py 剪的循环（bgm_day.mp3 / bgm_night.mp3），原曲在云盘 shenshan_td/audio_sources/。
"""

import argparse
import os
import struct
import subprocess
import tempfile
from pathlib import Path

import numpy as np

SR = 44100
RNG = np.random.default_rng(20261124)


def note(name):
    """'D4' / 'F#5' → 频率"""
    names = {"C": -9, "C#": -8, "D": -7, "D#": -6, "E": -5, "F": -4, "F#": -3, "G": -2, "G#": -1, "A": 0, "A#": 1, "B": 2}
    n, o = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((names[n] + (o - 4) * 12) / 12)


def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def onepole_lp(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    # 一阶低通：分块向量化太麻烦，长度一般不大，直接循环（噪声段只有几千个样本）
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def fft_lp(x, cutoff, order=2):
    """频域低通（长信号用）"""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + (f / cutoff) ** (2 * order))
    return np.fft.irfft(X, len(x))


def fft_bp(x, lo, hi):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + (f / hi) ** 4) * (1 / np.sqrt(1 + (lo / np.maximum(f, 1)) ** 4))
    return np.fft.irfft(X, len(x))


# ---------------------------------------------------------------- 乐器

def zheng(f0, dur=2.5, vel=0.8, bend=None, vibrato=0.0, bright=1.0):
    """古筝。bend：(起始音分, 结束音分, 用时秒) 的按音；vibrato：揉弦幅度（音分）"""
    t = t_axis(dur)
    cents = np.zeros_like(t)
    if bend:
        c0, c1, bt = bend
        k = np.clip(t / max(bt, 1e-3), 0, 1)
        cents += c0 + (c1 - c0) * (1 - (1 - k) ** 2)
    if vibrato:
        cents += vibrato * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - 0.25) / 0.4, 0, 1)
    f = f0 * 2 ** (cents / 1200)
    phase = 2 * np.pi * np.cumsum(f) / SR
    out = np.zeros_like(t)
    for k in range(1, 13):
        inh = np.sqrt(1 + 0.00015 * k * k)
        amp = (1 / k ** 1.05) * abs(np.sin(np.pi * k * 0.18)) * (bright ** (k - 1) if bright < 1 else 1)
        dec = np.exp(-t * (0.55 + 0.32 * k ** 1.35))
        if f0 * k * inh > 9000:
            break
        out += amp * dec * np.sin(phase * k * inh + RNG.uniform(0, 6.28))
    # 拨弦：一小段低通噪声
    n = int(0.018 * SR)
    pick = RNG.normal(0, 1, n) * np.exp(-np.arange(n) / (0.004 * SR))
    pick = onepole_lp(pick, 3500)
    out[:n] += pick * 0.35
    att = np.clip(t / 0.004, 0, 1)
    return out * att * vel * 0.35


def dizi(f0, dur=1.5, vel=0.7, slide=None):
    """竹笛。slide：(起始音分, 用时秒) 从下往上滑到本音"""
    t = t_axis(dur)
    cents = 18 * np.sin(2 * np.pi * 5.6 * t) * np.clip((t - 0.3) / 0.5, 0, 1)
    if slide:
        c0, st = slide
        cents += c0 * np.clip(1 - t / st, 0, 1) ** 2
    f = f0 * 2 ** (cents / 1200)
    ph = 2 * np.pi * np.cumsum(f) / SR
    env = np.clip(t / 0.08, 0, 1) * np.clip((dur - t) / 0.18, 0, 1)
    env *= 1 + 0.08 * np.sin(2 * np.pi * 2.1 * t)  # 气息起伏
    tone = np.sin(ph) + 0.32 * np.sin(2 * ph + 0.4) + 0.12 * np.sin(3 * ph + 1.1) + 0.05 * np.sin(4 * ph)
    breath = fft_bp(RNG.normal(0, 1, len(t)), f0 * 0.8, f0 * 3.5) * 0.12
    return (tone * 0.5 + breath) * env * vel * 0.3


def drum(dur=0.9, vel=1.0, f_hi=120, f_lo=52):
    t = t_axis(dur)
    f = f_lo + (f_hi - f_lo) * np.exp(-t / 0.05)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.32)
    thump = fft_lp(RNG.normal(0, 1, len(t)), 400) * np.exp(-t / 0.05) * 0.8
    return (body + thump) * vel * 0.9


def rim(vel=0.6):
    t = t_axis(0.12)
    x = fft_bp(RNG.normal(0, 1, len(t)), 1500, 5000) * np.exp(-t / 0.012)
    x += np.sin(2 * np.pi * 820 * t) * np.exp(-t / 0.03) * 0.5
    return x * vel * 0.6


def gong(dur=5.0, vel=1.0, f0=110):
    t = t_axis(dur)
    out = np.zeros_like(t)
    for r, a, d in [(1, 1.0, 3.5), (1.47, 0.7, 2.6), (2.09, 0.55, 2.0), (2.76, 0.4, 1.5), (3.38, 0.3, 1.1), (4.13, 0.22, 0.8), (5.4, 0.15, 0.5)]:
        f = f0 * r * (1 + 0.012 * (1 - np.exp(-t / 0.6)))  # 锣声起音后音高略升
        out += a * np.sin(2 * np.pi * np.cumsum(f) / SR + RNG.uniform(0, 6)) * np.exp(-t / d)
    hit = fft_lp(RNG.normal(0, 1, len(t)), 2500) * np.exp(-t / 0.03) * 0.6
    swell = np.clip(t / 0.02, 0, 1)
    return (out * swell + hit) * vel * 0.32


def wood(f0=780, vel=0.6, dur=0.18):
    t = t_axis(dur)
    x = np.sin(2 * np.pi * f0 * t) * np.exp(-t / 0.035) + 0.4 * np.sin(2 * np.pi * f0 * 2.57 * t) * np.exp(-t / 0.015)
    x += fft_bp(RNG.normal(0, 1, len(t)), 800, 4000) * np.exp(-t / 0.004) * 0.6
    return x * vel * 0.5


def bell(f0=1760, vel=0.5, dur=1.4):
    t = t_axis(dur)
    x = np.zeros_like(t)
    for r, a, d in [(1, 1, 0.9), (2.76, 0.45, 0.35), (5.4, 0.25, 0.15), (8.9, 0.1, 0.06)]:
        x += a * np.sin(2 * np.pi * f0 * r * t) * np.exp(-t / d)
    return x * vel * 0.25


def noise_burst(dur, lo, hi, decay, vel):
    t = t_axis(dur)
    return fft_bp(RNG.normal(0, 1, len(t)), lo, hi) * np.exp(-t / decay) * vel


# ---------------------------------------------------------------- 混音工具

class Track:
    def __init__(self, dur):
        self.buf = np.zeros(int(dur * SR) + SR * 6)
        self.dur = dur

    def add(self, at, x, gain=1.0):
        i = int(at * SR)
        if i >= len(self.buf):
            return
        n = min(len(x), len(self.buf) - i)
        self.buf[i:i + n] += x[:n] * gain

    def render(self, reverb=0.25, rt=1.6, loop=False, tail=0.0):
        x = self.buf
        if reverb > 0:
            n = int(rt * SR)
            ir = RNG.normal(0, 1, n) * np.exp(-np.arange(n) / (rt * SR / 6.9))
            ir = fft_lp(ir, 4500)
            ir /= np.sqrt(np.sum(ir ** 2)) * 6
            size = 1 << int(np.ceil(np.log2(len(x) + n)))
            wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:len(x)]
            x = x + wet * reverb * 6
        L = int((self.dur + tail) * SR)
        if loop:
            # 循环曲：把超出结尾的尾音（含混响）叠回开头，接缝处就没有断层
            body = x[:int(self.dur * SR)].copy()
            over = x[int(self.dur * SR):]
            body[:len(over)] += over[:len(body)]
            x = body
        else:
            x = x[:L]
        peak = np.max(np.abs(x)) + 1e-9
        return x / peak * 0.89


def write_wav(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, SR, SR * 2, 2, 16))
        f.write(b"data" + struct.pack("<I", len(pcm)) + pcm)


def to_mp3(x, out, kbps):
    with tempfile.TemporaryDirectory() as d:
        w = os.path.join(d, "a.wav")
        write_wav(w, x)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", w, "-codec:a", "libmp3lame", "-b:a", f"{kbps}k", "-ac", "1", str(out)], check=True)


# ---------------------------------------------------------------- 音乐

D_PENTA = ["D3", "E3", "F#3", "A3", "B3", "D4", "E4", "F#4", "A4", "B4", "D5", "E5", "F#5", "A5", "B5", "D6"]


def day_music():
    """白天：D 宫，60 拍 / 分，16 小节 64 秒。古筝分解和弦铺底，竹笛两段长句，段尾古筝刮奏。"""
    bpm = 60
    beat = 60 / bpm
    bars = 16
    tr = Track(bars * 4 * beat)
    # 每小节的低音根音和分解音型（五声音阶里取 1-5-8-10 的骨架）
    roots = ["D3", "B2", "E3", "A2", "D3", "B2", "A2", "D3", "D3", "E3", "B2", "A2", "D3", "B2", "E3", "A2"]
    shapes = {
        "D3": ["D3", "A3", "D4", "F#4", "A4", "F#4", "D4", "A3"],
        "B2": ["B2", "F#3", "B3", "D4", "F#4", "D4", "B3", "F#3"],
        "E3": ["E3", "B3", "E4", "F#4", "B4", "F#4", "E4", "B3"],
        "A2": ["A2", "E3", "A3", "B3", "E4", "B3", "A3", "E3"],
    }
    for b, r in enumerate(roots):
        t0 = b * 4 * beat
        tr.add(t0, zheng(note(r) / 1, 4.5, 0.75, vibrato=6), 0.9)
        for k, nm in enumerate(shapes[r]):
            if b in (7, 15) and k >= 4:
                break  # 段尾留空给刮奏
            v = 0.42 + 0.12 * (k % 4 == 0) + RNG.uniform(-0.05, 0.05)
            tr.add(t0 + k * beat / 2 + RNG.uniform(0, 0.012), zheng(note(nm), 2.2, v, bright=0.92), 0.55)
    # 刮奏：第 8、16 小节后半，从高到低扫一串五声音
    for b in (7, 15):
        t0 = b * 4 * beat + 2 * beat
        for k, nm in enumerate(reversed(D_PENTA[4:])):
            tr.add(t0 + k * 0.06, zheng(note(nm), 1.8, 0.32 + 0.02 * k), 0.5)
        tr.add(t0 + 12 * 0.06 + 0.1, zheng(note("D4"), 3.0, 0.6, bend=(0, 200, 0.5), vibrato=10), 0.6)
    # 竹笛旋律：(小节, 拍, 时值拍, 音, 滑音)
    melody = [
        (2, 0, 3, "A4", (-150, 0.25)), (2, 3, 1, "B4", None), (3, 0, 2, "D5", None), (3, 2, 2, "B4", None),
        (4, 0, 1.5, "A4", None), (4, 1.5, 0.5, "F#4", None), (4, 2, 2, "E4", None), (5, 0, 4, "D4", (-120, 0.3)),
        (9, 0, 2, "F#4", (-150, 0.2)), (9, 2, 2, "A4", None), (10, 0, 3, "B4", None), (10, 3, 1, "A4", None),
        (11, 0, 2, "D5", (-100, 0.2)), (11, 2, 1, "E5", None), (11, 3, 1, "D5", None), (12, 0, 2, "B4", None), (12, 2, 2, "A4", None),
        (13, 0, 1.5, "F#4", None), (13, 1.5, 0.5, "E4", None), (13, 2, 2, "D4", None), (14, 0, 4, "E4", (-150, 0.3)),
    ]
    for bar, bt, ln, nm, sl in melody:
        tr.add((bar * 4 + bt) * beat, dizi(note(nm), ln * beat + 0.15, 0.75, slide=sl), 0.8)
    # 远处偶尔一声木鱼（山寺），很轻
    for b in (1, 6, 9, 14):
        tr.add(b * 4 * beat + 3.5 * beat, wood(520, 0.35), 0.25)
    return tr.render(reverb=0.32, rt=2.4, loop=True)


def night_music():
    """夜里：B 羽，96 拍 / 分，24 小节 60 秒。大鼓定拍、古筝低音持续扫弦、高音零星的紧张拨音，第 1、13 小节一声锣。"""
    bpm = 96
    beat = 60 / bpm
    bars = 24
    tr = Track(bars * 4 * beat)
    for b in range(bars):
        t0 = b * 4 * beat
        strong = 1.0 if b % 4 == 0 else 0.8
        # 鼓：1、3 拍大鼓，2.5 / 4.5 鼓边，每 4 小节最后一拍加花
        tr.add(t0, drum(0.9, strong), 0.9)
        tr.add(t0 + 2 * beat, drum(0.8, 0.7), 0.8)
        tr.add(t0 + 1.5 * beat, rim(0.5), 0.5)
        tr.add(t0 + 3.5 * beat, rim(0.45), 0.5)
        if b % 4 == 3:
            for k in range(4):
                tr.add(t0 + (3 + k * 0.25) * beat, drum(0.4, 0.45 + 0.1 * k, 150, 70), 0.6)
        # 低音古筝：B2 / F#2 八分音持续（像紧张的心跳）
        low = ["B2", "B2", "F#2", "B2"] if b % 8 < 4 else ["E2", "E2", "B2", "E2"]
        for k in range(8):
            nm = low[k // 2]
            tr.add(t0 + k * beat / 2, zheng(note(nm), 0.6, 0.55 if k % 2 == 0 else 0.35, bright=0.85), 0.55)
    # 高音拨弦：零星的下行动机（B5-A5-F#5 … E5 按音下滑）
    motif = [("B5", 0), ("A5", 0.5), ("F#5", 1.0), ("E5", 2.0)]
    for b in (2, 3, 6, 10, 11, 14, 18, 19, 22):
        t0 = b * 4 * beat
        for nm, bt in motif:
            bend = (0, -100, 0.6) if nm == "E5" else None
            tr.add(t0 + bt * beat, zheng(note(nm), 1.6, 0.5, bend=bend, vibrato=8), 0.5)
    # 竹笛低音长音（不安的号角感），只在后半
    for b, nm in ((12, "B3"), (16, "A3"), (20, "F#3")):
        tr.add(b * 4 * beat, dizi(note(nm), 4 * beat * 1.8, 0.6, slide=(-200, 0.6)), 0.6)
    for b in (0, 12):
        tr.add(b * 4 * beat, gong(5.5, 0.8, 98), 0.7)
    return tr.render(reverb=0.22, rt=1.8, loop=True)


# ---------------------------------------------------------------- 音效

def sfx():
    s = {}
    tr = Track(0.25); tr.add(0, wood(980, 0.6, 0.15)); s["ui_tap"] = tr.render(0.05, 0.4)
    tr = Track(0.7)
    tr.add(0, wood(620, 0.9)); tr.add(0.13, wood(560, 0.8)); tr.add(0.02, drum(0.4, 0.5, 140, 80), 0.5)
    tr.add(0.0, noise_burst(0.3, 200, 1500, 0.05, 0.4)); s["build"] = tr.render(0.12, 0.8)
    tr = Track(1.6)
    for k, nm in enumerate(["D5", "F#5", "A5"]):
        tr.add(k * 0.09, zheng(note(nm), 1.3, 0.7))
    tr.add(0.27, bell(note("D6") * 1.0, 0.6)); s["upgrade"] = tr.render(0.2, 1.2)
    tr = Track(0.35)
    t = t_axis(0.22)
    sweep = fft_bp(RNG.normal(0, 1, len(t)), 900, 6000) * np.sin(np.pi * np.clip(t / 0.22, 0, 1)) ** 2 * 0.7
    tr.add(0, sweep); tr.add(0, zheng(note("A2"), 0.25, 0.5, bright=0.7), 0.6); s["shot"] = tr.render(0.04, 0.3)
    tr = Track(0.6)
    tr.add(0, sweep * 0.8)
    crack = np.zeros(int(0.5 * SR))
    for k in range(10):
        i = int(RNG.uniform(0.02, 0.45) * SR)
        b = noise_burst(0.02, 1500, 7000, 0.003, 0.6)
        crack[i:i + len(b)] += b[:len(crack) - i]
    tr.add(0.05, crack); tr.add(0.05, noise_burst(0.5, 100, 900, 0.15, 0.4)); s["fire_shot"] = tr.render(0.06, 0.4)
    tr = Track(0.3); tr.add(0, drum(0.25, 0.7, 180, 90)); tr.add(0, noise_burst(0.08, 300, 2500, 0.01, 0.5)); s["hit"] = tr.render(0.03, 0.3)
    tr = Track(0.9); tr.add(0, noise_burst(0.7, 150, 1800, 0.18, 0.8)); tr.add(0.12, bell(2350, 0.55, 0.7)); s["flee"] = tr.render(0.15, 0.8)
    tr = Track(0.8); tr.add(0, bell(2093, 0.7, 0.7)); tr.add(0.07, bell(2637, 0.5, 0.6)); s["coin"] = tr.render(0.12, 0.6)
    tr = Track(5.5); tr.add(0, gong(5.2, 1.0, 92)); tr.add(0.0, drum(1.0, 1.0)); tr.add(0.45, drum(0.9, 0.8)); tr.add(0.9, drum(0.9, 0.9))
    s["night"] = tr.render(0.25, 2.0)
    tr = Track(3.0)
    for k, nm in enumerate(D_PENTA[3:13]):
        tr.add(k * 0.07, zheng(note(nm), 2.4, 0.35 + 0.03 * k))
    tr.add(0.8, bell(note("A5") * 2, 0.5, 1.6)); tr.add(1.0, dizi(note("D5"), 1.6, 0.6, slide=(-200, 0.3)), 0.7)
    s["dawn"] = tr.render(0.3, 2.0)
    tr = Track(4.5)
    for k in range(6):
        tr.add(k * 0.12, drum(0.5, 0.6 + 0.07 * k, 150, 70), 0.7)
    for k, nm in enumerate(D_PENTA[5:]):
        tr.add(0.8 + k * 0.05, zheng(note(nm), 2.5, 0.4))
    tr.add(1.4, gong(3.0, 0.8, 130)); tr.add(1.4, dizi(note("A5"), 2.0, 0.8, slide=(-200, 0.25)), 0.8)
    s["victory"] = tr.render(0.3, 2.2)
    tr = Track(4.5); tr.add(0, gong(4.4, 1.0, 70))
    for k, nm in enumerate(["A3", "F#3", "E3", "D3"]):
        tr.add(0.6 + k * 0.45, zheng(note(nm), 2.0, 0.6, bend=(0, -80, 0.8)))
    s["defeat"] = tr.render(0.3, 2.2)
    tr = Track(1.6)
    for k, f in enumerate([1760, 2093, 2637, 3136]):
        tr.add(k * 0.08, bell(f, 0.5, 1.0))
    s["reward"] = tr.render(0.25, 1.4)
    tr = Track(2.4)
    for k in range(8):
        nm = ["D5", "E5", "F#5", "A5", "F#5", "A5", "B5", "D6"][k]
        tr.add(k * 0.11, zheng(note(nm), 1.2, 0.55))
    for k in range(4):
        tr.add(k * 0.22, rim(0.5), 0.6)
    tr.add(0.9, bell(note("D6"), 0.5, 1.4)); s["joy"] = tr.render(0.25, 1.6)
    tr = Track(1.2); tr.add(0, noise_burst(0.9, 80, 3000, 0.2, 0.9)); tr.add(0, drum(0.8, 0.9, 90, 40))
    for k in range(6):
        tr.add(0.05 + k * 0.06, wood(300 + RNG.uniform(-60, 60), 0.5, 0.12), 0.6)
    s["destroyed"] = tr.render(0.2, 1.0)
    tr = Track(0.5); tr.add(0, zheng(note("A2"), 0.45, 0.6, bend=(0, -60, 0.2), bright=0.6)); s["deny"] = tr.render(0.05, 0.3)
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="client/assets/audio")
    ap.add_argument("--music", action="store_true", help="也合成背景音乐（写成 bgm_*_synth.mp3）")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    if args.music:
        # 2026-11-24 起游戏里的背景音乐换成 Suno 生成的（见 make_loop.py 和云盘 audio_sources/），程序合成版只在 --music 时才写，
        # 而且写成 *_synth.mp3，不覆盖正式曲
        to_mp3(day_music(), out / "bgm_day_synth.mp3", 96)
        print("bgm_day_synth.mp3", flush=True)
        to_mp3(night_music(), out / "bgm_night_synth.mp3", 96)
        print("bgm_night_synth.mp3", flush=True)
    for name, x in sfx().items():
        to_mp3(x, out / f"sfx_{name}.mp3", 80)
        print(f"sfx_{name}.mp3", flush=True)
    total = sum(p.stat().st_size for p in out.glob("*.mp3"))
    print(f"共 {total / 1024:.0f} KB")


if __name__ == "__main__":
    main()
