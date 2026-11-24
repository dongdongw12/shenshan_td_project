/**
 * 激励视频：平台层只负责“放一条广告、告诉我看没看完”，奖励由玩法层 adReward 发。
 * - rewarded：看完了，发奖励
 * - skipped：中途关掉，不发
 * - unavailable：没有广告可放（没填广告位、没广告库存、网络错误），不发，提示稍后再试
 */
export type AdResult = "rewarded" | "skipped" | "unavailable";

export interface RewardedAds {
  show(placement: string): Promise<AdResult>;
}

interface WxRewardedVideoAd {
  load(): Promise<void>;
  show(): Promise<void>;
  onClose(cb: (res?: { isEnded: boolean }) => void): void;
  onError(cb: (err: { errMsg: string; errCode: number }) => void): void;
}
declare const wx: { createRewardedVideoAd(opts: { adUnitId: string }): WxRewardedVideoAd };

/**
 * 微信激励视频（wx.createRewardedVideoAd）。同一个广告位全局只建一个实例（微信要求），
 * onClose / onError 只注册一次，按“当前正在等结果的那次 show”分发。
 * unitFor(placement) 返回广告位 id；同一个 id 可以给多个场景共用。
 */
export class WechatRewardedAds implements RewardedAds {
  private readonly ads = new Map<string, WxRewardedVideoAd>();
  private pending: ((r: AdResult) => void) | null = null;

  constructor(private readonly unitFor: (placement: string) => string | undefined) {}

  private get(unit: string): WxRewardedVideoAd {
    let ad = this.ads.get(unit);
    if (!ad) {
      ad = wx.createRewardedVideoAd({ adUnitId: unit });
      // 基础库 2.1.0 以下 onClose 不带参数，视为看完
      ad.onClose((res) => this.settle(!res || res.isEnded ? "rewarded" : "skipped"));
      ad.onError((err) => { console.warn("激励视频出错", err.errCode, err.errMsg); this.settle("unavailable"); });
      this.ads.set(unit, ad);
    }
    return ad;
  }

  private settle(r: AdResult): void {
    const p = this.pending;
    this.pending = null;
    p?.(r);
  }

  show(placement: string): Promise<AdResult> {
    const unit = this.unitFor(placement);
    if (!unit) return Promise.resolve("unavailable");
    if (this.pending) return Promise.resolve("unavailable"); // 上一条还没结束
    const ad = this.get(unit);
    return new Promise<AdResult>((resolve) => {
      this.pending = resolve;
      // 预加载可能失效：show 失败就重新 load 一次再 show；还不行就算没广告
      ad.show().catch(() => ad.load().then(() => ad.show())).catch(() => this.settle("unavailable"));
    });
  }
}
