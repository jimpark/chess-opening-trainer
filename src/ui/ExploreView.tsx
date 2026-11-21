import { useCallback, useEffect, useMemo, useState } from "react";
import type { DrawShape } from "chessground/draw";
import type { OpeningBook } from "../core/book";
import { explore, findPosition, firstPlyOf, linesWithPrefix, searchLines, type PositionHit } from "../core/explore";
import type { Db } from "../core/store";
import { CommentBox } from "./CommentBox";
import { Board } from "./Board";
import { arrow, formatMoves, PositionTitle } from "./common";
import { EngineLines, EvalBar, useAnalysis } from "./engineView";

/** Explore analysis stops at this depth so an idle board does not keep the CPU busy. */
const EXPLORE_DEPTH = 24;

/** Above this many book moves, only the hovered move gets an arrow. */
const MAX_ARROWS = 5;

interface Cursor {
  /** Start position set up from a FEN or a PGN header; the standard start when undefined. */
  startFen?: string;
  /** Moves played, including moves after the cursor kept for stepping forward. */
  moves: string[];
  /** Number of moves applied to the board. */
  ply: number;
}

/** A position another tab asks Explore to show; a new `id` repeats a request for the same moves. */
export interface ExploreRequest {
  ucis: string[];
  /** The side the user studies, shown at the bottom. */
  orientation: "white" | "black";
  id: number;
}

interface Props {
  book: OpeningBook;
  db: Db | undefined;
  /** False while another tab is shown: keys are ignored and the engine pauses. */
  active: boolean;
  /** Shows this position with the engine on, replacing the current moves. */
  request?: ExploreRequest;
}

