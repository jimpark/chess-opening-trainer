import type { Color } from "chessops/types";
import { epdOf, replay, type OpeningBook } from "./book";
import { doneLeafCount, nameOf, subtreeDone, type StudyNode, type StudyTree } from "./study";

export type QuizFeedback =
  | { kind: "correct" }
  /** A correct move off the review line; the quiz continues on the review line. */
  | { kind: "redirected"; san: string }
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
  /** The move the user played. */
  uci: string;
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
  /** In a review, the leaf of the line being played. Opponent moves and redirects follow it. */
  targetId: number | undefined;
}

export type Turn = "user" | "opponent" | "complete";

export function startQuiz(tree: StudyTree, color: Color, targetId?: number): QuizState {
  return {
    targetId,
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
  if (node.children.length === 0 || s.nodeId === s.targetId) return "complete";
  return node.turn === s.color ? "user" : "opponent";
}

/** The move the hint points to: the selected variation, else the first branch not yet done. */
export function expectedChild(tree: StudyTree, s: QuizState): StudyNode | undefined {
  const node = tree.nodes[s.nodeId];
  const onPath = targetChild(tree, s);
  if (onPath) return onPath;
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
  const onPath = targetChild(tree, s);
  if (child && onPath && child !== onPath) return advance(s, onPath, { kind: "redirected", san: onPath.san }, uci);
  if (child) return advance(s, child, { kind: "correct" }, uci);

  const pos = replay([...node.ucis, uci]);
  if (!pos) return s;
  const epd = epdOf(pos);

  const same = tree.byEpd.get(epd);
  if (same && onPath) {
    const target = same.includes(onPath) ? onPath : undefined;
    return advance(s, onPath, target ? { kind: "correct" } : { kind: "redirected", san: onPath.san }, uci);
  }
  if (same) {
    const target = same.find((n) => !subtreeDone(n, s.done)) ?? same[0];
    return advance(s, target, { kind: "transposed", name: nameOf(target) }, uci);
  }

  if (book.get(epd)) {
    return { ...s, feedback: { kind: "otherBook", uci, label: book.labelFor(epd) } };
  }

  return { ...s, mistakesHere: s.mistakesHere + 1, feedback: { kind: "wrong", uci } };
}

export function opponentMove(tree: StudyTree, s: QuizState, childId: number): QuizState {
  if (turnOf(tree, s) !== "opponent") return s;
  return advance(s, tree.nodes[childId], undefined, undefined);
}

/**
 * Opponent reply for auto mode. Picks a branch at random, weighted by the lines it has not
 * completed, so main lines come up more often than sidelines. Once every branch is done, weights
 * by all lines.
 */
export function autoOpponentChild(tree: StudyTree, s: QuizState, random = Math.random): StudyNode {
  const onPath = targetChild(tree, s);
  if (onPath) return onPath;
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

/** The child of the current node on the way to the review target, if there is a target. */
export function targetChild(tree: StudyTree, s: QuizState): StudyNode | undefined {
  if (s.targetId === undefined) return undefined;
  const depth = tree.nodes[s.nodeId].ucis.length;
  let n: StudyNode | undefined = tree.nodes[s.targetId];
  while (n && n.ucis.length > depth + 1) n = n.parent;
  return n && n.parent?.id === s.nodeId ? n : undefined;
}

/** Starts the next review line, keeping results. */
export function retarget(tree: StudyTree, s: QuizState, targetId: number): QuizState {
  return { ...restart(tree, s), targetId };
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
  /** The user's move, or undefined for an opponent move. */
  userUci: string | undefined,
): QuizState {
  const results = userUci
    ? [...s.results, { nodeId: s.nodeId, grade: gradeOf(s.mistakesHere, s.hintLevel), uci: userUci }]
    : s.results;
  let done = s.done;
  if (target.children.length === 0 || target.id === s.targetId) {
    done = new Set(done).add(target.id);
    // Keep "redirected" visible when the last user move was redirected.
    if (feedback?.kind !== "redirected") feedback = { kind: "complete", name: nameOf(target) };
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
