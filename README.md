# 《深山传家：开荒守寨》正式版工程（路线 B：3D 建模 → 2.5D 高精粗墨线图集）

> 本仓库为《深山传家：开荒守寨》独立游戏工程仓库（默认本地路径 `~/Projects/shenshan_td_project/`）。跨设备 / 跨模型接手请先阅读根目录 [`HANDOFF.md`](HANDOFF.md)。

## 1. 独立项目仓库结构

```text
shenshan_td_project/
├── HANDOFF.md                             # 跨电脑 / 跨模型交接文档与任务队列（开工必读）
├── README.md                              # 项目总览与管线说明
├── assets_manifest.json                   # 24 件核心 3D 建筑/物件规格清单（尺寸/占地/灯光）
├── docs/                                  # 策划案、数值表、美术规范与开发日志
│   └── prototype_v0/                      # 前 3 天浏览器可玩原型（原 mountain_td_mvp，含初版 config.js）
├── pipeline/                              # 离线美术与 3D 烘培管线（不打包进小游戏）
│   ├── colab/
│   │   └── colab_bake_sprites.ipynb       # Colab A100 批量等距双光影烘培笔记本
│   ├── blender/
│   │   └── bake_isometric_sprites.py      # Blender 4.x/5.0 自动归一化 + 粗墨线昼/夜烘培脚本
│   ├── raw_models/                        # Colab 生成的原始 .glb 建筑模型（.gitignore 忽略，走 Google Drive）
│   └── baked_sprites/                     # Blender 烘培出的高清 _day.png / _night.png / _meta.json（.gitignore 忽略，走 Google Drive）
├── client/                                # 游戏客户端（Cocos Creator 3.8+ 或 TypeScript 微信小游戏）
│   ├── assets/
│   │   ├── atlases/                       # 打包压缩后的 2.5D 图集（主包 + 分包）
│   │   ├── audio/                         # 五声古风音乐与环境/打击音效
│   │   └── configs/                       # 从 docs 导出的 JSON 数值表（波次/建筑/家族羁绊）
│   └── src/
│       ├── core/                          # 昼夜状态机、经济循环、存档管理
│       ├── family/                        # 娶妻、生子、家谱树、族人驻守羁绊系统
│       ├── combat/                        # 塔防寻路、弹幕对象池、野兽与土匪 AI
│       ├── render/                        # 2.5D 深度排序（Y-Sort）、昼夜混合与暖光叠加
│       └── platform/                      # 微信小游戏适配层（IAA 激励视频、分包加载）
└── .gitignore                             # 忽略大体积 .glb/.blend 与临时构建目录
```

## 2. 路线 B 核心工作流（4 步闭环）

1. **生成 3D 建筑模型**：在 Colab 上用开源图生 3D 模型（Hunyuan3D / TRELLIS）生成明清古建 `.glb`，放进 Google Drive 的 `shenshan_td/raw_models/`（文件名与 `assets_manifest.json` 的 `id` 一致，如 `house_lv2_tile.glb`）。
2. **Blender 自动双光影烘培**：运行 `pipeline/blender/bake_isometric_sprites.py`（本机小图测试或 Colab A100 批量跑），自动完成：
   - 物理高度归一化 + 底面归零对齐网格中心；
   - 标准 2:1 等距正交相机（俯角 35.264°、方位角 45°）+ 透明底；
   - **Freestyle 饱满粗墨线描边**（默认 2.6px 深墨色 `#1c1510`）；
   - 同步输出 **`<id>_day.png`（白昼矿物重彩）**、**`<id>_night.png`（深靛蓝夜色 + 暖橙门窗灯火）** 与 **`<id>_meta.json`（脚点锚点坐标）**。
3. **打图集进引擎**：用 TexturePacker / Cocos 自动图集把 `_day.png` 与 `_night.png` 合成 WebP/PNG 图集，放入 `client/assets/atlases/`。
4. **游戏中平滑昼夜切换**：同一建筑只需叠放白昼图与夜晚图，入夜时把夜晚图透明度从 `0 → 1` 平滑过渡，零 3D 性能开销即可呈现细腻的“入夜逐户点灯”效果。

## 3. 本机快速测试命令

```bash
# 单模型试烘培（先用 512px、32 采样快速看线条与光影）
blender -b -P pipeline/blender/bake_isometric_sprites.py -- \
  --input pipeline/raw_models/house_lv2_tile.glb \
  --out pipeline/baked_sprites \
  --manifest assets_manifest.json \
  --res 512 --samples 32 --ink-width 2.6

# 批量烘培整个目录（已存在的 PNG 自动跳过）
blender -b -P pipeline/blender/bake_isometric_sprites.py -- \
  --input pipeline/raw_models \
  --out pipeline/baked_sprites \
  --manifest assets_manifest.json \
  --res 768 --samples 48
```
