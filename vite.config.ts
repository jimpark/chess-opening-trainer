import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), devEngine()],

  // The bundled opening book (about 400 KB of TSV) lands in the main chunk.
  build: { chunkSizeWarningLimit: 1500 },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));

/**
 * Dev server only: runs the Stockfish sidecar for a page opened in a browser instead of the Tauri
 * window, over the Vite WebSocket. See viteTransport in src/platform/engine.ts.
 */
function devEngine(): Plugin {
  const triples: Record<string, string> = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "win32-x64": "x86_64-pc-windows-msvc.exe",
    "win32-arm64": "aarch64-pc-windows-msvc.exe",
  };
  const triple = triples[`${process.platform}-${process.arch}`];
  return {
    name: "dev-engine",
    apply: "serve",
    configureServer(server) {
      let proc: ChildProcess | undefined;
      server.ws.on("engine:send", (data: { line: string }) => {
        if (!proc) {
          proc = spawn(`src-tauri/binaries/stockfish-${triple}`);
          createInterface({ input: proc.stdout! }).on("line", (line) => server.ws.send("engine:line", { line }));
          proc.on("exit", () => {
            proc = undefined;
            server.ws.send("engine:exit", {});
          });
          proc.on("error", (e) => server.config.logger.error(`dev engine: ${e.message}`));
        }
        proc.stdin!.write(`${data.line}\n`);
      });
    },
  };
}
