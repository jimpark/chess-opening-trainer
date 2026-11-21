import type { Color } from "chessops/types";
import { epdOf, replay, type OpeningBook } from "./book";
import { doneLeafCount, nameOf, subtreeDone, type StudyNode, type StudyTree } from "./study";

export type QuizFeedback =
  | { kind: "correct" }
  /** The move left the current branch but reached a position elsewhere in the opening. */
  | { kind: "transposed"; name: string | undefined }
  /** The move is in the book but outside this opening. Not counted as a mistake. */
  | { kind: "otherBook"; uci: string; label: string | undefined }
  | { kind: "wrong"; uci: string }
  | { kind: "complete"; name: string | undefined };

/** Grade for one user move, used for spaced repetition. */
export type Grade = "good" | "hard" | "again";

export interface MoveResult {
  /** Node where the user was to move. */
  nodeId: number;
  grade: Grade;
}

export interface QuizState {
  color: Color;
  nodeId: number;
  /** Child the user picked to follow at their own branch point. The hint shows its move. */
  selectedId: number | undefined;
  /** 0: no hint, 1: piece highlighted, 2: move shown. */
  hintLevel: 0 | 1 | 2;
  /** Mistakes at the current position. */
  mistakesHere: number;
  feedback: QuizFeedback | undefined;
  /** Leaves of lines completed in this session. */
  done: ReadonlySet<number>;
  results: readonly MoveResult[];
}

export type Turn = "user" | "opponent" | "complete";

export function startQuiz(tree: StudyTree, color: Color): QuizState {
  return {
    color,
    nodeId: tree.root.id,
    selectedId: undefined,
    hintLevel: 0,
    mistakesHere: 0,
    feedback: undefined,
    done: new Set(),
    results: [],
  };
}

export function turnOf(tree: StudyTree, s: QuizState): Turn {
  const node = tree.nodes[s.nodeId];
  if (node.children.length === 0) return "complete";
  return node.turn === s.color ? "user" : "opponent";
}

/** The move the hint points to: the selected variation, else the first branch not yet done. */
export function expectedChild(tree: StudyTree, s: QuizState): StudyNode | undefined {
  const node = tree.nodes[s.nodeId];
  if (s.selectedId !== undefined) return tree.nodes[s.selectedId];
  return node.children.find((c) => !subtreeDone(c, s.done)) ?? node.children[0];
}

export function hint(s: QuizState): QuizState {
  return { ...s, hintLevel: Math.min(2, s.hintLevel + 1) as 0 | 1 | 2 };
}

export function selectVariation(s: QuizState, childId: number): QuizState {
  return { ...s, selectedId: childId };
}

export function userMove(tree: StudyTree, book: OpeningBook, s: QuizState, uci: string): QuizState {
  if (turnOf(tree, s) !== "user") return s;
  const node = tree.nodes[s.nodeId];

  const child = node.children.find((c) => c.ucis[c.ucis.length - 1] === uci);
  if (child) return advance(s, child, { kind: "correct" }, true);

  const pos = replay([...node.ucis, uci]);
  if (!pos) return s;
  const epd = epdOf(pos);

  const same = tree.byEpd.get(epd);
  if (same) {
    const target = same.find((n) => !subtreeDone(n, s.done)) ?? same[0];
    return advance(s, target, { kind: "transposed", name: nameOf(target) }, true);
  }

  if (book.get(epd)) {
    return { ...s, feedback: { kind: "otherBook", uci, label: book.labelFor(epd) } };
  }

  return { ...s, mistakesHere: s.mistakesHere + 1, feedback: { kind: "wrong", uci } };
}

export function opponentMove(tree: StudyTree, s: QuizState, childId: number): QuizState {
  if (turnOf(tree, s) !== "opponent") return s;
  return advance(s, tree.nodes[childId], undefined, false);
}

/**
 * Opponent reply for auto mode. Picks a branch at random, weighted by the lines it has not
 * completed, so main lines come up more often than sidelines. Once every branch is done, weights
 * by all lines.
 */
export function autoOpponentChild(tree: StudyTree, s: QuizState, random = Math.random): StudyNode {
  const children = tree.nodes[s.nodeId].children;
  let weights = children.map((c) => c.leafCount - doneLeafCount(c, s.done));
  if (weights.every((w) => w === 0)) weights = children.map((c) => c.leafCount);
  let r = random() * weights.reduce((a, b) => a + b, 0);
  for (const [i, w] of weights.entries()) {
    if (r < w) return children[i];
    r -= w;
  }
  return children[children.length - 1];
}

/** Returns to the start position, keeping completed lines and results. */
export function restart(tree: StudyTree, s: QuizState): QuizState {
  return { ...s, nodeId: tree.root.id, selectedId: undefined, hintLevel: 0, mistakesHere: 0, feedback: undefined };
}

export function gradeOf(mistakes: number, hintLevel: number): Grade {
  if (mistakes > 0 || hintLevel >= 2) return "again";
  if (hintLevel === 1) return "hard";
  return "good";
}

function advance(
  s: QuizState,
  target: StudyNode,
  feedback: QuizFeedback | undefined,
  byUser: boolean,
): QuizState {
  const results = byUser
    ? [...s.results, { nodeId: s.nodeId, grade: gradeOf(s.mistakesHere, s.hintLevel) }]
    : s.results;
  let done = s.done;
  if (target.children.length === 0) {
    done = new Set(done).add(target.id);
    feedback = { kind: "complete", name: nameOf(target) };
  }
  return {
    ...s,
    nodeId: target.id,
    selectedId: undefined,
    hintLevel: 0,
    mistakesHere: 0,
    feedback,
    done,
    results,
  };
}
