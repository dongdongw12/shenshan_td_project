# 《深山传家：开荒守寨》跨设备 / 跨模型交接文档（HANDOFF）

> **用途**：供 **Claude Opus** 与 **Antigravity** 在不同电脑（MacBook Air / Mac mini 等）上无缝接手本项目。每次开工前**先读完本文件**，收工前更新底部「交接日志」并 `git push`。  
> **文档同步（2026-11-24 起）**：`HANDOFF.md` 与 `docs/` 同时放在 Git 和 Google 云端硬盘 `shenshan_td/docs/`（Colab 用的那个 20TB 账号），任何电脑都能直接在云盘里改。开工 `git pull` 之后、提交文档之前各跑一次 `python3 tools/sync_docs.py`（双向：哪边改了拷到另一边；两边都改了会留一份 `*.drive-conflict-*` 让你合并，exit 2）。样张 `docs/art/samples/` 只在云盘，不进 Git（同步脚本拉到本地）。  
> **最后更新**：2026-11-23 凌晨（第二夜自主工作：24 件资产全部有烘培替身、家人干活动作、战斗与氛围特效、精灵图鉴；T2 的 AI 图生 3D 已跑通 3 件样张，待决定量产）

---

## 1. 30 秒项目速览

- **项目定位**：中国古代深山开荒 + 家族养成 + 昼夜塔防 **微信小游戏**（纯 IAA 激励视频变现，无需版号）。
- **核心卖点**：贫困农夫流落深山 → 白天开荒建房、种地、捕鱼、打猎卖给货郎攒铜钱 → 攒够聘礼修青瓦正房**娶妻**（解锁自动收成 + 夜间熬汤回血）→ 建厢房**生子**（2–3 昼夜长成少年）→ 派族人**驻守箭楼/城墙触发羁绊** → 扩建青砖大院与祠堂，抵御饿狼、野猪、黑熊与黑风寨土匪。
- **已锁定技术路线（路线 B）**：**Colab GPU 生成 3D 古建 `.glb` → Blender 5.x 归一化 + 2:1 等距固定比例烘培渲染通道 → 工笔风格化后处理 → 输出 `_day.png` / `_night.png` / `_shadow.png` / `_meta.json` 进 2.5D 客户端**（稳跑微信小游戏 60 帧，零 3D 机型兼容坑）。本机与 Colab 统一 **Blender 5.3.0**（脚本兼容 5.0.x）。
- **当前阶段（2026-11-23 早）**：
  - ✅ 工笔风格化烘培管线 v2（建筑 + 角色序列帧），本机用程序化替身全链路验证。**manifest 24 件资产全部已有烘培精灵**：5 件正式程序化 + 19 件程序化替身（过渡美术，也是图生 3D 失败时的兜底；AI 版出图后同 id 覆盖）。12 个角色（9 敌 + 3 家人）有行走 / 攻击，家人另有干活。
  - ✅ 客户端：引擎无关 TS 渲染底座（2:1 投影、遮挡排序、昼夜逐户点灯、画风化地面与青绿山石）+ 玩法核心模拟（10 夜、家族羁绊、货郎、IAA 埋点）+ 竖屏可玩演示 `client/play.html`。
  - ⏳ **卡点：T2 的 Colab 图生 3D 还没跑通**（首跑在 T4 上内存不足崩溃，已修；随后浏览器里的 Google 账号被登出）。用户登录 Colab 后按 T2 重跑即可。
  - 一眼看效果：`docs/art/samples/`（`demo_*.jpg` 是可玩演示截图，`proxy_*` 是替身，`characters_*.png` 是角色序列帧，`gallery_v1.jpg` 是精灵图鉴）；或本机 `npm --prefix client run dev` 打开 `/play.html?auto=1`（AI 自动玩）和 `/gallery.html`（精灵图鉴）。

---

## 2. 已锁定的设计决策（接手模型不可擅自推翻）

