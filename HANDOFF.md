# 《深山传家：开荒守寨》跨设备 / 跨模型交接文档（HANDOFF）

> **用途**：供 **Claude Opus** 与 **Antigravity** 在不同电脑（MacBook Air / Mac mini 等）上无缝接手本项目。每次开工前**先读完本文件**，收工前更新底部「交接日志」并 `git push`。  
> **最后更新**：2026-11-22

---

## 1. 30 秒项目速览

- **项目定位**：中国古代深山开荒 + 家族养成 + 昼夜塔防 **微信小游戏**（纯 IAA 激励视频变现，无需版号）。
- **核心卖点**：贫困农夫流落深山 → 白天开荒建房、种地、捕鱼、打猎卖给货郎攒铜钱 → 攒够聘礼修青瓦正房**娶妻**（解锁自动收成 + 夜间熬汤回血）→ 建厢房**生子**（2–3 昼夜长成少年）→ 派族人**驻守箭楼/城墙触发羁绊** → 扩建青砖大院与祠堂，抵御饿狼、野猪、黑熊与黑风寨土匪。
- **已锁定技术路线（路线 B）**：**Colab GPU 生成 3D 古建 `.glb` → Blender 5.0.1 自动归一化 + Freestyle 粗墨线 + 2:1 等距昼/夜双光影烘培 → 输出 `_day.png` / `_night.png` / `_meta.json` 进 2.5D 客户端**（稳跑微信小游戏 60 帧，零 3D 机型兼容坑）。
- **当前阶段**：**Phase 0 已完成**（策划案、前 3 天可玩原型、正式仓库骨架、24 件资产清单、Blender/Colab 双光影烘培管线均已就绪），下一步进入 **Phase 1（第 1 周 3 件样张 3D 生成与烘培验收）**。

---

## 2. 已锁定的设计决策（接手模型不可擅自推翻）

1. **画风规范**：**明清木刻版画粗墨线 + 矿物重彩工笔**。轮廓线必须明晰饱满（Blender Freestyle 约 `2.6px`，深墨色 `#1c1510`），白昼采用青绿山林、赭石土地、朱砂屋檐；入夜压成深靛蓝衬托门窗与火把暖橙光。**禁止**做成灰蒙蒙、低对比的淡彩水墨。
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
| `pipeline/blender/bake_isometric_sprites.py` | 已通过 `py_compile` | Blender 4.x/5.0 自动归一化、2:1 正交相机、Freestyle 粗墨线、昼/夜双通道渲染 + 脚点锚点 JSON |
| `pipeline/colab/colab_bake_sprites.ipynb` | 已通过 JSON 校验 | 对齐 Blender 5.0.1 的 Colab GPU 批量烘培笔记本（跑完自动 `runtime.unassign()`） |
| `.gitignore` | 已完成 | 忽略 `.glb`/`.blend`/`.hdr`/烘培散图/构建产物，防止污染 Git |

### B. 玩法验证原型（已归档至 `docs/prototype_v0/`）
- 独立 HTML5 Canvas 竖屏原型，双击 `docs/prototype_v0/index.html` 可直接在浏览器玩完前 3 天（开荒种田/捕鱼/打猎 → 攒 200 铜钱 + 40 木修青瓦正房娶发妻“阿莲” → 守住饿狼、野猪、黑熊王 3 夜，含模拟 IAA 与 Web Audio 音效）。
- 正式版开发时可直接参考 `docs/prototype_v0/src/config.js` 里的初版数值节奏。

---

## 4. 跨电脑 & 跨模型协同规范

### 文件同步边界
- **GitHub 仓库（代码、配置、文档、小体积脚本）**：每台电脑开工前必跑 `git pull`，收工前必跑 `git add/commit/push` 并更新本文件底部日志。
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

- [ ] **T1 · 独立建仓与环境同步**（仅差 `git push` 到 GitHub）
  - [x] 将 `shenshan_td_project/` 移至 `~/Projects/shenshan_td_project/`，将 `mountain_td_mvp/` 归档到 `docs/prototype_v0/`，并初始化本地独立 Git 仓库（`main` 分支）
  - [x] 在 Google Drive 创建 `MyDrive/shenshan_td/raw_models/` 与 `baked_sprites/`，上传 `assets_manifest.json`、`bake_isometric_sprites.py` 与 `colab_bake_sprites.ipynb`
  - [ ] 创建 GitHub 远程仓库并执行 `git push -u origin main`
- [ ] **T2 · 编写 Colab 图生 3D 笔记本 + 第 1 周视觉样张（3 件）**
  - 准备统一“明清木刻粗墨线重彩”概念图提示词，先做 3 件核心样张：`house_lv2_tile`（青瓦正房）、`tower_bamboo`（竹箭楼）、`prop_pine_tree`（深山古松）。
  - 在 `pipeline/colab/` 新建 `colab_gen_3d.ipynb`（Hunyuan3D / TRELLIS）批量生成 `.glb` 到 `raw_models/`。
  - 运行 `colab_bake_sprites.ipynb`（先设 `TEST_SINGLE = "house_lv2_tile.glb"`, `RES = 512`, `SAMPLES = 24`）验收画风与粗墨线。
- [ ] **T3 · 搭建 `client/` 2.5D 等距昼夜渲染底座**
  - 确定客户端框架（推荐 **Cocos Creator 3.8+ TypeScript** 一键导微信小游戏，或轻量 TypeScript Canvas 过渡）。
  - 实现读取 `_meta.json` 脚点锚点、Y-Sort 遮挡排序、以及 `_day.png` / `_night.png` 透明度平滑切换。
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
