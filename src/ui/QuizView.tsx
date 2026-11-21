import { useEffect, useMemo, useState } from "react";
import type { DrawShape } from "chessground/draw";
import type { Color } from "chessops/types";
import { replay, type OpeningBook } from "../core/book";
import { explore } from "../core/explore";
import {
  autoOpponentChild,
  expectedChild,
  hint,
  opponentMove,
  restart,
  selectVariation,
  startQuiz,
  turnOf,
  userMove,
  type QuizState,
} from "../core/quiz";
import { doneLeafCount, pathTo, subtreeDone, type StudyTree } from "../core/study";
import { Board } from "./Board";
import { arrow, circle, MoveList, PositionTitle } from "./common";

/** Delay before the app plays the opponent's move, so the user sees it happen. */
const OPPONENT_DELAY_MS = 500;

interface Props {
  book: OpeningBook;
  tree: StudyTree;
  color: Color;
}

export function QuizView({ book, tree, color }: Props) {
  const [s, setS] = useState<QuizState>(() => startQuiz(tree, color));
  const [auto, setAuto] = useState(false);

  const node = tree.nodes[s.nodeId];
  const turn = turnOf(tree, s);
  const pos = useMemo(() => replay(node.ucis)!, [node]);
  const info = useMemo(() => explore(book, node.ucis)!, [book, node]);
  const expected = turn === "user" ? expectedChild(tree, s) : undefined;
  const doneCount = doneLeafCount(tree.root, s.done);
  const allDone = doneCount === tree.leaves.length;
  const opponentChoice = turn === "opponent" && node.children.length > 1 && !auto;

  // The app plays the opponent's move when there is one reply, or in auto mode.
  useEffect(() => {
    if (turn !== "opponent" || opponentChoice) return;
    const timer = setTimeout(() => {
      setS((cur) => opponentMove(tree, cur, autoOpponentChild(tree, cur).id));
    }, OPPONENT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [tree, turn, opponentChoice, s.nodeId]);

  const shapes = useMemo<DrawShape[]>(() => {
    const out: DrawShape[] = [];
    const fb = s.feedback;
    if (fb?.kind === "wrong") out.push(arrow(fb.uci, "red"));
    if (fb?.kind === "otherBook") out.push(arrow(fb.uci, "yellow"));
    if (expected && s.hintLevel === 1) out.push(circle(expected.ucis.at(-1)!, "green"));
    if (expected && s.hintLevel === 2) out.push(arrow(expected.ucis.at(-1)!, "green"));
    return out;
  }, [s.feedback, s.hintLevel, expected]);

  const goodCount = s.results.filter((r) => r.grade === "good").length;

  return (
    <div className="explore">
      <div className="board-column">
        <Board
          pos={pos}
          fen={node.fen}
          orientation={color}
          lastMove={node.ucis.at(-1)}
          shapes={shapes}
          interactive={turn === "user"}
          onMove={(uci) => setS((cur) => userMove(tree, book, cur, uci))}
        />
        <div className="controls">
          <button onClick={() => setS((cur) => hint(cur))} disabled={turn !== "user" || s.hintLevel >= 2}>
            {s.hintLevel === 0 ? "Hint: which piece" : "Hint: show move"}
          </button>
          <button onClick={() => setS((cur) => restart(tree, cur))}>Restart line</button>
          <label className="toggle" title="Let the app choose the opponent's replies">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto replies
          </label>
        </div>
      </div>

      <aside className="panel">
        <PositionTitle state={info} fallback={node.parent ? "Unnamed position" : "Starting position"} />

        <p className="progress">
          Lines completed: {doneCount} / {tree.leaves.length}
          <progress value={doneCount} max={tree.leaves.length} />
          {s.results.length > 0 && (
            <span className="muted"> First try: {goodCount} / {s.results.length} moves</span>
          )}
        </p>

        <section>
          <h2>Moves</h2>
          <MoveList moves={pathTo(node)} currentId={node.id} />
        </section>

        <Feedback s={s} family={tree.family} />

        {turn === "user" && (
          <section>
            <h2>Your move</h2>
            {node.children.length > 1 && (
              <>
                <p className="muted">
                  {node.children.length} book moves here. Any of them is correct. Pick one to make the hint follow it.
                </p>
                <ul className="bookmoves">
                  {node.children.map((c) => (
                    <li key={c.id}>
                      <button className={c === expected ? "next" : ""} onClick={() => setS((cur) => selectVariation(cur, c.id))}>
                        <span className="san muted">?</span>
                        <span className="label">{book.labelFor(c.epd)}</span>
                        <span className="muted count">{subtreeDone(c, s.done) ? "✓" : `${doneLeafCount(c, s.done)}/${c.leafCount}`}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {opponentChoice && (
          <section>
            <h2>Choose the opponent's reply</h2>
            <ul className="bookmoves">
              {node.children.map((c) => (
                <li key={c.id}>
                  <button onClick={() => setS((cur) => opponentMove(tree, cur, c.id))}>
                    <span className="san">{c.san}</span>
                    <span className="label">{book.labelFor(c.epd)}</span>
                    <span className="muted count">{subtreeDone(c, s.done) ? "✓" : `${doneLeafCount(c, s.done)}/${c.leafCount}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {turn === "complete" && (
          <section className="notice">
            {allDone ? (
              <>
                <p>All {tree.leaves.length} lines completed.</p>
                <button className="primary" onClick={() => setS(startQuiz(tree, color))}>Start over</button>
              </>
            ) : (
              <button className="primary" onClick={() => setS((cur) => restart(tree, cur))}>Next line</button>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}

function Feedback({ s, family }: { s: QuizState; family: string }) {
  const fb = s.feedback;
  if (!fb) return null;
  switch (fb.kind) {
    case "correct":
      return <p className="feedback good">Correct.</p>;
    case "transposed":
      return <p className="feedback good">Correct. That move order transposes to {fb.name ?? "another line"}.</p>;
    case "otherBook":
      return (
        <p className="feedback info">
          That is a book move ({fb.label ?? "another opening"}), but it leaves the {family}. Try again.
        </p>
      );
    case "wrong":
      return <p className="feedback bad">Wrong. Try again.</p>;
    case "complete":
      return <p className="feedback good">Line complete: {fb.name ?? "end of book"}.</p>;
  }
}
