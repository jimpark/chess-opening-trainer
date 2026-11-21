import { describe, expect, it } from "vitest";
import a from "../../data/lichess/a.tsv?raw";
import b from "../../data/lichess/b.tsv?raw";
import c from "../../data/lichess/c.tsv?raw";
import d from "../../data/lichess/d.tsv?raw";
import e from "../../data/lichess/e.tsv?raw";
import { buildBookFromTsv, epdOf, INITIAL_EPD, normalizeUci, OpeningBook, replay } from "./book";

describe("OpeningBook", () => {
  it("merges transposed move orders into one position", () => {
    const book = new OpeningBook();
    const x = book.addLine("D00", "X", ["d4", "Nf6", "c4", "e6"]);
    const y = book.addLine("E00", "Y", ["c4", "e6", "d4", "Nf6"]);
    expect(x.endEpd).toBe(y.endEpd);
    expect(book.get(x.endEpd)!.endingLines).toEqual([0, 1]);
  });

  it("ignores an en passant square when no capture is possible", () => {
    const afterE4 = replay(["e2e4"])!;
    expect(epdOf(afterE4).split(" ")[3]).toBe("-");
  });

  it("labels a position by the shortest line through it", () => {
    const book = new OpeningBook();
    book.addLine("B90", "Sicilian Defense: Najdorf Variation", [
      "e4",
      "c5",
      "Nf3",
      "d6",
      "d4",
      "cxd4",
      "Nxd4",
      "Nf6",
      "Nc3",
      "a6",
    ]);
    book.addLine("B20", "Sicilian Defense", ["e4", "c5"]);
    const afterNf3 = epdOf(replay(["e2e4", "c7c5", "g1f3"])!);
    expect(book.labelFor(afterNf3)).toBe("Sicilian Defense: Najdorf Variation");
    const afterC5 = epdOf(replay(["e2e4", "c7c5"])!);
    expect(book.labelFor(afterC5)).toBe("Sicilian Defense");
  });

  it("throws on an illegal move", () => {
    expect(() => new OpeningBook().addLine("A00", "Bad", ["e5"])).toThrow(/illegal move e5/);
  });
});

describe("Lichess dataset", () => {
  it("loads every line", () => {
    const start = performance.now();
    const book = buildBookFromTsv([a, b, c, d, e]);
    const ms = performance.now() - start;
    console.log(`${book.lines.length} lines, ${book.positions.size} positions, ${ms.toFixed(0)} ms`);
    expect(book.lines.length).toBeGreaterThan(3000);
    expect(book.get(INITIAL_EPD)!.moves.length).toBe(20);
  });
});

describe("normalizeUci", () => {
  it("converts a board castling move to the book's king-takes-rook form", () => {
    const pos = replay(["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5"])!;
    const book = new OpeningBook();
    const line = book.addLine("C50", "Castles", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O"]);
    expect(line.ucis.at(-1)).toBe("e1h1");
    expect(normalizeUci(pos, "e1g1")).toBe("e1h1");
    expect(normalizeUci(pos, "e1h1")).toBe("e1h1");
    expect(normalizeUci(pos, "d2d3")).toBe("d2d3");
  });
});