1. **画风规范**：**明清木刻版画粗墨线 + 古旧绢本设色**（2026-11-23 用户选定 v2：在矿物重彩工笔基础上整体做旧，更像中国画、更有历史感；v1 青绿重彩参数存档于 `pipeline/style/variants/`）。详见 `docs/art/ART_BIBLE.md`，参数唯一来源 `pipeline/style/style_profile.json`（外轮廓 4.5px 书法笔触、内线 1.6px、赭褐旧墨 `#2a1d13`、16 色古旧矿物色板 + 全局绢色调色、3 阶色阶光影、暗部灰靛冷调、128 px/m 统一比例）。白昼旧绢底上的褪色青绿山林、赭石土地、砖红朱砂屋檐；入夜压成深靛蓝衬托门窗与火把暖橙光。**禁止**做成灰蒙蒙、低对比的淡彩水墨；**禁止**单件私调画风。
2. **塔防 × 家族强耦合**：空塔楼仅发挥基础战力；**子女/族人驻守塔楼**后按白天分工触发专属羁绊（打猎子女进箭楼变神射手破甲、伐木子女驻城墙自动修墙等），让“攒钱娶妻生子”直接转化为塔防爽感。
3. **10 天主线节奏**：第 1–3 夜纯野兽（饿狼、野猪、第 3 夜黑熊王 Boss）建立安全感并完成“娶妻”里程碑；第 4 夜起土匪登场（斥候、刀匪、盾牌匪、纵火贼）；第 7 夜黑风二当家、第 10 夜黑风大当家总攻，通关解锁无尽模式。
4. **商业化与过审**：纯 IAA（激励视频包装为“富商货郎进山”“双喜临门”“绝境死守”“风调雨顺”），单局轻松超 3 分钟以吃满微信小游戏视频号加热金激励；娶妻生子用温馨传统民俗风（红灯笼、喜字、摇篮），敌人击败用“冒烟逃跑”而非血腥表现。

---

## 3. 现有文件清点（截至 2026-11-22；之后新增的见各条交接日志与 README 目录）

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
- [~] **T4 · 扩充 10 天核心玩法（生子 + 族人驻守 + 土匪波次）**（2026-11-23 核心模拟 v1 完成，见 `docs/design/T4_core_systems.md`、`docs/design/balance_v1.md`）
  - [x] 引擎无关确定性模拟 `client/src/game/`：昼夜循环、自动生产、建造/升级/修补、流场寻路（障碍=高代价，可绕可砍）、塔/投射物/溅射/灼烧/眩晕/陷阱、当家的补刀、阿莲回血、娶妻/厢房添丁/按分工长成身份/四种驻守羁绊、10 夜波次（熊王/二当家/大当家）+ 无尽
  - [x] 数值 JSON（`client/assets/configs/`）+ 平衡 AI + 自动调难度；3 个种子都能通关，中后期主屋 30–90%
  - [x] 竖屏可玩演示 `client/play.html`：玩法核心接进渲染底座，程序化墨线占位 + HUD + 建造栏 + 点地块放置；地图改为竖屏谷地；敌人沿土路走
  - [x] 货郎进山（粮木消耗口）+ IAA 四个埋点的模拟层（`adOffers` / `adReward`），演示可点；难度按不看广告重调
  - [ ] 正式 UI、接 `wx.createRewardedVideoAd`、可操控英雄、家族面板
  - 在 `client/assets/configs/` 落地完整 JSON 配置表，实现厢房建房、添丁成长、族人入驻塔楼羁绊、刀匪/盾牌匪/纵火贼/二当家与大当家 Boss。
- [ ] **T6 · 下一步建议（按优先级，2026-11-23 整理）**
  1. ~~AI 资产量产 + v2 正式烘培 + 导出~~（2026-11-23 晚完成；鱼梁 2026-11-24 重出完成，见交接日志）。
  2. **客户端落地方**：选定引擎（直接小游戏 Canvas / Cocos），把 `client/src/render` + `client/src/game` 接进去；真机验证 `wechat.ts`、触屏、图集、接 `wx.createRewardedVideoAd` 到 `adReward`。
  3. **用户（可选，不依赖 T2）**：登录 Colab 后直接跑 `colab_bake_sprites.ipynb`（`TEST_SINGLE=""`、`SCALE=1.0`、`SAMPLES=48`，`PROXY_FALLBACK` 默认开），就能拿到正式比例（128px/m）的全套替身 + 12 个角色。
  4. **Claude**：遮挡排序的空间分桶优化（现 250 物体 0.84ms/帧）、正式 UI 美术、T6 平衡（祠堂 / 滚木塔在 10 夜内很少出现，见 2026-11-23 凌晨日志）。已完成：家族面板（手动分工 / 驻守）、受击闪白 / 逃跑、家人干活、着火 / 血条 / 夜灯 / 炊烟 / 萤火、HUD 图标与缩略图。
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
- **追加（地面画风）**：`groundPainter.ts` 按地形图把地面一次性画成木刻重彩风格的离屏贴图（白昼 / 夜晚两张交叉淡入，地图外透明避免接缝），加屏幕固定的宣纸纹理（夜里自动减淡）；效果图 `docs/art/samples/client_village_{day,dusk,night}.jpg`。
- **下一棒**：T2 仍需用户登录 Colab 重跑（见上一条）；T3 剩余项交给客户端落地方（真机 / 图集 / 引擎选型）；T4 可以直接基于 `Scene` + `DayNightClock.setPhase` 接波次。

