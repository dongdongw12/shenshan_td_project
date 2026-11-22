/**
 * 平衡对局：用“正常玩家”AI 自动打 10 夜（多个种子），打印每夜结果。
 *   npm --prefix client run balance            # 打印
 *   npm --prefix client run balance -- --write # 同时写 docs/design/balance_v1.md
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { autoPlay, type BalanceRow } from "../src/game/bot";
import { defaultConfig } from "../src/game/config";

const SEEDS = [7, 21, 99];
const cfg = defaultConfig();
const all: BalanceRow[][] = [];
for (const seed of SEEDS) all.push(await autoPlay(cfg, 10, undefined, seed));

const pct = (x: number) => `${Math.round(x * 100)}%`;
const lines: string[] = [];
lines.push(`| 夜 | ${SEEDS.map((s) => `种子${s} 主屋血量`).join(" | ")} | 出怪 | 被毁建筑 | 塔数 | 家族 | 夜后余钱/木/粮/兽材 |`);
lines.push(`|---|${SEEDS.map(() => "---").join("|")}|---|---|---|---|---|`);
for (let n = 1; n <= 10; n++) {
  const rows = all.map((r) => r.find((x) => x.night === n));
  const r0 = rows[0];
  const cells = rows.map((r) => (r ? (r.survived ? pct(r.houseHpPct) : "**失守**") : "—"));
  lines.push(`| ${n} | ${cells.join(" | ")} | ${r0?.spawned ?? "—"} | ${r0?.lost ?? "—"} | ${r0?.towers ?? "—"} | ${r0?.family ?? "—"} | ${r0 ? `${r0.coin}/${r0.wood}/${r0.food}/${r0.hide}` : "—"} |`);
}
const wins = all.filter((r) => r.length === 10 && r.every((x) => x.survived)).length;
const table = lines.join("\n");
console.log(table);
console.log(`\n通关：${wins}/${SEEDS.length} 局`);
console.log("\n种子 7 每天的操作：");
for (const r of all[0]!) console.log(`第${r.night}天：${r.actions.join("；") || "（无）"}`);

if (process.argv.includes("--write")) {
  const out = resolve(import.meta.dirname ?? ".", "../../docs/design/balance_v1.md");
  mkdirSync(resolve(out, ".."), { recursive: true });
  const md = `# 数值平衡 v1（自动对局）

> 由 \`npm --prefix client run balance -- --write\` 生成。AI 是“正常玩家”策略（\`client/src/game/bot.ts\`），不是最优解。
> 目标：正常玩家能通关 10 夜，但中后期主屋血量在 30–80% 之间（有压力、不碾压、不崩盘）。数值来源：\`client/assets/configs/*.json\`。

## 每夜结果

${table}

通关：${wins}/${SEEDS.length} 局（种子 ${SEEDS.join("、")}）。

## 种子 7 的 AI 操作记录

${all[0]!.map((r) => `- 第${r.night}天：${r.actions.join("；") || "（无）"}`).join("\n")}
`;
  writeFileSync(out, md);
  console.log(`\n已写入 ${out}`);
}
