import { useEffect, useMemo, useRef, useState } from "react";
import type { DrawShape } from "chessground/draw";
import { replay, type OpeningBook } from "../core/book";
import { explore } from "../core/explore";
import {
  autoOpponentChild,
  expectedChild,
  hint,
  opponentMove,
  restart,
  retarget,
  selectVariation,
  startQuiz,
  turnOf,
  userMove,
  type QuizState,
} from "../core/quiz";
import { doneLeafCount, pathTo, subtreeDone } from "../core/study";
import { Board } from "./Board";
import { arrow, circle, MoveList, PositionTitle } from "./common";
import { lossInPawns, PvMoves, useAnalysis } from "./engineView";
import { makeFen } from "chessops/fen";
import { sanLine } from "../core/explore";
import { formatScore, scoreValue } from "../core/uci";
import type { RepertoireState } from "./useRepertoire";

/** Search depth for judging a move the user played. */
const MISTAKE_DEPTH = 16;

/** Delay before the app plays the opponent's move, so the user sees it happen. */
const OPPONENT_DELAY_MS = 500;

export interface ReviewPlan {
  /** Leaf node ids of the lines to play, in order. */
  targets: number[];
  onFinish: () => void;
}

interface Props {
  book: OpeningBook;
  rep: RepertoireState;
  /** In a review, the lines to play. Only positions that already have cards are graded. */
  review?: ReviewPlan;
  /** Opens a position, as UCI moves from the start, in Explore. */
  onExplore: (ucis: string[], orientation: "white" | "black") => void;
}

