import type { Position } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parsePgn, startingPosition } from "chessops/pgn";
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

/** The position a FEN describes, or the standard start without one. Undefined for an invalid FEN. */
export function startPosition(startFen?: string): Position | undefined {
  if (!startFen) return Chess.default();
  const setup = parseFen(startFen);
  if (setup.isErr) return undefined;
  const pos = Chess.fromSetup(setup.value);
  return pos.isErr ? undefined : pos.value;
}

/**
 * Describes the position reached by playing `ucis` from `startFen`, or from the standard start.
 * Returns undefined if the FEN or a move is invalid.
 */
export function explore(book: OpeningBook, ucis: string[], startFen?: string): ExploreState | undefined {
  const pos = startPosition(startFen);
  if (!pos) return undefined;
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
  kind: "moves" | "fen" | "pgn";
  /** Start position when it is not the standard one: a FEN outside the book, or a PGN's FEN header. */
  startFen?: string;
  /** Moves from the start position that reach the position. */
  ucis: string[];
  sans: string[];
  inBook: boolean;
}

/**
 * Reads a query as a PGN, a FEN or a move sequence ("1. e4 c5 2. Nf3", "e4 c5 Nf3"). For a FEN of
 * a book position, the moves are the shortest book line that reaches it; any other FEN becomes
 * the start position. A PGN gives its main line, from its FEN header if it has one. Returns
 * undefined when the query is none of these.
 */
export function findPosition(book: OpeningBook, query: string): PositionHit | undefined {
  const q = query.trim();
  if (q.startsWith("[")) return fromPgn(book, q);
  if (q.includes("/")) return fromFen(book, q);
  return fromMoves(book, q) ?? (/[{(*]|1-0|0-1|1\/2/.test(q) ? fromPgn(book, q) : undefined);
}

function fromFen(book: OpeningBook, fen: string): PositionHit | undefined {
  const pos = startPosition(fen);
  if (!pos) return undefined;
  const p = book.get(epdOf(pos));
  if (!p) return { kind: "fen", startFen: makeFen(pos.toSetup()), ucis: [], sans: [], inBook: false };
  let best: { lineId: number; ply: number } | undefined;
  for (const t of p.throughLines) if (!best || t.ply < best.ply) best = t;
  const line = book.line(best!.lineId);
  return { kind: "fen", ucis: line.ucis.slice(0, best!.ply), sans: line.sans.slice(0, best!.ply), inBook: true };
}

function fromMoves(book: OpeningBook, text: string): PositionHit | undefined {
  const tokens = text
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

/** The first game's main line. Undefined when the text has no moves and no FEN header. */
function fromPgn(book: OpeningBook, text: string): PositionHit | undefined {
  const [game] = parsePgn(text);
  if (!game) return undefined;
  const start = startingPosition(game.headers);
  if (start.isErr) return undefined;
  const pos = start.value;
  const startFen = game.headers.has("FEN") ? makeFen(pos.toSetup()) : undefined;
  const ucis: string[] = [];
  const sans: string[] = [];
  for (let node = game.moves.children[0]; node; node = node.children[0]) {
    const move = parseSan(pos, node.data.san);
    if (!move) break;
    ucis.push(makeUci(move));
    sans.push(makeSanAndPlay(pos, move));
  }
  if (ucis.length === 0 && !startFen) return undefined;
  return { kind: "pgn", startFen, ucis, sans, inBook: book.get(epdOf(pos)) !== undefined };
}

/** Lines that begin with `ucis`, shortest first. */
export function linesWithPrefix(book: OpeningBook, ucis: string[], limit = 50): BookLine[] {
  const key = ucis.join(" ");
  return book.lines
    .filter((l) => l.ucis.length >= ucis.length && l.ucis.slice(0, ucis.length).join(" ") === key)
    .sort((a, b) => a.ucis.length - b.ucis.length || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Ply number of the first move from `fen`: 0 for White's first move, 1 for Black's, and so on. */
export function firstPlyOf(fen?: string): number {
  if (!fen) return 0;
  const [, turn, , , , fullmove] = fen.split(" ");
  return (Math.max(1, Number(fullmove) || 1) - 1) * 2 + (turn === "b" ? 1 : 0);
}
