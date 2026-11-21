# Chess Opening Trainer: Design

Status: milestone 5 complete, 2026-11-20

## Goal

A desktop app for macOS and Windows that teaches chess openings and drills them until the user
knows them. The user picks an opening and a color. The app first walks through the book
variations, then quizzes the user by having them play their side's moves. Progress is scheduled
with spaced repetition. Stockfish explains why a non-book move is bad.

Web and mobile builds may follow later. The architecture keeps that path open but v1 does not
target them.

## Decisions

| Area                | Choice                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Shell               | Tauri 2 (Rust backend, system webview)                                                                                   |
| UI                  | TypeScript, React, Vite                                                                                                  |
| Board               | `chessground` (Lichess board, GPL-3.0)                                                                                   |
| Chess rules and PGN | `chessops` (Lichess, GPL-3.0): move generation, SAN, FEN, PGN with variations and comments                               |
| Opening data        | Lichess `chess-openings` dataset (CC0), plus PGN import                                                                  |
| Storage             | Opening book: in memory, built from bundled TSVs at startup. User data: SQLite through `tauri-plugin-sql`. Offline only. |
| Spaced repetition   | FSRS through `ts-fsrs` 6 (MIT)                                                                                           |
| Engine              | Stockfish 19, bundled as a Tauri sidecar, UCI over stdin/stdout                                                          |
| Project license     | GPL-3.0 (changed from MIT; see Licensing)                                                                                |
| Tests               | Vitest for TypeScript core logic, `cargo test` for the Rust side                                                         |

## Licensing

Stockfish, `chessground` and `chessops` are GPL-3.0. Two options:

- **Relicense to GPL-3.0 (chosen).** All three libraries can be used directly. For a personal
  project the only obligation is to keep the source available if the app is ever distributed.
- **Keep MIT.** Replace `chessground` with an MIT board such as `cm-chessboard`, replace
  `chessops` with `chess.js` (BSD-2) plus a separate PGN parser, and ship Stockfish as an
  unmodified separate executable with its license and source. This works, but `chess.js` drops
  PGN variations, so the app needs a second parser, and the Lichess pair is the more mature
  board and rules stack.

`LICENSE` holds the GPL-3.0 text. The Lichess data is CC0 (`data/lichess/COPYING.txt`).

## Opening data

### Source

The Lichess dataset is five TSV files (`a.tsv` to `e.tsv`) with columns `eco`, `name` and `pgn`.
It holds about 3,500 named lines. Names follow the pattern
`Family: Variation, Subvariation`, for example
`Sicilian Defense: Najdorf Variation, English Attack`. An "opening" in the app is a family: every
line whose name starts with `Sicilian Defense`.

The TSVs are committed under `data/lichess/` at a pinned upstream commit (`SOURCE.txt`), 3,865
lines in total. Vite bundles them as text. At startup, `buildBookFromTsv` replays each line with
`chessops` and builds the position graph in memory: about 8,000 positions in about 300 ms.

The book is not stored in SQLite. It is about 400 KB of static data, an in-memory graph answers
every query without I/O, and the same code runs unchanged on web and mobile. A seed database
would also need a merge step on every dataset update to keep user data. SQLite holds only user
data, keyed by EPD so it does not depend on book row ids (see Data model).

### Position graph

Openings transpose, so the data is a graph of positions, not a tree of move sequences.

- A **position** is keyed by its EPD: the first four FEN fields (pieces, side to move, castling,
  en passant). The en passant field is set only when an en passant capture is legal, so
  `1.e4 e5` and transposed orders produce the same key. `chessops` produces this normalized form.
- A **move** is an edge from one position to another, stored as UCI and SAN.
- A **line** is a named path from the start position, with its ECO code.

A position can be reached by several move orders. The UI lists the other orders under the
title, each named by the deepest named position it passed through before joining the current
order: "Also reached from: Indian Defense: Normal Variation; Queen's Gambit Declined: Queen's
Knight Variation". The list shows three names, then "+N more". Hovering a name shows its moves.