### 2026-11-23 · Claude Opus（T4 玩法核心模拟 v1，夜间自主工作）
- **已完成**：`client/src/game/`（config / rng / flowField / sim / bot）+ `client/assets/configs/` 六个 JSON + 平衡脚本（balance / tune / income）+ 17 项玩法单测（共 38 项）。前 3 夜数值沿用原型并换算到米/秒；第 4–10 夜土匪与两个 Boss 为新增。
- **平衡过程**（记录在案，便于以后复盘）：① 首跑第 2 夜必败 → 补上原型里的“当家的补刀”（约 34 DPS），AI 改为白天边攒边建；② 改完反而太简单（攒到 1.4 万钱）→ 原型产出是按手动收割设计的，自动化后下调约 2/3；③ AI 改成贪心花钱后堆到 50 座塔 → 击退赏钱减半、加“塔越多越贵 +8%/座”；④ 发现并修复寻路 bug（`nextStep` 没算进入代价，敌人会去砍本可绕开的篱笆）；⑤ 用 `tune.ts` 逐夜二分 `hpMul` 对准目标曲线。
- **结果**：3/3 种子通关；第 3 夜熊王 51–60%，第 7 夜二当家 31–51%，第 10 夜 0–69%（波动大，已列入已知问题）。
- **已知问题**：粮/木大量结余（缺“货郎”消耗口）；第 10 夜波动大；英雄是简化版；未接 UI 与 IAA。
- **下一棒**：把 `sim.ts` 接进渲染台做可玩的竖屏 Demo（或交客户端落地方）；做货郎后重跑 `npm --prefix client run tune -- --write`。

### 2026-11-23 · Claude Opus（竖屏可玩演示，夜间自主工作）
- **已完成**：`client/play.html` + `src/demo/`：T4 模拟驱动 T3 渲染（白昼/夜晚随阶段平滑切换），烘培替身精灵（喜房、竹箭楼、古松）+ `inkDraw.ts` 程序化墨线占位（茅屋/厢房/猎棚/粮仓/祠堂/火油塔/滚木塔、篱笆/青砖墙、稻田/鱼梁/捕兽夹贴地、狼/野猪/熊王/四种土匪/两个当家、箭矢、冒烟逃跑、赏钱飘字）；HUD（天数、资源、主屋血条）、建造栏（实时价格）、点地块放置（绿/红预览 + 射程圈）、选中建筑升级、事件提示；`?auto=1` AI 自动玩。截图：`docs/art/samples/demo_day3.jpg`、`demo_night6.jpg`。
- **顺带修正**：地图改成竖屏谷地（沿网格反对角线，屏幕上竖着），镜头只框谷地；山道代价 0.75 让敌人沿路走；底栏按钮改为只创建一次（原来每 0.25 秒重建，会吞掉点击）；单测改用独立测试地图；`tune.ts` 用 5 个种子，重新调了 10 夜难度。
- **未验证**：真机触屏、微信小游戏；内置浏览器后台标签页会降帧到约 2fps，演示里只能用 `?auto=1` 的大步长观察。

### 2026-11-23 · Claude Opus（24 件资产量产准备，夜间自主工作）
- **已完成**：`gen_3d_jobs.json` 补齐全部 24 件（19 件 `method: ai` 带中/英提示词，5 件 `method: procedural`）；`make_proxy_assets.py` 新增 5 件正式程序化资产（稻田青苗/金穗、尖木篱笆、青砖墙、捕兽夹），本机半比例试烘通过（稻田第一版像“尖刺地毯”，已改成细叶稻丛 + 露出田水）；篱笆/青砖墙占地改为 1×1（与玩法一致），青砖墙高 2.8→2.4m；烘培笔记本会自动生成缺失的程序化资产，图生 3D 笔记本自动跳过它们；`export_sprites.py --merge`；演示里稻田/篱笆/墙/陷阱改用烘培精灵（墙按相邻方向选 0°/90°）。
- **下一棒**：Colab 登录后，按 T2 跑 3 件样张 → 用户验收 → `ASSET_IDS = []` 量产其余 AI 资产 → `colab_bake_sprites.ipynb` 正式烘培全部 24 件 → `export_sprites.py` 导出到客户端。

### 2026-11-23 · Claude Opus（货郎 + IAA 埋点）
- **已完成**：`economy.json` 加 `peddler` 与 `ads`；`sim.ts` 加 `sellToPeddler`、`adOffers`、`adReward`（风调雨顺 / 富商货郎 / 双喜临门 / 绝境死守，含每天/每夜次数限制）；平衡 AI 会把结余卖给货郎（不看广告）；重新 `tune.ts`，3/3 通关；新增 4 项单测（共 42 项）；演示底栏在可用时显示货郎与广告按钮。

