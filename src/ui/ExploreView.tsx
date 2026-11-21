import { useCallback, useEffect, useMemo, useState } from "react";
import type { DrawShape } from "chessground/draw";
import { epdOf, replay, type OpeningBook } from "../core/book";
import { explore, findPosition, linesWithPrefix, searchLines } from "../core/explore";
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

  const path = useMemo(() => cursor.moves.slice(0, cursor.ply), [cursor]);
  const state = useMemo(() => explore(book, path)!, [book, path]);
  const hit = useMemo(() => findPosition(book, query), [book, query]);
  const results = useMemo(
    () => (hit?.ucis ? linesWithPrefix(book, hit.ucis) : hit ? [] : searchLines(book, query)),
    [book, query, hit],
  );
  const lastMove = path.at(-1);
  const beforeLast = useMemo(() => (path.length > 0 ? epdOf(replay(path.slice(0, -1))!) : undefined), [path]);
  const engine = useAnalysis(
    engineOn && active ? state.fen : undefined,
    { depth: EXPLORE_DEPTH, multipv: 3 },
    "explore",
  );
  const best = engine.analysis?.lines[0];
  const allSans = useMemo(() => explore(book, cursor.moves)?.sans ?? [], [book, cursor.moves]);

  const play = useCallback((uci: string) => {
    setCursor(({ moves, ply }) =>
      moves[ply] === uci ? { moves, ply: ply + 1 } : { moves: [...moves.slice(0, ply), uci], ply: ply + 1 },
    );
  }, []);

  const goTo = useCallback((ply: number) => {
    setCursor(({ moves }) => ({ moves, ply: Math.max(0, Math.min(ply, moves.length)) }));
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
    (ucis: string[]) => setCursor({ moves: [...path, ...ucis], ply: path.length + ucis.length }),
    [path],
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
          placeholder="Search by name, ECO, moves (1. e4 c5) or FEN"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim() !== "" ? (
          <ul className="results">
            {hit && (
              <li>
                {hit.ucis ? (
                  <button
                    className="next"
                    onClick={() => {
                      setCursor({ moves: hit.ucis!, ply: hit.ucis!.length });
                      setQuery("");
                    }}
                  >
                    Go to the position after {formatMoves(hit.sans)}
                    {!hit.inBook && <span className="warn"> (out of book)</span>}
                  </button>
                ) : (
                  <p className="muted">That position is not in the book.</p>
                )}
              </li>
            )}
            {hit?.ucis && results.length > 0 && <li className="muted">Lines that start this way:</li>}
            {!hit && results.length === 0 && <li className="muted">No matches</li>}
            {results.map((l) => (
              <li key={l.id}>
                <button
                  onClick={() => {
                    setCursor({ moves: l.ucis, ply: l.ucis.length });
                    setQuery("");
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
            <PositionTitle state={state} fallback={cursor.ply === 0 ? "Starting position" : "Unnamed position"} />

            {lastMove && beforeLast && <CommentBox db={db} epd={beforeLast} uci={lastMove} san={state.sans.at(-1)!} />}

            <section>
              <h2>Moves</h2>
              {cursor.moves.length === 0 && <p className="muted">None</p>}
              <ol className="movelist">
                {cursor.moves.map((_, i) =>
                  i % 2 === 0 ? (
                    <li key={i}>
                      <MoveButton ply={i} cursor={cursor} sans={allSans} onClick={goTo} />
                      {i + 1 < cursor.moves.length && (
                        <MoveButton ply={i + 1} cursor={cursor} sans={allSans} onClick={goTo} />
                      )}
                    </li>
                  ) : null,
                )}
              </ol>
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
