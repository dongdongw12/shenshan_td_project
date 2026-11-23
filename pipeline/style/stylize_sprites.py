"""
《深山传家》“明清木刻粗墨线 + 矿物重彩工笔”风格化后处理（路线 B · stylized 模式第二步）

输入：bake_isometric_sprites.py 写出的 _passes/<stem>_{day,night}.exr（多层 EXR）与 <stem>_render.json
输出：<out>/<stem>_day.png、<stem>_night.png、<stem>_shadow.png、<stem>_meta.json

每张图的处理顺序（全部在超采样分辨率上做，最后 Lanczos 缩回目标尺寸）：
  1. 固有色（Diffuse Color 通道）→ 颜色外扩防黑边 → Kuwahara 平涂（抹掉 AI 贴图斑驳）
  2. 矿物色归色：Lab 空间向 style_profile.palette 软吸附 + 提纯度
  3. 光影：Combined / 固有色 = 纯光照 → 色阶化（2–4 阶，软边）→ 亮部暖白、暗部石青冷色（不发灰）
  4. 内墨线：法线夹角 + 深度跳变 → 去噪点 → 定宽
  5. 分染：墨线附近同色加深（工笔“分染”晕染效果）
  6. 外轮廓墨线：Freestyle 通道（书法笔触）统一改成墨色
  7. 墨色地影：取白昼阴影接收面，靛墨色半透明，默认单独输出 <stem>_shadow.png（客户端在地面层先画）
  8. 夜晚：固有色减饱和 + 靛蓝环境光 + 暖灯色阶 + 灯晕（bloom，带透明度外溢）

运行环境：Blender 自带 Python（含 numpy + OpenImageIO），或任意装了 numpy + (OpenImageIO 或 OpenEXR+Pillow) 的 Python。
单独重跑风格化（不重新渲染）：
  <blender>/5.x/python/bin/python3.x pipeline/style/stylize_sprites.py \
      --passes pipeline/baked_sprites/_passes --out pipeline/baked_sprites [--profile ...] [--debug]
"""

import argparse
import json
import math
import os
import re
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
DEFAULT_PROFILE = HERE / "style_profile.json"

try:
    import OpenImageIO as oiio
except Exception:  # pragma: no cover - 取决于运行环境
    oiio = None

PASS_ALIASES = {
    "combined": ("Combined",),
    "depth": ("Depth", "Z"),
    "normal": ("Normal",),
    "index": ("Object Index", "IndexOB"),
    "albedo": ("Diffuse Color", "DiffCol"),
    "ao": ("Ambient Occlusion", "AO"),
    "ink": ("Freestyle",),
}
CHANNEL_ORDER = {"R": 0, "X": 0, "G": 1, "Y": 1, "B": 2, "Z": 2, "A": 3, "V": 0}


# ============================================================================ IO

def _group_channels(named):
    """{'ViewLayer.Diffuse Color.R': arr, ...} → {'Diffuse Color': (H,W,C)}"""
    groups = {}
    for full, arr in named.items():
        parts = full.split(".")
        if len(parts) >= 3:
            pass_name, chan = ".".join(parts[1:-1]), parts[-1]
        elif len(parts) == 2:
            pass_name, chan = parts
        else:
            pass_name, chan = "Combined", parts[0]
        groups.setdefault(pass_name, []).append((CHANNEL_ORDER.get(chan, 9), chan, arr))
    out = {}
    for name, chans in groups.items():
        chans.sort(key=lambda c: (c[0], c[1]))
        out[name] = np.stack([c[2] for c in chans], axis=-1).astype(np.float32)
    return out