A path that leaves the book and transposes back into a book position counts as in book.

### Comments

The Lichess dataset has no comments. A comment belongs to a move: the position before it (EPD)
plus the move (UCI). It is shared by every opening and color that reaches that move. Comments
come from two places:

- PGN import. `{...}` comments before or after a move attach to that move. Embedded commands
  such as `[%eval]` and `[%csl]` are dropped. An import does not replace an existing comment.
- The user. Learn and Explore show a "Comment on Nf3" box for the last move played, with "Add a
  comment" or "Edit". A user edit replaces an imported comment; saving empty text deletes it.
  Cmd+Enter (Ctrl+Enter) saves, Escape cancels.

Quiz does not show comments, so they cannot give away the next move.

Wikibooks Chess Opening Theory (CC BY-SA) has prose for many positions and is a candidate for a
later import. It is out of scope for v1.

### PGN import

"Import PGN…" in the opening picker takes a name and a PGN file or pasted text
(`src/core/pgnImport.ts`):

- Every mainline and variation becomes a line from the start. Duplicate move sequences are kept
  once.
- The import becomes its own family under the given name, studied like any opening with either
  color. It is listed first in the picker with an "imported" badge.
- Each line is named after the deepest Lichess-named position it passes through, with
  " (imported)" appended, or after the import when it passes none. At positions both share, the
  Lichess name stays first.
- Moves already in the Lichess data reuse the existing positions, so transpositions and names
  work across both.
- Games with a `FEN` header for another start position, and variations with an illegal move, are
  left out. The dialog lists what was left out before opening the new family.
- The name must differ from every existing family.

The PGN text is saved in the database and replayed into the book at startup. Deleting an import
(✕, then "Delete?" to confirm) removes it with its cards and progress, and reloads the app,
because the book cannot drop lines it has added.

## Data model

The opening book lives in memory (`src/core/book.ts`):

- `BookPosition`: EPD, FEN, outgoing book moves, lines ending here, lines passing through.
- `BookMove`: UCI, SAN, destination EPD.
- `BookLine`: id, ECO, name, family, SAN and UCI moves, final EPD.

User data lives in SQLite (`src/core/store.ts`) and refers to positions by EPD, never to book
row ids. Schema version 1, applied by `migrate` through `PRAGMA user_version`:

```sql
repertoires   (id, family, color, created_at, UNIQUE (family, color))
              -- family: a Lichess family or an import name
cards         (id, repertoire_id, epd, due, stability, difficulty, scheduled_days,
               learning_steps, reps, lapses, state, last_review, UNIQUE (repertoire_id, epd))
review_log    (id, card_id, rating, state, reviewed_at, move_uci)
line_progress (repertoire_id, kind, line, at, PRIMARY KEY (repertoire_id, kind, line))
              -- kind: 'seen' (Learn) or 'completed' (Quiz); line: UCI moves to the leaf
engine_cache  (key, analysis, created_at)
              -- key: FEN, search options, depth and MultiPV; analysis: JSON
```

Opening a family with a color creates its repertoire. The card columns are the fields of a
`ts-fsrs` 6 card.

Schema version 2 adds:

```sql
imports  (id, name UNIQUE, pgn, created_at)    -- replayed into the book at startup
comments (epd, uci, text, source, updated_at, PRIMARY KEY (epd, uci))
         -- source: 'import' or 'user'
```

All SQL goes through a two-method `Db` interface (`execute`, `select`, `?` placeholders):

- In the app: `@tauri-apps/plugin-sql`, file `trainer.db` in the app config directory
  (`~/Library/Application Support/com.jimpark.chess-opening-trainer` on macOS).
- In a browser on the dev server: the Vite bridge runs the same SQL with `node:sqlite` on
  `.dev-data/trainer.db`.
- In tests: `node:sqlite` in memory.
- Without any of these, the app runs and says that progress is not saved.

## Search

