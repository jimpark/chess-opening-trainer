import a from "../data/lichess/a.tsv?raw";
import b from "../data/lichess/b.tsv?raw";
import c from "../data/lichess/c.tsv?raw";
import d from "../data/lichess/d.tsv?raw";
import e from "../data/lichess/e.tsv?raw";
import popularity from "../data/popularity.json";
import { buildBookFromTsv, type OpeningBook } from "./core/book";

let book: OpeningBook | undefined;

/** The Lichess opening book, built on first use. */
export function lichessBook(): OpeningBook {
  book ??= buildBookFromTsv([a, b, c, d, e]);
  return book;
}

/** Games that reached each family's main position, from data/popularity.json. */
export const familyGames: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(popularity.families).map(([name, f]) => [name, f.games]),
);

/** Where the game counts come from: "masters" or "lichess". */
export const popularitySource: string = popularity.source;
