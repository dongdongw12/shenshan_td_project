# 《深山传家：开荒守寨》跨设备 / 跨模型交接文档（HANDOFF）

> **用途**：供 **Claude Opus** 与 **Antigravity** 在不同电脑（MacBook Air / Mac mini 等）上无缝接手本项目。每次开工前**先读完本文件**，收工前更新底部「交接日志」并 `git push`。  
> **最后更新**：2026-11-22（T2 代码 + 工笔风格化管线 v2 完成，待 Colab 实跑）

---

## 1. 30 秒项目速览

- **项目定位**：中国古代深山开荒 + 家族养成 + 昼夜塔防 **微信小游戏**（纯 IAA 激励视频变现，无需版号）。
- **核心卖点**：贫困农夫流落深山 → 白天开荒建房、种地、捕鱼、打猎卖给货郎攒铜钱 → 攒够聘礼修青瓦正房**娶妻**（解锁自动收成 + 夜间熬汤回血）→ 建厢房**生子**（2–3 昼夜长成少年）→ 派族人**驻守箭楼/城墙触发羁绊** → 扩建青砖大院与祠堂，抵御饿狼、野猪、黑熊与黑风寨土匪。
- **已锁定技术路线（路线 B）**：**Colab GPU 生成 3D 古建 `.glb` → Blender 5.x 归一化 + 2:1 等距固定比例烘培渲染通道 → 工笔风格化后处理 → 输出 `_day.png` / `_night.png` / `_shadow.png` / `_meta.json` 进 2.5D 客户端**（稳跑微信小游戏 60 帧，零 3D 机型兼容坑）。本机与 Colab 统一 **Blender 5.3.0**（脚本兼容 5.0.x）。
- **当前阶段**：**Phase 0 已完成**（策划案、前 3 天可玩原型、正式仓库骨架、24 件资产清单、Blender/Colab 双光影烘培管线均已就绪），下一步进入 **Phase 1（第 1 周 3 件样张 3D 生成与烘培验收）**。

---

## 2. 已锁定的设计决策（接手模型不可擅自推翻）

1. **画风规范**：**明清木刻版画粗墨线 + 矿物重彩工笔**。详见 `docs/art/ART_BIBLE.md`，参数唯一来源 `pipeline/style/style_profile.json`（外轮廓 4.5px 书法笔触、内线 1.6px、墨色 `#1c1510`、16 色矿物色板、3 阶色阶光影、暗部石青冷调、128 px/m 统一比例）。白昼青绿山林、赭石土地、朱砂屋檐；入夜压成深靛蓝衬托门窗与火把暖橙光。**禁止**做成灰蒙蒙、低对比的淡彩水墨；**禁止**单件私调画风。
2. **塔防 × 家族强耦合**：空塔楼仅发挥基础战力；**子女/族人驻守塔楼**后按白天分工触发专属羁绊（打猎子女进箭楼变神射手破甲、伐木子女驻城墙自动修墙等），让“攒钱娶妻生子”直接转化为塔防爽感。
3. **10 天主线节奏**：第 1–3 夜纯野兽（饿狼、野猪、第 3 夜黑熊王 Boss）建立安全感并完成“娶妻”里程碑；第 4 夜起土匪登场（斥候、刀匪、盾牌匪、纵火贼）；第 7 夜黑风二当家、第 10 夜黑风大当家总攻，通关解锁无尽模式。
4. **商业化与过审**：纯 IAA（激励视频包装为“富商货郎进山”“双喜临门”“绝境死守”“风调雨顺”），单局轻松超 3 分钟以吃满微信小游戏视频号加热金激励；娶妻生子用温馨传统民俗风（红灯笼、喜字、摇篮），敌人击败用“冒烟逃跑”而非血腥表现。

---

## 3. 现有文件清点（截至 2026-11-22）