def read_exr_passes(path):
    named = {}
    if oiio is not None:
        inp = oiio.ImageInput.open(str(path))
        if inp is None:
            raise IOError(f"无法打开 {path}: {oiio.geterror()}")
        sub = 0
        while inp.seek_subimage(sub, 0):
            spec = inp.spec()
            pixels = inp.read_image(sub, 0, 0, spec.nchannels, oiio.FLOAT)  # 必须显式指定 subimage
            pixels = np.asarray(pixels).reshape(spec.height, spec.width, spec.nchannels)
            for c, name in enumerate(spec.channelnames):
                named[name] = pixels[..., c]
            sub += 1
        inp.close()
    else:
        import OpenEXR  # noqa: WPS433
        with OpenEXR.File(str(path), separate_channels=True) as f:
            for part in f.parts:
                for name, ch in part.channels.items():
                    named[name] = np.asarray(ch.pixels, dtype=np.float32)
    grouped = _group_channels(named)
    passes = {}
    for key, aliases in PASS_ALIASES.items():
        for alias in aliases:
            if alias in grouped:
                passes[key] = grouped[alias]
                break
    missing = [k for k in ("combined", "albedo", "normal", "depth", "index", "ink") if k not in passes]
    if missing:
        raise KeyError(f"{path} 缺少通道 {missing}；实际有：{sorted(grouped)}")
    return passes


def resize(img, width, height):
    """Lanczos 缩放 (H,W,C) float32。"""
    if img.shape[1] == width and img.shape[0] == height:
        return img
    if oiio is not None:
        src = oiio.ImageBuf(np.ascontiguousarray(img, dtype=np.float32))
        roi = oiio.ROI(0, width, 0, height, 0, 1, 0, img.shape[2])
        dst = oiio.ImageBufAlgo.resize(src, filtername="lanczos3", roi=roi)
        return np.asarray(dst.get_pixels(oiio.FLOAT)).reshape(height, width, img.shape[2])
    from PIL import Image
    chans = [np.asarray(Image.fromarray(img[..., c], mode="F").resize((width, height), Image.LANCZOS))
             for c in range(img.shape[2])]
    return np.stack(chans, axis=-1).astype(np.float32)


def write_png(path, rgba):
    data = (np.clip(rgba, 0, 1) * 255.0 + 0.5).astype(np.uint8)
    if oiio is not None:
        out = oiio.ImageOutput.create(str(path))
        spec = oiio.ImageSpec(data.shape[1], data.shape[0], data.shape[2], oiio.UINT8)
        spec.attribute("png:compressionLevel", 9)
        out.open(str(path), spec)
        out.write_image(data)
        out.close()
    else:
        from PIL import Image
        Image.fromarray(data, mode="RGBA" if data.shape[2] == 4 else "RGB").save(path, optimize=True)


# ============================================================================ 颜色

def hex_to_srgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((np.maximum(c, 0) + 0.055) / 1.055) ** 2.4).astype(np.float32)


def linear_to_srgb(c):
    c = np.clip(c, 0.0, None)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055).astype(np.float32)


def hex_to_linear(h):
    return srgb_to_linear(hex_to_srgb(h))


def luminance(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


_M_RGB2XYZ = np.array([[0.4124564, 0.3575761, 0.1804375],
                       [0.2126729, 0.7151522, 0.0721750],
                       [0.0193339, 0.1191920, 0.9503041]], dtype=np.float32)
_M_XYZ2RGB = np.linalg.inv(_M_RGB2XYZ).astype(np.float32)
_WHITE = np.array([0.95047, 1.0, 1.08883], dtype=np.float32)


def linear_to_lab(rgb):
    xyz = rgb @ _M_RGB2XYZ.T / _WHITE
    d = 6 / 29
    f = np.where(xyz > d ** 3, np.cbrt(np.maximum(xyz, 0)), xyz / (3 * d * d) + 4 / 29)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1).astype(np.float32)


def lab_to_linear(lab):
    fy = (lab[..., 0] + 16) / 116
    fx = fy + lab[..., 1] / 500
    fz = fy - lab[..., 2] / 200
    d = 6 / 29
    def finv(t):
        return np.where(t > d, t ** 3, 3 * d * d * (t - 4 / 29))
    xyz = np.stack([finv(fx), finv(fy), finv(fz)], axis=-1) * _WHITE
    return np.clip(xyz @ _M_XYZ2RGB.T, 0, None).astype(np.float32)


# ============================================================================ 图像算子（纯 numpy）