export function QuizView({ book, rep, review, onExplore }: Props) {
  const { tree, color } = rep;
  const [s, setS] = useState<QuizState>(() =>
    review ? startQuiz(tree, color, review.targets[0]) : { ...startQuiz(tree, color), done: rep.completed },
  );
  const [lineIndex, setLineIndex] = useState(0);
  const [auto, setAuto] = useState(false);

  // Save each new answer to its card.
  const recorded = useRef(0);
  useEffect(() => {
    for (const r of s.results.slice(recorded.current)) rep.record(r, review !== undefined);
    recorded.current = s.results.length;
  }, [s.results, rep, review]);

  /** Engine line shown on the board, as UCI moves from the current position. */
  const [preview, setPreview] = useState<string[] | undefined>();
  useEffect(() => setPreview(undefined), [s]);

  const node = tree.nodes[s.nodeId];
  const turn = turnOf(tree, s);
  const pos = useMemo(() => replay(node.ucis)!, [node]);
  const info = useMemo(() => explore(book, node.ucis)!, [book, node]);
  const expected = turn === "user" ? expectedChild(tree, s) : undefined;
  const doneCount = doneLeafCount(tree.root, s.done);
  const allDone = doneCount === tree.leaves.length;
  const opponentChoice = turn === "opponent" && node.children.length > 1 && !auto && !review;

  // Save a completed line, outside reviews.
  const { markLine } = rep;
  useEffect(() => {
    if (turn === "complete" && !review) markLine("completed", node);
  }, [turn, node, review, markLine]);

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
  const previewPos = useMemo(() => (preview ? replay([...node.ucis, ...preview]) : undefined), [node, preview]);
  const fb = s.feedback;
  const judged = fb?.kind === "wrong" || fb?.kind === "otherBook" ? fb.uci : undefined;

  return (
    <div className="explore">
      <div className="board-column">
        <Board
          pos={previewPos ?? pos}
          fen={previewPos ? makeFen(previewPos.toSetup()) : node.fen}
          orientation={color}
          lastMove={preview ? preview.at(-1) : node.ucis.at(-1)}
          shapes={previewPos ? [] : shapes}
          interactive={turn === "user" && !previewPos}
          onMove={(uci) => setS((cur) => userMove(tree, book, cur, uci))}
        />
        <div className="controls">
          <button onClick={() => setS((cur) => hint(cur))} disabled={turn !== "user" || s.hintLevel >= 2}>
            {s.hintLevel === 0 ? "Hint: which piece" : "Hint: show move"}
          </button>
          <button onClick={() => setS((cur) => restart(tree, cur))}>Restart line</button>
          {!review && (
            <label className="toggle" title="Let the app choose the opponent's replies">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto replies
            </label>
          )}
        </div>
      </div>

      <aside className="panel">
        <PositionTitle state={info} fallback={node.parent ? "Unnamed position" : "Starting position"} />

        <p className="progress">
          {review ? (
            <>
              Review line {Math.min(lineIndex + 1, review.targets.length)} of {review.targets.length}
              <progress value={lineIndex + (turn === "complete" ? 1 : 0)} max={review.targets.length} />
            </>
          ) : (
            <>
              Lines completed: {doneCount} / {tree.leaves.length}
              <progress value={doneCount} max={tree.leaves.length} />
            </>
          )}
          {s.results.length > 0 && (
            <span className="muted">
              {" "}
              First try: {goodCount} / {s.results.length} moves
            </span>
          )}
        </p>

        <section>
          <h2>Moves</h2>
          <MoveList moves={pathTo(node)} currentId={node.id} />
        </section>

        <Feedback s={s} family={tree.family} />

        {preview && (
          <div className="preview-banner">
            <span>Showing the engine line on the board.</span>
            <button className="primary" onClick={() => setPreview(undefined)}>
              Back to quiz
            </button>
          </div>
        )}

        {judged && (
          <MoveJudgement
            fen={node.fen}
            played={judged}
            book={node.children.map((c) => c.ucis.at(-1)!)}
            onPreview={setPreview}
          />
        )}

        {turn === "user" && (
          <section>
            <h2>Your move</h2>
            {node.children.length > 1 && review && (
              <p className="muted">{node.children.length} book moves here. This review follows one of them.</p>
            )}
            {node.children.length > 1 && !review && (
              <>
                <p className="muted">
                  {node.children.length} book moves here. Any of them is correct. Pick one to make the hint follow it.
                </p>
                <ul className="bookmoves">
                  {node.children.map((c) => (
                    <li key={c.id}>
                      <button
                        className={c === expected ? "next" : ""}
                        onClick={() => setS((cur) => selectVariation(cur, c.id))}
                      >
                        <span className="san muted">?</span>
                        <span className="label">{book.labelFor(c.epd)}</span>
                        <span className="muted count">
                          {subtreeDone(c, s.done) ? "✓" : `${doneLeafCount(c, s.done)}/${c.leafCount}`}
                        </span>
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
                    <span className="muted count">
                      {subtreeDone(c, s.done) ? "✓" : `${doneLeafCount(c, s.done)}/${c.leafCount}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {turn === "complete" && (
          <button className="explore-here" onClick={() => onExplore(node.ucis, color)}>
            Explore from here with the engine
          </button>
        )}

        {turn === "complete" && review && (
          <section className="notice">
            {lineIndex + 1 < review.targets.length ? (
              <button
                className="primary"
                onClick={() => {
                  setS((cur) => retarget(tree, cur, review.targets[lineIndex + 1]));
                  setLineIndex((i) => i + 1);
                }}
              >
                Next line ({lineIndex + 2} of {review.targets.length})
              </button>
            ) : (
              <>
                <p>
                  Review complete. First try on {goodCount} of {s.results.length} moves.
                </p>
                <button className="primary" onClick={review.onFinish}>
                  Done
                </button>
              </>
            )}
          </section>
        )}

        {turn === "complete" && !review && (
          <section className="notice">
            {allDone ? (
              <>
                <p>All {tree.leaves.length} lines completed.</p>
                <button
                  className="primary"
                  onClick={() => {
                    rep.clearLines("completed");
                    setS(startQuiz(tree, color));
                  }}
                >
                  Start over
                </button>
              </>
            ) : (
              <button className="primary" onClick={() => setS((cur) => restart(tree, cur))}>
                Next line
              </button>
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
    case "redirected":
      return <p className="feedback good">Correct. That is also book; this review continues with {fb.san}.</p>;
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

/**
 * Engine comparison of the move the user played with this position's book moves, searched
 * together with searchmoves so the scores are comparable. Book moves are not named, so the user
 * can still find the answer.
 */
function MoveJudgement(props: { fen: string; played: string; book: string[]; onPreview: (ucis: string[]) => void }) {
  const { fen, played, book, onPreview } = props;
  const moves = [played, ...book];
  const { available, analysis, running } = useAnalysis(
    fen,
    { depth: MISTAKE_DEPTH, multipv: moves.length, searchmoves: moves },
    `${fen} ${moves.join(" ")}`,
  );
  if (!available) return null;

  const whiteToMove = fen.split(" ")[1] === "w";
  const byMove = new Map(analysis?.fen === fen ? analysis.lines.map((l) => [l.pv[0], l]) : []);
  const mine = byMove.get(played);
  const sign = whiteToMove ? 1 : -1;
  const bestBook = book
    .map((m) => byMove.get(m))
    .filter((l) => l !== undefined)
    .sort((a, b) => sign * (scoreValue(b.score) - scoreValue(a.score)))[0];
  const loss = mine && bestBook ? lossInPawns(mine.score, bestBook.score, whiteToMove) : undefined;
  const playedSan = sanLine(fen, [played])[0];

  return (
    <section>
      <h2>
        Engine{analysis ? ` · depth ${analysis.depth}` : ""}
        {running ? "…" : ""}
      </h2>
      {!mine || !bestBook ? (
        <p className="muted">Analyzing…</p>
      ) : (
        <>
          <table className="engine-compare">
            <tbody>
              <tr>
                <td>Your move {playedSan}</td>
                <td className="score">{formatScore(mine.score)}</td>
              </tr>
              <tr>
                <td>Best book move</td>
                <td className="score">{formatScore(bestBook.score)}</td>
              </tr>
            </tbody>
          </table>
          {loss !== undefined && (
            <p className="muted">
              {loss > 0.15
                ? `${playedSan} gives up about ${loss.toFixed(1)} pawns compared with the book.`
                : `${playedSan} is about as good as the book move by the engine's measure, but it is not the book move.`}
            </p>
          )}
          <p className="muted">Engine line after {playedSan}. Click a move to see it on the board:</p>
          <PvMoves fen={fen} pv={mine.pv} max={12} onSelect={onPreview} />
        </>
      )}
    </section>
  );
}
