import { defineConfig, type Plugin } from "vite";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * 微信小游戏打包：npm run build:minigame → build/minigame/（用微信开发者工具「导入项目」选这个目录）。
 * - game.js：src/minigame/main.ts 打成一个文件（玩法配置 JSON 一起打进去）
 * - assets/：精灵图分包（主包限 4MB，分包合计限 30MB），默认拷 assets/mobile（npm run export:mobile 生成的手机版），
 *   没有就拷 assets/dev
 * - game.json / project.config.json：来自 minigame/ 模板；AppID 默认是小游戏测试号 wx16352051ede3d1a1（2026-11-24 申请；能在开发者工具里跑、真机预览，不能上传发布），环境变量 WX_APPID 可覆盖
 */
function packMinigame(): Plugin {
  const root = __dirname;
  const out = resolve(root, "build/minigame");
  return {
    name: "shenshan-pack-minigame",
    apply: "build",
    closeBundle() {
      for (const f of readdirSync(resolve(root, "minigame"))) copyFileSync(resolve(root, "minigame", f), join(out, f));
      const appid = process.env.WX_APPID;
      if (appid) {
        const p = join(out, "project.config.json");
        const cfg = JSON.parse(readFileSync(p, "utf8"));
        cfg.appid = appid;
        writeFileSync(p, JSON.stringify(cfg, null, 2));
      }
      const src = existsSync(resolve(root, "assets/mobile/sprites.json")) ? resolve(root, "assets/mobile") : resolve(root, "assets/dev");
      const dst = join(out, "assets/dev");
      mkdirSync(dst, { recursive: true });
      cpSync(src, dst, { recursive: true, filter: (s) => !s.endsWith(".DS_Store") });
      // 音乐音效（pipeline/audio/make_audio.py 生成）也放分包
      if (existsSync(resolve(root, "assets/audio"))) cpSync(resolve(root, "assets/audio"), join(out, "assets/audio"), { recursive: true, filter: (s) => !s.endsWith(".DS_Store") });
      // 分包根目录必须有一个 game.js
      writeFileSync(join(out, "assets/game.js"), "// 精灵图分包（只放图片和索引）\n");
      const size = (p: string): number => statSync(p).isDirectory() ? readdirSync(p).reduce((s, f) => s + size(join(p, f)), 0) : statSync(p).size;
      const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
      const total = size(out), assets = size(join(out, "assets"));
      console.log(`\n小游戏包：主包 ${mb(total - assets)} MB（限 4MB），分包 assets ${mb(assets)} MB（合计限 30MB）；资源来自 ${src}`);
    },
  };
}

export default defineConfig({
  publicDir: false,
  define: { "import.meta.env.DEV": "false" },
  build: {
    outDir: "build/minigame",
    emptyOutDir: true,
    target: "es2017",
    minify: true,
    lib: { entry: resolve(__dirname, "src/minigame/main.ts"), formats: ["iife"], name: "shenshan", fileName: () => "game.js" },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  plugins: [packMinigame()],
});
