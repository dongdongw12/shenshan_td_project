import { defineConfig, type Plugin } from "vite";
import { writeFileSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";

/**
 * 开发台截图：页面 POST /__capture {name, data(dataURL)} → 写到 docs/art/samples/<name>。
 * 只在 dev server 里存在，只接受 .jpg/.png 文件名，不能写到别的目录。
 */
function capturePlugin(): Plugin {
  const outDir = resolve(__dirname, "../docs/art/samples");
  return {
    name: "shenshan-dev-capture",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__capture", (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const { name, data } = JSON.parse(body) as { name: string; data: string };
            const file = basename(name);
            if (!/^[\w.-]+\.(jpg|png)$/.test(file)) throw new Error("bad name");
            mkdirSync(outDir, { recursive: true });
            writeFileSync(resolve(outDir, file), Buffer.from(data.split(",", 2)[1] ?? "", "base64"));
            res.end(`saved ${file}`);
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}

// 开发台：client/assets 作为静态目录（/dev/sprites.json 等）
export default defineConfig({
  root: ".",
  publicDir: "assets",
  build: { outDir: "build/web", emptyOutDir: true },
  server: { strictPort: true },
  plugins: [capturePlugin()],
});
