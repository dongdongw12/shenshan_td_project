# 《深山传家：开荒守寨》正式版工程（路线 B：3D 建模 → 2.5D 高精粗墨线图集）

> 本仓库为《深山传家：开荒守寨》独立游戏工程仓库（默认本地路径 `~/Projects/shenshan_td_project/`）。跨设备 / 跨模型接手请先阅读根目录 [`HANDOFF.md`](HANDOFF.md)。

## 1. 独立项目仓库结构

```text
shenshan_td_project/
├── HANDOFF.md                             # 跨电脑 / 跨模型交接文档与任务队列（开工必读）
├── README.md                              # 项目总览与管线说明
├── assets_manifest.json                   # 24 件核心 3D 建筑/物件规格清单（尺寸/占地/灯光）
├── docs/                                  # 策划案、数值表、美术规范与开发日志
│   ├── art/ART_BIBLE.md                   # 美术圣经：画风原则、比例镜头、光源、色板、墨线层级
│   ├── art/T2_concept_prompts.md          # 概念图提示词、出图规范与样张验收清单
│   ├── art/samples/                       # 风格化效果样张（只在 Google 云端硬盘，tools/sync_docs.py 同步到本地）
│   └── prototype_v0/                      # 前 3 天浏览器可玩原型（原 mountain_td_mvp，含初版 config.js）
├── pipeline/                              # 离线美术与 3D 烘培管线（不打包进小游戏）
│   ├── colab/
│   │   ├── colab_gen_3d.ipynb             # 概念图 → Hunyuan3D-2 图生 3D → .glb → 风格化试烘培（T2）
│   │   ├── build_gen3d_notebook.py        # 上面笔记本的生成脚本（改单元格改这里）
│   │   ├── gen_3d_jobs.json               # 概念图提示词 + 图生 3D 参数（每件资产一条）
│   │   ├── gen3d_utils.py                 # 墙面朝向自动对齐（纯 Python）
│   │   └── colab_bake_sprites.ipynb       # Colab GPU 批量烘培 + 风格化（支持只重跑风格化）
│   ├── style/
│   │   ├── style_profile.json             # 画风参数唯一来源（色板、墨线、光影、比例）
│   │   ├── stylize_sprites.py             # 明清木刻 + 矿物重彩工笔风格化后处理
│   │   └── compose_preview.py             # 场景预览（按锚点摆到地块网格）
│   ├── atlas/export_sprites.py            # 母版精灵按统一倍率导出给客户端 + sprites.json（--merge 增量合并）
│   ├── atlas/export_chars.py              # 角色序列帧合并进客户端 chars.json
│   ├── tests/                             # python3 -m unittest discover -s pipeline/tests
│   ├── blender/
│   │   ├── bake_isometric_sprites.py      # Blender 5.x 归一化 + 固定比例等距相机 + 渲染通道（v2）
│   │   ├── make_proxy_assets.py           # 程序化模型：19 件建筑 / 道具替身（过渡美术 + 图生 3D 兜底）+ 5 件正式程序化资产（稻田/篱笆/墙/陷阱）
│   │   ├── make_characters.py             # 程序化角色（9 种敌人 + 当家的/阿莲/孩子）：骨骼 + 行走 / 攻击 / 干活循环
│   │   └── bake_sprite_anim.py            # 角色序列帧烘培：逐帧渲染 → 同一套工笔风格化 → 横排精灵表（两个朝向 + 镜像）
│   ├── raw_models/                        # Colab 生成的原始 .glb 建筑模型（.gitignore 忽略，走 Google Drive）
│   └── baked_sprites/                     # Blender 烘培出的高清 _day.png / _night.png / _meta.json（.gitignore 忽略，走 Google Drive）
├── client/                                # 游戏客户端：引擎无关 TS 渲染核心 + 浏览器开发台（见 client/README.md）
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

> 画风规范见 [`docs/art/ART_BIBLE.md`](docs/art/ART_BIBLE.md)，参数唯一来源 [`pipeline/style/style_profile.json`](pipeline/style/style_profile.json)。效果样张：`docs/art/samples/`（不进 Git，`python3 tools/sync_docs.py` 从云盘 `shenshan_td/docs/` 拉下来；文档也在那里双向同步，可跨电脑直接改）。

1. **生成 3D 建筑模型**：按 [`docs/art/T2_concept_prompts.md`](docs/art/T2_concept_prompts.md) 出无描边概念图放进云盘 `shenshan_td/concepts/<id>.png`（或让笔记本用 HunyuanDiT 自动出），再在 Colab 运行 `pipeline/colab/colab_gen_3d.ipynb`，用 Hunyuan3D-2 生成带贴图、墙面已转正的 `.glb` 到 `shenshan_td/raw_models/`（文件名 = `assets_manifest.json` 的 `id`）。
2. **Blender 烘培渲染通道**（`pipeline/blender/bake_isometric_sprites.py`，stylized 模式）：
   - 全资产统一 **128 px/m**、2:1 等距（俯角 30°、方位角 45°）、×2 超采样；高度对齐 `target_height_m`，底座不出占地格；
   - 主光左前方来（正面亮、侧面暗、影子在后），材质统一哑光；Freestyle 只画外轮廓（书法笔触 + 手绘抖动）；
   - 输出多层 EXR（固有色 / 光照 / 法线 / 深度 / 物体 ID / 墨线）到 `_passes/`。
3. **工笔风格化**（`pipeline/style/stylize_sprites.py`，烘培时自动调用，也可单独重跑）：Kuwahara 平涂 → 矿物色板归色 → 3 阶色阶光影（暗部石青冷调）→ 内结构线 → 分染 → 墨色外轮廓 → 夜晚夜靛 + 暖灯 + 灯晕。输出 `<id>_day.png` / `<id>_night.png` / `<id>_shadow.png`（地影单独一层）/ `<id>_meta.json`（锚点、比例）。
4. **进客户端**：打图集到 `client/assets/atlases/`；先画全部地影，再按锚点 Y 排序画物体；入夜把夜晚图透明度 0→1，地影 ×0.6。

## 3. 本机命令（Blender 5.3：`/Applications/Blender.app/Contents/MacOS/Blender`）

```bash
# 生成程序化模型（全部替身 + 正式程序化资产；--ids 只生成指定几件）
blender -b -P pipeline/blender/make_proxy_assets.py -- --out pipeline/raw_models [--ids house_lv3_courtyard,prop_plum_tree]

