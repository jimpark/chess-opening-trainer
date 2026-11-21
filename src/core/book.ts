import { Chess, type Position } from "chessops/chess";
import { INITIAL_FEN, makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";

/** A named opening line from the book. */
export interface BookLine {
  id: number;
  eco: string;
  name: string;
  /**
   * Text before the first colon: "Sicilian Defense" for "Sicilian Defense: Najdorf Variation".
   * For an imported line, the name of the import.
   */
  family: string;
  source: "lichess" | "import";
  sans: string[];
  ucis: string[];
  /** EPD of the position after the last move. */
  endEpd: string;
}

export interface BookMove {
  uci: string;
  san: string;
  toEpd: string;
}

export interface BookPosition {
  epd: string;
  /** Full FEN of the first path that reached this position. */
  fen: string;
  moves: BookMove[];
  /** Lines whose final position is this one. */
  endingLines: number[];
  /** Lines that pass through or end at this position, with the ply count at which they reach it. */
  throughLines: { lineId: number; ply: number }[];
}

/**
 * Position key: the first four FEN fields. chessops writes the en passant square only when an
 * en passant capture is legal, so transposed move orders produce the same key.
 */
export function epdOf(pos: Position): string {
  return makeFen(pos.toSetup(), { epd: true });
}

export const INITIAL_EPD = epdOf(Chess.default());

export class OpeningBook {
  readonly positions = new Map<string, BookPosition>();
  readonly lines: BookLine[] = [];

  constructor() {
    this.positionFor(Chess.default(), INITIAL_FEN);
  }

  get(epd: string): BookPosition | undefined {
    return this.positions.get(epd);
  }

  line(id: number): BookLine {
    return this.lines[id];
  }

  /**
   * Adds a line given in SAN. Throws on an illegal or unparseable move. The family defaults to the
   * text of the name before the first colon.
   */
  addLine(eco: string, name: string, sans: string[], family?: string): BookLine {
    const pos = Chess.default();
    const ucis: string[] = [];
    const normalizedSans: string[] = [];
    const id = this.lines.length;
    let current = this.positions.get(INITIAL_EPD)!;
    current.throughLines.push({ lineId: id, ply: 0 });

    for (const [i, san] of sans.entries()) {
      const move = parseSan(pos, san);
      if (!move) throw new Error(`${name}: illegal move ${san} at ply ${i + 1}`);
      const uci = makeUci(move);
      const canonicalSan = makeSan(pos, move);
      pos.play(move);
      const next = this.positionFor(pos, makeFen(pos.toSetup()));
      if (!current.moves.some((m) => m.uci === uci)) {
        current.moves.push({ uci, san: canonicalSan, toEpd: next.epd });
      }
      next.throughLines.push({ lineId: id, ply: i + 1 });
      ucis.push(uci);
      normalizedSans.push(canonicalSan);
      current = next;
    }

    current.endingLines.push(id);
    const line: BookLine = {
      id,
      eco,
      name,
      family: family ?? name.split(":")[0].trim(),
      source: family === undefined ? "lichess" : "import",
      sans: normalizedSans,
      ucis,
      endEpd: current.epd,
    };
    this.lines.push(line);
    return line;
  }

  /**
   * Label for the position reached by a move: the name of a line ending there, or else the
   * shortest line that passes through it.
   */
  labelFor(epd: string): string | undefined {
    const p = this.positions.get(epd);
    if (!p) return undefined;
    if (p.endingLines.length > 0) return this.lines[p.endingLines[0]].name;
    let best: BookLine | undefined;
    for (const { lineId } of p.throughLines) {
      const l = this.lines[lineId];
      if (!best || l.ucis.length < best.ucis.length) best = l;
    }
    return best?.name;
  }

  /** Name of the deepest position along `sans` that ends a Lichess line. */
  lichessNameAlong(sans: string[]): string | undefined {
    const pos = Chess.default();
    let name: string | undefined;
    for (const san of sans) {
      const move = parseSan(pos, san);
      if (!move) break;
      pos.play(move);
      const lichess = this.positions.get(epdOf(pos))?.endingLines.find((id) => this.lines[id].source === "lichess");
      if (lichess !== undefined) name = this.lines[lichess].name;
    }
    return name;
  }

  /** Number of distinct named lines that pass through a position. */
  lineCount(epd: string): number {
    return this.positions.get(epd)?.throughLines.length ?? 0;
  }

  private positionFor(pos: Position, fen: string): BookPosition {
    const epd = epdOf(pos);
    let p = this.positions.get(epd);
    if (!p) {
      p = { epd, fen, moves: [], endingLines: [], throughLines: [] };
      this.positions.set(epd, p);
    }
    return p;
  }
}

/** Splits PGN movetext such as "1. e4 c5 2. Nf3" into SAN tokens. */
export function sansFromMovetext(movetext: string): string[] {
  return movetext
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0 && !/^\d+\.+$/.test(t));
}

/** Parses Lichess chess-openings TSV files (columns: eco, name, pgn) into a book. */
export function buildBookFromTsv(tsvs: string[]): OpeningBook {
  const book = new OpeningBook();
  for (const tsv of tsvs) {
    for (const row of tsv.split("\n").slice(1)) {
      if (row.trim() === "") continue;
      const [eco, name, pgn] = row.split("\t");
      book.addLine(eco, name, sansFromMovetext(pgn));
    }
  }
  return book;
}

/** Replays UCI moves from the start position. Returns undefined at the first illegal move. */
export function replay(ucis: string[]): Position | undefined {
  const pos = Chess.default();
  for (const uci of ucis) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) return undefined;
    pos.play(move);
  }
  return pos;
}
