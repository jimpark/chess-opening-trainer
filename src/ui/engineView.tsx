import { useEffect, useState } from "react";
import { sanLine } from "../core/explore";
import { formatScore, type Analysis, type AnalyzeOptions, type Score } from "../core/uci";
import { cacheAnalysis, cachedAnalysis } from "../core/store";
import { database } from "../platform/db";
import { engine } from "../platform/engine";

export interface AnalysisState {
  available: boolean;
  analysis: Analysis | undefined;
  running: boolean;
}

/**
 * Runs the engine on `fen` while it is defined. A new fen or option set stops the previous search.
 * `key` identifies the options, so callers need not memoize them. A search with a depth limit
 * that reaches its depth is cached in the database and reused.
 */
export function useAnalysis(fen: string | undefined, options: Omit<AnalyzeOptions, "onUpdate">, key: string): AnalysisState {
  const eng = engine();
  const [analysis, setAnalysis] = useState<Analysis | undefined>();
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setAnalysis(undefined);
    if (!eng || !fen) return;
    let live = true;
    let search: ReturnType<typeof eng.analyze> | undefined;
    const depth = options.depth;
    const cacheKey = depth ? `${fen}|${key}|${depth}|${options.multipv ?? 1}` : undefined;
    setRunning(true);
    void (async () => {
      const db = cacheKey ? await database() : undefined;
      const hit = db && cacheKey ? await cachedAnalysis<Analysis>(db, cacheKey) : undefined;
      if (!live) return;
      if (hit) {
        setAnalysis(hit);
        setRunning(false);
        return;
      }
      search = eng.analyze(fen, { ...options, onUpdate: (a) => live && setAnalysis(a) });
      const a = await search.result;
      if (db && cacheKey && depth && a.depth >= depth && a.lines.length > 0) void cacheAnalysis(db, cacheKey, a);
      if (!live) return;
      if (a.lines.length > 0) setAnalysis(a);
      setRunning(false);
    })();
    return () => {
      live = false;
      search?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eng, fen, key]);

  return { available: eng !== undefined, analysis, running };
}

/** Vertical bar: White's share grows with White's advantage. Uses Lichess's win-chance curve. */
export function EvalBar({ score, orientation }: { score: Score | undefined; orientation: "white" | "black" }) {
  let white = 50;
  if (score) {
    if ("mate" in score) white = score.mate > 0 ? 100 : 0;
    else white = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * score.cp)) - 1);
  }
  return (
    <div className={`evalbar ${orientation}`} title={score ? formatScore(score) : "No evaluation"}>
      <div className="evalbar-white" style={{ height: `${white}%` }} />
      <span className="evalbar-label">{score ? formatScore(score) : ""}</span>
    </div>
  );
}

/** Numbered SAN moves; each move is a button that receives the UCI prefix ending at it. */
export function PvMoves(props: { fen: string; pv: string[]; max?: number; onSelect?: (ucis: string[]) => void }) {
  const { fen, pv, max = 10, onSelect } = props;
  const sans = sanLine(fen, pv).slice(0, max);
  const [, turn, , , , fullmove] = fen.split(" ");
  let ply = (Number(fullmove) - 1) * 2 + (turn === "b" ? 1 : 0);
  return (
    <span className="pv">
      {sans.map((san, i) => {
        const p = ply++;
        const number = p % 2 === 0 ? `${p / 2 + 1}.` : i === 0 ? `${(p + 1) / 2}…` : "";
        return (
          <span key={i}>
            {number && <span className="muted">{number}</span>}
            <button className="move" disabled={!onSelect} onClick={() => onSelect?.(pv.slice(0, i + 1))}>
              {san}
            </button>{" "}
          </span>
        );
      })}
      {sans.length < pv.length && sans.length === max && <span className="muted">…</span>}
    </span>
  );
}

/** Difference between two scores in pawns, from the mover's point of view. */
export function lossInPawns(played: Score, best: Score, whiteToMove: boolean): number | undefined {
  if (!("cp" in played) || !("cp" in best)) return undefined;
  return ((best.cp - played.cp) * (whiteToMove ? 1 : -1)) / 100;
}

/** MultiPV lines: score and moves. Clicking a move passes the UCI moves up to it. */
export function EngineLines(props: { fen: string; analysis: Analysis | undefined; onSelect?: (ucis: string[]) => void }) {
  const { fen, analysis, onSelect } = props;
  if (!analysis || analysis.lines.length === 0) return <p className="muted">Analyzing…</p>;
  if (analysis.fen !== fen) return <p className="muted">Analyzing…</p>;
  return (
    <ul className="engine-lines">
      {analysis.lines.map((l) => (
        <li key={l.multipv}>
          <span className="score">{formatScore(l.score)}</span>
          <PvMoves fen={fen} pv={l.pv} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}
