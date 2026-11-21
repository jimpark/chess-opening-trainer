/// <reference types="node" />
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { describe, expect, it } from "vitest";
import { formatScore, parseInfo, scoreValue, UciSession } from "./uci";

const AFTER_E4_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

/** A fake engine that records commands; the test plays the engine's side. */
function fake() {
  const sent: string[] = [];
  const session = new UciSession((l) => sent.push(l), { Threads: 2 });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { sent, session, tick };
}

describe("parseInfo", () => {
  it("parses a MultiPV line", () => {
    expect(parseInfo("info depth 12 seldepth 18 multipv 2 score cp -42 nodes 19419 pv g1f3 d7d6")).toEqual({
      depth: 12,
      multipv: 2,
      score: { cp: -42 },
      pv: ["g1f3", "d7d6"],
    });
  });

  it("parses mate scores and skips bounds and non-PV lines", () => {
    expect(parseInfo("info depth 5 score mate -3 pv a1a2")?.score).toEqual({ mate: -3 });
    expect(parseInfo("info depth 5 score cp 10 lowerbound pv a1a2")).toBeUndefined();
    expect(parseInfo("info string NNUE enabled")).toBeUndefined();
  });
});

describe("formatScore", () => {
  it("formats pawns and mates", () => {
    expect(formatScore({ cp: 34 })).toBe("+0.34");
    expect(formatScore({ cp: -120 })).toBe("−1.20");
    expect(formatScore({ cp: 0 })).toBe("0.00");
    expect(formatScore({ mate: -2 })).toBe("#-2");
    expect(scoreValue({ mate: 3 })).toBeGreaterThan(scoreValue({ cp: 5000 }));
  });
});

describe("UciSession", () => {
  it("initializes once, then searches", async () => {
    const { sent, session, tick } = fake();
    const search = session.analyze(AFTER_E4_E5, { depth: 10, multipv: 2, searchmoves: ["g1f3", "a2a4"] });
    await tick();
    expect(sent).toEqual(["uci"]);
    session.receive("uciok");
    await tick();
    expect(sent.slice(1)).toEqual(["setoption name Threads value 2", "isready"]);
    session.receive("readyok");
    await tick();
    expect(sent.slice(3)).toEqual([
      "setoption name MultiPV value 2",
      `position fen ${AFTER_E4_E5}`,
      "go depth 10 searchmoves g1f3 a2a4",
    ]);
    session.receive("info depth 10 multipv 1 score cp 40 pv g1f3 b8c6");
    session.receive("info depth 10 multipv 2 score cp -30 pv a2a4 d7d5");
    session.receive("bestmove g1f3 ponder b8c6");
    const a = await search.result;
    expect(a.lines.map((l) => [l.pv[0], l.score])).toEqual([
      ["g1f3", { cp: 40 }],
      ["a2a4", { cp: -30 }],
    ]);
    expect(a.bestmove).toBe("g1f3");
  });

  it("reports scores from White's point of view when Black is to move", async () => {
    const { session, tick } = fake();
    const search = session.analyze(AFTER_E4, { depth: 1 });
    await tick();
    session.receive("uciok");
    await tick();
    session.receive("readyok");
    await tick();
    session.receive("info depth 1 score cp 25 pv c7c5");
    session.receive("bestmove c7c5");
    expect((await search.result).lines[0].score).toEqual({ cp: -25 });
  });

  it("stops the running search when a new one starts", async () => {
    const { sent, session, tick } = fake();
    const first = session.analyze(AFTER_E4_E5, {});
    await tick();
    session.receive("uciok");
    await tick();
    session.receive("readyok");
    await tick();
    session.receive("info depth 3 score cp 30 pv g1f3");
    const second = session.analyze(AFTER_E4, { depth: 5 });
    await tick();
    expect(sent.slice(-3)).toEqual(["stop", `position fen ${AFTER_E4}`, "go depth 5"]);
    session.receive("bestmove g1f3");
    session.receive("info depth 5 score cp 20 pv c7c5");
    session.receive("bestmove c7c5");
    expect((await first.result).lines[0].pv).toEqual(["g1f3"]);
    expect((await second.result).lines[0].pv).toEqual(["c7c5"]);
  });

  it("does not stop a newer search when an older one is stopped in the same tick", async () => {
    const { sent, session, tick } = fake();
    const first = session.analyze(AFTER_E4_E5, { depth: 10 });
    first.stop();
    session.analyze(AFTER_E4, { depth: 10 });
    await tick();
    session.receive("uciok");
    await tick();
    session.receive("readyok");
    await tick();
    await tick();
    const goSecond = sent.indexOf("go depth 10", sent.indexOf(`position fen ${AFTER_E4}`));
    expect(sent.slice(goSecond + 1)).not.toContain("stop");
  });

  it("calls onUpdate when a depth completes", async () => {
    const { session, tick } = fake();
    const depths: number[] = [];
    const search = session.analyze(AFTER_E4_E5, { depth: 3, onUpdate: (a) => depths.push(a.depth) });
    await tick();
    session.receive("uciok");
    await tick();
    session.receive("readyok");
    await tick();
    for (const d of [1, 2, 3]) session.receive(`info depth ${d} score cp 30 pv g1f3`);
    session.receive("bestmove g1f3");
    await search.result;
    expect(depths).toEqual([1, 2]);
  });
});

const binary = `src-tauri/binaries/stockfish-${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`;

describe.runIf(process.platform === "darwin" && existsSync(binary))("Stockfish", () => {
  it("scores a bad move below the book move", async () => {
    const proc = spawn(binary);
    const session = new UciSession((l) => proc.stdin.write(`${l}\n`), { Threads: 1, Hash: 16 });
    createInterface({ input: proc.stdout }).on("line", (l) => session.receive(l));
    try {
      // 2.Ke2 against 2.Nf3 after 1.e4 e5.
      const a = await session.analyze(AFTER_E4_E5, { depth: 12, multipv: 2, searchmoves: ["g1f3", "e1e2"] }).result;
      const byMove = new Map(a.lines.map((l) => [l.pv[0], l.score]));
      expect(scoreValue(byMove.get("g1f3")!)).toBeGreaterThan(scoreValue(byMove.get("e1e2")!) + 50);
    } finally {
      proc.kill();
    }
  }, 30_000);
});