### 2026-11-23 · Claude Opus（角色序列帧管线）
- **已完成**：`make_characters.py`（9 个角色：狼/野猪/熊王四足一套骨骼，五种土匪 + 二当家/大当家人形一套骨骼，8 帧行走循环）+ `bake_sprite_anim.py`（复用建筑烘培的相机/光照/墨线/渲染通道与 `stylize_sprites`，两个朝向 + 镜像，夜晚版由白昼调色保证可读）；本机半比例 9 个角色约 3 分钟烘完；导出到 `client/assets/dev/chars/`（`chars.json`）；`src/render/animSprites.ts` + 演示接入（有序列帧就用，否则退回程序化画法），44 项单测。美术圣经补“角色”一节。
- **追加**：攻击动作（6 帧）、家人角色（当家的 / 阿莲 / 孩子）与演示里的白天走动、夜里守门；熊王造型修正（短吻、低尾、细腰带）；烘培笔记本可一并烘角色（`BAKE_CHARACTERS`）。
- **未做**：受击 / 逃跑动作（击退仍用冒烟）；家人“干活”动作；正式比例（128px/m）烘培应放 Colab。

### 2026-11-23 · Claude Opus（更多程序化建筑替身 + 青绿山石）
- **已完成**：`make_proxy_assets.py` 新增茅草屋、厢房、猎棚、粮仓、火油连弩塔 5 件程序化替身并半比例烘培导出，演示里对应建筑全部换成烘培精灵（截图 `docs/art/samples/demo_day5.jpg`、`proxy_buildings_v1.png`）；地面山石格画成青绿山水式石峰；遮挡排序 250 物体 0.84ms/帧；陷阱触发时机修正。
- **说明**：这些替身是过渡美术，也是图生 3D 失败时的兜底；AI 资产出图后同 id 直接覆盖即可。

