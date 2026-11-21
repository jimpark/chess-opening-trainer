import { describe, expect, it } from "vitest";
import { OpeningBook } from "./book";
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
} from "./quiz";
import {
  buildStudyTree,
  doneLeafCount,
  families,
  nameOf,
  nearestOpenBranch,
  nearestOpenPosition,
  nextMoves,
  pathTo,
  sortFamilies,
  type FamilySort,
} from "./study";

function sampleBook(): OpeningBook {
  const book = new OpeningBook();
  book.addLine("C20", "King's Pawn Game", ["e4", "e5"]);
  book.addLine("C44", "Scotch Game", ["e4", "e5", "Nf3", "Nc6", "d4"]);
  book.addLine("C50", "Italian Game", ["e4", "e5", "Nf3", "Nc6", "Bc4"]);
  book.addLine("C50", "Italian Game: Giuoco Piano", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]);
  book.addLine("C50", "Italian Game: Two Knights", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"]);
  book.addLine("C50", "Italian Game: Bishop First", ["e4", "e5", "Bc4", "Nc6", "Nf3"]);
  return book;
}

describe("study tree", () => {
  it("lists families by line count", () => {
    expect(families(sampleBook()).map((f) => [f.name, f.lineCount])).toEqual([
      ["Italian Game", 4],
      ["King's Pawn Game", 1],
      ["Scotch Game", 1],
    ]);
  });

  it("sorts families by popularity, name or line count", () => {
    const list = families(sampleBook(), { "Scotch Game": 900, "King's Pawn Game": 5000 });
    const names = (by: FamilySort) => sortFamilies(list, by).map((f) => f.name);
    // Italian Game has no game count, so it goes last by popularity.
    expect(names("popularity")).toEqual(["King's Pawn Game", "Scotch Game", "Italian Game"]);
    expect(names("name")).toEqual(["Italian Game", "King's Pawn Game", "Scotch Game"]);
    expect(names("lines")).toEqual(["Italian Game", "King's Pawn Game", "Scotch Game"]);
  });

  it("builds a tree of the family's lines with leaves sorted first by size", () => {
    const tree = buildStudyTree(sampleBook(), "Italian Game");
    expect(tree.leaves.map((l) => l.san).sort()).toEqual(["Bc5", "Nf3", "Nf6"]);
    const afterE5 = tree.root.children[0].children[0];
    expect(afterE5.children.map((c) => c.san)).toEqual(["Nf3", "Bc4"]);
    expect(nameOf(afterE5.children[0].children[0].children[0])).toBe("Italian Game");
  });

  it("links move orders that reach the same position", () => {
    const tree = buildStudyTree(sampleBook(), "Italian Game");
    const bishopFirst = tree.leaves.find((l) => l.san === "Nf3")!;
    expect(tree.byEpd.get(bishopFirst.epd)!.length).toBe(2);
  });

  it("finds the nearest branch with lines left", () => {
    const tree = buildStudyTree(sampleBook(), "Italian Game");
    const giuoco = tree.leaves.find((l) => l.san === "Bc5")!;
    const done = new Set([giuoco.id]);
    expect(nearestOpenBranch(giuoco, done)!.san).toBe("Bc4");
    expect(doneLeafCount(tree.root, done)).toBe(1);
  });
});

describe("nextMoves", () => {
  it("continues a line that ends where another move order goes on", () => {
    const book = sampleBook();
    const tree = buildStudyTree(book, "Italian Game");
    // "Italian Game: Bishop First" ends after 1.e4 e5 2.Bc4 Nc6 3.Nf3, the position after
    // 1.e4 e5 2.Nf3 Nc6 3.Bc4, where the main order continues with Bc5 and Nf6.
    const bishopFirstEnd = tree.leaves.find((l) => l.san === "Nf3")!;
    expect(bishopFirstEnd.children).toEqual([]);
    const moves = nextMoves(tree, bishopFirstEnd);
    expect(moves.map((m) => [m.node.san, m.transposed])).toEqual([
      ["Bc5", true],
      ["Nf6", true],
    ]);
    // Following a transposed move continues in the other branch.
    expect(pathTo(moves[0].node).map((n) => n.san)).toEqual(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]);
  });

  it("lists a node's own children first and once", () => {
    const tree = buildStudyTree(sampleBook(), "Italian Game");
    const mainBc4 = tree.nodes.find(
      (n) =>
        pathTo(n)
          .map((p) => p.san)
          .join(" ") === "e4 e5 Nf3 Nc6 Bc4",
    )!;
    expect(nextMoves(tree, mainBc4).map((m) => [m.node.san, m.transposed])).toEqual([
      ["Bc5", false],
      ["Nf6", false],
    ]);
  });

  it("finds the nearest position with unseen lines through transpositions", () => {
    const tree = buildStudyTree(sampleBook(), "Italian Game");
    const bishopFirstEnd = tree.leaves.find((l) => l.san === "Nf3")!;
    expect(nearestOpenPosition(tree, bishopFirstEnd, new Set([bishopFirstEnd.id]))).toBe(bishopFirstEnd);
    const all = new Set(tree.leaves.map((l) => l.id));
    expect(nearestOpenPosition(tree, bishopFirstEnd, all)).toBeUndefined();
  });
});

