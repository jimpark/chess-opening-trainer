import { describe, expect, it } from "vitest";
import { OpeningBook } from "./book";
import { explore, findPosition, linesWithPrefix, sanLine, searchLines } from "./explore";

function sampleBook(): OpeningBook {
  const book = new OpeningBook();
  book.addLine("D06", "Queen's Gambit", ["d4", "d5", "c4"]);
  book.addLine("D30", "Queen's Gambit Declined", ["d4", "d5", "c4", "e6"]);
  book.addLine("A13", "English Opening: Agincourt Defense", ["c4", "e6"]);
  book.addLine("D30", "Queen's Gambit Declined (English order)", ["c4", "e6", "d4", "d5"]);
  return book;
}

describe("explore", () => {
  it("names the position and lists book moves", () => {
    const s = explore(sampleBook(), ["d2d4", "d7d5", "c2c4"])!;
    expect(s.name).toBe("Queen's Gambit");
    expect(s.sans).toEqual(["d4", "d5", "c4"]);
    expect(s.bookMoves.map((m) => m.san)).toEqual(["e6"]);
    expect(s.bookMoves[0].label).toBe("Queen's Gambit Declined");
  });

  it("keeps the last name after an unnamed move", () => {
    const s = explore(sampleBook(), ["d2d4", "d7d5"])!;
    expect(s.name).toBeUndefined();
    expect(explore(sampleBook(), ["c2c4", "e7e6", "d2d4"])!.name).toBe("English Opening: Agincourt Defense");
  });

  it("lists other move orders that reach the position", () => {
    const s = explore(sampleBook(), ["d2d4", "d7d5", "c2c4", "e7e6"])!;
    expect(s.transpositions).toEqual([{ sans: ["c4", "e6", "d4", "d5"], name: "English Opening: Agincourt Defense" }]);
  });

  it("names another move order by where it stood before joining, not by a longer line", () => {
    const book = sampleBook();
    book.addLine("A13", "English Opening: Agincourt Defense, Long Line", ["c4", "e6", "d4", "d5", "Nc3"]);
    const s = explore(book, ["d2d4", "d7d5", "c2c4", "e7e6"])!;
    expect(s.transpositions.map((t) => t.name)).toEqual(["English Opening: Agincourt Defense"]);
    const afterD4 = explore(book, ["d2d4", "e7e6", "c2c4"])!;
    expect(afterD4.transpositions.map((t) => t.name)).toEqual(["English Opening: Agincourt Defense"]);
  });

  it("treats a transposition back into the book as in book", () => {
    const s = explore(sampleBook(), ["d2d4", "e7e6", "c2c4"])!;
    expect(s.inBook).toBe(true);
    expect(s.bookMoves.map((m) => m.san)).toEqual(["d5"]);
  });

  it("reports an off-book position", () => {
    const s = explore(sampleBook(), ["h2h4"])!;
    expect(s.inBook).toBe(false);
    expect(s.bookMoves).toEqual([]);
  });

  it("rejects an illegal path", () => {
    expect(explore(sampleBook(), ["e2e5"])).toBeUndefined();
  });
});

describe("searchLines", () => {
  it("matches every word against name and ECO", () => {
    const names = searchLines(sampleBook(), "declined d30").map((l) => l.name);
    expect(names).toEqual(["Queen's Gambit Declined", "Queen's Gambit Declined (English order)"]);
  });
});

describe("sanLine", () => {
  it("converts UCI to SAN and stops at an illegal move", () => {
    const fen = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    expect(sanLine(fen, ["g1f3", "b8c6", "f1b5", "a1a8"])).toEqual(["Nf3", "Nc6", "Bb5"]);
  });
});

describe("findPosition", () => {
  it("reads move sequences with or without move numbers", () => {
    const book = sampleBook();
    expect(findPosition(book, "1. d4 d5 2.c4")).toEqual({
      kind: "moves",
      ucis: ["d2d4", "d7d5", "c2c4"],
      sans: ["d4", "d5", "c4"],
      inBook: true,
    });
    expect(findPosition(book, "h4")?.inBook).toBe(false);
    expect(findPosition(book, "declined")).toBeUndefined();
  });

  it("finds a book position by FEN through its shortest line", () => {
    const book = sampleBook();
    const hit = findPosition(book, "rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/8/PP2PPPP/RNBQKBNR w KQkq - 0 3");
    expect(hit).toEqual({
      kind: "fen",
      ucis: ["d2d4", "d7d5", "c2c4", "e7e6"],
      sans: ["d4", "d5", "c4", "e6"],
      inBook: true,
    });
    expect(findPosition(book, "4k3/8/8/8/8/8/8/4K3 w - - 0 1")).toEqual({
      kind: "fen",
      ucis: undefined,
      sans: [],
      inBook: false,
    });
  });

  it("lists lines that start with given moves", () => {
    expect(linesWithPrefix(sampleBook(), ["d2d4", "d7d5"]).map((l) => l.name)).toEqual([
      "Queen's Gambit",
      "Queen's Gambit Declined",
    ]);
  });
});
