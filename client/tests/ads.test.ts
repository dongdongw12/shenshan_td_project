import { describe, expect, it } from "vitest";
import { WechatRewardedAds } from "../src/platform/ads";

/** 假的 wx.createRewardedVideoAd：behavior 决定这次 show 的结果 */
function fakeWx(behavior: { showFails?: number; close?: { isEnded: boolean } | undefined; error?: boolean }) {
  const created: string[] = [];
  let fails = behavior.showFails ?? 0;
  (globalThis as unknown as { wx: unknown }).wx = {
    createRewardedVideoAd: ({ adUnitId }: { adUnitId: string }) => {
      created.push(adUnitId);
      let onClose: (r?: { isEnded: boolean }) => void = () => {};
      let onError: (e: { errMsg: string; errCode: number }) => void = () => {};
      return {
        load: () => Promise.resolve(),
        show: () => {
          if (fails > 0) { fails--; return Promise.reject(new Error("not loaded")); }
          setTimeout(() => (behavior.error ? onError({ errMsg: "no fill", errCode: 1004 }) : onClose(behavior.close)), 0);
          return Promise.resolve();
        },
        onClose: (cb: typeof onClose) => { onClose = cb; },
        onError: (cb: typeof onError) => { onError = cb; },
      };
    },
  };
  return created;
}

describe("WechatRewardedAds", () => {
  it("看完发奖励、中途关掉不发", async () => {
    fakeWx({ close: { isEnded: true } });
    expect(await new WechatRewardedAds(() => "adunit-1").show("good_harvest")).toBe("rewarded");
    fakeWx({ close: { isEnded: false } });
    expect(await new WechatRewardedAds(() => "adunit-1").show("good_harvest")).toBe("skipped");
  });

  it("旧基础库 onClose 不带参数算看完；show 失败会重新 load 一次", async () => {
    fakeWx({ close: undefined, showFails: 1 });
    expect(await new WechatRewardedAds(() => "adunit-1").show("rich_peddler")).toBe("rewarded");
  });

  it("没广告位 / 出错 / 一直放不出来 → unavailable", async () => {
    fakeWx({ close: { isEnded: true } });
    expect(await new WechatRewardedAds(() => undefined).show("last_stand")).toBe("unavailable");
    fakeWx({ error: true });
    expect(await new WechatRewardedAds(() => "adunit-1").show("last_stand")).toBe("unavailable");
    fakeWx({ showFails: 5 });
    expect(await new WechatRewardedAds(() => "adunit-1").show("last_stand")).toBe("unavailable");
  });

  it("同一个广告位只建一个实例", async () => {
    const created = fakeWx({ close: { isEnded: true } });
    const ads = new WechatRewardedAds(() => "adunit-1");
    await ads.show("good_harvest");
    await ads.show("rich_peddler");
    expect(created).toEqual(["adunit-1"]);
  });
});
