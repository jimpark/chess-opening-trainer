import { useCallback, useEffect, useMemo, useState } from "react";
import type { DrawShape } from "chessground/draw";
import type { Color } from "chessops/types";
import { replay, type OpeningBook } from "../core/book";
import { explore } from "../core/explore";
import { doneLeafCount, nearestOpenBranch, pathTo, subtreeDone, type StudyTree } from "../core/study";
import { Board } from "./Board";
import { arrow, MoveList, PositionTitle } from "./common";

const MAX_ARROWS = 5;

interface Props {
  book: OpeningBook;
  tree: StudyTree;
  color: Color;
  onQuiz: () => void;
}

/** Walks through every line of an opening. The user picks the branch at each fork. */
export function LearnView({ book, tree, color, onQuiz }: Props) {
  const [nodeId, setNodeId] = useState(tree.root.id);
  const [seen, setSeen] = useState<ReadonlySet<number>>(new Set());
  const [hovered, setHovered] = useState<number | undefined>();

  const node = tree.nodes[nodeId];
  const pos = useMemo(() => replay(node.ucis)!, [node]);
  const info = useMemo(() => explore(book, node.ucis)!, [book, node]);
  const next = node.children.find((c) => !subtreeDone(c, seen)) ?? node.children[0];
  const seenCount = doneLeafCount(tree.root, seen);
  const allSeen = seenCount === tree.leaves.length;

  const goTo = useCallback(
    (id: number) => {
      setNodeId(id);
      if (tree.nodes[id].children.length === 0) setSeen((s) => new Set(s).add(id));
    },
    [tree],
  );

  const forward = useCallback(() => next && goTo(next.id), [next, goTo]);
  const back = useCallback(() => node.parent && setNodeId(node.parent.id), [node]);
  const nextLine = useCallback(() => {
    const branch = nearestOpenBranch(node, seen);
    if (branch) setNodeId(branch.id);
  }, [node, seen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") forward();
      else if (e.key === "ArrowLeft") back();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [forward, back]);

  const onMove = (uci: string) => {
    const child = node.children.find((c) => c.ucis.at(-1) === uci);
    if (child) goTo(child.id);
  };

  const shapes = useMemo<DrawShape[]>(() => {
    const few = node.children.length <= MAX_ARROWS;
    return node.children
      .filter((c) => few || c === next || c.id === hovered)
      .map((c) => arrow(c.ucis.at(-1)!, c === next || c.id === hovered ? "green" : "paleGreen"));
  }, [node, next, hovered]);

  return (
    <div className="explore">
      <div className="board-column">
        <Board pos={pos} fen={node.fen} orientation={color} lastMove={node.ucis.at(-1)} shapes={shapes} onMove={onMove} />
        <div className="controls">
          <button onClick={() => setNodeId(tree.root.id)} disabled={!node.parent} title="Start">⏮</button>
          <button onClick={back} disabled={!node.parent} title="Back (←)">◀ Back</button>
          <button onClick={forward} disabled={!next} title="Next move (→)">Next ▶</button>
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
          <MoveList moves={pathTo(node)} currentId={node.id} onSelect={setNodeId} />
        </section>

        {node.children.length > 0 ? (
          <section>
            <h2>
              {node.children.length > 1 ? `${node.children.length} variations: choose one` : "Next move"}
              {node.turn === color ? " (your move)" : " (opponent)"}
            </h2>
            <ul className="bookmoves">
              {node.children.map((c) => (
                <li key={c.id}>
                  <button
                    className={c === next ? "next" : ""}
                    onClick={() => goTo(c.id)}
                    onMouseEnter={() => setHovered(c.id)}
                    onMouseLeave={() => setHovered(undefined)}
                  >
                    <span className="san">{c.san}</span>
                    <span className="label">{book.labelFor(c.epd)}</span>
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
            {allSeen ? (
              <>
                <p>You have seen all {tree.leaves.length} lines.</p>
                <button className="primary" onClick={onQuiz}>Start the quiz</button>
              </>
            ) : (
              <button className="primary" onClick={nextLine}>Next unseen line</button>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}
