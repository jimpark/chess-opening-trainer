import { migrate, type Db } from "../core/store";

/** File name of the app database, in the app config directory. */
const DB_FILE = "trainer.db";

async function tauriDb(): Promise<Db> {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  const sql = await Database.load(`sqlite:${DB_FILE}`);
  return {
    execute: async (query, params = []) => {
      const r = await sql.execute(query, params);
      return { lastInsertId: r.lastInsertId };
    },
    select: (query, params = []) => sql.select(query, params),
  };
}

/** Dev server bridge (see devBridge in vite.config.ts), for running the UI in a browser. */
function viteDb(hot: NonNullable<ImportMeta["hot"]>): Db {
  let next = 0;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  hot.on("db:res", (d: { id: number; result?: unknown; error?: string }) => {
    const w = waiting.get(d.id);
    if (!w) return;
    waiting.delete(d.id);
    if (d.error) w.reject(new Error(d.error));
    else w.resolve(d.result);
  });
  const call = (op: "execute" | "select", sql: string, params: unknown[] = []) =>
    new Promise<unknown>((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject });
      hot.send("db:req", { id, op, sql, params });
    });
  return {
    execute: (sql, params) => call("execute", sql, params) as Promise<{ lastInsertId?: number }>,
    select: <T,>(sql: string, params?: unknown[]) => call("select", sql, params) as Promise<T[]>,
  };
}

let opening: Promise<Db | undefined> | undefined;

/** The migrated app database, or undefined when there is no storage (progress is not saved). */
export function database(): Promise<Db | undefined> {
  opening ??= (async () => {
    let db: Db | undefined;
    if ("__TAURI_INTERNALS__" in window) db = await tauriDb();
    else if (import.meta.env.DEV && import.meta.hot) db = viteDb(import.meta.hot);
    if (db) await migrate(db);
    return db;
  })().catch((e) => {
    console.error("database", e);
    return undefined;
  });
  return opening;
}