def box_blur(img, r):
    """半径 r 的盒式模糊（积分图，O(1)/像素），边缘复制。img: (H,W) 或 (H,W,C)。"""
    r = int(round(r))
    if r <= 0:
        return img
    squeeze = img.ndim == 2
    a = img[..., None] if squeeze else img
    for axis in (0, 1):
        pad = [(0, 0)] * a.ndim
        pad[axis] = (r + 1, r)
        p = np.pad(a, pad, mode="edge")
        c = np.cumsum(p, axis=axis, dtype=np.float64)
        n = a.shape[axis]
        hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
        lo = np.take(c, np.arange(0, n), axis=axis)
        a = ((hi - lo) / (2 * r + 1)).astype(np.float32)
    return a[..., 0] if squeeze else a


def gaussian(img, sigma):
    """三次盒式模糊近似高斯。"""
    if sigma <= 0.3:
        return img
    r = max(1, int(round(math.sqrt(12 * sigma * sigma / 3 + 1) / 2)))
    for _ in range(3):
        img = box_blur(img, r)
    return img


def shift(img, dy, dx):
    """平移（边缘复制），返回与 img 同形状。"""
    h, w = img.shape[:2]
    ys = np.clip(np.arange(h) - dy, 0, h - 1)
    xs = np.clip(np.arange(w) - dx, 0, w - 1)
    return img[ys][:, xs]


def dilate(mask, r):
    r = int(round(r))
    out = mask.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dy * dy + dx * dx <= r * r and (dy or dx):
                out = np.maximum(out, shift(mask, dy, dx))
    return out


def erode(mask, r):
    return 1.0 - dilate(1.0 - mask, r)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / max(e1 - e0, 1e-6), 0, 1)
    return t * t * (3 - 2 * t)


def bleed_fill(color, mask, sigmas=(2, 6, 18, 48)):
    """把 mask 外的像素用附近的 mask 内颜色填满，滤波时边缘不会被背景的黑色污染。"""
    out = color.copy()
    known = mask.copy()
    for s in sigmas:
        num = gaussian(out * known[..., None], s)
        den = gaussian(known, s)
        fill = num / np.maximum(den[..., None], 1e-6)
        unknown = known < 0.5
        out = np.where(unknown[..., None] & (den[..., None] > 1e-4), fill, out)
        known = np.maximum(known, (den > 1e-4).astype(np.float32))
    return out


def kuwahara(img, r):
    """Kuwahara 平涂滤波：四个象限里取方差最小的均值，保边去斑驳，形成色块。"""
    r = int(round(r))
    if r <= 0:
        return img
    h, w, _ = img.shape
    lum = luminance(img)
    pad = r
    ip = np.pad(img, ((pad + 1, pad), (pad + 1, pad), (0, 0)), mode="edge").astype(np.float64)
    lp = np.pad(lum, ((pad + 1, pad), (pad + 1, pad)), mode="edge").astype(np.float64)
    S = ip.cumsum(0).cumsum(1)
    SL = lp.cumsum(0).cumsum(1)
    SL2 = (lp * lp).cumsum(0).cumsum(1)
    n = float((r + 1) * (r + 1))

    def rect(T, y0, x0):
        # 以 (y,x) 为角、尺寸 (r+1)×(r+1) 的方块和；y0/x0 ∈ {-r, 0} 为方块左上角相对偏移
        ya, xa = pad + 1 + y0, pad + 1 + x0
        yb, xb = ya + r + 1, xa + r + 1
        return (T[yb - 1:yb - 1 + h, xb - 1:xb - 1 + w] - T[ya - 1:ya - 1 + h, xb - 1:xb - 1 + w]
                - T[yb - 1:yb - 1 + h, xa - 1:xa - 1 + w] + T[ya - 1:ya - 1 + h, xa - 1:xa - 1 + w])

    best_var = np.full((h, w), np.inf)
    best = np.zeros_like(img, dtype=np.float64)
    for y0 in (-r, 0):
        for x0 in (-r, 0):
            m = rect(SL, y0, x0) / n
            var = rect(SL2, y0, x0) / n - m * m
            mean = rect(S, y0, x0) / n
            take = var < best_var
            best_var = np.where(take, var, best_var)
            best = np.where(take[..., None], mean, best)
    return best.astype(np.float32)


