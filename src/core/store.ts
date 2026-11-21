import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card } from "ts-fsrs";
import type { Grade } from "./quiz";

/**
 * Minimal SQL access. The Tauri SQL plugin, the dev server bridge and node:sqlite in tests all
 * implement it. Parameters use `?` placeholders.
 */
export interface Db {
  execute(sql: string, params?: unknown[]): Promise<{ lastInsertId?: number }>;
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** Each entry migrates from schema version (index) to version (index + 1). */
const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE repertoires (
       id INTEGER PRIMARY KEY,
       family TEXT NOT NULL,
       color TEXT NOT NULL CHECK (color IN ('white', 'black')),
       created_at TEXT NOT NULL,
       UNIQUE (family, color)
     )`,
    `CREATE TABLE cards (
       id INTEGER PRIMARY KEY,
       repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
       epd TEXT NOT NULL,
       due TEXT NOT NULL,
       stability REAL NOT NULL,
       difficulty REAL NOT NULL,
       scheduled_days INTEGER NOT NULL,
       learning_steps INTEGER NOT NULL,
       reps INTEGER NOT NULL,
       lapses INTEGER NOT NULL,
       state INTEGER NOT NULL,
       last_review TEXT,
       UNIQUE (repertoire_id, epd)
     )`,
    `CREATE INDEX cards_due ON cards (repertoire_id, due)`,
    `CREATE TABLE review_log (
       id INTEGER PRIMARY KEY,
       card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
       rating INTEGER NOT NULL,
       state INTEGER NOT NULL,
       reviewed_at TEXT NOT NULL,
       move_uci TEXT
     )`,
    // Lines the user has seen in Learn or completed in Quiz, keyed by the leaf's UCI moves.
    `CREATE TABLE line_progress (
       repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
       kind TEXT NOT NULL CHECK (kind IN ('seen', 'completed')),
       line TEXT NOT NULL,
       at TEXT NOT NULL,
       PRIMARY KEY (repertoire_id, kind, line)
     )`,
    `CREATE TABLE engine_cache (
       key TEXT PRIMARY KEY,
       analysis TEXT NOT NULL,
       created_at TEXT NOT NULL
     )`,
  ],
  [
    // PGN files the user imported. Their lines are added to the book at startup.
    `CREATE TABLE imports (
       id INTEGER PRIMARY KEY,
       name TEXT NOT NULL UNIQUE,
       pgn TEXT NOT NULL,
       created_at TEXT NOT NULL
     )`,
    // One comment per move, shared by every repertoire. A user edit replaces an imported comment.
    `CREATE TABLE comments (
       epd TEXT NOT NULL,
       uci TEXT NOT NULL,
       text TEXT NOT NULL,
       source TEXT NOT NULL CHECK (source IN ('import', 'user')),
       updated_at TEXT NOT NULL,
       PRIMARY KEY (epd, uci)
     )`,
  ],
];

export async function migrate(db: Db): Promise<void> {
  await db.execute("PRAGMA foreign_keys = ON");
  const [{ user_version }] = await db.select<{ user_version: number }>("PRAGMA user_version");
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    for (const sql of MIGRATIONS[v]) await db.execute(sql);
    await db.execute(`PRAGMA user_version = ${v + 1}`);
  }
}

export type Color = "white" | "black";

export interface Repertoire {
  id: number;
  family: string;
  color: Color;
}

export async function repertoireFor(db: Db, family: string, color: Color, now = new Date()): Promise<Repertoire> {
  await db.execute(
    "INSERT INTO repertoires (family, color, created_at) VALUES (?, ?, ?) ON CONFLICT (family, color) DO NOTHING",
    [family, color, now.toISOString()],
  );
  const [row] = await db.select<Repertoire>(
    "SELECT id, family, color FROM repertoires WHERE family = ? AND color = ?",
    [family, color],
  );
  return row;
}

export interface RepertoireSummary extends Repertoire {
  cards: number;
  due: number;
  /** Earliest due time among cards not yet due, as ISO text. */
  nextDue: string | null;
}

export async function repertoireSummaries(db: Db, now = new Date()): Promise<RepertoireSummary[]> {
  const t = now.toISOString();
  return db.select<RepertoireSummary>(
    `SELECT r.id, r.family, r.color,
            COUNT(c.id) AS cards,
            COALESCE(SUM(c.due <= ?), 0) AS due,
            MIN(CASE WHEN c.due > ? THEN c.due END) AS nextDue
       FROM repertoires r LEFT JOIN cards c ON c.repertoire_id = r.id
      GROUP BY r.id
      ORDER BY due DESC, r.family`,
    [t, t],
  );
}

interface CardRow {
  id: number;
  epd: string;
  due: string;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
}

export interface StoredCard extends Card {
  id: number;
  epd: string;
}

function toCard(r: CardRow): StoredCard {
  return {
    id: r.id,
    epd: r.epd,
    due: new Date(r.due),
    stability: r.stability,
    difficulty: r.difficulty,
    scheduled_days: r.scheduled_days,
    learning_steps: r.learning_steps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state as State,
    last_review: r.last_review ? new Date(r.last_review) : undefined,
  } as StoredCard;
}

/** Cards of a repertoire, keyed by EPD. */
export async function cardsOf(db: Db, repertoireId: number): Promise<Map<string, StoredCard>> {
  const rows = await db.select<CardRow>("SELECT * FROM cards WHERE repertoire_id = ?", [repertoireId]);
  return new Map(rows.map((r) => [r.epd, toCard(r)]));
}

export function isDue(card: Card | undefined, now: Date): boolean {
  return card !== undefined && card.due.getTime() <= now.getTime();
}

/**
 * Whether an answer changes a card. New and due cards always update. A card that is not due
 * updates only on a mistake: answering it early would stretch its interval without a real test.
 */
export function shouldRecord(card: Card | undefined, grade: Grade, now: Date): boolean {
  return card === undefined || isDue(card, now) || grade === "again";
}

const RATING = {
  good: Rating.Good,
  hard: Rating.Hard,
  again: Rating.Again,
} as const;

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

/**
 * Applies a quiz answer to the card for `epd`, creating the card on first answer. Returns the
 * updated card, or the unchanged card when `shouldRecord` says to skip it.
 */
export async function recordAnswer(
  db: Db,
  repertoireId: number,
  epd: string,
  grade: Grade,
  moveUci: string | undefined,
  now = new Date(),
): Promise<StoredCard | undefined> {
  const [row] = await db.select<CardRow>("SELECT * FROM cards WHERE repertoire_id = ? AND epd = ?", [
    repertoireId,
    epd,
  ]);
  const existing = row ? toCard(row) : undefined;
  if (!shouldRecord(existing, grade, now)) return existing;

  const { card, log } = scheduler.next(existing ?? createEmptyCard(now), now, RATING[grade]);
  const values = [
    card.due.toISOString(),
    card.stability,
    card.difficulty,
    card.scheduled_days,
    card.learning_steps,
    card.reps,
    card.lapses,
    card.state,
    card.last_review?.toISOString() ?? null,
  ];
  let id: number;
  if (existing) {
    id = existing.id;
    await db.execute(
      `UPDATE cards SET due = ?, stability = ?, difficulty = ?, scheduled_days = ?, learning_steps = ?,
              reps = ?, lapses = ?, state = ?, last_review = ? WHERE id = ?`,
      [...values, id],
    );
  } else {
    await db.execute(
      `INSERT INTO cards (due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, state, last_review,
                          repertoire_id, epd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...values, repertoireId, epd],
    );
    [{ id }] = await db.select<{ id: number }>("SELECT id FROM cards WHERE repertoire_id = ? AND epd = ?", [
      repertoireId,
      epd,
    ]);
  }
  await db.execute("INSERT INTO review_log (card_id, rating, state, reviewed_at, move_uci) VALUES (?, ?, ?, ?, ?)", [
    id,
    log.rating,
    log.state,
    now.toISOString(),
    moveUci ?? null,
  ]);
  return { ...card, id, epd } as StoredCard;
}