The Explore search box reads the query in this order (`findPosition` in `src/core/explore.ts`):

- **FEN** (contains "/"): a book position offers "Go to the position after 1. d4 d5 2. c4 e6",
  using the shortest book line that reaches it, and lists lines that start that way. A position
  outside the book says so.
- **Moves**, with or without move numbers (`1. e4 c5 2.Nf3`, `e4 c5 Nf3`): if every move is legal
  from the start, it offers to go to the position, marked "out of book" when it is, and lists
  lines that start with those moves.
- **Names and ECO codes**: every query word must appear (`najdorf`, `B90`).

Imported lines are included. Results do not show spaced-repetition status yet.

## Modes

### Explore

A free board on the position graph. A side panel lists the book moves from the current
position for both colors, each with the name of the line it leads to and the number of named
lines below it. The user clicks a move or plays it on the board. Any legal move is allowed; an
off-book position shows "Out of book".

The board draws an arrow for each book move when there are five or fewer, and always for the
move under the mouse. Keys: ← and → step through the move list, Home and End jump to its ends,
F flips the board. Moving back keeps the later moves until a different move is played.

"Explore from here" in Learn (always, and at the end of a line) and in Quiz and Review (when a
line is complete) opens the current position in Explore with the engine on and the studied side
at the bottom, so the user can see the engine's best continuations past the book. The Study tab
keeps its place.

The Engine button (or E) turns on Stockfish: an evaluation bar beside the board, a blue arrow
for the best move, and the top three lines with scores. Clicking a move in a line plays the line
up to that move on the board. Analysis stops at depth 24 so an idle board does not keep the CPU
busy.

### Study tree

Learn and Quiz work on one family, as a tree of move sequences (`src/core/study.ts`). Each
family line is a path from the root. A line counts toward progress only if it ends at a leaf: a
line such as "Sicilian Defense" (1.e4 c5) that other lines extend is covered by them. The Italian
Game has 187 lines and 114 leaves. Two branches that reach the same position by different move
orders stay separate in the tree and are linked through an EPD index.

The Study tab opens with an opening picker: all 149 families, a search box, and a White or Black
toggle. The list sorts by popularity (the default), name, or line count; the choice is kept in
browser storage. Each row shows the family's game count and line count.

Popularity is the number of games that reached the family's main position: the end of the line
named exactly after the family (1.e4 c5 for the Sicilian Defense), or the family's shortest line
when no line has that name (13 families). `just popularity` (`scripts/fetch-popularity.mjs`)
queries the Lichess opening explorer once per family and writes `data/popularity.json`, which is
committed; the app makes no network calls. The counts come from the masters database, which needs
no login. With `LICHESS_TOKEN` set to a personal Lichess API token, the script uses the Lichess
player database instead, which counts online games at all levels. Chess.com has no public API for
opening statistics. Broad families rank high because their main position is shallow: King's Pawn
Game (1.e4) counts every 1.e4 game. Imported openings have no count and sort last.

### Learn

The app steps through the moves with arrows. "Next" (or →) plays the next move; at a branch it
takes the first branch with unseen lines. The panel lists every branch with its line name and
seen-out-of-total count, and the user clicks one to follow it instead. Moves played on the board
also follow a branch when they match one. Clicking a move in the move list returns to it.

Transpositions: at every position Learn also offers the moves that other branches of the opening
play from the same position, marked "transposes" (`nextMoves` in `src/core/study.ts`). A line
that ends where another move order continues is therefore not a dead end. Following such a move
continues in the other branch: the move list switches to that branch's move order, and a note
shows the order the user played. Line counts and progress do not change; merging the branches
into one tree instead would count each continuation once per move order (Queen's Gambit Declined
would grow from 133 lines to 1,028). Quiz keeps to each line's own moves.

At the end of a line, "Next unseen line" jumps back to the nearest position, by either move
order, with unseen lines. When every line has been seen, the panel offers to start the quiz. The comment on the last
move shows below the move list.

### Quiz

