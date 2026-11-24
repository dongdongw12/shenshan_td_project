/**
 * 微信小游戏入口（打包成 build/minigame/game.js，见 vite.minigame.config.ts）。
 * 精灵图放在分包 assets/ 里（主包限 4MB），先加载分包再进游戏。
 */
import { WechatPlatform } from "../platform/wechat";
import { drawFatal, runApp } from "../app/app";

declare const wx: {
  loadSubpackage(opts: { name: string; success: () => void; fail: (e: unknown) => void }): { onProgressUpdate?(cb: (r: { progress: number }) => void): void };
};

const platform = new WechatPlatform("assets");
platform.mainCanvas(); // 第一次 createCanvas 拿到上屏画布

function loadAssets(): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.loadSubpackage({ name: "assets", success: () => resolve(), fail: (e) => reject(new Error(`分包加载失败：${JSON.stringify(e)}`)) });
  });
}

loadAssets()
  .then(() => runApp(platform, { assetDir: "dev", coverTip: "底栏选建筑 → 点地块放置 · 单指拖动看地图 · 双指缩放 · 点“入夜”开战" }))
  .catch((e) => drawFatal(platform, e));
