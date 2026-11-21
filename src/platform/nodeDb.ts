/// <reference types="node" />
// Db over node:sqlite, for tests and the dev server bridge. Never imported by app code.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/** Matches Db in src/core/store.ts structurally, so the Vite config need not compile src/core. */
export interface NodeDb {
  execute(sql: string, params?: unknown[]): Promise<{ lastInsertId?: number }>;
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): void;
}

export function nodeDb(path = ":memory:"): NodeDb {
  const db = new DatabaseSync(path);
  return {
    async execute(sql: string, params: unknown[] = []) {
      const info = db.prepare(sql).run(...(params as SQLInputValue[]));
      return { lastInsertId: Number(info.lastInsertRowid) };
    },
    async select<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as SQLInputValue[])) as T[];
    },
    close: () => db.close(),
  };
}
