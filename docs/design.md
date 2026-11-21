# Chess Opening Trainer: Design

Status: milestone 1 complete, 2026-11-20

## Goal

A desktop app for macOS and Windows that teaches chess openings and drills them until the user
knows them. The user picks an opening and a color. The app first walks through the book
variations, then quizzes the user by having them play their side's moves. Progress is scheduled
with spaced repetition. Stockfish explains why a non-book move is bad.

Web and mobile builds may follow later. The architecture keeps that path open but v1 does not
target them.

## Decisions

| Area | Choice |
| --- | --- |
| Shell | Tauri 2 (Rust backend, system webview) |
| UI | TypeScript, React, Vite |
| Board | `chessground` (Lichess board, GPL-3.0) |
| Chess rules and PGN | `chessops` (Lichess, GPL-3.0): move generation, SAN, FEN, PGN with variations and comments |
| Opening data | Lichess `chess-openings` dataset (CC0), plus PGN import |
| Storage | Opening book: in memory, built from bundled TSVs at startup. User data: SQLite through `tauri-plugin-sql`. Offline only. |
| Spaced repetition | FSRS through `ts-fsrs` (MIT) |
| Engine | Stockfish, bundled as a Tauri sidecar, UCI over stdin/stdout |
| Project license | GPL-3.0 (changed from MIT; see Licensing) |
| Tests | Vitest for TypeScript core logic, `cargo test` for the Rust side |

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

The Lichess dataset has no comments. Comments come from two places:

- PGN import. `{...}` comments in an imported PGN attach to the move that precedes them.
- A per-move comment field the user edits in the app.

Wikibooks Chess Opening Theory (CC BY-SA) has prose for many positions and is a candidate for a
later import. It is out of scope for v1.

### PGN import

The user imports a PGN file, with variations and comments, into a named repertoire. Every
mainline and variation becomes a line in the graph. Imported moves that already exist in the
Lichess data reuse the existing positions and edges. Lines without a name inherit the name of the
deepest named position they pass through, with " (imported)" appended.

## Data model

The opening book lives in memory (`src/core/book.ts`):

- `BookPosition`: EPD, FEN, outgoing book moves, lines ending here, lines passing through.
- `BookMove`: UCI, SAN, destination EPD.
- `BookLine`: id, ECO, name, family, SAN and UCI moves, final EPD.

User data lives in SQLite and refers to positions by EPD and to moves by EPD plus UCI. Imported
PGN lines are stored there and added to the in-memory book at startup.

```sql
imported_lines (id, repertoire_id, eco NULL, name, pgn)   -- replayed into the book at startup
comments       (id, epd, uci, text, source)               -- source: 'import' | 'user'
repertoires    (id, name, color, family NULL)             -- a family or an imported set
cards          (id, repertoire_id, epd, color,            -- one per user-to-move position
                due, stability, difficulty, elapsed_days, scheduled_days,
                reps, lapses, state, last_review,
                UNIQUE(repertoire_id, epd))
review_log     (id, card_id, rating, reviewed_at, move_played_uci)
engine_cache   (epd, depth, multipv, score_cp, mate, pv_uci, PRIMARY KEY (epd, depth, multipv))
```

Choosing a family and color creates a repertoire automatically. An imported PGN creates one
explicitly.

## Search

One search box queries:

- Names and ECO codes, in memory: every query word must appear (`najdorf`, `B90`). Done in
  milestone 1.
- Move sequences (`e4 c5 Nf3 d6`), matched against line move prefixes.
- A pasted FEN, matched by EPD, which shows every line that reaches the position.

Results list the line name, ECO code, move sequence and SRS status (new, due, learned).

## Modes

### Explore

A free board on the position graph. A side panel lists the book moves from the current
position for both colors, each with the name of the line it leads to and the number of named
lines below it. The user clicks a move or plays it on the board. Any legal move is allowed; an
off-book position shows "Out of book".

