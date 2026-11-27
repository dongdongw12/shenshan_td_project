/**
 * 浏览器开发台入口（play.html）：和微信小游戏跑的是同一个 runApp（src/app/app.ts），UI 全画在画布上。
 * URL：?auto=1 让平衡 AI 自己玩（看效果用），?seed=数字，?speed=2，?rich=1 开局多给资源（截图看后期建筑用，不影响平衡）
 *      ?theme=qinglv 看原来的青绿重彩；&set=A|B 换上本地预览用的重新风格化精灵（assets/_preview/，不进仓库）
 *      ?assets=mobile 用手机版资源（pipeline/atlas/make_mobile.py 生成：裁透明边 + 0.75 倍，和小游戏包里一样）
 *      ?nosave=1 不读也不写存档
 *      ?noads=1 不显示广告按钮（和正式小游戏包一样，截备案 / 宣传图用）
 *      ?loading=0.42 只显示启动画面停在这个进度（看启动画面排版用）
 *      ?bg=1（仅开发调试）：页面在后台时 requestAnimationFrame 会停，改用定时器驱动，方便自动化截图
 */
import { BrowserPlatform } from "../platform/browser";
import { drawFatal, runApp } from "../app/app";
import { LoadingScreen } from "../app/loading";

const qs = new URLSearchParams(location.search);
const theme = qs.get("theme") === "qinglv" ? "qinglv" : "aged";
const previewSet = qs.get("set");
const canvas = document.getElementById("stage") as HTMLCanvasElement;
const platform = new BrowserPlatform(canvas);

const hold = qs.get("loading");
if (hold !== null) new LoadingScreen(platform).set(Number(hold) || 0.42, "下载画卷 · 7.9 / 18.9 MB");
else runApp(platform, {
  assetDir: theme === "aged" && previewSet ? `_preview/aged_${previewSet}` : qs.get("assets") === "mobile" ? "mobile" : "dev",
  theme,
  seed: Number(qs.get("seed") ?? 7),
  auto: qs.get("auto") === "1",
  speed: Number(qs.get("speed") ?? 1),
  rich: qs.get("rich") === "1",
  timerFrames: qs.get("bg") === "1",
  demoAds: qs.get("noads") !== "1",
  // 存档（localStorage）：自动演示 / 多给资源的截图模式不存；?nosave=1 也不存
  saveKey: qs.get("rich") === "1" || qs.get("nosave") === "1" ? undefined : "shenshan_save",
  coverTip: "底栏选建筑 → 点地块放置 · 拖动看地图 · 滚轮 / 双指缩放 · 点“入夜”开战",
}).catch((e) => drawFatal(platform, e));
