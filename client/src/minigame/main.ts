/**
 * 微信小游戏入口（打包成 build/minigame/game.js，见 vite.minigame.config.ts）。
 * 精灵图和声音放在分包 assets/ 里（主包限 4MB）：先下载分包（进度条前 70%，第一次约 19MB，之后走缓存），
 * 再解码精灵（后 30%）。下载失败就提示“点屏幕重试”。
 */
import { WechatPlatform } from "../platform/wechat";
import { drawFatal, runApp } from "../app/app";
import { LoadingScreen } from "../app/loading";
import { WechatRewardedAds } from "../platform/ads";
import { adUnitFor, REWARDED_AD_UNITS } from "./adUnits";

interface SubpackageProgress { progress: number; totalBytesWritten?: number; totalBytesExpectedToWrite?: number }
declare const wx: {
  loadSubpackage(opts: { name: string; success: () => void; fail: (e: unknown) => void }): { onProgressUpdate?(cb: (r: SubpackageProgress) => void): void } | undefined;
  onTouchStart(cb: () => void): void;
  offTouchStart?(cb: () => void): void;
};

/** 下载分包占进度条的比例 */
const DOWNLOAD_PART = 0.7;

const platform = new WechatPlatform("assets");
platform.mainCanvas(); // 第一次 createCanvas 拿到上屏画布
const loading = new LoadingScreen(platform);

class DownloadError extends Error {}

function loadAssets(): Promise<void> {
  return new Promise((resolve, reject) => {
    const mb = (n?: number) => ((n ?? 0) / 1048576).toFixed(1);
    const task = wx.loadSubpackage({
      name: "assets",
      success: () => resolve(),
      fail: (e) => reject(new DownloadError(`分包下载失败：${JSON.stringify(e)}`)),
    });
    task?.onProgressUpdate?.((r) => {
      const size = r.totalBytesExpectedToWrite ? ` · ${mb(r.totalBytesWritten)} / ${mb(r.totalBytesExpectedToWrite)} MB` : "";
      loading.set((DOWNLOAD_PART * r.progress) / 100, `下载画卷${size}`); // 百分比只看进度条下面那个总的，免得两个数打架
    });
  });
}

function start(): void {
  loading.set(0, "进山中…");
  loadAssets()
    .then(() => runApp(platform, {
      assetDir: "dev",
      saveKey: "shenshan_save",
      loading,
      loadingFrom: DOWNLOAD_PART,
      // 排查真机问题时改成 true：屏幕上显示系统 / 帧时间 / 声音状态和声音测试按钮
      diag: false,
      // 填了广告位才接真广告；没填就不出现广告按钮
      ads: Object.values(REWARDED_AD_UNITS).some(Boolean) ? new WechatRewardedAds(adUnitFor) : undefined,
      // 正式包不放演示广告（审核员看到“演示广告”会当成未完成）；排查广告流程时改成 true
      demoAds: false,
      coverTip: "底栏选建筑 → 点地块放置 · 单指拖动看地图 · 双指缩放 · 点“入夜”开战",
    }))
    .catch((e) => {
      if (!(e instanceof DownloadError)) { loading.done(); drawFatal(platform, e); return; }
      console.warn(e);
      loading.fail("下载没成功（网络不好？），点屏幕重试");
      const retry = () => { wx.offTouchStart?.(retry); start(); };
      wx.onTouchStart(retry);
    });
}

start();