### A. 正式工程骨架（独立仓库根目录 `~/Projects/shenshan_td_project/`）
| 文件 | 状态 | 说明 |
|---|---|---|
| `README.md` | 已完成 | 目录规划、路线 B 工作流与本机/Colab 命令 |
| `assets_manifest.json` | 已完成 | 24 件 3D 建筑/道具清单（真实高度、占地格数、夜灯强度、角度） |
| `pipeline/blender/bake_isometric_sprites.py` | **v2，Blender 5.3 本机实跑通过** | stylized（默认）：固定 128px/m、底座适配占地、×2 超采样、多层 EXR 通道 + 自动风格化；classic：v1 行为仅作对比 |
| `pipeline/colab/colab_bake_sprites.ipynb` | 已通过 JSON 校验 | 对齐 Blender 5.0.1 的 Colab GPU 批量烘培笔记本（跑完自动 `runtime.unassign()`）；T2 起自动从 GitHub 同步脚本，`TEST_SINGLE` 试烘输出到 `_preview/` |
| `pipeline/colab/colab_gen_3d.ipynb` | T2 新增，单元格已过语法检查，**尚未在 Colab 实跑** | 概念图（外部或 HunyuanDiT 自动）→ Hunyuan3D-2 白模 → 减面 → 贴图 → 墙面转正 → `.glb` → 512px 试烘培预览 |
| `pipeline/colab/gen_3d_jobs.json` | T2 新增 | 每件资产的概念图提示词（中/英/≤60 字短版）+ 图生 3D 参数 |
| `pipeline/colab/gen3d_utils.py` + `pipeline/tests/` | T2 新增，12 项单测通过 | 墙面朝向对齐 + 风格化算子单测（用 Blender 自带 Python 跑） |
| `pipeline/style/style_profile.json` | T2 新增 | 画风参数唯一来源 |
| `pipeline/style/stylize_sprites.py` | T2 新增，本机已用替身模型实跑 | 明清木刻 + 矿物重彩工笔风格化（可脱离渲染单独重跑） |
| `pipeline/style/compose_preview.py` | T2 新增 | 按锚点把精灵摆到 2:1 地块网格出场景预览（美术验收 / 锚点检查） |
| `pipeline/blender/make_proxy_assets.py` | T2 新增 | 3 件样张的程序化替身模型（本机回归测试画风；图生 3D 失败时的低模起点） |
| `docs/art/ART_BIBLE.md` + `docs/art/samples/` | T2 新增 | 美术圣经与效果样张（替身模型 昼/夜 场景、v1 classic vs v2 stylized 对比） |
| `docs/art/T2_concept_prompts.md` | T2 新增 | 出图规范（为什么不画描边）、复制即用提示词、样张验收清单 |
| `.gitignore` | 已完成 | 忽略 `.glb`/`.blend`/`.hdr`/烘培散图/构建产物，防止污染 Git |

### B. 玩法验证原型（已归档至 `docs/prototype_v0/`）
- 独立 HTML5 Canvas 竖屏原型，双击 `docs/prototype_v0/index.html` 可直接在浏览器玩完前 3 天（开荒种田/捕鱼/打猎 → 攒 200 铜钱 + 40 木修青瓦正房娶发妻“阿莲” → 守住饿狼、野猪、黑熊王 3 夜，含模拟 IAA 与 Web Audio 音效）。
- 正式版开发时可直接参考 `docs/prototype_v0/src/config.js` 里的初版数值节奏。

---

## 4. 跨电脑 & 跨模型协同规范

