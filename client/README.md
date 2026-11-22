# client · 2.5D 等距昼夜渲染底座（T3）

引擎无关的 TypeScript 渲染核心 + 浏览器开发台。核心只依赖 Canvas2D 的通用子集（微信小游戏同样支持），
最终是直接上微信小游戏 Canvas，还是迁到 Cocos Creator，都可以复用 `src/render/` 的数学与排序。

## 目录

| 路径 | 作用 |
|---|---|
| `src/render/iso.ts` | 2:1 等距投影（与 Blender 烘培相机一致：俯角 30°、方位角 45°、1 格 2m）；世界↔屏幕、拾取格子 |
| `src/render/depthSort.ts` | 多格建筑 + 移动单位的遮挡排序（拓扑排序，不是简单按 y 排） |
| `src/render/dayNight.ts` | 昼夜时钟、逐户点灯（每栋建筑按 id 哈希错开亮灯）、地影昼夜透明度 |
| `src/render/spriteMeta.ts` | 精灵元数据类型（`sprites.json`）与比例/锚点校验 |
| `src/render/scene.ts` | 场景数据：地块网格、建筑精灵、自绘物体（单位/投射物/特效） |
| `src/render/renderer.ts` | Canvas2D 渲染：天色 → 地块 → **全部地影** → 按遮挡顺序画物体（白昼图 + 夜晚图交叉淡入） |
| `src/platform/` | 平台适配：`browser.ts`（开发台）、`wechat.ts`（小游戏，**未真机验证**） |
| `src/dev/` | 浏览器开发台（替身精灵小山村 + 绕房走的村民） |
| `assets/dev/` | 开发用替身精灵（`pipeline/atlas/export_sprites.py --scale 0.5` 导出，64 px/m） |
| `tests/` | Vitest 单测（投影、排序、昼夜、元数据校验） |

## 命令

```bash
npm --prefix client install
npm --prefix client test          # 单测
npm --prefix client run typecheck
npm --prefix client run dev       # http://127.0.0.1:5173
```

开发台 URL 参数（便于截图对比）：`?t=秒` 固定时辰并暂停，`?debug=1` 显示占地框，`?walk=米` 固定村民位置，`?zoom=1.1&focus=3,3` 放大到某格。

## 精灵约定（与烘培管线的接口）

- 全部精灵同一比例：母版 128 px/m，导出缩放后同比变化（开发台 0.5× = 64 px/m）。混用不同比例时 `validateAtlas` 会报出来。
- `anchor_px` = 占地中心落地点；建筑占地 `footprint: "AxB"` 沿世界 X 占 A 格、沿 Y 占 B 格，放在格 (i, j) 时锚点在 `((i+A/2)·2m, (j+B/2)·2m)`。
- 每个资产三张图：`_day` / `_night` / `_shadow`，尺寸锚点一致。**地影先全部画完再画物体**；夜晚地影透明度 × `night_shadow_opacity`（0.6）。
- 建筑正面朝屏幕左下；需要朝右下时水平镜像（注意镜像后锚点 x 要换成 `宽 − anchor_x`）。

## 已验证 / 未验证

- 已验证：19 项单测；开发台中锚点与格子对齐、地影层、树木与建筑遮挡、村民在房后被挡住、黄昏逐户点灯；每帧绘制约 0.45ms（11 个物体，M1）。
- 未验证：微信小游戏真机（`wechat.ts` 只写了接口）、触屏手势、图集打包、几百个单位时的帧率。
