window.MountainTD = window.MountainTD || {};

window.MountainTD.CONFIG = {
  WIDTH: 430,
  HEIGHT: 650,
  DAY_DURATION: 38,
  MAX_DAYS: 3,

  INITIAL_RESOURCES: {
    coin: 90,
    wood: 45,
    food: 20,
    hide: 0,
  },

  // 农舍与娶妻升级配置
  HOUSE: {
    x: 215,
    y: 410,
    baseMaxHp: 320,
    marriedMaxHp: 560,
    marryCost: { coin: 200, wood: 40 },
    wifeHealPerSec: 12,
    wifeAutoHarvestInterval: 5.5,
  },

  // 防线木篱笆（横向横跨山口主路）
  FENCE: {
    x: 215,
    y: 292,
    width: 176,
    buildCost: { wood: 30 },
    upgradeCost: { coin: 85, wood: 30 },
    lv1Hp: 260,
    lv2Hp: 540,
    repairCostCoin: 25,
  },

  // 可交互槽位
  SLOTS: [
    {
      id: "tower_left",
      kind: "tower",
      name: "西坡箭楼位",
      x: 118,
      y: 252,
      r: 26,
    },
    {
      id: "tower_right",
      kind: "tower",
      name: "东坡箭楼位",
      x: 312,
      y: 252,
      r: 26,
    },
    {
      id: "trap_mid",
      kind: "trap",
      name: "山口陷阱位",
      x: 215,
      y: 192,
      r: 24,
    },
    {
      id: "fish_1",
      kind: "fish",
      name: "溪边鱼梁位",
      x: 72,
      y: 492,
      r: 26,
    },
    {
      id: "field_1",
      kind: "field",
      name: "南坡荒田（西）",
      x: 175,
      y: 542,
      r: 27,
    },
    {
      id: "field_2",
      kind: "field",
      name: "南坡荒田（东）",
      x: 258,
      y: 542,
      r: 27,
    },
    {
      id: "hunt_1",
      kind: "hunt",
      name: "林间猎棚位",
      x: 358,
      y: 486,
      r: 26,
    },
  ],

  // 建筑数值表（与 1 页纸策划案一致）
  BUILDINGS: {
    tower: {
      name: "竹箭楼",
      lv2Name: "强弩楼",
      buildCost: { coin: 60 },
      upgradeCost: { coin: 110, hide: 2 },
      lv1: { dmg: 18, fireRate: 1.05, range: 170 },
      lv2: { dmg: 38, fireRate: 1.25, range: 205 },
      desc: "自动射箭拦截野兽；升级强弩楼后伤害与射程大增。",
    },
    trap: {
      name: "捕兽夹",
      buildCost: { coin: 40, hide: 1 },
      charges: 3,
      dmg: 70,
      slowFactor: 0.45,
      slowDuration: 3.2,
      desc: "触发 3 次，每次造成 70 伤害并减速 55%，专克野猪与黑熊。",
    },
    field: {
      name: "开荒稻田",
      buildCost: { coin: 40 },
      growTime: 7.5,
      yieldFood: 24,
      yieldCoin: 26,
      desc: "定期成熟产出稻谷（自动折算部分铜钱），娶妻后自动收割且收益 +40%。",
    },
    fish: {
      name: "溪边鱼梁",
      buildCost: { coin: 60 },
      growTime: 8.5,
      yieldFood: 14,
      yieldCoin: 38,
      desc: "溪水自动捕鱼，稳定产铜钱与鲜鱼，不占体力。",
    },
    hunt: {
      name: "林间猎棚",
      buildCost: { coin: 75, wood: 15 },
      growTime: 10.5,
      yieldHide: 1,
      yieldCoin: 42,
      desc: "产出稀缺兽材（造捕兽夹、升强弩楼）与较高铜钱。",
    },
  },

  // 主角与媳妇配置
  FARMER: {
    speed: 145,
    attackRange: 54,
    attackDamage: 22,
    attackCooldown: 0.65,
  },

  // 敌人数值
  ENEMIES: {
    wolf: {
      name: "饿狼",
      hp: 55,
      speed: 52,
      dmg: 12,
      attackCd: 1.0,
      rewardCoin: 8,
      rewardHide: 0,
      radius: 13,
      color: "#5f636e",
    },
    boar: {
      name: "野猪",
      hp: 150,
      speed: 38,
      dmg: 24,
      attackCd: 1.2,
      rewardCoin: 18,
      rewardHide: 1,
      radius: 17,
      color: "#6b4735",
    },
    bear: {
      name: "黑熊王",
      hp: 460,
      speed: 25,
      dmg: 42,
      attackCd: 1.45,
      rewardCoin: 90,
      rewardHide: 2,
      radius: 25,
      color: "#2b2421",
      isBoss: true,
    },
  },

  // 前 3 天夜袭波次表
  WAVES: [
    {
      day: 1,
      title: "第一夜 · 孤狼探营",
      hint: "建议先建木篱笆 + 1座竹箭楼，余钱开荒稻田或鱼梁。",
      spawns: [
        { type: "wolf", count: 6, interval: 1.7 },
      ],
      clearReward: { coin: 70, wood: 25, hide: 1 },
    },
    {
      day: 2,
      title: "第二夜 · 饿狼野猪",
      hint: "野猪撞墙很痛！攒钱建第二座箭楼，准备 200 铜钱修房娶妻。",
      spawns: [
        { type: "wolf", count: 4, interval: 1.4 },
        { type: "boar", count: 2, interval: 2.8 },
        { type: "wolf", count: 4, interval: 1.2 },
      ],
      clearReward: { coin: 110, wood: 30, hide: 2 },
    },
    {
      day: 3,
      title: "第三夜 · 熊王夜袭",
      hint: "终局试炼！娶妻回血 + 捕兽夹 + 强弩楼是守住黑熊王的关键。",
      spawns: [
        { type: "wolf", count: 5, interval: 1.2 },
        { type: "boar", count: 4, interval: 2.2 },
        { type: "bear", count: 1, interval: 1.0 },
        { type: "wolf", count: 5, interval: 1.1 },
      ],
      clearReward: { coin: 180, wood: 50, hide: 3 },
    },
  ],

  QUOTES: {
    daySolo: ["先砍点柴，把篱笆扎起来！", "有田有鱼，才能攒够聘礼。", "深山虽苦，总能熬出头。"],
    dayMarried: ["阿莲：当家的歇会儿，稻子我来收！", "阿莲：今年收成好，明春就能盖厢房。", "有你在，这深山也是家。"],
    nightSolo: ["野兽来了！守住草棚！", "休想毁我辛辛苦苦开的田！", "看我柴刀！"],
    nightMarried: ["阿莲：姜汤熬好了，墙破了我帮衬着！", "阿莲：当家的当心，山口来大家伙了！", "为了媳妇和这个家，一步不退！"],
  },
};