### 2026-11-23 凌晨 · Claude Opus（第二批程序化替身：游戏里每种建筑都有烘培精灵了）
- **已完成**：`make_proxy_assets.py` 再加 8 件替身（连弩箭楼、鱼梁、货郎车、石灯、烽火盆、青砖大院 3×3、祠堂、滚木塔），色板补石青 / 墨；本机半比例烘培导出到 `client/assets/dev`（共 23 张精灵）。演示里：连弩箭楼 / 鱼梁 / 大院 / 祠堂 / 滚木塔改用烘培精灵（`inkDraw` 只剩缺图时的兜底）；货郎进山的白天，正房旁停一辆货郎车；路两头最近的山石上各立一对石灯（山石不可建，不和玩家建筑冲突）。新增 `?rich=1`（开局多给资源，只为截图看后期建筑）。样张：`docs/art/samples/proxy_buildings_v2.jpg`、`demo_proxies_v2_dusk.jpg`。
- **修平衡 AI**：原来它货郎一来就把木料卖到只剩 150（大院要 220），所以永远修不起大院。现在正房修好、第 5 天起为大院留木料 / 兽材（木料兽材够了之后余钱也先留着），第 6 天起钱粮够了先修大院；重跑 `tune.ts`（第 8 夜 hpMul 1.49→1.39、第 9 夜 1.22→1.09，其余变化 ≤0.1），`balance_v1.md` 已重写：3/3 通关，种子 7 第 8 天修成大院。
- **演示**：谷口（出怪那头）山石上一座烽火盆；`?rich=1` 第 6 天就会修成大院（截图 `docs/art/samples/demo_courtyard_day7.jpg`）。
- **待定（T6）**：大院修好后钱已花光，祠堂 / 滚木塔在 10 夜内仍然很少出现；种子 7 第 10 夜主屋只剩 1%（5 种子平均 40% 达标）。要不要降低祠堂 / 滚木塔造价，留给 T6。
- **未做**：替身全部是半比例（64px/m），正式比例应在 Colab 烘。
- **家人干活动作**：`make_characters.py` 加 `work` 动作（当家的双手抡锄刨地；阿莲 / 孩子弯腰插秧、两手交替往下点），`bake_sprite_anim.py` 只给家人多烘这一套（8 帧 8fps），新增 `pipeline/atlas/export_chars.py` 把烘培结果合并进 `chars.json`。演示：当家的一半时间、阿莲多半时间、孩子偶尔走到稻田边，面朝田干活；孩子闲逛不再走到山石上。开发台新增 `window.__demo`（`speed` 可写、`g` / `villagers` 只读，只在 dev server 里有），截图时把速度降到 1× 或 0。
- **战斗反馈补回来**：建筑全换成精灵后，原来程序化画的“着火”丢了。现在 `inkDraw.drawFlames`（木刻风火舌 + 墨线勾边 + 飘烟）叠在屋面上，大建筑烧成 2–3 处火头；夜里受损的建筑头顶显示墨框血条（低于 35% 变藤黄，主屋仍看顶栏）；敌人被打跑时除了冒烟，还会掉头往山外跑 0.8 秒淡出（没在截图里抓到这一帧，代码跑过无报错）。
- **青砖大院替身 v2**：原来两厢没有屋顶（烘出来是两块白方块）、院中树是个绿球。现在：青石下碱 + 砖墙 + 墙帽；门楼带匾额、双扇朱门 + 门钉；石狮一对；正房朱柱前廊 + 门 + 格窗；两厢青瓦顶 + 朝院心的格窗；院中石榴树（多子多福）+ 太平缸 + 甬道。样张 `docs/art/samples/proxy_courtyard_v2.png`。注意：单独烘某件替身要带 `--manifest assets_manifest.json`，否则按 1×1 默认尺寸烘。
- **夜灯闪烁**：夜里每座有灯的建筑、石灯、烽火盆叠一层叠加混合的暖光晕（位置按烘培夜灯：正面偏左、约 0.4 倍高；箭楼在平台高度），亮度轻微闪烁 —— 美术圣经第 7 节“灯火闪烁 / 灯晕外溢”的客户端部分。
- **炊烟 / 萤火**：白天主屋、厢房屋脊冒炊烟（浅色烟团 + 细墨线勾边，木刻画法；只用灰色在草地和茅草上几乎看不见），快天黑时更浓；夜里稻田上几点萤火明灭。
- **受击闪白**：敌人被箭射中时叠加混合再画一遍同一帧，0.12 秒内淡掉。顺手修了 `drawAnimFrame` 会把调用方设的 `globalAlpha` 覆盖成 1 的问题（之前“掉头逃跑”的淡出其实不生效）。闪白太快没截到图，代码跑过无报错。
- **Colab 烘培笔记本**：角色清单补上当家的 / 阿莲 / 孩子；新增 `PROXY_FALLBACK`（默认开）：`raw_models/` 里还没有 AI 模型的建筑 / 道具（现 19 件），先用程序化替身按同样参数烘到 `baked_sprites/_proxy/`。所以 T2 就算还卡着，在 Colab 跑一次烘培也能拿到正式比例（128px/m）的全套替身。导出顺序：`export_sprites.py --sprites baked_sprites/_proxy --merge` → `--sprites baked_sprites --merge`（AI 版覆盖替身）→ `export_chars.py --anims baked_sprites/chars`。
- **精灵图鉴** `client/gallery.html`（`npm --prefix client run dev` → `/gallery.html`，只在开发台）：全部建筑 / 道具精灵按统一比例排开，可拖“入夜”看白昼→夜晚、切底色、显示占地框与锚点、开关地影；角色卡片实时播放行走 / 攻击 / 干活、四个朝向。T2 的 AI 资产导出后用它验收最快。截图 `docs/art/samples/gallery_v1.jpg`。
- **最后 3 件替身**：翠竹丛（竹节 + 下垂的尖叶簇，版画“个 / 介”字竹叶）、溪上木桥（2×1，0° / 90°，微拱桥面 + 栏杆 + 灯笼）、红梅。至此 manifest 里 24 件资产全部有烘培精灵（19 件替身 + 5 件正式程序化）。演示：谷地边缘山石上几丛翠竹，离主屋最近的山石上一株红梅（木桥暂时没有放的地方：路不过溪）。截图 `docs/art/samples/demo_day1_decor.jpg`。Colab 笔记本的 `PROXY_FALLBACK` 清单同步加上这 3 件。
- **HUD 美术 v2**：顶栏资源改成墨线 + 矿物色的内联 SVG 小图标（铜钱 / 原木 / 稻穗 / 兽皮），造价也用图标；建造按钮上方显示该建筑的烘培精灵缩略图（修房按钮显示下一级房子）。`setHtml` 改为记住上次写入的字符串再比较（浏览器回读 SVG 的 innerHTML 会改写，直接比会每 250ms 重写子节点、可能丢点击）。截图 `docs/art/samples/demo_hud_v2.jpg`。
- **家族面板**（演示，点“安排家人”打开）：当家的 / 阿莲的职责说明；幼年子女四个分工按钮（打猎 / 砍柴 / 打渔 / 种田），显示“再过 N 个黎明长成 → 将成某身份”；长成的少年按羁绊位置列出可驻守的塔 / 墙 / 主屋（含“不驻守”）；底部“一键安排”（原来的自动安排）与“收起”。只在家族状态变化时重建，面板贴在底栏上方。截图 `docs/art/samples/demo_family_panel.jpg`。
- **封面**：`play.html` 打开先是一张木刻卷首（“深山传家”楷书 + 朱砂印“开荒守寨” + 一句话玩法 + “开荒 ▶”），点之前模拟不走、画面照常渲染当背景；`?auto=1` 直接跳过。截图 `docs/art/samples/demo_cover.jpg`（印章位置后来挪到了右上角）。另补了 2 条平衡 AI 回归测试（货郎不卖光大院材料、第 6 天起先修大院），共 47 项单测。
- **远山背景**：`groundPainter.paintBackdrop` 画三层青绿远山（淡石青 → 二青 → 石绿，山脊书法墨线 + 皴 + 层间白雾，下半部渐隐回天色），白昼 / 夜晚两张按屏幕尺寸缓存；渲染器新增 `drawBackdrop` 钩子（天色之后、地面之前）。谷地菱形四周不再是一片空纸色。截图 `docs/art/samples/demo_backdrop_day1.jpg`。
- **野猪掉肉**（用户需求）：打跑野猪除 10 钱 + 1 兽材外再掉 15 野猪肉。肉计入口粮（`food`），`enemies.json` 新增 `rewardNames: {food: "肉"}`，只影响界面叫法；演示里打跑野猪会多飘一行“+15肉”。野猪本来就在第 2 / 3 夜（饿狼野猪）出场。重跑平衡：3/3 通关，曲线基本不变；新增 1 条单测（共 48 项）。

