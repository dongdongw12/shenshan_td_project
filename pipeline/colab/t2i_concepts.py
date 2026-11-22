"""
《深山传家》概念图生成（独立进程运行，跑完显存/内存全部释放，再加载 Hunyuan3D 不会 OOM）。

模型：
  qwen-image  Qwen/Qwen-Image（Apache-2.0，无需登录；中文长提示词遵循度高）。需要原生 bf16 的 GPU（A100 / L4 / H100），
              transformer 与 text_encoder 用 bitsandbytes 4bit 量化加载，约 16GB 显存；首次下载约 58GB（建议缓存到云盘）。
  hunyuandit  Tencent-Hunyuan/HunyuanDiT-v1.1-Distilled（T4 也能跑，但实测“箭楼”会画成宝塔、“正房”会画成红墙庙宇）。
  auto        有原生 bf16 → qwen-image，否则 hunyuandit；qwen-image 任何报错都自动退回 hunyuandit。

输出：<out>/_candidates/<id>_<model>_s<seed>.png；<out>/<id>.png 不存在（或 id 在 --regen 里）时用第一张候选。
用法：
  python t2i_concepts.py --jobs gen_3d_jobs.json --out /content/drive/MyDrive/shenshan_td/concepts \
      --ids house_lv2_tile,tower_bamboo --model auto [--regen tower_bamboo]
"""

import argparse
import gc
import json
import os
import shutil
import sys
import time
import traceback


def log(msg):
    print(msg, flush=True)


def has_native_bf16():
    import torch
    if not torch.cuda.is_available():
        return False
    major, _ = torch.cuda.get_device_capability(0)
    return major >= 8  # Ampere 及以上（A100/L4/H100）；T4 = 7.5


def load_qwen_image():
    import torch
    from diffusers import DiffusionPipeline
    from diffusers.quantizers import PipelineQuantizationConfig

    qc = PipelineQuantizationConfig(
        quant_backend="bitsandbytes_4bit",
        quant_kwargs={"load_in_4bit": True, "bnb_4bit_quant_type": "nf4",
                      "bnb_4bit_compute_dtype": torch.bfloat16},
        components_to_quantize=["transformer", "text_encoder"],
    )
    pipe = DiffusionPipeline.from_pretrained("Qwen/Qwen-Image", torch_dtype=torch.bfloat16, quantization_config=qc)
    pipe.enable_model_cpu_offload()

    def run(asset, style, seed):
        prompt = f"{style['prefix_zh']}{asset['prompt_zh']}"
        g = torch.Generator(device="cuda").manual_seed(int(seed))
        return pipe(prompt=prompt, negative_prompt=style["negative_zh"], width=1024, height=1024,
                    num_inference_steps=40, true_cfg_scale=4.0, generator=g).images[0]
    return pipe, run


def load_hunyuandit():
    from hy3dgen.text2image import HunyuanDiTPipeline
    pipe = HunyuanDiTPipeline("Tencent-Hunyuan/HunyuanDiT-v1.1-Diffusers-Distilled")

    def run(asset, style, seed):
        prompt = asset["t2i_zh"]
        if len(prompt) > 60:
            log(f"WARN {asset['id']} 的 t2i_zh 有 {len(prompt)} 字，HunyuanDiT 只读前 60 字")
        return pipe(prompt, seed=int(seed))
    return pipe, run


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--jobs", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--ids", required=True, help="逗号分隔，需要出图的资产 id")
    p.add_argument("--model", default="auto", choices=["auto", "qwen-image", "hunyuandit"])
    p.add_argument("--regen", default="", help="逗号分隔：即使已有 <id>.png 也用新候选覆盖")
    args = p.parse_args()

    jobs = json.load(open(args.jobs, encoding="utf-8"))
    assets = {a["id"]: a for a in jobs["assets"]}
    style = jobs["style"]
    ids = [i for i in args.ids.split(",") if i]
    regen = {i for i in args.regen.split(",") if i}
    cand_dir = os.path.join(args.out, "_candidates")
    os.makedirs(cand_dir, exist_ok=True)

    model = args.model
    if model == "auto":
        model = "qwen-image" if has_native_bf16() else "hunyuandit"
    log(f"T2I_MODEL: {model}")

    try:
        pipe, run = load_qwen_image() if model == "qwen-image" else load_hunyuandit()
    except Exception:
        if model != "qwen-image":
            raise
        traceback.print_exc()
        log("WARN Qwen-Image 加载失败，退回 HunyuanDiT")
        model = "hunyuandit"
        gc.collect()
        pipe, run = load_hunyuandit()

    summary = {}
    for i in ids:
        asset = assets[i]
        seeds = asset.get("gen", {}).get("t2i_seeds", jobs["defaults"]["t2i_seeds"])
        cands = []
        for seed in seeds:
            t0 = time.time()
            path = os.path.join(cand_dir, f"{i}_{model}_s{seed}.png")
            run(asset, style, seed).save(path)
            cands.append(path)
            log(f"{i}: {os.path.basename(path)} ({time.time() - t0:.0f}s)")
        target = os.path.join(args.out, f"{i}.png")
        if i in regen or not os.path.exists(target):
            shutil.copy(cands[0], target)
            log(f"{i}: 选用 {os.path.basename(cands[0])} → {os.path.basename(target)}")
        summary[i] = [os.path.basename(c) for c in cands]
    with open(os.path.join(cand_dir, "_last_run.json"), "w", encoding="utf-8") as f:
        json.dump({"model": model, "candidates": summary, "time": time.strftime("%Y-%m-%d %H:%M:%S")},
                  f, ensure_ascii=False, indent=2)
    del pipe
    gc.collect()
    log("T2I_DONE")


if __name__ == "__main__":
    sys.exit(main())