def soft_posterize(x, bands, softness):
    """把 0–1 的连续光照变成 bands 阶色块，阶与阶之间留 softness 宽的柔边。"""
    t = np.clip(x, 0, 1) * bands
    i = np.floor(t)
    f = t - i
    s = smoothstep(0.5 - softness / 2, 0.5 + softness / 2, f)
    return np.clip((i + s) / bands, 0, 1)


def tonemap(x, knee=0.8):
    """高光软肩，避免亮部纯白死掉。"""
    over = np.maximum(x - knee, 0)
    return np.where(x > knee, knee + (1 - knee) * (1 - np.exp(-over / (1 - knee))), x)


# ============================================================================ 风格化

def harmonize(albedo_lin, mask, profile, ss, debug=None):
    hp = profile["harmonize"]
    color = bleed_fill(albedo_lin, mask)
    srgb = linear_to_srgb(color)
    for _ in range(int(hp.get("smooth_passes", 1))):
        srgb = kuwahara(srgb, hp["smooth_radius_px"] * ss)
    lab = linear_to_lab(srgb_to_linear(srgb))

    pal = np.stack([linear_to_lab(hex_to_linear(v["hex"])[None, None, :])[0, 0] for v in profile["palette"].values()])
    d = np.sqrt(((lab[..., None, :] - pal[None, None]) ** 2 * np.array([0.5, 1, 1])).sum(-1))
    w = np.exp(-(d - d.min(-1, keepdims=True)) / 6.0)
    w /= w.sum(-1, keepdims=True)
    target = (w[..., None] * pal[None, None]).sum(-2)
    s, sl = float(hp["palette_strength"]), float(hp.get("palette_lightness_strength", 0.0))
    lab[..., 1:] += s * (target[..., 1:] - lab[..., 1:])
    lab[..., 0] += sl * (target[..., 0] - lab[..., 0])
    lab[..., 1:] *= float(hp.get("saturation", 1.0))
    out = lab_to_linear(lab)
    if debug is not None:
        debug["albedo_harmonized"] = out
    return out


def inner_lines(normal, depth, obj, ink_cfg, ss, px_per_meter, outer_alpha):
    n = normal / np.maximum(np.linalg.norm(normal, axis=-1, keepdims=True), 1e-6)
    n = gaussian(n, ink_cfg.get("inner_normal_blur_px", 1.0) * ss)
    n = n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    cos_thr = math.cos(math.radians(ink_cfg["inner_normal_deg"]))
    z = np.where(obj > 0.5, depth[..., 0], np.nan)
    z = np.where(np.isfinite(z), z, np.nanmax(z) if np.isfinite(np.nanmax(z)) else 0.0)
    depth_thr = float(ink_cfg.get("inner_depth_m", 0.3))

    edge = np.zeros(obj.shape, dtype=np.float32)
    step = max(1, int(round(ss)))
    for dy, dx in ((0, step), (step, 0), (step, step), (step, -step)):
        nn = shift(n, dy, dx)
        edge = np.maximum(edge, ((n * nn).sum(-1) < cos_thr).astype(np.float32))
        edge = np.maximum(edge, (np.abs(z - shift(z, dy, dx)) > depth_thr).astype(np.float32))
    # 只在物体内部（外轮廓墨线已经覆盖边缘）
    inside = erode((obj > 0.5).astype(np.float32), max(1, int(round(ss))))
    edge *= inside * (1.0 - np.clip(outer_alpha * 2, 0, 1))
    # 去孤立噪点：穿过 (2k+1)² 窗口的 1px 线密度约 1/(2k+1)，孤点只有 1/(2k+1)²
    k = max(1, int(round(ink_cfg.get("inner_min_feature_px", 3.0) * ss / 2)))
    density = box_blur(edge, k)
    edge *= (density > (0.55 / (2 * k + 1))).astype(np.float32)
    width = float(ink_cfg["inner_px"]) * ss
    lines = dilate(edge, max(0, int(round(width / 2 - 0.5))))
    return np.clip(gaussian(lines, 0.5 * ss), 0, 1) * float(ink_cfg.get("inner_opacity", 1.0))