### 2026-11-23 上午 · Claude Opus（Colab 正式比例烘培）
- **已完成**：用户登录 Colab 后，`colab_bake_sprites.ipynb` 在 L4 上以 `SCALE=1.0, SAMPLES=48` 跑完全部替身（19 件 → `_proxy/`）、5 件程序化资产和 12 个角色（约 75 分钟，结束后运行时自动释放）。从云盘网页端下载 PNG/JSON（不含 `_passes/`）三个 zip，导出到 `client/assets/dev`：27 张建筑 / 道具精灵 + 12 个角色，全部 128 px/m（`sprites.json` / `chars.json` 已重建，开发台约 23 MB）。图鉴与演示检查过，占地框、锚点、比例都对。样张 `docs/art/samples/demo_fullscale_day5.jpg`。
- **经验**：浏览器面板长时间后台会和 Colab 断开，但运行时照常跑、产出照常写云盘；刷新 GitHub 版笔记本会丢掉临时加的单元格，别点“连接”以免另起一台 GPU，去云盘看进度即可。云盘网页按住 End 让列表加载完，再 Shift 选取，才能一次选全。
- **未做**：真机图集打包（按显示密度缩到 0.5–0.75）留给客户端落地方；T2 的 AI 图生 3D 仍未跑。

### 2026-11-23 下午 · Claude Opus（T2 图生 3D 首次跑通）
- **结果**：3 件样张（青瓦正房 / 竹箭楼 / 古松）在 L4 上跑完 概念图（Qwen-Image）→ 白模 → 贴图 → `raw_models/<id>.glb` → 半比例试烘培（`baked_sprites/_preview/`）。概念图三张都很到位（白底、三分之四视角、构件齐全）。烘出来：**正房很好**（瓦垄、朱柱、灯笼、门都在，比程序化替身丰富）；**竹箭楼可用**；**古松一般** —— 树干和山石好，但云头松针团被 Hunyuan3D 做成很薄的片，从游戏视角看像一根根蓝色刀片，暂时不如程序化古松。
- **踩坑与修复（都已推送，下次直接跑）**：
  1. 云盘里的 Qwen-Image 权重是之前崩溃留下的截断文件（"header too large"）→ `t2i_concepts.py` 加载前校验 `.safetensors` 头与大小，坏的删掉重下（`cf7c0cd`）。
  2. Colab 现在自带 transformers 5.x，DINOv2 权重改名导致白模模型加载失败 → 安装格固定 `transformers<5`，已加载 5.x 时直接报错让重启（`910874c`）。
  3. Qwen-Image 整个 transformer 4bit 量化出图满屏噪点 → 第 0 块 `img_mod` 保持 bf16、50 步、噪点检测 + 必要时去噪（`a34cb9f`）；修复后噪点 1.0–1.6。
  4. diffusers ≥ 0.35 要求 `trust_remote_code` 才加载 Hunyuan3D-Paint 自带的本地 pipeline（`810fe68`）；贴图 UNet 只认 `.bin`，安装格不能跳过这 7.3GB（`8280ac8`）。
- **Colab 经验**：待执行的单元格队列在浏览器里，网页和运行时断开后，正在跑的格会跑完，但后面的格不会接着跑（这次白白空等了半小时）—— 长任务要每 5–10 分钟看一眼，断了就刷新页面重连同一台运行时再“运行此单元格及下方”。中断（Ctrl+M I）正好打在 import 中途会把模块弄坏（`numba has no attribute core`），要重启会话。
- **下一步（待用户定）**：正房 / 箭楼采用 AI 版；古松换一张概念图候选或换种子重出，不行就保留程序化版；然后量产其余 16 件 AI 资产（`ASSET_IDS=[]`），再用 `colab_bake_sprites.ipynb` 正式比例烘培（`raw_models/` 里有 AI 模型的件会自动不再用替身）。

