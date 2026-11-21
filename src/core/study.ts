import { makeFen } from "chessops/fen";
import type { Color } from "chessops/types";
import { epdOf, replay, type OpeningBook } from "./book";

/** One opening family, such as "Sicilian Defense", with its line count. */
export interface Family {
  name: string;
  lineCount: number;
  /** Lowest ECO code among the family's lines. */
  eco: string;
}

export function families(book: OpeningBook): Family[] {
  const byName = new Map<string, Family>();
  for (const line of book.lines) {
    const f = byName.get(line.family);
    if (!f) byName.set(line.family, { name: line.family, lineCount: 1, eco: line.eco });
    else {
      f.lineCount++;
      if (line.eco < f.eco) f.eco = line.eco;
    }
  }
  return [...byName.values()].sort((a, b) => b.lineCount - a.lineCount || a.name.localeCompare(b.name));
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