def stylize_image(passes, day_passes, profile, info, which, debug=None):
    ss = int(info["supersample"])
    scale = float(info.get("preview_scale", 1.0))
    px = ss * scale  # profile 里的像素尺寸都按 1.0 倍正式比例定义
    comb = passes["combined"]
    cov = np.clip(comb[..., 3], 0, 1)
    idx = passes["index"][..., 0]
    obj_hard = (idx > 0.5).astype(np.float32)
    obj = np.clip(dilate(obj_hard, 1) * cov, 0, 1)
    safe_cov = np.maximum(cov, 1e-4)[..., None]

    albedo = passes["albedo"][..., :3] / safe_cov
    albedo_h = harmonize(albedo, obj_hard, profile, px, debug)

    # 纯光照 = 渲染结果 / 固有色（同样按覆盖率预乘，比值与覆盖率无关）
    light_rgb = comb[..., :3] / np.maximum(passes["albedo"][..., :3], 0.02 * safe_cov)
    light_rgb = np.clip(bleed_fill(light_rgb, obj_hard, sigmas=(2, 8)), 0, 4)
    light_rgb = gaussian(light_rgb, 0.75 * px)
    sh = profile["shading"][which]
    ref = float(sh.get("light_reference", 1.0))
    L = luminance(light_rgb) / ref * float(sh.get("exposure", 1.0))
    bands = soft_posterize(L, int(sh["bands"]), float(sh["band_softness"]))

    ink_cfg = profile["ink"]
    outer_a = np.clip(passes["ink"][..., 3], 0, 1)
    inner = inner_lines(passes["normal"][..., :3] / safe_cov, passes["depth"], obj_hard, ink_cfg, px,
                        info["px_per_meter"], outer_a)

    if which == "day":
        floor = float(sh.get("shadow_floor", 0.0))
        t = (floor + (1 - floor) * bands)[..., None]
        tint = hex_to_linear(sh["shadow_color"]) * (1 - t) + hex_to_linear(sh["light_color"]) * t
        color = albedo_h * tint
    else:
        grey = luminance(albedo_h)[..., None]
        base = albedo_h + (grey - albedo_h) * float(sh.get("albedo_desaturate", 0.0))
        # 灯光色相：只保留暖光（灯笼）分量的色相，压掉月光蓝与暖光混出的粉紫
        hue = light_rgb / np.maximum(luminance(light_rgb)[..., None], 1e-4)
        warm_hue = hex_to_linear(profile["lighting"]["night"].get("lantern_color", "#ff9a3c"))
        warm_hue = warm_hue / max(float(luminance(warm_hue)), 1e-4)
        warmth = np.clip((light_rgb[..., 0] - light_rgb[..., 2]) / np.maximum(light_rgb[..., 0], 1e-4), 0, 1)
        hue = hue * (1 - warmth[..., None]) + warm_hue * warmth[..., None]
        # 环境光：直接用夜靛色（线性值）按 ambient_level 缩放，不按亮度归一，避免饱和蓝过亮
        ambient = hex_to_linear(sh["ambient_color"]) * float(sh["ambient_level"])
        lit = ambient + hue * (bands * float(sh.get("lamp_gain", 1.0)))[..., None]
        color = base * lit

    # 分染：墨线附近同色加深
    wash_src = np.maximum(outer_a, inner)
    wash = gaussian(wash_src, float(sh.get("edge_wash_px", 4.0)) * px)
    wash = np.clip(wash * 2.5, 0, 1) * (1 - wash_src)
    color = color * (1 - float(sh.get("edge_wash", 0.0)) * wash[..., None])

    ink = hex_to_linear(ink_cfg["color"])
    color = color * (1 - inner[..., None]) + ink * inner[..., None]

    # 墨色地影：白昼阴影接收面的透明度（物体以外部分）
    gs = profile["ground_shadow"]
    d_cov = np.clip(day_passes["combined"][..., 3], 0, 1)
    d_obj = dilate((day_passes["index"][..., 0] > 0.5).astype(np.float32), 1)
    shadow_a = gaussian(d_cov * (1 - d_obj), float(gs.get("blur_px", 1.0)) * px) * float(gs["opacity"])
    if which == "night":
        shadow_a = shadow_a * 0.6

    sc = hex_to_linear(gs["color"])
    separate = bool(gs.get("separate", True))
    if separate:
        # 地影单独成层：客户端先画所有地影再按 Y 排序画物体，近处物体的影子不会盖到远处建筑上
        C = np.zeros_like(color)
        A = np.zeros_like(obj)
    else:
        C = sc * shadow_a[..., None]
        A = shadow_a
    C = color * obj[..., None] + C * (1 - obj[..., None])
    A = obj + A * (1 - obj)
    C = ink * outer_a[..., None] + C * (1 - outer_a[..., None])
    A = outer_a + A * (1 - outer_a)

    if which == "night":
        lum = luminance(color)
        warm = np.clip((light_rgb[..., 0] - light_rgb[..., 2]) / np.maximum(light_rgb[..., 0], 1e-4), 0, 1)
        src = np.maximum(lum - float(sh["bloom_threshold"]) * luminance(albedo_h), 0) * warm * obj
        glow = gaussian(src, float(sh["bloom_radius_px"]) * px)
        glow = glow / max(float(glow.max()), 1e-6) if glow.max() > 0 else glow
        glow_a = np.clip(glow * float(sh["bloom_strength"]), 0, 1)
        lantern = hex_to_linear(profile["lighting"]["night"].get("lantern_color", "#ff9a3c"))
        C = C + lantern * glow_a[..., None] * 0.6
        A = np.maximum(A, glow_a * 0.55)

    if debug is not None:
        debug[f"{which}_light_bands"] = np.repeat(bands[..., None], 3, -1)
        debug[f"{which}_inner_lines"] = np.repeat(inner[..., None], 3, -1)
        debug[f"{which}_light_stats"] = {
            "p50": float(np.percentile(luminance(light_rgb)[obj_hard > 0.5], 50)),
            "p95": float(np.percentile(luminance(light_rgb)[obj_hard > 0.5], 95)),
        }
    if debug is not None:
        debug[f"{which}_shadow_alpha"] = shadow_a
    return C, A


