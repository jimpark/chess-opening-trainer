import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { UciSession } from "../core/uci";

/** Moves lines between a UciSession and an engine process. */
interface Transport {
  send(line: string): void;
  onLine(cb: (line: string) => void): void;
  onExit(cb: () => void): void;
}

function tauriTransport(): Transport {
  let chain: Promise<unknown> = Promise.resolve();
  const lineHandlers: ((l: string) => void)[] = [];
  const exitHandlers: (() => void)[] = [];
  const listening = Promise.all([
    listen<string>("engine-line", (e) => lineHandlers.forEach((h) => h(e.payload))),
    listen("engine-exit", () => exitHandlers.forEach((h) => h())),
  ]);
  return {
    // Chained so commands reach the engine in order.
    send: (line) => {
      chain = chain.then(() => listening).then(() => invoke("engine_send", { line })).catch((e) => console.error("engine_send", e));
    },
    onLine: (cb) => lineHandlers.push(cb),
    onExit: (cb) => exitHandlers.push(cb),
  };
}

/** Dev server bridge (see devEngine in vite.config.ts), for running the UI in a browser. */
function viteTransport(hot: NonNullable<ImportMeta["hot"]>): Transport {
  return {
    send: (line) => hot.send("engine:send", { line }),
    onLine: (cb) => hot.on("engine:line", (d: { line: string }) => cb(d.line)),
    onExit: (cb) => hot.on("engine:exit", cb),
  };
}

function transport(): Transport | undefined {
  if ("__TAURI_INTERNALS__" in window) return tauriTransport();
  if (import.meta.env.DEV && import.meta.hot) return viteTransport(import.meta.hot);
  return undefined;
}

function engineOptions(): Record<string, number> {
  const cores = navigator.hardwareConcurrency || 2;
  return { Threads: Math.max(1, Math.floor(cores / 2)), Hash: 128 };
}

let session: UciSession | undefined;
let t: Transport | undefined | null = null;

/** The shared engine session, or undefined when no engine is available. */
export function engine(): UciSession | undefined {
  if (t === null) {
    t = transport();
    if (t) {
      t.onLine((l) => session?.receive(l));
      // The process restarts on the next command; the new session sends "uci" again.
      t.onExit(() => (session = undefined));
    }
  }
  if (!t) return undefined;
  const send = t.send;
  session ??= new UciSession(send, engineOptions());
  return session;
}
