import { Chess, IllegalSetup } from "chessops/chess";
import type { Board } from "chessops/board";
import { parseBoardFen, parseFen } from "chessops/fen";
import type { Color } from "chessops/types";
import { parseSquare } from "chessops/util";

/** A castling right in FEN notation: K and Q for White, k and q for Black. */
export type CastlingRight = "K" | "Q" | "k" | "q";

export const CASTLING_RIGHTS: CastlingRight[] = ["K", "Q", "k", "q"];

/** Starting squares of the king and rook that a castling right needs. */
const HOME: Record<CastlingRight, { color: Color; king: string; rook: string }> = {
  K: { color: "white", king: "e1", rook: "h1" },
  Q: { color: "white", king: "e1", rook: "a1" },
  k: { color: "black", king: "e8", rook: "h8" },
  q: { color: "black", king: "e8", rook: "a8" },
};

/** A position built in the Setup tab. Move numbers start at 1 and there is no en passant square. */
export interface BoardSetup {
  /** Piece placement, the first FEN field. */
  boardFen: string;
  turn: Color;
  /** Castling rights the user turned off. A right is in effect when the pieces allow it and it is not off. */
  castlingOff: ReadonlySet<CastlingRight>;
}

/** Castling rights the pieces allow: the king and that rook stand on their starting squares. */
export function possibleCastling(boardFen: string): Set<CastlingRight> {
  const out = new Set<CastlingRight>();
  const board = parseBoardFen(boardFen).unwrap();
  for (const right of CASTLING_RIGHTS) {
    const { color, king, rook } = HOME[right];
    const k = board.get(parseSquare(king)!);
    const r = board.get(parseSquare(rook)!);
    if (k?.role === "king" && k.color === color && r?.role === "rook" && r.color === color) out.add(right);
  }
  return out;
}

/** Castling rights in effect for a setup. */
export function castlingOf(setup: BoardSetup): Set<CastlingRight> {
  return new Set([...possibleCastling(setup.boardFen)].filter((r) => !setup.castlingOff.has(r)));
}

export function setupFen(setup: BoardSetup): string {
  const castling = CASTLING_RIGHTS.filter((r) => castlingOf(setup).has(r)).join("") || "-";
  return `${setup.boardFen} ${setup.turn === "white" ? "w" : "b"} ${castling} - 0 1`;
}

/** Reads a FEN into a setup, keeping its pieces, side to move and castling rights. */
export function setupFromFen(fen: string): BoardSetup | undefined {
  const [boardFen, turn, castling = "-"] = fen.trim().split(/\s+/);
  if (parseBoardFen(boardFen).isErr) return undefined;
  const off = [...possibleCastling(boardFen)].filter((r) => !castling.includes(r));
  return { boardFen, turn: turn === "b" ? "black" : "white", castlingOff: new Set(off) };
}

/**
 * A side with more material than promotions can produce, or undefined. Stockfish exits on such
 * positions: each pawn, and each queen past the first or rook, bishop or knight past the second,
 * uses up one of the side's eight pawns.
 */
export function excessMaterial(board: Board): Color | undefined {
  for (const color of ["white", "black"] as const) {
    const count = (role: "pawn" | "queen" | "rook" | "bishop" | "knight") => board.pieces(color, role).size();
    const used =
      count("pawn") +
      Math.max(count("queen") - 1, 0) +
      Math.max(count("rook") - 2, 0) +
      Math.max(count("bishop") - 2, 0) +
      Math.max(count("knight") - 2, 0);
    if (used > 8) return color;
  }
  return undefined;
}

const COLOR_NAME: Record<Color, string> = { white: "White", black: "Black" };

/** Why the engine cannot analyze the setup, or undefined when it can. */
export function setupError(setup: BoardSetup): string | undefined {
  const board = parseBoardFen(setup.boardFen).unwrap();
  for (const color of ["white", "black"] as const) {
    const kings = board.pieces(color, "king").size();
    if (kings === 0) return `${COLOR_NAME[color]} has no king.`;
    if (kings > 1) return `${COLOR_NAME[color]} has ${kings} kings.`;
  }
  const excess = excessMaterial(board);
  if (excess) return `${COLOR_NAME[excess]} has more pieces than promotions can give.`;
  const pos = Chess.fromSetup(parseFen(setupFen(setup)).unwrap());
  if (pos.isOk) return undefined;
  switch (pos.error.message) {
    case IllegalSetup.PawnsOnBackrank:
      return "Pawns cannot stand on the first or eighth rank.";
    case IllegalSetup.OppositeCheck: {
      const other = setup.turn === "white" ? "black" : "white";
      return `${COLOR_NAME[other]} is in check, so it cannot be ${COLOR_NAME[setup.turn]}'s move.`;
    }
    default:
      return "The position is not legal.";
  }
}
