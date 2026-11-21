import { makeFen } from "chessops/fen";
import type { Color } from "chessops/types";
import { epdOf, replay, type OpeningBook } from "./book";

/** One opening family, such as "Sicilian Defense", with its line count. */
export interface Family {
  name: string;
  lineCount: number;
  /** Lowest ECO code among the family's lines. */
  eco: string;
  /** True for a PGN the user imported. */
  imported: boolean;
  /** Games that reached the family's main position, when known. */
  games: number | undefined;
}

export type FamilySort = "popularity" | "name" | "lines";

/** Sorts families; families without a game count go last when sorting by popularity. */
export function sortFamilies(list: Family[], by: FamilySort): Family[] {
  const byName = (a: Family, b: Family) => a.name.localeCompare(b.name);
  const compare: Record<FamilySort, (a: Family, b: Family) => number> = {
    popularity: (a, b) => (b.games ?? -1) - (a.games ?? -1) || byName(a, b),
    name: byName,
    lines: (a, b) => b.lineCount - a.lineCount || byName(a, b),
  };
  return [...list].sort(compare[by]);
}

export function families(book: OpeningBook, games: Readonly<Record<string, number>> = {}): Family[] {
  const byName = new Map<string, Family>();
  for (const line of book.lines) {
    const f = byName.get(line.family);
    if (!f) {
      byName.set(line.family, {
        name: line.family,
        lineCount: 1,
        eco: line.eco,
        imported: line.source === "import",
        games: games[line.family],
      });
    } else {
      f.lineCount++;
      if (line.eco && (!f.eco || line.eco < f.eco)) f.eco = line.eco;
    }
  }
  return sortFamilies([...byName.values()], "lines");
}

export interface StudyNode {
  id: number;
  parent: StudyNode | undefined;
  /** Moves from the start position, in UCI. */
  ucis: string[];
  /** SAN of the move that reached this node. Empty at the root. */
  san: string;
  epd: string;
  fen: string;
  turn: Color;
  children: StudyNode[];
  /** Names of family lines that end at this node. */
  endingNames: string[];
  /** Leaves in this node's subtree, including itself. */
  leafCount: number;
}

/**
 * The lines of one family as a tree of move sequences. Two lines that reach the same position by
 * different move orders are separate branches; `byEpd` links them.
 */
export interface StudyTree {
  family: string;
  root: StudyNode;
  nodes: StudyNode[];
  leaves: StudyNode[];
  byEpd: Map<string, StudyNode[]>;
}

export function buildStudyTree(book: OpeningBook, family: string): StudyTree {
  const root = makeNode(0, undefined, [], "");
  const nodes = [root];

  for (const line of book.lines) {
    if (line.family !== family) continue;
    let node = root;
    for (const [i, uci] of line.ucis.entries()) {
      let child = node.children.find((c) => c.ucis[i] === uci);
      if (!child) {
        child = makeNode(nodes.length, node, line.ucis.slice(0, i + 1), line.sans[i]);
        node.children.push(child);
        nodes.push(child);
      }
      node = child;
    }
    node.endingNames.push(line.name);
  }

  const leaves: StudyNode[] = [];
  const byEpd = new Map<string, StudyNode[]>();
  const count = (n: StudyNode): number => {
    const list = byEpd.get(n.epd);
    if (list) list.push(n);
    else byEpd.set(n.epd, [n]);
    if (n.children.length === 0) {
      leaves.push(n);
      n.leafCount = 1;
    } else {
      n.leafCount = n.children.reduce((sum, c) => sum + count(c), 0);
      n.children.sort((a, b) => b.leafCount - a.leafCount);
    }
    return n.leafCount;
  };
  count(root);

  return { family, root, nodes, leaves, byEpd };
}

/** Name of the deepest node on the path to `node` (inclusive) that ends a family line. */
export function nameOf(node: StudyNode): string | undefined {
  for (let n: StudyNode | undefined = node; n; n = n.parent) {
    if (n.endingNames.length > 0) return n.endingNames[0];
  }
  return undefined;
}

/** Nodes from the first move to `node`, inclusive. Empty at the root. */
export function pathTo(node: StudyNode): StudyNode[] {
  const path: StudyNode[] = [];
  for (let n: StudyNode | undefined = node; n?.parent; n = n.parent) path.unshift(n);
  return path;
}

/** True if every leaf under `node` is in `done`. */
export function subtreeDone(node: StudyNode, done: ReadonlySet<number>): boolean {
  if (node.children.length === 0) return done.has(node.id);
  return node.children.every((c) => subtreeDone(c, done));
}

/** Number of leaves under `node` that are in `done`. */
export function doneLeafCount(node: StudyNode, done: ReadonlySet<number>): number {
  if (node.children.length === 0) return done.has(node.id) ? 1 : 0;
  return node.children.reduce((sum, c) => sum + doneLeafCount(c, done), 0);
}

export interface NextMove {
  node: StudyNode;
  /** True when the move comes from another branch that reaches the same position. */
  transposed: boolean;
}

/**
 * Moves from `node`'s position: its own children first, then moves that other branches play from
 * the same position, so a line that ends where another move order continues is not a dead end.
 * A move offered by several branches appears once, preferring the node's own child, then the
 * branch with the most lines below it. Following a transposed move continues in that branch, with
 * its move order.
 */
export function nextMoves(tree: StudyTree, node: StudyNode): NextMove[] {
  const own = new Set(node.children.map((c) => c.ucis.at(-1)));
  const foreign = new Map<string, StudyNode>();
  for (const other of tree.byEpd.get(node.epd) ?? []) {
    if (other === node) continue;
    for (const c of other.children) {
      const uci = c.ucis.at(-1)!;
      if (own.has(uci)) continue;
      const prev = foreign.get(uci);
      if (!prev || c.leafCount > prev.leafCount) foreign.set(uci, c);
    }
  }
  return [
    ...node.children.map((c) => ({ node: c, transposed: false })),
    ...[...foreign.values()].sort((a, b) => b.leafCount - a.leafCount).map((c) => ({ node: c, transposed: true })),
  ];
}

/** Nearest node at or above `node` with a next move, own or transposed, whose lines are not all done. */
export function nearestOpenPosition(
  tree: StudyTree,
  node: StudyNode,
  done: ReadonlySet<number>,
): StudyNode | undefined {
  for (let n: StudyNode | undefined = node; n; n = n.parent) {
    if (nextMoves(tree, n).some((m) => !subtreeDone(m.node, done))) return n;
  }
  return undefined;
}

/** Nearest node at or above `node` with a child whose subtree is not done. */
export function nearestOpenBranch(node: StudyNode, done: ReadonlySet<number>): StudyNode | undefined {
  for (let n: StudyNode | undefined = node; n; n = n.parent) {
    if (n.children.some((c) => !subtreeDone(c, done))) return n;
  }
  return undefined;
}

function makeNode(id: number, parent: StudyNode | undefined, ucis: string[], san: string): StudyNode {
  const pos = replay(ucis)!;
  return {
    id,
    parent,
    ucis,
    san,
    epd: epdOf(pos),
    fen: makeFen(pos.toSetup()),
    turn: pos.turn,
    children: [],
    endingNames: [],
    leafCount: 0,
  };
}
