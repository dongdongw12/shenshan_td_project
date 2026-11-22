# 《深山传家：开荒守寨》MVP 技术架构

## 1. 架构目标
- **双击即玩**：采用原生 HTML5 Canvas 2D + 模块化 Classic Scripts（`window.MountainTD` 命名空间），支持本地 `file://` 直接在浏览器打开试玩，无需配置本地服务器或打包器。
- **平滑迁移微信小游戏 / Cocos Creator**：将**数值配置（`config.js`）**、**渲染表现（`renderer.js`）**、**音效合成（`audio.js`）**与**核心状态机（`game.js`）**解耦，后续迁移到 Cocos Creator 或微信小游戏时，`config.js` 与状态机逻辑可直接复用。

## 2. 目录结构
```text
mountain_td_mvp/
├── index.html          # 竖屏 9:16 试玩外壳 + 古风 HUD + 弹窗
├── style.css           # 明清木刻粗墨线 + 宣纸矿物重彩 UI 样式
├── ARCHITECTURE.md     # 本技术架构说明
└── src/
    ├── config.js       # 地图槽位、建筑/驻守数值、3 天昼夜波次与台词表
    ├── audio.js        # Web Audio API 零素材古风/打击音效合成
    ├── renderer.js     # 粗墨线重彩 2.5D Canvas 渲染器（昼夜光影/单位/气泡）
    └── game.js         # 昼夜状态机、采集经济、娶妻自动化、塔防战斗主循环
```

## 3. 核心状态机
`TITLE` → `DAY（35s 开荒种田/捕鱼/打猎/建房娶妻，可提前入夜）` → `NIGHT（野兽波次塔防 + 农夫补刀 + 媳妇熬汤回血）` → `DAWN（黎明结算与货郎收购）` → 循环至第 3 夜击退黑熊王触发 `VICTORY`（支持无尽模式继续体验）。

## 4. 后续升级到微信小游戏的改造点
1. 将 `src/renderer.js` 替换为 Cocos Creator 精灵图 / Spine 动画（使用统一画风 AI 生图切片）。
2. 将 `game.js` 中的模拟 IAA 按钮接入 `wx.createRewardedVideoAd`。
3. 接入 `wx.setStorageSync` 存档与 `src/config.js` 扩充至 10 天（加入生子、厢房、土匪与祠堂）。