The board draws an arrow for each book move when there are five or fewer, and always for the
move under the mouse. Keys: ← and → step through the move list, Home and End jump to its ends,
F flips the board. Moving back keeps the later moves until a different move is played.

The engine evaluation bar is optional and toggled here (milestone 3).

### Learn

The user picks an opening and color. The app steps through the moves with arrows, one move per
"Next" click, and shows the line name and any comment at each step.

At a branch, the panel lists the possible next moves for whichever side is to move. The user
picks the branch to follow. When a branch ends, the app returns to the most recent branch point
with unexplored moves, until the whole subtree has been shown. A progress indicator shows lines
seen out of lines in the opening.

### Quiz

The board resets to the start. The app plays the opponent's moves and the user plays their own.

- **Opponent's turn with one book move:** the app plays it.
- **Opponent's turn with several book moves:** the panel lists them with their line names. The
  user picks which path to follow. An "Auto" toggle lets the app choose instead, preferring the
  branch with the most due or new cards.
- **User's turn with several book moves:** a badge shows "2 other variations". Any of those moves
  counts as correct. The panel lets the user switch to another variation before moving.

Move outcomes:

| User's move | Result |
| --- | --- |
| The move of the current line | Correct. Quiz continues. |
| A book move from another line, or a move that transposes into a book position | Not an error. The app names the line it leads to and continues there. |
| Not a book move | "Wrong, try again." The move is taken back. The panel shows the engine evaluation of the move played next to the evaluation of the book move, and the engine's principal variation after the wrong move, as clickable moves. |

Hint button, per user turn:

1. First click highlights the piece to move.
2. Second click draws the move arrow.

With several book moves, the hint uses the current line's move. A move made after a hint is
rated "Hard" for SRS. A move made after the full hint is rated "Again".

### Review

Lists due cards across all repertoires. A review session builds the shortest set of lines that
covers the due cards and plays them as a quiz. Only the due positions update their FSRS state.
Positions passed along the way do not.

## Spaced repetition

A card is a position where the user is to move, in a given repertoire. Grading:

| Outcome | FSRS rating |
| --- | --- |
| Correct on first try, no hint | Good |
| Correct after one hint | Hard |
| Wrong at least once, or used the full hint | Again |

"Easy" is not used. The user can reset a card or a whole repertoire.

## Engine

The Rust side owns the Stockfish process.

- Stockfish is bundled per platform as a Tauri sidecar: `stockfish-aarch64-apple-darwin`,
  `stockfish-x86_64-apple-darwin` and `stockfish-x86_64-pc-windows-msvc.exe`. The binaries embed
  the NNUE network, which adds tens of MB per platform.
- Tauri commands: `engine_analyze(fen, depth, multipv)` and `engine_stop()`. The Rust side emits
  `engine-info` events for each UCI `info` line and `engine-done` with the final result.
- The TypeScript side calls the engine through an `Engine` interface, so a WASM build of
  Stockfish can replace the sidecar for web.
- Results at the requested depth are cached in `engine_cache` by EPD.
- Defaults: depth 18 for wrong-move feedback, infinite analysis in Explore until stopped.
  Threads and hash size are settings.

## Architecture

```
src/
  core/        pure TypeScript, no Tauri imports: book graph (book.ts), Explore queries
               (explore.ts), later the quiz state machine, SRS grading, PGN import
  platform/    interfaces (Engine, Storage) and their Tauri implementations
  ui/          React components: board, move panel, search, mode screens
src-tauri/
  src/         engine process management, Tauri commands
  binaries/    Stockfish sidecars
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
2. Learn and Quiz modes with hints and branch selection.
3. Stockfish sidecar and wrong-move feedback.
4. SRS cards, Review mode.
5. Search by moves and FEN, PGN import, comment editing.

## Open questions

1. Should Learn mode require the user to see every branch of an opening before Quiz unlocks, or
   leave the order to the user? Default: leave it to the user.