### 2026-11-23 下午 · Claude Opus（画风 v2：古旧绢本设色）
- **用户要求**：“画风色彩再中国画一点，颜色整体再偏历史感一点”。做了 A（中）/ B（强）两版与原画风同屏对比（`docs/art/samples/theme_compare_sheet.jpg`、`theme_compare_sprites.png`），**用户选 A**。
- **已落地**：`style_profile.json` v2（古旧矿物色板、纯度 1.0、暖黄受光 / 灰靛暗部、赭褐旧墨、黛瓦调亮成青灰、明度吸附 35%、新增 `grade` 全局调色）；`stylize_sprites.grade_srgb`（建筑与角色帧都走）；客户端默认 `aged` 主题（旧绢天色、橄榄赭草地、灰石青溪水、灰青绿远山、绢纹 + 水渍），`?theme=qinglv` 看原画风；概念图提示词改成“古旧绢本设色”。美术圣经第 1、4 节已改。
- **过渡状态**：`client/assets/dev` 里的精灵目前只是在旧图上补了一层 `grade`（色板没变），等 AI 资产量产完，用 `colab_bake_sprites.ipynb`（`OVERWRITE=True`）按 v2 正式重烘全部建筑与角色，才是完整效果。

### 2026-11-23 晚 · Claude Opus（AI 资产量产完成 + 按画风 v2 正式重烘）
- **AI 量产验收**：16 件 + 3 件样张全部出了模型并半比例试烘（`baked_sprites/_preview/`）。好：茅屋、青瓦正房、大院、厢房、祠堂、吊脚粮仓、猎棚、四座塔、石灯笼、烽火盆、货郎车、两向木桥（木桥底下自带一小块水面，进游戏后再看要不要裁）。不要：**古松**（松针成蓝色刀片）和**翠竹丛**（叶团发蓝、带怪脸）→ 已在 `gen_3d_jobs.json` 改 `method=procedural`，云盘旧模型挪到 `raw_models/_rejected/`，烘培自动用程序化替身。院墙红梅树是“墙 + 梅”，名字本意如此，保留。
- **正式重烘（v2）**：`colab_bake_sprites.ipynb` `SCALE=1.0 / SAMPLES=48 / OVERWRITE=True`，建筑 25 张（含两向篱笆 / 青砖墙 / 木桥）+ 程序化古松 / 竹丛 + 12 个角色。L4、A100 都排不到，跑在 T4 上（建筑约 3–5 分钟一件，角色约 12 分钟一个，共约 3.5 小时）。已导出到 `client/assets/dev`（仍 23 MB），图鉴 0 警告，演示样张 `docs/art/samples/demo_v2_ai_assets_day2.jpg`。角色随后单独导出（`export_chars.py`，108 张序列帧全部换成 v2 旧墨 / 旧绢调色，`chars.json` 帧尺寸与锚点不变，`chars/` 12 MB），图鉴 12 个角色行走 / 攻击 / 干活正常。
- **新工具 `pipeline/colab/run_unattended.py`**：在 Colab 内核里依次执行仓库里 notebook 的代码格（不依赖浏览器排队，网页断开照跑），参数格执行后用 overrides 覆盖，跳过各 notebook 的释放格、全部结束（含失败）后统一释放运行时；进度写云盘 `_unattended.log`。用法见文件头两行。
- **修**：替身兜底以前不带 `--overwrite`、且把 `proxy_models/` 整个目录重烘 → 换画风后古松 / 竹丛替身不会更新；改为只烘缺的件并跟随 `OVERWRITE`。
- **Colab 经验**：① 新运行时的“连接到 Google 云端硬盘”弹窗要在几十秒内点完，晚了 `drive.mount` 报 `mount failed`，`run_jobs` 会照常收尾释放 GPU（这次因此重跑了一次）；② 选 A100 / L4 排不到会自动降到 T4 + 普通内存（12.7GB），Hunyuan3D 会 OOM —— 这种情况只做 Blender 烘培，图生 3D 留到有 L4 / A100 时。
- ~~**未完成**：鱼梁仍是带小屋的旧模型~~ → 2026-11-24 已重出，见下一条。

