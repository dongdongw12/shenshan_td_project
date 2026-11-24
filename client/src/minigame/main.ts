/**
 * 微信小游戏入口（打包成 build/minigame/game.js，见 vite.minigame.config.ts）。
 * 精灵图放在分包 assets/ 里（主包限 4MB），先加载分包再进游戏。
 */
import { WechatPlatform } from "../platform/wechat";
import { drawFatal, runApp } from "../app/app";
import { WechatRewardedAds } from "../platform/ads";
import { adUnitFor, REWARDED_AD_UNITS } from "./adUnits";

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
  .then(() => runApp(platform, {
    assetDir: "dev",
    saveKey: "shenshan_save",
    // 2026-11-24 排查真机没声音：预览包先显示排查信息，修好后关掉
    diag: true,
    // 填了广告位才接真广告；没填就放游戏内演示广告
    ads: Object.values(REWARDED_AD_UNITS).some(Boolean) ? new WechatRewardedAds(adUnitFor) : undefined,
    coverTip: "底栏选建筑 → 点地块放置 · 单指拖动看地图 · 双指缩放 · 点“入夜”开战" }))
  .catch((e) => drawFatal(platform, e));
