import { describe, expect, it } from "vitest";
import { State } from "ts-fsrs";
import { nodeDb } from "../platform/nodeDb";
import {
  addImportedComments,
  addLineProgress,
  commentFor,
  deleteImport,
  imports,
  saveImport,
  setComment,
  cacheAnalysis,
  cachedAnalysis,
  cardsOf,
  lineProgress,
  migrate,
  recordAnswer,
  repertoireFor,
  repertoireSummaries,
} from "./store";

const T0 = new Date("2026-11-20T12:00:00Z");
const hours = (h: number) => new Date(T0.getTime() + h * 3600_000);

async function setup() {
  const db = nodeDb();
  await migrate(db);
  const rep = await repertoireFor(db, "Italian Game", "white", T0);
  return { db, rep };
}

describe("store", () => {
  it("migrates once and reuses a repertoire", async () => {
    const { db, rep } = await setup();
    await migrate(db);
    expect((await repertoireFor(db, "Italian Game", "white")).id).toBe(rep.id);
    expect((await repertoireFor(db, "Italian Game", "black")).id).not.toBe(rep.id);
  });

  it("creates a card on the first answer and schedules it", async () => {
    const { db, rep } = await setup();
    const card = await recordAnswer(db, rep.id, "epd-1", "good", "e2e4", T0);
    expect(card!.state).toBe(State.Learning);
    expect(card!.due.getTime()).toBeGreaterThan(T0.getTime());
    const cards = await cardsOf(db, rep.id);
    expect(cards.get("epd-1")!.reps).toBe(1);
    const log = await db.select<{ rating: number; move_uci: string }>("SELECT rating, move_uci FROM review_log");
    expect(log).toEqual([{ rating: 3, move_uci: "e2e4" }]);
  });

  it("ignores a correct answer before the card is due, but records a mistake", async () => {
    const { db, rep } = await setup();
    const first = await recordAnswer(db, rep.id, "epd-1", "good", undefined, T0);
    const early = new Date(first!.due.getTime() - 1000);
    expect((await recordAnswer(db, rep.id, "epd-1", "good", undefined, early))!.reps).toBe(1);
    expect((await recordAnswer(db, rep.id, "epd-1", "again", undefined, early))!.reps).toBe(2);
  });

  it("summarizes due cards per repertoire", async () => {
    const { db, rep } = await setup();
    await recordAnswer(db, rep.id, "a", "good", undefined, T0);
    await recordAnswer(db, rep.id, "b", "again", undefined, T0);
    const [summary] = await repertoireSummaries(db, hours(48));
    expect(summary).toMatchObject({ id: rep.id, family: "Italian Game", cards: 2, due: 2 });
    const [now] = await repertoireSummaries(db, T0);
    expect(now.due).toBe(0);
    expect(now.nextDue).not.toBeNull();
  });

  it("stores line progress and engine results", async () => {
    const { db, rep } = await setup();
    await addLineProgress(db, rep.id, "seen", "e2e4 e7e5");
    await addLineProgress(db, rep.id, "seen", "e2e4 e7e5");
    expect(await lineProgress(db, rep.id, "seen")).toEqual(new Set(["e2e4 e7e5"]));
    expect(await lineProgress(db, rep.id, "completed")).toEqual(new Set());
    await cacheAnalysis(db, "k", { depth: 16 });
    expect(await cachedAnalysis(db, "k")).toEqual({ depth: 16 });
  });
});

describe("imports and comments", () => {
  it("saves and deletes an import with its repertoire data", async () => {
    const db = nodeDb();
    await migrate(db);
    await saveImport(db, "Mine", "1. e4 *");
    const rep = await repertoireFor(db, "Mine", "white");
    await recordAnswer(db, rep.id, "x", "good", "e2e4");
    await addLineProgress(db, rep.id, "seen", "e2e4");
    expect((await imports(db)).map((i) => i.name)).toEqual(["Mine"]);
    await expect(saveImport(db, "Mine", "1. d4 *")).rejects.toThrow();
    await deleteImport(db, "Mine");
    expect(await imports(db)).toEqual([]);
    expect(await db.select("SELECT * FROM cards")).toEqual([]);
    expect(await db.select("SELECT * FROM review_log")).toEqual([]);
    expect(await db.select("SELECT * FROM repertoires")).toEqual([]);
  });

  it("keeps the user's comment over an imported one, and deletes on empty text", async () => {
    const db = nodeDb();
    await migrate(db);
    await addImportedComments(db, [{ epd: "p", uci: "e2e4", text: "Best by test." }]);
    expect(await commentFor(db, "p", "e2e4")).toEqual({ text: "Best by test.", source: "import" });
    await setComment(db, "p", "e2e4", " My note ");
    await addImportedComments(db, [{ epd: "p", uci: "e2e4", text: "Other." }]);
    expect(await commentFor(db, "p", "e2e4")).toEqual({ text: "My note", source: "user" });
    await setComment(db, "p", "e2e4", "");
    expect(await commentFor(db, "p", "e2e4")).toBeUndefined();
  });
});
