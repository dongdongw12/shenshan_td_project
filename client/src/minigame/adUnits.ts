/**
 * 激励视频广告位 id（微信公众平台 → 流量主 → 广告管理 → 新建「激励视频」广告位，形如 adunit-xxxxxxxx）。
 * 开通流量主要先注册正式小游戏 AppID（测试号拿不到广告位）。
 * 空着 = 游戏里放“演示广告”（同样要等倒计时结束才给奖励），方便测试流程。
 * default 给所有场景共用；也可以按场景（good_harvest / rich_peddler / double_happiness / last_stand）单独填，方便看各自的数据。
 */
export const REWARDED_AD_UNITS: Record<string, string> = {
  default: "",
};

export const adUnitFor = (placement: string): string | undefined => REWARDED_AD_UNITS[placement] || REWARDED_AD_UNITS.default || undefined;