### 文件同步边界
- **GitHub 仓库（代码、配置、文档、小体积脚本）**：`https://github.com/dongdongw12/shenshan_td_project.git`（主分支 `main`）。每台电脑开工前必跑 `git pull`，收工前必跑 `git add/commit/push` 并更新本文件底部日志。
- **Google Drive（大体积 3D 资产与烘培图）**：统一存放在 `Google Drive/MyDrive/shenshan_td/`（[云盘目录链接](https://drive.google.com/drive/folders/1eoE7aVdFmsn79JN-U3fkxy1DiwpEbhe8)）：
  - `raw_models/`：Colab 生成的原始 `.glb`（命名必须严格对应 `assets_manifest.json` 的 `id`）
  - `baked_sprites/`：Blender 烘培出的 `_day.png`、`_night.png`、`_meta.json`
  - 根目录已同步：`assets_manifest.json`、`bake_isometric_sprites.py`、`colab_bake_sprites.ipynb`（已按 Colab 笔记本 MIME 类型上传，可在 Drive 直接用 Colab 打开）
  - **原则**：`.glb`、`.blend` 和烘培散图绝不提交进 Git；只有压缩打包进客户端的最终图集（`client/assets/atlases/`）才入仓。

### Claude Opus 与 Antigravity 推荐分工
- **Claude Opus 优先负责**：系统架构设计、30 天数值平衡表、复杂核心逻辑（家族家谱、驻守羁绊、寻路/波次引擎）、Colab/Blender 自动化脚本与代码审查。
- **Antigravity 优先负责**：客户端 2.5D 渲染与交互落地、浏览器/微信开发者工具真机调试、UI 动效与打击感抛光、图集打包与微信小游戏适配。

### 控上下文与省 Token 铁律
- **单会话只做 1 个清晰子任务**，上下文尽量控制在 **20 万 Token 以内**，做完立即写进交接日志开新会话。
- 不要在没有需求时全量读取大目录或把原型整份粘贴进对话；按模块只读相关文件。
- **先出样张再量产**：所有 3D 生成和 Blender 烘培必须先跑 1–3 个样本验收画风、粗墨线宽度与夜灯强度，用户确认后再跑全量 24 件。

---

## 5. 下一步任务队列（Next Actions — 按顺序认领）

- [x] **T1 · 独立建仓与环境同步**
  - [x] 将 `shenshan_td_project/` 移至 `~/Projects/shenshan_td_project/`，将 `mountain_td_mvp/` 归档到 `docs/prototype_v0/`，并初始化本地独立 Git 仓库（`main` 分支）
  - [x] 在 Google Drive 创建 `MyDrive/shenshan_td/raw_models/` 与 `baked_sprites/`，上传 `assets_manifest.json`、`bake_isometric_sprites.py` 与 `colab_bake_sprites.ipynb`
  - [x] 绑定 GitHub 远程仓库 `https://github.com/dongdongw12/shenshan_td_project.git` 并推送 `main` 分支
- [ ] **T2 · 编写 Colab 图生 3D 笔记本 + 第 1 周视觉样张（3 件）**
  - 准备统一“明清木刻粗墨线重彩”概念图提示词，先做 3 件核心样张：`house_lv2_tile`（青瓦正房）、`tower_bamboo`（竹箭楼）、`prop_pine_tree`（深山古松）。
  - [x] 提示词：`pipeline/colab/gen_3d_jobs.json` + `docs/art/T2_concept_prompts.md`（概念图**不画黑描边**，墨线统一由 Freestyle 生成）
  - [x] `pipeline/colab/colab_gen_3d.ipynb`（选定 **Hunyuan3D-2**，固定 commit `f8db630`；TRELLIS 在 Colab 依赖编译太脆弱，暂不接入）
  - [x] 修烘培脚本：相机俯角 35.264°→**30°**（原设置出的是 1.73:1 菱形，不是 2:1）；命令行 `--res/--samples` 现在优先于 manifest（原来试烘参数被 manifest 覆盖）；地面不再被描边；`_meta.json` 增加 `px_per_meter` / `tile_px_per_meter`
  - [x] **画面精细化（工笔风格化管线 v2）**：美术圣经 + `style_profile.json`；烘培改为固定比例 + 渲染通道；新增 `stylize_sprites.py`（平涂、归色、色阶、内线、分染、夜灯晕、独立地影层）；用 3 件程序化替身在本机 Blender 5.3 实跑并迭代 5 轮，样张见 `docs/art/samples/`
  - [~] **Colab 首跑（2026-11-23）**：T4（L4 不可用）上安装、custom_rasterizer 编译、HunyuanDiT 概念图都通过；加载形状模型时系统内存（12.7GB）OOM 崩溃重启，随后浏览器 Google 账号被登出，未能继续。已修：概念图改独立子进程、只下载实际加载的 fp16 权重（43GB→16GB）、权重缓存到云盘、启动时检查内存；新增 Qwen-Image 概念图选项
  - [ ] **用户在 Colab（A100 或 L4 + 勾选「高 RAM」）重跑 `colab_gen_3d.ipynb`**，看第 ⑦⑧ 格体检图与 `baked_sprites/_preview/`，按验收清单确认 3 件样张；不达标按清单末尾的调整顺序迭代
  - [ ] 样张通过后：把其余 21 件补进 `gen_3d_jobs.json`，批量生成 + `colab_bake_sprites.ipynb` 正式 768px 烘培
- [~] **T3 · 搭建 `client/` 2.5D 等距昼夜渲染底座**（2026-11-23 核心已完成，见 `client/README.md`）
  - [x] 先做**引擎无关**的 TypeScript 核心（`client/src/render/`）：2:1 投影（与烘培相机一致）、多格建筑 + 单位的拓扑遮挡排序、昼夜时钟 + 逐户点灯、精灵元数据校验、Canvas2D 渲染器（地影单独一层）；平台层分浏览器 / 微信小游戏；Vite 开发台 + 19 项 Vitest 单测
  - [x] `pipeline/atlas/export_sprites.py`：母版精灵按统一倍率导出 + `sprites.json` 索引（开发台用 0.5× = 64 px/m）
  - [ ] 最终引擎二选一（直接微信小游戏 Canvas / Cocos Creator 3.8+）——核心两边都能用，建议等 T4 玩法规模明确再定
  - [ ] 微信开发者工具真机跑通 `src/platform/wechat.ts`、触屏手势、正式图集打包（TexturePacker / Cocos 自动图集）
  - 确定客户端框架（推荐 **Cocos Creator 3.8+ TypeScript** 一键导微信小游戏，或轻量 TypeScript Canvas 过渡）。
  - 实现读取 `_meta.json` 脚点锚点、Y-Sort 遮挡排序、以及 `_day.png` / `_night.png` 透明度平滑切换。
  - 精灵约定（v2）：全部 **128 px/m** 同一比例（无需逐张缩放，打图集时统一乘 0.5–0.75）；1 格 = 2m，菱形 362×181px；按 `_meta.json.anchor_px` 对齐占地中心；**先画全部 `_shadow.png` 地影层，再按锚点 Y 排序画物体**；入夜夜晚图透明度 0→1、地影 ×`night_shadow_opacity`(0.6)；建筑正面朝画面左下，朝右下用水平镜像；宣纸纹理在客户端全屏叠加，不进精灵。
- [ ] **T4 · 扩充 10 天核心玩法（生子 + 族人驻守 + 土匪波次）**
  - 在 `client/assets/configs/` 落地完整 JSON 配置表，实现厢房建房、添丁成长、族人入驻塔楼羁绊、刀匪/盾牌匪/纵火贼/二当家与大当家 Boss。
- [ ] **T5 · 资质与软著并行启动**
  - 确定最终上架游戏名后，尽早同步办理软件著作权、微信小程序备案与微信小游戏 IAA 备案（审核约 10–30 个工作日）。

---

## 6. 新电脑 3 分钟开工自检

1. 确认已拉取最新代码：`git pull` 并阅读本文件「交接日志」最新一条。
2. 若需本机测试 Blender 烘培：确认已装 Blender 5.0.1（`blender --version`），且 Google Drive 桌面端或手动同步已拿到 `raw_models/` 样本。
3. 若需跑 Colab：浏览器打开 `pipeline/colab/` 对应 `.ipynb`，选 GPU 运行时（无需 High-RAM），跑完确认最后一格释放运行时。
4. 若需调试小游戏客户端：确认已装 Node 24 与微信开发者工具（或 Cocos Creator 3.8+）。

---

## 7. 交接日志（每次换设备 / 换模型追加）

### 2026-11-22 · Gemini（本机初始化）
- **已完成**：敲定《深山传家：开荒守寨》1 页纸策划案（含 4 阶段家族成长、驻守羁绊、10 天波次、IAA 埋点）；建成前 3 天浏览器可玩原型（`mountain_td_mvp/`）；建成路线 B 独立项目骨架（`shenshan_td_project/`），含 24 件 `assets_manifest.json`、Blender 粗墨线双光影烘培脚本与 Colab 笔记本（均已通过语法校验）。
- **未完成 / 下一棒**：请接手方直接从 **T1（独立建仓）** 或 **T2（3 件核心样张概念图 + Colab 图生 3D 笔记本）** 开始。

### 2026-11-22 · Antigravity（完成 T1 独立建仓与云端同步）
- **已完成**：
  - 将工程从 `RemotionVideo/` 迁出至独立目录 `~/Projects/shenshan_td_project/`，并将前 3 天原型归档至 `docs/prototype_v0/`；同步更新 `.gitignore`（补充忽略 `pipeline/baked_sprites/` 散图并保留 `.gitkeep`）、`README.md` 与 `HANDOFF.md`。
  - 在 Google Drive 建好 `MyDrive/shenshan_td/`（`raw_models/`、`baked_sprites/`）并上传 `assets_manifest.json`、`bake_isometric_sprites.py`、`colab_bake_sprites.ipynb`（Colab 类型）。
  - 初始化独立 Git 仓库并推送至 `https://github.com/dongdongw12/shenshan_td_project.git`（`main` 分支）。
- **未完成 / 下一棒**：**T1 已全部完成**。请接手方直接从 **T2（3 件核心样张概念图提示词 + `pipeline/colab/colab_gen_3d.ipynb` + 首批 `.glb` 生成与单件试烘培验收）** 开始。

### 2026-11-22 · Claude Opus（T2 代码部分完成，待 Colab 实跑验收）
- **可行性结论**：路线 B 可行。主要风险与对策：① 图生 3D 对细杆件（竹箭楼）和翘角屋檐容易糊 → 每件 4 个概念图候选 + 换种子，箭楼不行就改 Blender 程序化低模；② AI 网格直接上 Freestyle 会线条杂乱、渲染慢 → 先减面到 40k；③ AI 模型朝向随机斜 → 自动最小外接矩形转正；④ 许可：Hunyuan3D-2 社区许可在中国大陆可商用，游戏只分发烘培 PNG。另：“纯 IAA 无需版号”属于政策判断，T5 前需按微信官方最新规则核实。
- **已完成**：`gen_3d_jobs.json`（3 件样张提示词 + 参数）、`docs/art/T2_concept_prompts.md`、`colab_gen_3d.ipynb`（10 格，含 HunyuanDiT 自动概念图、custom_rasterizer 编译缓存到云盘、试烘培预览）、`gen3d_utils.py` + 单测；烘培脚本 2:1 相机修正、参数优先级修正、地面去描边、meta 增加比例字段；两个笔记本都会从 GitHub 公开仓库自动同步脚本到云盘。
- **未验证**：笔记本没有在 Colab GPU 上实跑过（本机无 GPU / Blender）。首次运行最可能出问题的是 ③ 安装格（依赖版本、nvcc 编译），报错贴回即可修。
- **下一棒**：用户先 `git pull` 确认 GitHub 上是最新版，然后在 Colab 跑 `colab_gen_3d.ipynb` → 按 `docs/art/T2_concept_prompts.md` 第 4 节验收 3 件样张。通过后再开 T3。

### 2026-11-22 · Claude Opus（画面精细化：工笔风格化管线 v2）
- **起因**：用户要求画面尽可能精细。v1 是 Cycles 写实光照 + Freestyle 描边，本质是“带描边的 3D 渲染图”，不是木刻/工笔；且主光与相机同向（顺光，没体积感）、各精灵比例不一（墨线粗细在游戏里会不一致）、阴影烘在精灵里（近处影子会盖到远处建筑）。
- **已完成**：
  - `docs/art/ART_BIBLE.md` + `pipeline/style/style_profile.json`：比例镜头、光源、16 色矿物色板、墨线层级、色阶、夜晚、地影全部参数化。
  - 烘培脚本 v2：固定 128 px/m、底座（底部 25% 高度）适配占地格、×2 超采样、哑光材质、左前方主光、Freestyle 书法笔触外轮廓（修正了 ABSOLUTE 模式全局粗细是“倍率”的坑）、多层 EXR 通道（Blender 5.x 写成多 part，读取需逐 part）。
  - `stylize_sprites.py`：颜色外扩 → Kuwahara 平涂 → Lab 软吸附色板 → 光照/固有色比值做 3 阶色阶（暗部石青冷调）→ 法线/深度内线（去噪点）→ 分染 → 墨色外轮廓 → 夜靛 + 暖灯 + 灯晕 → 独立地影层 → Lanczos 缩回。
  - `make_proxy_assets.py`（3 件替身）、`compose_preview.py`（场景预览）、风格化算子单测；两个 Colab 笔记本同步风格文件、改用 `--scale` 预览、Blender 版本统一 5.3.0，烘培笔记本支持 `RESTYLE_ONLY`。
- **已验证**：本机 Blender 5.3.0（Metal）全链路实跑，3 件替身昼/夜/地影出图，场景预览中比例与锚点对齐；12 项单测通过。单件渲染 25–110s（首次运行 Metal 编译内核约 5 分钟），风格化 20–35s。
- **未验证**：Colab 上的 Blender 5.3 Linux 版是否自带 OpenImageIO（笔记本已做自动回退到 Colab Python + OpenEXR）；真实 AI 模型（贴图斑驳、网格噪声）下内线去噪与平涂力度是否合适——需要 T2 Colab 实跑后用真实 `.glb` 再调 `style_profile.json`。
- **下一棒**：先 push，再在 Colab 跑 `colab_gen_3d.ipynb`，用真实模型按 `docs/art/T2_concept_prompts.md` 第 4 节验收；调画风只改 profile，用 `stylize_sprites.py` 单独重跑即可，不必重新渲染。

### 2026-11-23 · Claude Opus（T2 Colab 首跑 + 稳定性修复，夜间自主工作）
- **首跑结果**（T4 14.6GB / 系统内存 12.7GB / torch 2.14 + CUDA 13）：同步脚本、安装、custom_rasterizer 编译（wheel 已缓存到云盘 `_cache/hy3d_wheels/`）、HunyuanDiT 12 张概念候选（已存到云盘 `concepts/`）全部成功；进入形状生成后加载 4.9GB 模型时**系统内存 OOM，运行时崩溃重启**，之后内置浏览器里的 Google 账号被登出（需用户重新登录），本轮未产出 `.glb`。
- **概念图质量**：HunyuanDiT 把竹箭楼画成宝塔、正房画成红墙庙宇、全是正面视角 → 不能作正式美术。
- **修复（已推送）**：`t2i_concepts.py` 独立进程出图（退出即释放内存）；`T2I_MODEL=auto` 在 A100/L4 上用 Qwen-Image（Apache-2.0、无需登录、4bit 量化），T4 退回 HunyuanDiT；Hunyuan3D 只预下载 fp16 safetensors（形状目录原有 5 份同模型共 24.6GB，贴图 UNet 跳过 7.3GB .bin）；`HF_HOME` / `HY3DGEN_MODELS` 默认缓存到云盘（用户有 20TB）；启动时检测系统内存 < 20GB 给出“开高 RAM”提示。
- **注意**：本机是 M1 MacBook Air 8GB，重活（全尺寸烘培、所有模型推理）一律放 Colab；本机只做代码、单测和半比例小样检查。
- **下一棒**：用户登录 Colab 后，运行时类型选 A100（或 L4）并勾选高 RAM，`REGEN_CONCEPTS = ["house_lv2_tile", "tower_bamboo", "prop_pine_tree"]` 用 Qwen-Image 重出概念图，然后全部运行。

### 2026-11-23 · Claude Opus（T3 渲染底座核心，夜间自主工作）
- **背景**：Colab 账号被登出无法继续 T2，转做不依赖 GPU、本机（M1 8GB）也跑得动的 T3。
- **已完成**：`client/`（TypeScript 5.9 + Vite 6 + Vitest 3）引擎无关渲染核心：
  - `iso.ts` 投影与烘培相机逐项对齐（单测验证菱形 362.04×181.02 = meta.tile_px）；
  - `depthSort.ts` 用“整体更靠 +X 或整体更靠 −Y 即在前 + 屏幕投影重叠才比较 + 拓扑排序”，解决简单 y 排序在长墙/多格建筑旁的错误（单测里有两个反例）；
  - `dayNight.ts` 昼夜周期 + 每栋建筑按 id 哈希错开点灯（黄昏逐户亮、黎明逐户灭），支持 setPhase 供 T4 波次驱动；
  - `renderer.ts` 天色 → 地块 → 全部地影 → 物体（白昼图 + 夜晚图淡入），只用小游戏也支持的 Canvas2D 子集；
  - `platform/wechat.ts` 小游戏适配接口（未真机验证）。
- **已验证**：19 项单测 + 类型检查 + 构建（核心 14.7KB JS）；浏览器开发台中锚点对齐格子、地影层、树/房遮挡、村民走到房后被挡住只露斗笠、黄昏逐户点灯；每帧绘制约 0.45ms（11 物体）。
- **未验证**：微信真机、触屏、几百单位压力、正式图集。
- **下一棒**：T2 仍需用户登录 Colab 重跑（见上一条）；T3 剩余项交给客户端落地方（真机 / 图集 / 引擎选型）；T4 可以直接基于 `Scene` + `DayNightClock.setPhase` 接波次。
