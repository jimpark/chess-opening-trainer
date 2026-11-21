import type { DrawShape } from "chessground/draw";
import type { ExploreState } from "../core/explore";
import { uciSquares } from "./Board";

/** Formats SAN moves with move numbers: "1. e4 e5 2. Nf3". */
export function formatMoves(sans: string[], firstPly = 0): string {
  return sans
    .map((s, i) => {
      const ply = firstPly + i;
      if (ply % 2 === 0) return `${ply / 2 + 1}. ${s}`;
      return i === 0 ? `${(ply + 1) / 2}... ${s}` : s;
    })
    .join(" ");
}

/** Opening name, ECO code, out-of-book warning and other move orders for a position. */
export function PositionTitle({ state, fallback }: { state: ExploreState; fallback: string }) {
  return (
    <header className="title">
      <h1>
        {state.eco && <span className="eco">{state.eco}</span>}
        {state.name ?? fallback}
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
  );
}

/** Arrow for a UCI move. */
export function arrow(uci: string, brush: string): DrawShape {
  const [orig, dest] = uciSquares(uci);
  return { orig, dest, brush };
}

/** Circle on the origin square of a UCI move. */
export function circle(uci: string, brush: string): DrawShape {
  return { orig: uciSquares(uci)[0], brush };
}

export interface PathMove {
  id: number;
  san: string;
}

/** Numbered move list. Moves are clickable when `onSelect` is given. */
export function MoveList({ moves, currentId, onSelect }: { moves: PathMove[]; currentId: number; onSelect?: (id: number) => void }) {
  if (moves.length === 0) return <p className="muted">None</p>;
  const item = (m: PathMove) => (
    <button
      className={m.id === currentId ? "move current" : "move"}
      onClick={onSelect && (() => onSelect(m.id))}
      disabled={!onSelect}
    >
      {m.san}
    </button>
  );
  return (
    <ol className="movelist">
      {moves.map((m, i) =>
        i % 2 === 0 ? (
          <li key={m.id}>
            {item(m)}
            {moves[i + 1] && item(moves[i + 1])}
          </li>
        ) : null,
      )}
    </ol>
  );
}