def shadow_layer(day_passes, profile, info):
    """单独的地影层（白昼形状；夜晚由客户端按 meta.night_shadow_opacity 减淡）。"""
    gs = profile["ground_shadow"]
    px = int(info["supersample"]) * float(info.get("preview_scale", 1.0))
    d_cov = np.clip(day_passes["combined"][..., 3], 0, 1)
    d_obj = dilate((day_passes["index"][..., 0] > 0.5).astype(np.float32), 1)
    a = gaussian(d_cov * (1 - d_obj), float(gs.get("blur_px", 1.0)) * px) * float(gs["opacity"])
    a = np.clip(a, 0, 1)
    return hex_to_linear(gs["color"]) * a[..., None], a


def finalize(C, A, out_w, out_h):
    """线性预乘 → 去预乘 → 软肩 → sRGB → 预乘缩放（Lanczos）→ 去预乘 RGBA。"""
    straight = C / np.maximum(A, 1e-5)[..., None]
    srgb = linear_to_srgb(tonemap(straight))
    pre = np.concatenate([srgb * A[..., None], A[..., None]], axis=-1)
    small = resize(pre, out_w, out_h)
    a = np.clip(small[..., 3:4], 0, 1)
    rgb = np.clip(small[..., :3] / np.maximum(a, 1e-5), 0, 1)
    rgb = np.where(a > 1e-4, rgb, 0)
    return np.concatenate([rgb, a], axis=-1)


def grade_srgb(rgb, profile, which="day"):
    """全局调色（sRGB 0–1，作用在最终精灵上，不进 Lab 归色）：模拟古旧绢本设色 ——
    先整体略去饱和，再向绢色保亮度地染一层（暖黄、矿物色褪色感），最后把最暗处轻轻托向暖褐（旧墨不是纯黑）。
    profile["grade"] 不存在时原样返回。夜晚按 night_scale 减弱。"""
    g = profile.get("grade")
    if not g:
        return rgb
    k = float(g.get("night_scale", 0.5)) if which == "night" else 1.0
    out = np.asarray(rgb, dtype=np.float32)
    lum = (0.2126 * out[..., 0] + 0.7152 * out[..., 1] + 0.0722 * out[..., 2])[..., None]
    d = float(g.get("desaturate", 0.0)) * k
    out = lum + (out - lum) * (1 - d)
    if g.get("tint"):
        t = hex_to_srgb(g["tint"])
        t_l = max(float(0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2]), 1e-4)
        s = float(g.get("tint_strength", 0.0)) * k
        out = out * (1 - s) + out * (t / t_l) * s
    if g.get("lift"):
        lc = hex_to_srgb(g["lift"])
        f = float(g.get("lift_strength", 0.0)) * k
        dark = np.clip(1 - lum / 0.45, 0, 1)  # 只托暗部，亮部不动
        out = out + (lc - out) * f * dark
    return np.clip(out, 0, 1)


