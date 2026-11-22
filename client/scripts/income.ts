/** 收入来源分析：AI 对局里每天的击退赏钱 / 夜晚奖励 / 花费。npx vite-node scripts/income.ts */
import { defaultConfig } from "../src/game/config";
import { createGame, step, drainEvents } from "../src/game/sim";
import { botDay, DEFAULT_BOT } from "../src/game/bot";
const g = createGame(defaultConfig(), 7);
const inc: Record<number, { kill: number; reward: number; other: number; spent: number }> = {};
let last = g.res.coin;
while ((g.phase === "day" || g.phase === "night") && g.day <= 10) {
  const d = g.day; const row = (inc[d] ??= { kill: 0, reward: 0, other: 0, spent: 0 });
  if (g.phase === "day") { const before = g.res.coin; botDay(g, DEFAULT_BOT); row.spent += before - g.res.coin; last = g.res.coin; }
  step(g, 0.5);
  for (const e of drainEvents(g)) {
    if (e.type === "enemyFled") row.kill += e.reward.coin ?? 0;
    if (e.type === "dawn") (inc[e.night] ??= { kill: 0, reward: 0, other: 0, spent: 0 }).reward += e.reward.coin ?? 0;
  }
  const delta = g.res.coin - last; last = g.res.coin;
  void delta;
}
// other = total gained - kill - reward
console.log("day | kill | nightReward | spent");
for (const [d, v] of Object.entries(inc)) console.log(d, Math.round(v.kill), v.reward, Math.round(v.spent));
