import type { Position } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSanAndPlay, parseSan } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";
import { Chess } from "chessops/chess";
import { epdOf, type BookLine, type OpeningBook } from "./book";

export interface ExploreMove {
  uci: string;
  san: string;
  /** Name of the line the move leads to. */
  label: string | undefined;
  /** Named lines that continue through the move. */
  lineCount: number;
}

export interface Transposition {
  /** The other move order, in SAN. */
  sans: string[];
  /** Name of the deepest named position on this move order before it joins the current one. */
  name: string;
}

export interface ExploreState {
  pos: Position;
  fen: string;
  epd: string;
  /** SAN of each move on the path. */
  sans: string[];
  /** Name of the most recent named position on the path. */
  name: string | undefined;
  eco: string | undefined;
  inBook: boolean;
  bookMoves: ExploreMove[];
  transpositions: Transposition[];
}

/** Describes the position reached by playing `ucis` from the start. Returns undefined if a move is illegal. */
export function explore(book: OpeningBook, ucis: string[]): ExploreState | undefined {
  const pos = Chess.default();
  const sans: string[] = [];
  let named: BookLine | undefined;

  for (const uci of ucis) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) return undefined;
    sans.push(makeSanAndPlay(pos, move));
    const p = book.get(epdOf(pos));
    if (p && p.endingLines.length > 0) named = book.line(p.endingLines[0]);
  }

  // A path that leaves the book and transposes back into a book position is in book.
  const epd = epdOf(pos);
  const here = book.get(epd);
  const inBook = here !== undefined;

  const bookMoves: ExploreMove[] = (here?.moves ?? []).map((m) => ({
    uci: m.uci,
    san: m.san,
    label: book.labelFor(m.toEpd),
    lineCount: book.lineCount(m.toEpd),
  }));
  bookMoves.sort((x, y) => y.lineCount - x.lineCount);

  return {
    pos,
    fen: makeFen(pos.toSetup()),
    epd,
    sans,
    name: named?.name,
    eco: named?.eco,
    inBook,
    bookMoves,
    transpositions: here ? transpositionsOf(book, epd, ucis) : [],
  };
}

/** Other move orders in the book that reach `epd`, one entry per distinct order. */
export function transpositionsOf(book: OpeningBook, epd: string, path: string[]): Transposition[] {
  const p = book.get(epd);
  if (!p) return [];
  const pathKey = path.join(" ");
  const byOrder = new Map<string, BookLine>();
  for (const { lineId, ply } of p.throughLines) {
    const line = book.line(lineId);
    const key = line.ucis.slice(0, ply).join(" ");
    if (key === pathKey) continue;
    const prev = byOrder.get(key);
    if (!prev || line.ucis.length < prev.ucis.length) byOrder.set(key, line);
  }
  return [...byOrder.values()].map((line) => {
    const ply = p.throughLines.find((t) => t.lineId === line.id)!.ply;
    // The final position is shared, so name the order by where it stood one move earlier.
    return { sans: line.sans.slice(0, ply), name: nameAlong(book, line.ucis.slice(0, ply - 1)) ?? line.family };
  });
}

/** Name of the deepest named position reached by `ucis`. */
function nameAlong(book: OpeningBook, ucis: string[]): string | undefined {
  const pos = Chess.default();
  let name: string | undefined;
  for (const uci of ucis) {
    pos.play(parseUci(uci)!);
    const p = book.get(epdOf(pos));
    if (p && p.endingLines.length > 0) name = book.line(p.endingLines[0]).name;
  }
  return name;
}

/** Lines whose name or ECO code contains every word of the query. */
export function searchLines(book: OpeningBook, query: string, limit = 50): BookLine[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits = book.lines.filter((l) => {
    const text = `${l.eco} ${l.name}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  hits.sort((x, y) => x.ucis.length - y.ucis.length || x.name.localeCompare(y.name));
  return hits.slice(0, limit);
}

/** SAN for a sequence of UCI moves from `fen`. Stops at the first illegal move. */
export function sanLine(fen: string, ucis: string[]): string[] {
  const setup = parseFen(fen);
  if (setup.isErr) return [];
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return [];
  const sans: string[] = [];
  for (const uci of ucis) {
    const move = parseUci(uci);
    if (!move || !pos.value.isLegal(move)) break;
    sans.push(makeSanAndPlay(pos.value, move));
  }
  return sans;
}

export interface PositionHit {
  kind: "moves" | "fen";
  /** Moves from the start that reach the position, when the book or the query gives them. */
  ucis: string[] | undefined;
  sans: string[];
  inBook: boolean;
}

/**
 * Reads a query as a FEN or a move sequence ("1. e4 c5 2. Nf3", "e4 c5 Nf3"). For a FEN of a
 * book position, the moves are the shortest book line that reaches it. Returns undefined when the
 * query is neither.
 */
export function findPosition(book: OpeningBook, query: string): PositionHit | undefined {
  const q = query.trim();
  if (q.includes("/")) {
    const setup = parseFen(q);
    if (setup.isErr) return undefined;
    const pos = Chess.fromSetup(setup.value);
    if (pos.isErr) return undefined;
    const p = book.get(epdOf(pos.value));
    if (!p) return { kind: "fen", ucis: undefined, sans: [], inBook: false };
    let best: { lineId: number; ply: number } | undefined;
    for (const t of p.throughLines) if (!best || t.ply < best.ply) best = t;
    const line = book.line(best!.lineId);
    return { kind: "fen", ucis: line.ucis.slice(0, best!.ply), sans: line.sans.slice(0, best!.ply), inBook: true };
  }

  const tokens = q
    .replace(/\d+\.(\.\.)?/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return undefined;
  const pos = Chess.default();
  const ucis: string[] = [];
  const sans: string[] = [];
  for (const t of tokens) {
    const move = parseSan(pos, t);
    if (!move) return undefined;
    ucis.push(makeUci(move));
    sans.push(makeSanAndPlay(pos, move));
  }
  return { kind: "moves", ucis, sans, inBook: book.get(epdOf(pos)) !== undefined };
}

/** Lines that begin with `ucis`, shortest first. */
export function linesWithPrefix(book: OpeningBook, ucis: string[], limit = 50): BookLine[] {
  const key = ucis.join(" ");
  return book.lines
    .filter((l) => l.ucis.length >= ucis.length && l.ucis.slice(0, ucis.length).join(" ") === key)
    .sort((a, b) => a.ucis.length - b.ucis.length || a.name.localeCompare(b.name))
    .slice(0, limit);
}