### 2026-11-24 · Claude Opus（角色 v2 导出 + 鱼梁重出）
- **角色**：12 个角色 108 张序列帧按 v2 导出（`export_chars.py`，`chars.json` 不变），图鉴行走 / 攻击 / 干活正常。
- **鱼梁**：第一次按“不要房屋”提示词重出，Qwen-Image 4 个种子**全都**在水车旁画了一间磨坊 —— “水车”这个词本身就带出磨坊，公共画风前缀里的“游戏建筑道具 / 黛瓦青灰 / 蛎灰旧白”也在推它。改法：`gen_3d_jobs.json` 里鱼梁单独的 `prefix_zh`（`t2i_concepts.py` 新支持单件覆盖前缀），把水车写成溪中独立的**竹筒车**，反向词加瓦 / 白墙 / 红门 / 台阶，6 个种子 → 6 张全部没有房子（对比图 `docs/art/samples/fish_weir_concepts_noria.jpg`）。人工选 s1234（A 字架筒车、轮廓最清楚），L4 上出模型 + 正式比例烘培，导出 `fish_weir` 568×416、2×1 格、高 1.16m，图鉴 0 警告。旧精灵在云盘 `baked_sprites/_rejected/`。
- **`run_unattended.py` 新增**：`need_gpu`（显存 / 内存不够直接放弃并释放，防 T4 上 OOM 白烧）、`set_aside_baked`（把 `baked_sprites/<id>_*` 挪进 `_rejected/`，不带 OVERWRITE 的烘培就只补这几件）、`(name, overrides, n)` 在第 n 个代码格前暂停等云盘 `_go`（人工挑概念图；最多等 40 分钟，超时照常继续）。驱动格把 `G`（raw.githubusercontent 的提交 SHA 路径）同时传给 `RAW` 和两个 notebook 的 `GITHUB_RAW`，避开 raw 缓存。
- **Colab 经验**：① Qwen-Image 从云盘缓存加载约 45 分钟，出图每张只要约 3 分钟 —— 要多出几个候选就一次出够；② 网页前端常卡在“正在恢复执行”看不到输出，内核其实在跑：看云盘 `_unattended.log`，或开底栏「终端」（xterm 只认粘贴事件：往 `.xterm-helper-textarea` 派发 ClipboardEvent('paste')）；③ 在终端 `pkill -INT -f colab_kernel_launcher` 中断时，若正卡在 `!` 子进程里，只会杀掉子进程、本格照常往下跑，要再发一次才会让本格失败；④ “连接到 Google 云端硬盘”之后还有一个账号授权窗口，要点到最后的“允许”，否则 mount 失败、运行时被释放（这次白等了一轮）。
- **文档上云盘**（用户要求：文档能跨电脑编辑，云盘 20TB 够放）：新增 `tools/sync_docs.py`，`HANDOFF.md` + `docs/` ⇄ 云盘 `shenshan_td/docs/` 三方比较双向同步（基线记在云盘 `docs/.sync_state.json`；删除默认不传播，`--delete` 才删；冲突用 `--prefer repo|drive` 或手动合并）。`docs/art/samples/`（35 张、约 9MB）移出 Git，只在云盘 + 本地。另：这台 Mac 现在同步了 Colab 那个云盘账号（`~/Library/CloudStorage/GoogleDrive-…/我的云端硬盘/shenshan_td`），Colab 输出以后可以直接从本地读，不用再从网页下载 zip。

### 2026-11-24 下午 · Claude Opus（角色五官表情 + 圆润四肢，Colab 正式烘培）
- **用户要求**：人物和动物要看到表情和五官；四肢和脚要逼真，不要方块。
- **`make_characters.py` 重写人物 / 野兽造型**：五官用“贴花”小物体（`obj["feature"]=1`，pass_index 2，进 NoInk 集合不描 Freestyle 线）；`stylize_sprites.py` 识别这层：Kuwahara 之前先用周边颜色填掉、之后把原色贴回，并去掉五官周围的内描线，所以眼睛 / 眉毛 / 嘴不会被抹糊。12 个角色各有表情（`FACE` 表：刀疤、独眼眼罩、络腮胡、八字胡、眯眼坏笑、狂笑；女眷睫毛唇色腮红，孩子大眼笑脸双髻），行走 / 攻击 / 干活嘴型不同；头整体朝镜头转 30°（`HEAD_TURN`），两只眼都看得到。野兽：琥珀狼眼、怒眉、攻击张嘴（下颌骨）、獠牙、猪鼻孔、熊月牙白斑。
- **四肢**：人物改成肩 / 肘 / 膝关节球 + 锥形上下臂和大小腿（新骨骼 `fore_*` / `shin_*`，走路屈膝、摆臂屈肘），绑腿斜纹、草鞋（村民）/ 黑布鞋（山匪），手有拇指；野兽两段腿（`low_*` 骨）+ 后腿臀部肌肉，狼 / 熊三趾爪，野猪分蹄。
- **烘培**：Colab L4，提交 `e72c30c`，`SCALE=1.0 SAMPLES=48`，04:00–06:01 UTC，12 个角色 120 张图全部成功；从本机同步的云盘直接拷出导出，图鉴 / 可玩演示无报错，`npm test` 48/48。样张（云盘）：`characters_v3_bake_humans.png`、`characters_v3_bake_bandits_beasts.png`、`characters_v3_bake_actions.png`。
- **待改进（未做）**：角色在手机画面里显示得比较小，五官主要靠眼睛和嘴的深色点辨认；如还要更清楚，可考虑在游戏里把角色放大 1.2–1.3 倍，或给 Colab 笔记本存一份云盘副本，免去每次挂载云盘的授权点击。
