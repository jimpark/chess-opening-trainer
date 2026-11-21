import { describe, expect, it } from "vitest";
import { createEmptyCard, type Card } from "ts-fsrs";
import { OpeningBook } from "./book";
import { opponentMove, startQuiz, turnOf, userMove, retarget } from "./quiz";
import { countCards, planReview, userNodes } from "./review";
import { buildStudyTree, pathTo } from "./study";

const NOW = new Date("2026-11-20T12:00:00Z");
const due = (): Card => createEmptyCard(new Date("2026-11-19T00:00:00Z"));
const later = (): Card => createEmptyCard(new Date("2026-12-01T00:00:00Z"));

function sample() {
  const book = new OpeningBook();
  book.addLine("C50", "Italian Game", ["e4", "e5", "Nf3", "Nc6", "Bc4"]);
  book.addLine("C50", "Italian Game: Giuoco Piano", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3"]);
  book.addLine("C50", "Italian Game: Giuoco Pianissimo", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d3"]);
  book.addLine("C55", "Italian Game: Two Knights", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5"]);
  const tree = buildStudyTree(book, "Italian Game");
  const at = (...sans: string[]) =>
    tree.nodes.find((n) => pathTo(n).map((p) => p.san).join(" ") === sans.join(" "))!;
  return { book, tree, at };
}

describe("review", () => {
  it("counts positions where the user moves", () => {
    const { tree, at } = sample();
    // White moves at: start, after e5, after Nc6, after Bc5, after Nf6.
    expect(userNodes(tree, "white").length).toBe(5);
    const cards = new Map([[at().epd, due()], [at("e4", "e5").epd, later()]]);
    expect(countCards(tree, "white", cards, NOW)).toEqual({ positions: 5, fresh: 3, due: 1 });
  });

  it("covers every due position with as few lines as possible", () => {
    const { tree, at } = sample();
    const afterBc5 = at("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5");
    const afterNf6 = at("e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6");
    const cards = new Map([[at().epd, due()], [afterBc5.epd, due()], [afterNf6.epd, due()]]);
    const plan = planReview(tree, "white", cards, NOW);
    expect(plan.length).toBe(2);
    expect(plan.map((l) => l.san).sort()).toEqual(["Ng5", expect.stringMatching(/c3|d3/)].sort());
  });

  it("ends a review line after the user's move at the last due position", () => {
    const { tree, at } = sample();
    const cards = new Map([[at().epd, due()], [at("e4", "e5").epd, due()]]);
    const plan = planReview(tree, "white", cards, NOW);
    expect(plan.map((n) => pathTo(n).map((p) => p.san).join(" "))).toEqual(["e4 e5 Nf3"]);
    expect(planReview(tree, "white", new Map(), NOW)).toEqual([]);
  });

  it("plays the review line and redirects a correct move off the line", () => {
    const { book, tree, at } = sample();
    const target = at("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d3");
    let s = startQuiz(tree, "white", target.id);
    s = userMove(tree, book, s, "e2e4");
    s = opponentMove(tree, s, tree.nodes[s.nodeId].children[0].id);
    s = userMove(tree, book, s, "g1f3");
    s = opponentMove(tree, s, tree.nodes[s.nodeId].children[0].id);
    s = userMove(tree, book, s, "f1c4");
    expect(turnOf(tree, s)).toBe("opponent");
    s = opponentMove(tree, s, at("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5").id);
    // c3 is book but the review follows d3.
    s = userMove(tree, book, s, "c2c3");
    expect(s.feedback).toEqual({ kind: "redirected", san: "d3" });
    expect(s.nodeId).toBe(target.id);
    expect(turnOf(tree, s)).toBe("complete");
    expect(s.results.at(-1)!.grade).toBe("good");
    s = retarget(tree, s, at("e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5").id);
    expect(s.nodeId).toBe(tree.root.id);
    expect(s.results.length).toBe(4);
  });
});