# 半比例快速预览（墨线同比缩放）
blender -b -P pipeline/blender/bake_isometric_sprites.py -- \
  --input pipeline/raw_models/house_lv2_tile.glb --out pipeline/baked_sprites \
  --manifest assets_manifest.json --scale 0.5 --samples 24 --overwrite

# 正式批量（128 px/m，已有成品自动跳过）
blender -b -P pipeline/blender/bake_isometric_sprites.py -- \
  --input pipeline/raw_models --out pipeline/baked_sprites --manifest assets_manifest.json --samples 48

# 只改了 style_profile.json：不重新渲染，几十秒重出全部风格化图
/Applications/Blender.app/Contents/Resources/5.3/python/bin/python3.13 pipeline/style/stylize_sprites.py \
  --passes pipeline/baked_sprites/_passes --out pipeline/baked_sprites [--debug]

# 角色序列帧（行走 8 帧 + 攻击 6 帧，家人再加干活 8 帧；两个朝向 + 镜像；夜晚版由白昼版调色）
blender -b -P pipeline/blender/bake_sprite_anim.py -- --chars wolf,swordsman,hero --out pipeline/baked_sprites/chars --scale 0.5 --samples 16

# 导出到客户端开发台（增量合并，同 id 覆盖）
/Applications/Blender.app/Contents/Resources/5.3/python/bin/python3.13 pipeline/atlas/export_sprites.py --sprites pipeline/baked_sprites --out client/assets/dev --merge
python3 pipeline/atlas/export_chars.py --anims pipeline/baked_sprites/chars --out client/assets/dev/chars

# 客户端开发台：可玩演示 /play.html（?auto=1 AI 自动玩、?speed=4、?seed=、?rich=1）、精灵图鉴 /gallery.html
npm --prefix client run dev

# 场景预览：按锚点摆到 2:1 地块网格上看整体效果
/Applications/Blender.app/Contents/Resources/5.3/python/bin/python3.13 pipeline/style/compose_preview.py \
  --sprites pipeline/baked_sprites --out preview --grid 7x6 \
  --place house_lv2_tile:1,2 --place tower_bamboo:5,4 --place prop_pine_tree:5,1

# 单元测试（Blender 自带 Python 含 numpy；系统 Python 会跳过需要 numpy 的用例）
/Applications/Blender.app/Contents/Resources/5.3/python/bin/python3.13 -m unittest discover -s pipeline/tests
```
