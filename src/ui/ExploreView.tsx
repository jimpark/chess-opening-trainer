import { useCallback, useEffect, useMemo, useState } from "react";
import type { DrawShape } from "chessground/draw";
import type { OpeningBook } from "../core/book";
import { explore, searchLines } from "../core/explore";
import { Board, uciSquares } from "./Board";

/** Above this many book moves, only the hovered move gets an arrow. */
const MAX_ARROWS = 5;

interface Cursor {
  /** Moves played, including moves after the cursor kept for stepping forward. */
  moves: string[];
  /** Number of moves applied to the board. */
  ply: number;
}

export function ExploreView({ book }: { book: OpeningBook }) {
  const [cursor, setCursor] = useState<Cursor>({ moves: [], ply: 0 });
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [hovered, setHovered] = useState<string | undefined>();
  const [query, setQuery] = useState("");

  const path = useMemo(() => cursor.moves.slice(0, cursor.ply), [cursor]);
  const state = useMemo(() => explore(book, path)!, [book, path]);
  const results = useMemo(() => searchLines(book, query), [book, query]);
  const allSans = useMemo(() => explore(book, cursor.moves)?.sans ?? [], [book, cursor.moves]);

  const play = useCallback((uci: string) => {
    setCursor(({ moves, ply }) =>
      moves[ply] === uci
        ? { moves, ply: ply + 1 }
        : { moves: [...moves.slice(0, ply), uci], ply: ply + 1 },
    );
  }, []);

  const goTo = useCallback((ply: number) => {
    setCursor(({ moves }) => ({ moves, ply: Math.max(0, Math.min(ply, moves.length)) }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft") goTo(cursor.ply - 1);
      else if (e.key === "ArrowRight") goTo(cursor.ply + 1);
      else if (e.key === "Home") goTo(0);
      else if (e.key === "End") goTo(cursor.moves.length);
      else if (e.key === "f") setOrientation((o) => (o === "white" ? "black" : "white"));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cursor, goTo]);

  const shapes = useMemo<DrawShape[]>(
    () =>
      state.bookMoves
        .filter((m) => m.uci === hovered || state.bookMoves.length <= MAX_ARROWS)
        .map((m) => {
          const [orig, dest] = uciSquares(m.uci);
          return { orig, dest, brush: m.uci === hovered ? "green" : "paleGreen" };
        }),
    [state.bookMoves, hovered],
  );

  return (
    <div className="explore">
      <div className="board-column">
        <Board
          pos={state.pos}
          fen={state.fen}
          orientation={orientation}
          lastMove={path[path.length - 1]}
          shapes={shapes}
          onMove={play}
        />
        <div className="controls">
          <button onClick={() => goTo(0)} disabled={cursor.ply === 0} title="Start (Home)">⏮</button>
          <button onClick={() => goTo(cursor.ply - 1)} disabled={cursor.ply === 0} title="Back (←)">◀</button>
          <button onClick={() => goTo(cursor.ply + 1)} disabled={cursor.ply >= cursor.moves.length} title="Forward (→)">▶</button>
          <button onClick={() => goTo(cursor.moves.length)} disabled={cursor.ply >= cursor.moves.length} title="End (End)">⏭</button>
          <button onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))} title="Flip board (F)">⇅ Flip</button>
        </div>
      </div>

      <aside className="panel">
        <input
          className="search"
          type="search"
          placeholder="Search openings by name or ECO"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim() !== "" ? (
          <ul className="results">
            {results.length === 0 && <li className="muted">No matches</li>}
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
            <header className="title">
              <h1>
                {state.eco && <span className="eco">{state.eco}</span>}
                {state.name ?? (cursor.ply === 0 ? "Starting position" : "Unnamed position")}
              </h1>
              {!state.inBook && <p className="warn">Out of book</p>}
              {state.transpositions.length > 0 && (
                <p className="muted also">
                  Also reached from:{" "}
                  {state.transpositions.slice(0, 3).map((t, i) => (
                    <span key={i} title={formatMoves(t.sans)}>
                      {i > 0 && "; "}
                      {t.name}
                    </span>
                  ))}
                  {state.transpositions.length > 3 && ` +${state.transpositions.length - 3} more`}
                </p>
              )}
            </header>

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

function formatMoves(sans: string[]): string {
  return sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(" ");
}
