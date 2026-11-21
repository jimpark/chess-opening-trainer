import { describe, expect, it } from "vitest";
import { epdOf, OpeningBook, replay } from "./book";
import { addImportedLines, linesFromPgn } from "./pgnImport";
import { buildStudyTree } from "./study";

const PGN = `[Event "My Italian"]
[ECO "C50"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 {Aim at f7.} Bc5 (3... Nf6 4. d3 {Quiet.}) 4. c3 Nf6 (4... d6) 5. d4 *

[Event "From a position"]
[FEN "8/8/8/8/8/8/4k3/4K3 w - - 0 1"]
[SetUp "1"]

1. Kf1 *

[Event "Broken"]

1. e4 e5 2. Ke3 *
`;

describe("linesFromPgn", () => {
  it("returns every mainline and variation as a line, with comments", () => {
    const r = linesFromPgn(PGN);
    expect(r.lines.map((l) => l.sans.join(" "))).toEqual([
      "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4",
      "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 d6",
      "e4 e5 Nf3 Nc6 Bc4 Nf6 d3",
    ]);
    expect(r.lines[0].eco).toBe("C50");
    expect(r.comments).toEqual([
      { epd: epdOf(replay(["e2e4", "e7e5", "g1f3", "b8c6"])!), uci: "f1c4", text: "Aim at f7." },
      { epd: epdOf(replay(["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"])!), uci: "d2d3", text: "Quiet." },
    ]);
    expect(r.skipped).toEqual([
      "Game 2: does not start from the standard position",
      "Game 3: illegal move Ke3 after e4 e5",
    ]);
  });
});

describe("addImportedLines", () => {
  it("adds lines under the import's family, named after the Lichess position they pass", () => {
    const book = new OpeningBook();
    book.addLine("C50", "Italian Game", ["e4", "e5", "Nf3", "Nc6", "Bc4"]);
    const r = linesFromPgn(PGN);
    expect(addImportedLines(book, "My Italian", [...r.lines, r.lines[0]])).toBe(3);
    expect(addImportedLines(book, "My Italian", r.lines)).toBe(0);
    const imported = book.lines.filter((l) => l.family === "My Italian");
    expect(imported.map((l) => l.name)).toEqual([
      "Italian Game (imported)",
      "Italian Game (imported)",
      "Italian Game (imported)",
    ]);
    expect(imported.every((l) => l.source === "import")).toBe(true);
    const tree = buildStudyTree(book, "My Italian");
    expect(tree.leaves.length).toBe(3);
    // Lichess names stay first at shared positions.
    expect(book.labelFor(book.line(0).endEpd)).toBe("Italian Game");
  });

  it("names a line after the import when it passes no Lichess name", () => {
    const book = new OpeningBook();
    addImportedLines(book, "Odd stuff", [{ eco: "", sans: ["a3", "a6"] }]);
    expect(book.lines[0].name).toBe("Odd stuff");
  });
});
