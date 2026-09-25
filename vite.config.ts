import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: [
        "**/src-tauri/**",
        // 编辑器 / 工具在仓库里落下的临时目录。之前 Vite 会去 watch 它们，
        // 正好撞上文件被锁就抛 EBUSY，把整个 dev server 带崩。
        "**/.tmp-*",
        "**/*.tmpdir/**",
        "**/*.tmp",
      ],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
