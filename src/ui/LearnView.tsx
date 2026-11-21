import { useCallback, useEffect, useMemo, useState } from "react";
import type { DrawShape } from "chessground/draw";
import { replay, type OpeningBook } from "../core/book";
import { explore } from "../core/explore";
import { doneLeafCount, nearestOpenPosition, nextMoves, pathTo, subtreeDone } from "../core/study";
import { Board } from "./Board";
import { arrow, formatMoves, MoveList, PositionTitle } from "./common";
import type { RepertoireState } from "./useRepertoire";
import { CommentBox } from "./CommentBox";
import type { Db } from "../core/store";

const MAX_ARROWS = 5;

interface Props {
  book: OpeningBook;
  rep: RepertoireState;
  db: Db | undefined;
  /** False while Quiz or another tab is shown; keys are then ignored. */
  active: boolean;
  onQuiz: () => void;
  /** Opens a position, as UCI moves from the start, in Explore. */
  onExplore: (ucis: string[], orientation: "white" | "black") => void;
}

/** Walks through every line of an opening. The user picks the branch at each fork. */
export function LearnView({ book, rep, db, active, onQuiz, onExplore }: Props) {
  const { tree, color, seen, markLine } = rep;
  const [nodeId, setNodeId] = useState(tree.root.id);
  const [hovered, setHovered] = useState<number | undefined>();
  /** Set after following a transposed move: the move order the user had played. */
  const [transposedFrom, setTransposedFrom] = useState<string[] | undefined>();

  const node = tree.nodes[nodeId];
  const pos = useMemo(() => replay(node.ucis)!, [node]);
  const info = useMemo(() => explore(book, node.ucis)!, [book, node]);
  // The node's own moves plus moves other move orders play from this position.
  const moves = useMemo(() => nextMoves(tree, node), [tree, node]);
  const next = (moves.find((m) => !subtreeDone(m.node, seen)) ?? moves[0])?.node;
  const seenCount = doneLeafCount(tree.root, seen);
  const allSeen = seenCount === tree.leaves.length;

  /** Moves to a node. `from` is the current path when the move transposes into another branch. */
  const goTo = useCallback(
    (id: number, from?: string[]) => {
      setNodeId(id);
      setTransposedFrom(from);
      if (tree.nodes[id].children.length === 0) markLine("seen", tree.nodes[id]);
    },
    [tree, markLine],
  );
  /** Follows one of `moves`; a transposed move records the move order the user had played. */
  const follow = useCallback(
    (id: number) => {
      const transposed = moves.some((m) => m.node.id === id && m.transposed);
      goTo(id, transposed ? [...pathTo(node).map((n) => n.san), tree.nodes[id].san] : undefined);
    },
    [goTo, moves, node, tree],
  );
  const jump = useCallback((id: number) => {
    setNodeId(id);
    setTransposedFrom(undefined);
  }, []);

  const forward = useCallback(() => next && follow(next.id), [next, follow]);
  const back = useCallback(() => node.parent && jump(node.parent.id), [node, jump]);
  const nextLine = useCallback(() => {
    const open = nearestOpenPosition(tree, node, seen);
    if (open) jump(open.id);
  }, [tree, node, seen, jump]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") forward();
      else if (e.key === "ArrowLeft") back();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, forward, back]);

  const onMove = (uci: string) => {
    const m = moves.find((c) => c.node.ucis.at(-1) === uci);
    if (m) follow(m.node.id);
  };

  const shapes = useMemo<DrawShape[]>(() => {
    const few = moves.length <= MAX_ARROWS;
    return moves
      .map((m) => m.node)
      .filter((c) => few || c === next || c.id === hovered)
      .map((c) => arrow(c.ucis.at(-1)!, c === next || c.id === hovered ? "green" : "paleGreen"));
  }, [moves, next, hovered]);

  return (
    <div className="explore">
      <div className="board-column">
        <Board
          pos={pos}
          fen={node.fen}
          orientation={color}
          lastMove={node.ucis.at(-1)}
          shapes={shapes}
          onMove={onMove}
        />
        <div className="controls">
          <button onClick={() => jump(tree.root.id)} disabled={!node.parent} title="Start">
            ⏮
          </button>
          <button onClick={back} disabled={!node.parent} title="Back (←)">
            ◀ Back
          </button>
          <button onClick={forward} disabled={!next} title="Next move (→)">
            Next ▶
          </button>
          <button onClick={() => onExplore(node.ucis, color)} title="Open this position in Explore with the engine on">
            Explore from here
          </button>
        </div>
      </div>

      <aside className="panel">
        <PositionTitle state={info} fallback={node.parent ? "Unnamed position" : "Starting position"} />

        <p className="progress">
          Lines seen: {seenCount} / {tree.leaves.length}
          <progress value={seenCount} max={tree.leaves.length} />
        </p>

        <section>
          <h2>Moves</h2>
          <MoveList moves={pathTo(node)} currentId={node.id} onSelect={jump} />
          {transposedFrom && (
            <p className="muted transposed-note">
              Transposed: you played {formatMoves(transposedFrom)}. This line reaches the same position by the move
              order above.
            </p>
          )}
        </section>

        {node.parent && <CommentBox db={db} epd={node.parent.epd} uci={node.ucis.at(-1)!} san={node.san} />}

        {moves.length > 0 ? (
          <section>
            <h2>
              {moves.length > 1 ? `${moves.length} variations: choose one` : "Next move"}
              {node.turn === color ? " (your move)" : " (opponent)"}
            </h2>
            <ul className="bookmoves">
              {moves.map(({ node: c, transposed }) => (
                <li key={c.id}>
                  <button
                    className={c === next ? "next" : ""}
                    onClick={() => follow(c.id)}
                    onMouseEnter={() => setHovered(c.id)}
                    onMouseLeave={() => setHovered(undefined)}
                    title={
                      transposed
                        ? `Continues by another move order: ${formatMoves(pathTo(c).map((n) => n.san))}`
                        : undefined
                    }
                  >
                    <span className="san">{c.san}</span>
                    <span className="label">{book.labelFor(c.epd)}</span>
                    {transposed && <span className="badge">transposes</span>}
                    <span className="muted count">
                      {subtreeDone(c, seen) ? "✓" : `${doneLeafCount(c, seen)}/${c.leafCount}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="notice">
            <p>
              <strong>End of line.</strong> {node.endingNames[0]}
            </p>
            <button onClick={() => onExplore(node.ucis, color)}>Explore from here with the engine</button>
            {allSeen ? (
              <>
                <p>You have seen all {tree.leaves.length} lines.</p>
                <button className="primary" onClick={onQuiz}>
                  Start the quiz
                </button>
                <button className="link" onClick={() => rep.clearLines("seen")}>
                  Mark all lines unseen
                </button>
              </>
            ) : (
              <button className="primary" onClick={nextLine}>
                Next unseen line
              </button>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}
