/**
 * 自动调难度：逐夜二分查找 waves.json 里每夜的 hpMul，使“贪心玩家”AI 打完该夜主屋血量接近目标（3 个种子平均）。
 * 前面的夜晚固定后再调下一夜（经济是累积的）。结果写回 assets/configs/waves.json。
 *   npx vite-node scripts/tune.ts            # 只打印
 *   npx vite-node scripts/tune.ts --write    # 写回
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { autoPlay } from "../src/game/bot";
import { defaultConfig, withOverrides } from "../src/game/config";

const TARGET: Record<number, number> = { 3: 0.55, 4: 0.85, 5: 0.75, 6: 0.7, 7: 0.5, 8: 0.65, 9: 0.6, 10: 0.4 };
const SEEDS = [7, 21, 99, 123, 456];
let cfg = defaultConfig();

async function scoreAt(night: number, mul: number): Promise<number> {
  const c = withOverrides(cfg, (x) => { x.waves.nights[night - 1]!.hpMul = mul; });
  let sum = 0;
  for (const seed of SEEDS) {
    const rows = await autoPlay(c, night, undefined, seed);
    const r = rows.find((x) => x.night === night);
    sum += r && r.survived ? r.houseHpPct : -0.5; // 失守按 -0.5 计，二分时推向更低倍率
  }
  return sum / SEEDS.length;
}

const result: Record<number, number> = {};
for (const n of Object.keys(TARGET).map(Number)) {
  let lo = Math.log(0.4), hi = Math.log(8);
  for (let it = 0; it < 9; it++) {
    const mid = (lo + hi) / 2;
    const s = await scoreAt(n, Math.exp(mid));
    if (s > TARGET[n]!) lo = mid; else hi = mid;
  }
  const mul = Math.round(Math.exp((lo + hi) / 2) * 100) / 100;
  result[n] = mul;
  cfg = withOverrides(cfg, (x) => { x.waves.nights[n - 1]!.hpMul = mul; });
  console.log(`第${n}夜 hpMul=${mul}  →  平均主屋 ${(await scoreAt(n, mul)).toFixed(2)}（目标 ${TARGET[n]}）`);
}

if (process.argv.includes("--write")) {
  const p = resolve(import.meta.dirname ?? ".", "../assets/configs/waves.json");
  const json = JSON.parse(readFileSync(p, "utf-8"));
  for (const night of json.nights) if (result[night.night]) night.hpMul = result[night.night];
  writeFileSync(p, JSON.stringify(json, null, 2) + "\n");
  console.log("已写回 waves.json");
}