export function ExploreView({ book, db, active, request }: Props) {
  const [cursor, setCursor] = useState<Cursor>({ moves: [], ply: 0 });
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [hovered, setHovered] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [engineOn, setEngineOn] = useState(false);

  useEffect(() => {
    if (!request) return;
    setCursor({ moves: request.ucis, ply: request.ucis.length });
    setOrientation(request.orientation);
    setQuery("");
    setEngineOn(true);
  }, [request]);

  const { startFen } = cursor;
  const firstPly = firstPlyOf(startFen);
  const path = useMemo(() => cursor.moves.slice(0, cursor.ply), [cursor]);
  const state = useMemo(() => explore(book, path, startFen)!, [book, path, startFen]);
  const hit = useMemo(() => findPosition(book, query), [book, query]);
  const results = useMemo(
    () => (hit ? (hit.startFen ? [] : linesWithPrefix(book, hit.ucis)) : searchLines(book, query)),
    [book, query, hit],
  );
  const lastMove = path.at(-1);
  const beforeLast = useMemo(
    () => (path.length > 0 ? explore(book, path.slice(0, -1), startFen)?.epd : undefined),
    [book, path, startFen],
  );
  const engine = useAnalysis(
    engineOn && active ? state.fen : undefined,
    { depth: EXPLORE_DEPTH, multipv: 3 },
    "explore",
  );
  const best = engine.analysis?.lines[0];
  const allSans = useMemo(() => explore(book, cursor.moves, startFen)?.sans ?? [], [book, cursor.moves, startFen]);

  const play = useCallback((uci: string) => {
    setCursor((c) =>
      c.moves[c.ply] === uci
        ? { ...c, ply: c.ply + 1 }
        : { ...c, moves: [...c.moves.slice(0, c.ply), uci], ply: c.ply + 1 },
    );
  }, []);

  const goTo = useCallback((ply: number) => {
    setCursor((c) => ({ ...c, ply: Math.max(0, Math.min(ply, c.moves.length)) }));
  }, []);

  /** Shows a search or paste result: its start position and all of its moves. */
  const show = useCallback((h: PositionHit) => {
    setCursor({ startFen: h.startFen, moves: h.ucis, ply: h.ucis.length });
    setQuery("");
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft") goTo(cursor.ply - 1);
      else if (e.key === "ArrowRight") goTo(cursor.ply + 1);
      else if (e.key === "Home") goTo(0);
      else if (e.key === "End") goTo(cursor.moves.length);
      else if (e.key === "f") setOrientation((o) => (o === "white" ? "black" : "white"));
      else if (e.key === "e") setEngineOn((on) => !on);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, cursor, goTo]);

  const bestMove = best?.pv[0];
  const shapes = useMemo<DrawShape[]>(() => {
    const out = state.bookMoves
      .filter((m) => m.uci === hovered || state.bookMoves.length <= MAX_ARROWS)
      .map((m) => arrow(m.uci, m.uci === hovered ? "green" : "paleGreen"));
    if (bestMove) out.push(arrow(bestMove, "blue"));
    return out;
  }, [state.bookMoves, hovered, bestMove]);

  const playLine = useCallback(
    (ucis: string[]) => setCursor({ startFen, moves: [...path, ...ucis], ply: path.length + ucis.length }),
    [startFen, path],
  );

  return (
    <div className="explore">
      <div className="board-column">
        <div className="board-row">
          {engineOn && <EvalBar score={best?.score} orientation={orientation} />}
          <Board
            pos={state.pos}
            fen={state.fen}
            orientation={orientation}
            lastMove={path[path.length - 1]}
            shapes={shapes}
            onMove={play}
          />
        </div>
        <div className="controls">
          <button onClick={() => goTo(0)} disabled={cursor.ply === 0} title="Start (Home)">
            ⏮
          </button>
          <button onClick={() => goTo(cursor.ply - 1)} disabled={cursor.ply === 0} title="Back (←)">
            ◀
          </button>
          <button onClick={() => goTo(cursor.ply + 1)} disabled={cursor.ply >= cursor.moves.length} title="Forward (→)">
            ▶
          </button>
          <button
            onClick={() => goTo(cursor.moves.length)}
            disabled={cursor.ply >= cursor.moves.length}
            title="End (End)"
          >
            ⏭
          </button>
          <button onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))} title="Flip board (F)">
            ⇅ Flip
          </button>
          <button
            className={engineOn ? "on" : ""}
            onClick={() => setEngineOn((on) => !on)}
            disabled={!engine.available}
            title={engine.available ? "Stockfish analysis (E)" : "No engine available"}
          >
            Engine
          </button>
        </div>
      </div>

      <aside className="panel">
        <input
          className="search"
          type="search"
          placeholder="Search by name or ECO, or paste moves, a FEN or a PGN"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onPaste={(e) => {
            // A single-line input drops a PGN's line breaks, so read the clipboard directly.
            const h = findPosition(book, e.clipboardData.getData("text"));
            if (!h) return;
            e.preventDefault();
            show(h);
          }}
        />
        {query.trim() !== "" ? (
          <ul className="results">
            {hit && (
              <li>
                <button className="next" onClick={() => show(hit)}>
                  {hit.startFen && hit.ucis.length === 0
                    ? "Set up this position"
                    : hit.startFen
                      ? `Set up the position and play ${formatMoves(hit.sans, firstPlyOf(hit.startFen))}`
                      : `Go to the position after ${formatMoves(hit.sans)}`}
                  {!hit.inBook && <span className="warn"> (out of book)</span>}
                </button>
              </li>
            )}
            {hit && results.length > 0 && <li className="muted">Lines that start this way:</li>}
            {!hit && results.length === 0 && <li className="muted">No matches</li>}
            {results.map((l) => (
              <li key={l.id}>
                <button
                  onClick={() => {
                    show({ kind: "moves", ucis: l.ucis, sans: l.sans, inBook: true });
                  }}
                >
                  <span className="eco">{l.eco}</span> {l.name}
                  <span className="muted moves">{l.sans.join(" ")}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <PositionTitle
              state={state}
              fallback={cursor.ply === 0 ? (startFen ? "Set-up position" : "Starting position") : "Unnamed position"}
            />

            {lastMove && beforeLast && <CommentBox db={db} epd={beforeLast} uci={lastMove} san={state.sans.at(-1)!} />}

            <section>
              <h2>Moves</h2>
              {startFen && (
                <p className="muted setup-note">
                  From a set-up position.{" "}
                  <button className="link" onClick={() => setCursor({ moves: [], ply: 0 })}>
                    Back to the standard start
                  </button>
                </p>
              )}
              {cursor.moves.length === 0 && <p className="muted">None</p>}
              <div className="movelist-flat">
                {cursor.moves.map((_, i) => {
                  // Move numbers follow the start position, which can be Black to move at move 40.
                  const p = firstPly + i;
                  const number = p % 2 === 0 ? `${p / 2 + 1}.` : i === 0 ? `${(p + 1) / 2}…` : "";
                  return (
                    <span key={i}>
                      {number && <span className="muted">{number}</span>}
                      <MoveButton ply={i} cursor={cursor} sans={allSans} onClick={goTo} />
                    </span>
                  );
                })}
              </div>
            </section>

            {engineOn && (
              <section>
                <h2>
                  Engine{engine.analysis ? ` · depth ${engine.analysis.depth}` : ""}
                  {engine.running ? "" : engine.analysis ? " · done" : ""}
                </h2>
                <EngineLines fen={state.fen} analysis={engine.analysis} onSelect={playLine} />
              </section>
            )}

            <section>
              <h2>Book moves</h2>
              {state.bookMoves.length === 0 && <p className="muted">None</p>}
              <ul className="bookmoves">
                {state.bookMoves.map((m) => (
                  <li key={m.uci}>
                    <button
                      onClick={() => play(m.uci)}
                      onMouseEnter={() => setHovered(m.uci)}
                      onMouseLeave={() => setHovered(undefined)}
                    >
                      <span className="san">{m.san}</span>
                      <span className="label">{m.label}</span>
                      <span className="muted count">{m.lineCount}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}

function MoveButton(props: { ply: number; cursor: Cursor; sans: string[]; onClick: (ply: number) => void }) {
  const { ply, cursor, sans, onClick } = props;
  return (
    <button
      className={ply + 1 === cursor.ply ? "move current" : ply < cursor.ply ? "move" : "move future"}
      onClick={() => onClick(ply + 1)}
    >
      {sans[ply]}
    </button>
  );
}
