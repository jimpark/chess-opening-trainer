import { describe, expect, it } from "vitest";
import { EMPTY_BOARD_FEN, INITIAL_BOARD_FEN, INITIAL_FEN } from "chessops/fen";
import {
  castlingOf,
  possibleCastling,
  setupError,
  setupFen,
  setupFromFen,
  type BoardSetup,
  type CastlingRight,
} from "./setup";
import { startPosition } from "./explore";

const setup = (boardFen: string, turn: "white" | "black" = "white", off: CastlingRight[] = []): BoardSetup => ({
  boardFen,
  turn,
  castlingOff: new Set(off),
});

describe("setup", () => {
  it("writes the standard start", () => {
    expect(setupFen(setup(INITIAL_BOARD_FEN))).toBe(INITIAL_FEN);
  });

  it("allows castling only with the king and rook on their starting squares", () => {
    expect([...possibleCastling("r3k3/8/8/8/8/8/8/4K2R")]).toEqual(["K", "q"]);
    expect([...possibleCastling("4k3/8/8/8/8/8/8/R3K2r")]).toEqual(["Q"]);
  });

  it("leaves out castling rights the user turned off", () => {
    expect(setupFen(setup(INITIAL_BOARD_FEN, "black", ["K", "q"]))).toBe(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b Qk - 0 1",
    );
    expect(setupFen(setup("4k3/8/8/8/8/8/8/4K3"))).toBe("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
  });

  it("reads a FEN, turning off castling rights it does not have", () => {
    const s = setupFromFen("r3k2r/8/8/8/8/8/8/R3K2R b Kq - 5 40")!;
    expect(s.turn).toBe("black");
    expect([...s.castlingOff].sort()).toEqual(["Q", "k"]);
    expect(setupFen(s)).toBe("r3k2r/8/8/8/8/8/8/R3K2R b Kq - 0 1");
    expect(setupFromFen("not a fen")).toBeUndefined();
    expect(setupFromFen(INITIAL_BOARD_FEN)!.turn).toBe("white");
    expect([...setupFromFen(`${INITIAL_BOARD_FEN} w - - 0 1`)!.castlingOff].sort()).toEqual(["K", "Q", "k", "q"]);
  });

  it("keeps a right off after its pieces leave and return", () => {
    const s = setup("r3k2r/8/8/8/8/8/8/R3K2R", "white", ["K"]);
    expect(castlingOf({ ...s, boardFen: "r3k2r/8/8/8/8/8/8/R3K1R1" }).has("K")).toBe(false);
    expect([...castlingOf(s)]).toEqual(["Q", "k", "q"]);
  });

  it("explains positions the engine cannot analyze", () => {
    expect(setupError(setup(INITIAL_BOARD_FEN))).toBeUndefined();
    expect(setupError(setup(EMPTY_BOARD_FEN))).toBe("White has no king.");
    expect(setupError(setup("4k3/8/8/8/8/8/8/3KK3"))).toBe("White has 2 kings.");
    expect(setupError(setup("8/8/8/8/8/8/8/4K3"))).toBe("Black has no king.");
    expect(setupError(setup("4k3/8/8/8/8/8/8/4K2P"))).toBe("Pawns cannot stand on the first or eighth rank.");
    expect(setupError(setup("4k3/8/8/8/8/8/8/4K2r", "black"))).toBe("White is in check, so it cannot be Black's move.");
    expect(setupError(setup("4k3/8/8/8/8/8/8/4K2r", "white"))).toBeUndefined();
  });

  it("rejects more material than promotions can give", () => {
    const tooMany = "4k3/8/8/8/8/8/PPPPPPPP/3QKQ2";
    expect(setupError(setup("4k3/8/8/8/8/8/PPPPPPPP/3QK3"))).toBeUndefined();
    expect(setupError(setup("4k3/8/8/8/8/P7/PPPPPPPP/4K3"))).toBe("White has more pieces than promotions can give.");
    expect(setupError(setup(tooMany))).toBe("White has more pieces than promotions can give.");
    expect(setupError(setup("4k3/8/8/8/8/8/PPPPPPPP/2BBK3"))).toBeUndefined();
    expect(setupError(setup("1nnnk3/pppppppp/8/8/8/8/8/4K3"))).toBe("Black has more pieces than promotions can give.");
    expect(startPosition(`${tooMany} w - - 0 1`)).toBeUndefined();
  });
});
