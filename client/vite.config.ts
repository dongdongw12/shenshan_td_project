import { defineConfig } from "vite";

// 开发台：client/assets 作为静态目录（/dev/sprites.json 等）
export default defineConfig({
  root: ".",
  publicDir: "assets",
  build: { outDir: "build/web", emptyOutDir: true },
  server: { strictPort: true },
});