describe("quiz as White", () => {
  const book = sampleBook();
  const tree = buildStudyTree(book, "Italian Game");

  it("accepts the book move and waits for the opponent", () => {
    let s = startQuiz(tree, "white");
    expect(turnOf(tree, s)).toBe("user");
    s = userMove(tree, book, s, "e2e4");
    expect(s.feedback).toEqual({ kind: "correct" });
    expect(turnOf(tree, s)).toBe("opponent");
    expect(s.results).toEqual([{ nodeId: 0, grade: "good", uci: "e2e4" }]);
  });

  it("rejects a non-book move and grades the position 'again'", () => {
    let s = startQuiz(tree, "white");
    s = userMove(tree, book, s, "a2a3");
    expect(s.feedback).toEqual({ kind: "wrong", uci: "a2a3" });
    expect(s.nodeId).toBe(0);
    s = userMove(tree, book, s, "e2e4");
    expect(s.results.at(-1)!.grade).toBe("again");
  });

  it("does not count a book move from another opening as a mistake", () => {
    book.addLine("A40", "Queen's Pawn", ["d4"]);
    let s = startQuiz(tree, "white");
    s = userMove(tree, book, s, "d2d4");
    expect(s.feedback).toEqual({ kind: "otherBook", uci: "d2d4", label: "Queen's Pawn" });
    expect(s.mistakesHere).toBe(0);
  });

  it("grades by hint level", () => {
    let s = startQuiz(tree, "white");
    s = hint(s);
    expect(s.hintLevel).toBe(1);
    s = userMove(tree, book, s, "e2e4");
    expect(s.results.at(-1)!.grade).toBe("hard");
    expect(s.hintLevel).toBe(0);
  });

  it("accepts either branch at a user branch point and follows the selected one for hints", () => {
    let s = startQuiz(tree, "white");
    s = userMove(tree, book, s, "e2e4");
    s = opponentMove(tree, s, tree.nodes[s.nodeId].children[0].id);
    expect(expectedChild(tree, s)!.san).toBe("Nf3");
    const bc4 = tree.nodes[s.nodeId].children.find((c) => c.san === "Bc4")!;
    s = selectVariation(s, bc4.id);
    expect(expectedChild(tree, s)!.san).toBe("Bc4");
    s = userMove(tree, book, s, "f1c4");
    expect(tree.nodes[s.nodeId].san).toBe("Bc4");
  });

  it("completes a line and restarts with the line marked done", () => {
    let s = startQuiz(tree, "white");
    for (const uci of ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5"]) {
      const node = tree.nodes[s.nodeId];
      s =
        turnOf(tree, s) === "user"
          ? userMove(tree, book, s, uci)
          : opponentMove(tree, s, node.children.find((c) => c.ucis.at(-1) === uci)!.id);
    }
    expect(s.feedback).toEqual({ kind: "complete", name: "Italian Game: Giuoco Piano" });
    expect(turnOf(tree, s)).toBe("complete");
    s = restart(tree, s);
    expect(s.nodeId).toBe(0);
    expect(s.done.size).toBe(1);
  });

  it("auto mode prefers branches with lines left", () => {
    let s = startQuiz(tree, "white");
    for (const uci of ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"]) {
      const node = tree.nodes[s.nodeId];
      s =
        turnOf(tree, s) === "user"
          ? userMove(tree, book, s, uci)
          : opponentMove(tree, s, node.children.find((c) => c.ucis.at(-1) === uci)!.id);
    }
    const giuoco = tree.nodes[s.nodeId].children.find((c) => c.san === "Bc5")!;
    s = { ...s, done: new Set([giuoco.id]) };
    expect(autoOpponentChild(tree, s, () => 0).san).toBe("Nf6");
  });

  it("auto mode weights replies by lines left", () => {
    const b = sampleBook();
    b.addLine("C55", "Italian Game: Two Knights, Line 2", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "d3"]);
    b.addLine("C55", "Italian Game: Two Knights, Line 3", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5"]);
    const t = buildStudyTree(b, "Italian Game");
    let s = startQuiz(t, "white");
    for (const uci of ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"]) {
      const node = t.nodes[s.nodeId];
      s =
        turnOf(t, s) === "user"
          ? userMove(t, b, s, uci)
          : opponentMove(t, s, node.children.find((c) => c.ucis.at(-1) === uci)!.id);
    }
    // Nf6 has 2 lines, Bc5 has 1: Nf6 covers [0, 2/3).
    expect(autoOpponentChild(t, s, () => 0.6).san).toBe("Nf6");
    expect(autoOpponentChild(t, s, () => 0.7).san).toBe("Bc5");
  });
});

describe("quiz transpositions", () => {
  it("accepts a move that reaches a position on another branch", () => {
    const book = sampleBook();
    const tree = buildStudyTree(book, "Italian Game");
    let s = startQuiz(tree, "black");
    s = opponentMove(tree, s, tree.root.children[0].id); // 1.e4
    s = userMove(tree, book, s, "e7e5");
    const bc4 = tree.nodes[s.nodeId].children.find((c) => c.san === "Bc4")!;
    s = opponentMove(tree, s, bc4.id); // 2.Bc4
    s = userMove(tree, book, s, "b8c6");
    s = opponentMove(tree, s, tree.nodes[s.nodeId].children[0].id); // 3.Nf3, end of Bishop First
    expect(s.feedback?.kind).toBe("complete");

    // From 2.Nf3, 2...Nc6 3.Bc4 reaches the same position and continues.
    s = restart(tree, s);
    s = opponentMove(tree, s, tree.root.children[0].id);
    s = userMove(tree, book, s, "e7e5");
    s = opponentMove(tree, s, tree.nodes[s.nodeId].children.find((c) => c.san === "Nf3")!.id);
    s = userMove(tree, book, s, "b8c6");
    s = opponentMove(tree, s, tree.nodes[s.nodeId].children.find((c) => c.san === "Bc4")!.id);
    expect(turnOf(tree, s)).toBe("user");
    s = userMove(tree, book, s, "f8c5");
    expect(s.feedback).toEqual({ kind: "complete", name: "Italian Game: Giuoco Piano" });
  });
});