export type ProgressKind = "seen" | "completed";

/** Lines with progress of `kind`, as space-separated UCI moves of each line's last position. */
export async function lineProgress(db: Db, repertoireId: number, kind: ProgressKind): Promise<Set<string>> {
  const rows = await db.select<{ line: string }>(
    "SELECT line FROM line_progress WHERE repertoire_id = ? AND kind = ?",
    [repertoireId, kind],
  );
  return new Set(rows.map((r) => r.line));
}

export async function addLineProgress(
  db: Db,
  repertoireId: number,
  kind: ProgressKind,
  line: string,
  now = new Date(),
) {
  await db.execute("INSERT OR IGNORE INTO line_progress (repertoire_id, kind, line, at) VALUES (?, ?, ?, ?)", [
    repertoireId,
    kind,
    line,
    now.toISOString(),
  ]);
}

export async function clearLineProgress(db: Db, repertoireId: number, kind: ProgressKind) {
  await db.execute("DELETE FROM line_progress WHERE repertoire_id = ? AND kind = ?", [repertoireId, kind]);
}

export async function cachedAnalysis<T>(db: Db, key: string): Promise<T | undefined> {
  const [row] = await db.select<{ analysis: string }>("SELECT analysis FROM engine_cache WHERE key = ?", [key]);
  return row ? (JSON.parse(row.analysis) as T) : undefined;
}