The board resets to the start. The app plays the opponent's moves and the user plays their own.

- **Opponent's turn with one book move:** the app plays it.
- **Opponent's turn with several book moves:** the panel lists them with their line names and
  completed-out-of-total counts. The user picks which path to follow. With "Auto replies" on,
  the app picks at random, weighted by each branch's uncompleted lines, so main lines come up
  more often than sidelines. Auto replies do not yet prefer branches with due cards; the Review
  tab covers due cards.
- **User's turn with several book moves:** the panel says how many book moves there are and lists
  their line names, without the moves. Any of them counts as correct. Clicking one makes the
  hint follow it; otherwise the hint follows the first branch with uncompleted lines.

Move outcomes:

| User's move                                                                       | Result                                                                                                                                         |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A book move of this opening at this position                                      | Correct. Quiz continues.                                                                                                                       |
| A move that reaches a position elsewhere in this opening's tree (a transposition) | Correct. The app names the line and continues from there.                                                                                      |
| A book move outside this opening                                                  | Not a mistake. "That is a book move (name), but it leaves the opening. Try again." A yellow arrow marks the move, and the board takes it back. |
| Not a book move                                                                   | "Wrong. Try again." A red arrow marks the move, and the board takes it back.                                                                   |

Hint button, per user turn:

1. First click highlights the piece to move.
2. Second click draws the move arrow.

For a wrong move or a book move outside the opening, the panel shows an engine comparison: the
score of the move played, the score of the best book move, the difference in pawns for the side
that moved, and the engine's line after the move played. One search with `searchmoves` scores
the played move and every book move together, so the scores are comparable. The comparison does
not name the book move, so the user can still find it; the hint reveals it. Clicking a move in
the engine line shows that position on the board until the user clicks "Back to quiz".

Each correct move records a grade for the position: "good" with no mistakes and no hint, "hard"
after the first hint, "again" after a mistake or the full hint. The panel shows first-try moves
out of total. Each grade is saved to the position's card (see Spaced repetition).

At the end of a line, "Next line" returns to the start with the completed line marked. Completed
lines and lines seen in Learn are saved per repertoire. "Start over", shown when every line is
complete, clears completed lines; Learn has "Mark all lines unseen".

### Review

The Review tab lists every repertoire with learned positions: learned count, due count, or when
the next card is due. "Review N" starts a session; "Study" opens the opening in the Study tab.
The opening picker puts openings already studied with the chosen color first, with a "due" or
"studying" badge.

A session plans its lines once, at the start (`planReview`): greedily, the line covering the most
uncovered due positions, then the shorter line, until every due position is covered. Each line
ends right after the user's move at its last due position, so a review never asks for moves past
what is due. The quiz then follows the line:

- Opponent moves follow the line, without choices.
- A user move that is book but off the line counts as correct; the panel says "That is also
  book; this review continues with Nf3", and the board continues on the line.
- Only positions that already have cards are graded. A position on the way that has no card is
  not created.

At the end the panel shows first-try moves out of total.

## Spaced repetition

A card is a position where the user is to move, in a given repertoire. Grading:

| Outcome                                    | FSRS rating |
| ------------------------------------------ | ----------- |
| Correct on first try, no hint              | Good        |
| Correct after one hint                     | Hard        |
| Wrong at least once, or used the full hint | Again       |

"Easy" is not used. Scheduling uses `ts-fsrs` 6 with default parameters and interval fuzz, so a
new position comes back after 1 to 10 minutes in learning steps, then after days.

An answer changes a card only when the card is new or due, or the answer is "again". A correct
answer on a card that is not yet due changes nothing: it would stretch the interval without a
real test. A mistake always counts, since the user has forgotten the move. This rule applies to
Quiz and Review alike (`shouldRecord`).

Not done: resetting a card or a repertoire, and a setting for target retention.

## Engine

Stockfish 19 runs as a separate process. The Rust side only starts it and passes lines; the UCI
protocol lives in TypeScript (`src/core/uci.ts`), so a WebAssembly build of Stockfish can reuse
it for web.