def load_profile(path=None):
    with open(path or DEFAULT_PROFILE, "r", encoding="utf-8") as f:
        return json.load(f)


def stylize_asset(render_json, out_dir, profile_path=None, debug=False):
    render_json, out_dir = Path(render_json), Path(out_dir)
    info = json.load(open(render_json, encoding="utf-8"))
    profile = load_profile(profile_path or None)
    pass_dir = render_json.parent
    day = read_exr_passes(pass_dir / info["day_exr"])
    night = read_exr_passes(pass_dir / info["night_exr"])
    out_w, out_h = info["resolution"]
    stem = info["stem"]
    dbg = {} if debug else None
    files = {}
    for which, passes in (("day", day), ("night", night)):
        C, A = stylize_image(passes, day, profile, info, which, dbg)
        rgba = finalize(C, A, out_w, out_h)
        rgba[..., :3] = grade_srgb(rgba[..., :3], profile, which)
        files[which] = out_dir / f"{stem}_{which}.png"
        write_png(files[which], rgba)
    separate = bool(profile["ground_shadow"].get("separate", True))
    if separate:
        C, A = shadow_layer(day, profile, info)
        files["shadow"] = out_dir / f"{stem}_shadow.png"
        write_png(files["shadow"], finalize(C, A, out_w, out_h))
    meta = {k: info[k] for k in ("id", "name", "angle", "resolution", "anchor_uv", "anchor_px", "px_per_meter",
                                 "camera_elevation_deg", "camera_azimuth_deg", "tile_size_m", "tile_px",
                                 "footprint", "fit_limited_by", "target_height_m", "actual_height_m",
                                 "actual_size_m", "front_faces") if k in info}
    meta.update({"mode": "stylized", "style": profile.get("name"), "style_version": profile.get("version"),
                 "day_file": files["day"].name, "night_file": files["night"].name})
    if separate:
        meta.update({"shadow_file": files["shadow"].name, "night_shadow_opacity": 0.6,
                     "shadow_note": "地影单独一层：先画全部地影，再按锚点 Y 排序画物体；夜晚地影透明度 × 0.6"})
    with open(out_dir / f"{stem}_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    if dbg is not None:
        ddir = pass_dir / "debug"
        ddir.mkdir(exist_ok=True)
        stats = {}
        for name, img in dbg.items():
            if isinstance(img, dict):
                stats[name] = img
                continue
            srgb = linear_to_srgb(img) if "albedo" in name else img
            write_png(ddir / f"{stem}_{name}.png", np.concatenate([srgb, np.ones_like(srgb[..., :1])], -1))
        print(f"STYLE_DEBUG {stem}: {json.dumps(stats)}", flush=True)
    return meta


def main():
    p = argparse.ArgumentParser(description="明清木刻粗墨线 + 矿物重彩风格化后处理")
    p.add_argument("--passes", required=True, help="_passes 目录（含 *_render.json）")
    p.add_argument("--out", required=True)
    p.add_argument("--profile", default="")
    p.add_argument("--only", default="", help="逗号分隔的 stem，只处理这些")
    p.add_argument("--debug", action="store_true", help="输出中间图到 _passes/debug/")
    args = p.parse_args()
    only = {s for s in args.only.split(",") if s}
    jobs = sorted(Path(args.passes).glob("*_render.json"))
    Path(args.out).mkdir(parents=True, exist_ok=True)
    for j in jobs:
        stem = re.sub(r"_render\.json$", "", j.name)
        if only and stem not in only:
            continue
        stylize_asset(j, args.out, args.profile or None, args.debug)
        print(f"STYLIZED {stem}", flush=True)


if __name__ == "__main__":
    main()