export async function cacheAnalysis(db: Db, key: string, analysis: unknown, now = new Date()) {
  await db.execute("INSERT OR REPLACE INTO engine_cache (key, analysis, created_at) VALUES (?, ?, ?)", [
    key,
    JSON.stringify(analysis),
    now.toISOString(),
  ]);
}

export interface StoredImport {
  id: number;
  name: string;
  pgn: string;
}

export async function imports(db: Db): Promise<StoredImport[]> {
  return db.select<StoredImport>("SELECT id, name, pgn FROM imports ORDER BY id");
}

export async function saveImport(db: Db, name: string, pgn: string, now = new Date()) {
  await db.execute("INSERT INTO imports (name, pgn, created_at) VALUES (?, ?, ?)", [name, pgn, now.toISOString()]);
}

/** Deletes an import with its repertoires, cards and progress. Comments stay: they are per move. */
export async function deleteImport(db: Db, name: string) {
  const reps = await db.select<{ id: number }>("SELECT id FROM repertoires WHERE family = ?", [name]);
  for (const { id } of reps) {
    // Explicit deletes: the SQL plugin's connection pool does not guarantee foreign_keys is on.
    await db.execute("DELETE FROM review_log WHERE card_id IN (SELECT id FROM cards WHERE repertoire_id = ?)", [id]);
    await db.execute("DELETE FROM cards WHERE repertoire_id = ?", [id]);
    await db.execute("DELETE FROM line_progress WHERE repertoire_id = ?", [id]);
    await db.execute("DELETE FROM repertoires WHERE id = ?", [id]);
  }
  await db.execute("DELETE FROM imports WHERE name = ?", [name]);
}

export interface MoveComment {
  text: string;
  source: "import" | "user";
}

export async function commentFor(db: Db, epd: string, uci: string): Promise<MoveComment | undefined> {
  const [row] = await db.select<MoveComment>("SELECT text, source FROM comments WHERE epd = ? AND uci = ?", [epd, uci]);
  return row;
}

/** Adds imported comments. A move that already has a comment keeps it. */
export async function addImportedComments(
  db: Db,
  comments: { epd: string; uci: string; text: string }[],
  now = new Date(),
) {
  for (const c of comments) {
    await db.execute(
      "INSERT OR IGNORE INTO comments (epd, uci, text, source, updated_at) VALUES (?, ?, ?, 'import', ?)",
      [c.epd, c.uci, c.text, now.toISOString()],
    );
  }
}

/** Sets the user's comment on a move. Empty text deletes the comment. */
export async function setComment(db: Db, epd: string, uci: string, text: string, now = new Date()) {
  if (text.trim() === "") {
    await db.execute("DELETE FROM comments WHERE epd = ? AND uci = ?", [epd, uci]);
    return;
  }
  await db.execute("INSERT OR REPLACE INTO comments (epd, uci, text, source, updated_at) VALUES (?, ?, ?, 'user', ?)", [
    epd,
    uci,
    text.trim(),
    now.toISOString(),
  ]);
}
