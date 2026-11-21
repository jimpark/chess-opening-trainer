import { Chess, type Position } from "chessops/chess";
import { parseComment, parsePgn, startingPosition, type Node, type PgnNodeData } from "chessops/pgn";
import { makeSan, parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { epdOf, type OpeningBook } from "./book";

export interface ImportedComment {
  /** Position before the move. */
  epd: string;
  uci: string;
  text: string;
}

export interface PgnLines {
  /** Every path from the start to the end of a mainline or variation, in SAN. */
  lines: { eco: string; sans: string[] }[];
  comments: ImportedComment[];
  /** Games or variations left out, with the reason. */
  skipped: string[];
}

/** Splits PGN text, with variations and comments, into lines from the standard start position. */
export function linesFromPgn(text: string): PgnLines {
  const out: PgnLines = { lines: [], comments: [], skipped: [] };
  const games = parsePgn(text);
  games.forEach((game, g) => {
    const label = `Game ${g + 1}`;
    const start = startingPosition(game.headers);
    if (start.isErr || !sameAsStandardStart(start.value)) {
      out.skipped.push(`${label}: does not start from the standard position`);
      return;
    }
    const eco = game.headers.get("ECO") ?? "";
    const lines = out.lines.length;
    const skipped = out.skipped.length;
    walk(game.moves, Chess.default(), [], eco, label, out);
    if (out.lines.length === lines && out.skipped.length === skipped) out.skipped.push(`${label}: no moves`);
  });
  return out;
}

function walk(node: Node<PgnNodeData>, pos: Position, sans: string[], eco: string, label: string, out: PgnLines) {
  if (node.children.length === 0) {
    if (sans.length > 0) out.lines.push({ eco, sans });
    return;
  }
  for (const child of node.children) {
    const move = parseSan(pos, child.data.san);
    if (!move) {
      out.skipped.push(`${label}: illegal move ${child.data.san} after ${sans.join(" ") || "the start"}`);
      continue;
    }
    const epd = epdOf(pos);
    const uci = makeUci(move);
    const san = makeSan(pos, move);
    const text = [...(child.data.startingComments ?? []), ...(child.data.comments ?? [])]
      .map((c) => parseComment(c).text.trim())
      .filter(Boolean)
      .join(" ");
    if (text) out.comments.push({ epd, uci, text });
    const next = pos.clone();
    next.play(move);
    walk(child, next, [...sans, san], eco, label, out);
  }
}

function sameAsStandardStart(pos: Position): boolean {
  return epdOf(pos) === epdOf(Chess.default());
}

/**
 * Adds imported lines to the book under the family `name`. Each line is named after the deepest
 * Lichess-named position it passes through, with " (imported)" appended, or after the import.
 * Returns the number of lines added. A move sequence the family already has is skipped, so adding
 * the same import twice changes nothing.
 */
export function addImportedLines(book: OpeningBook, name: string, lines: PgnLines["lines"]): number {
  const seen = new Set(book.lines.filter((l) => l.family === name).map((l) => l.sans.join(" ")));
  let added = 0;
  for (const line of lines) {
    const key = line.sans.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    const named = book.lichessNameAlong(line.sans);
    book.addLine(line.eco, named ? `${named} (imported)` : name, line.sans, name);
    added++;
  }
  return added;
}