- **Binaries.** `npm run fetch-stockfish` downloads the official release for the host (or for
  the target triples given as arguments), checks its SHA-256, and installs it as
  `src-tauri/binaries/stockfish-<target triple>`. On macOS it extracts the target architecture
  from the universal binary with `lipo`. The binaries are not committed. `tauri dev` and
  `tauri build` run the script first. Each binary is about 100 MB because the network is
  embedded; the macOS app bundle is 101 MB. Stockfish's license ships in the bundle as
  `licenses/stockfish-COPYING.txt`.
- **Rust** (`src-tauri/src/lib.rs`). One command, `engine_send(line)`, starts the sidecar on
  first use and writes the line to its stdin. Each stdout line is emitted as an `engine-line`
  event; `engine-exit` reports that the process ended, and the next command restarts it. The
  app kills the process on exit.
- **TypeScript.** `UciSession` sends `uci`, sets `Threads` (half the cores) and `Hash` (128 MB),
  and waits for `readyok`. `analyze(fen, {depth, multipv, searchmoves})` returns the lines with
  scores converted to White's point of view, and reports progress after each depth. Starting a
  search stops the running one. `src/platform/engine.ts` picks the transport: Tauri events in
  the app, or a Vite dev server bridge (`devEngine` in `vite.config.ts`) when the UI runs in a
  browser during development.
- **Castling.** The engine runs with `UCI_Chess960` on, so it reads and writes castling as the
  king taking its rook (`e1h1`), the form chessops and the book use. The board converts a king
  drop on g1 to the same form.
- **Depths.** 16 for quiz feedback, which takes under a second; 24 in Explore.
- **Cache.** A fixed-depth search that reaches its depth is saved in `engine_cache`, so a repeated
  quiz mistake or an Explore position already analyzed to depth 24 shows its result at once.
- **Not done.** Threads and hash size are fixed until there is a settings screen.

## Architecture

```
src/
  core/        pure TypeScript, no Tauri imports: book graph (book.ts), Explore queries
               (explore.ts), study tree (study.ts), quiz state and grading (quiz.ts),
               UCI protocol (uci.ts), storage and scheduling (store.ts), review planning
               (review.ts), PGN import (pgnImport.ts)
  platform/    engine transports (engine.ts), database transports (db.ts),
               node:sqlite adapter for tests and the dev server (nodeDb.ts)
  ui/          React components: board, move panel, search, mode screens, engine views
src-tauri/
  src/         engine process management, Tauri commands
  binaries/    Stockfish sidecars, installed by scripts/fetch-stockfish.mjs (not committed)
data/
  lichess/     Lichess TSVs at a pinned commit, CC0
```

`core/` runs under Vitest with an in-memory storage fake, so the quiz and SRS logic is tested
without the app shell.

### Web and mobile later

- Web: replace the Tauri `Storage` implementation with `sqlite-wasm` on OPFS and the `Engine`
  implementation with Stockfish WASM. Multi-threaded WASM needs COOP/COEP headers.
- Mobile: Tauri 2 builds for iOS and Android. iOS does not allow spawning a sidecar process, so
  Stockfish would be linked into the app as a library. This is the largest unknown for mobile.

## Out of scope for v1

- Move popularity statistics. The Lichess explorer API is online only.
- Wikibooks comment import.
- Sync between machines.
- Playing full games against the engine after the opening.

## Milestones

1. Tauri scaffold, GPL relicense, board, in-memory opening book, Explore mode with name search.
   Done.
2. Learn and Quiz modes with hints and branch selection. Done.
3. Stockfish sidecar and wrong-move feedback. Done.
4. SRS cards, Review mode. Done.
5. Search by moves and FEN, PGN import, comment editing. Done.

## Open questions

1. Should Learn mode require the user to see every branch of an opening before Quiz unlocks, or
   leave the order to the user? Default: leave it to the user.
