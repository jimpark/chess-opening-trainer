import type { Card } from "ts-fsrs";
import { isDue } from "./store";
import type { StudyNode, StudyTree } from "./study";

/** Positions in the tree where the user is to move and has a book move to make. */
export function userNodes(tree: StudyTree, color: "white" | "black"): StudyNode[] {
  return tree.nodes.filter((n) => n.turn === color && n.children.length > 0);
}

export interface RepertoireCounts {
  /** Distinct positions where the user must find a move. */
  positions: number;
  /** Positions without a card yet. */
  fresh: number;
  due: number;
}

export function countCards(
  tree: StudyTree,
  color: "white" | "black",
  cards: ReadonlyMap<string, Card>,
  now: Date,
): RepertoireCounts {
  const epds = new Set(userNodes(tree, color).map((n) => n.epd));
  let fresh = 0;
  let due = 0;
  for (const epd of epds) {
    const card = cards.get(epd);
    if (!card) fresh++;
    else if (isDue(card, now)) due++;
  }
  return { positions: epds.size, fresh, due };
}

/**
 * Lines that together pass through every due position, chosen greedily: each step takes the line
 * covering the most uncovered due positions, then the shorter line. Each line is returned as its
 * end node: the position right after the user's move at the line's last due position, so a review
 * never asks for moves past what is due.
 */
export function planReview(
  tree: StudyTree,
  color: "white" | "black",
  cards: ReadonlyMap<string, Card>,
  now: Date,
): StudyNode[] {
  const dueEpds = new Set(
    userNodes(tree, color)
      .filter((n) => isDue(cards.get(n.epd), now))
      .map((n) => n.epd),
  );
  const leafDue = new Map<StudyNode, Set<string>>();
  for (const leaf of tree.leaves) {
    const covered = new Set<string>();
    for (let n: StudyNode | undefined = leaf; n; n = n.parent) {
      if (dueEpds.has(n.epd) && n.turn === color && n.children.length > 0) covered.add(n.epd);
    }
    if (covered.size > 0) leafDue.set(leaf, covered);
  }

  const plan: StudyNode[] = [];
  const left = new Set(dueEpds);
  while (left.size > 0) {
    let best: StudyNode | undefined;
    let bestCount = 0;
    for (const [leaf, covered] of leafDue) {
      let count = 0;
      for (const e of covered) if (left.has(e)) count++;
      if (count > bestCount || (count === bestCount && count > 0 && leaf.ucis.length < best!.ucis.length)) {
        best = leaf;
        bestCount = count;
      }
    }
    if (!best) break;
    plan.push(endOf(best, leafDue.get(best)!, color));
    for (const e of leafDue.get(best)!) left.delete(e);
    leafDue.delete(best);
  }
  return plan;
}

/** The node after the user's move at the deepest due position on the path to `leaf`. */
function endOf(leaf: StudyNode, dueEpds: Set<string>, color: "white" | "black"): StudyNode {
  let child = leaf;
  for (let n = leaf.parent; n; child = n, n = n.parent) {
    if (n.turn === color && dueEpds.has(n.epd)) return child;
  }
  return leaf;
}
