import { useEffect, useMemo, useState } from "react";
import type { Color } from "chessops/types";
import type { OpeningBook } from "../core/book";
import { countCards } from "../core/review";
import { deleteImport, repertoireSummaries, type Db, type RepertoireSummary } from "../core/store";
import { familyGames, popularitySource } from "../bookData";
import { families, sortFamilies, type FamilySort } from "../core/study";
import { ImportDialog } from "./ImportDialog";
import { LearnView } from "./LearnView";
import { QuizView } from "./QuizView";
import { useRepertoire } from "./useRepertoire";

export interface Selection {
  family: string;
  color: Color;
}

type Mode = "learn" | "quiz";

interface Props {
  book: OpeningBook;
  db: Db | undefined;
  selection: Selection | undefined;
  onSelect: (s: Selection | undefined) => void;
  /** Called after a PGN import adds an opening to the book. */
  onImported: (name: string, color: Color) => void;
  /** False while another tab is shown. */
  active: boolean;
  /** Opens a position, as UCI moves from the start, in Explore. */
  onExplore: (ucis: string[], orientation: "white" | "black") => void;
}

export function StudyView({ book, db, selection, onSelect, onImported, active, onExplore }: Props) {
  const [color, setColor] = useState<Color>(selection?.color ?? "white");
  const [importing, setImporting] = useState(false);
  if (importing && db) {
    return (
      <div className="picker">
        <ImportDialog book={book} db={db} color={color} onImported={onImported} onCancel={() => setImporting(false)} />
      </div>
    );
  }
  if (!selection) {
    return (
      <OpeningPicker
        book={book}
        db={db}
        color={color}
        onColor={setColor}
        onPick={(family) => onSelect({ family, color })}
        onImport={() => setImporting(true)}
        active={active}
      />
    );
  }
  return (
    <Study
      key={`${selection.family}-${selection.color}`}
      book={book}
      db={db}
      selection={selection}
      onChange={() => onSelect(undefined)}
      active={active}
      onExplore={onExplore}
    />
  );
}

function Study({
  book,
  db,
  selection,
  onChange,
  active,
  onExplore,
}: {
  book: OpeningBook;
  db: Db | undefined;
  selection: Selection;
  onChange: () => void;
  active: boolean;
  onExplore: (ucis: string[], orientation: "white" | "black") => void;
}) {
  const [mode, setMode] = useState<Mode>("learn");
  const rep = useRepertoire(book, db, selection.family, selection.color);
  // A review in the Review tab can change this opening's cards while Study is hidden.
  const { reloadCards } = rep;
  useEffect(() => {
    if (active) reloadCards();
  }, [active, reloadCards]);
  const counts = useMemo(
    () => countCards(rep.tree, rep.color, rep.cards, new Date()),
    [rep.tree, rep.color, rep.cards],
  );

  return (
    <div className="study">
      <div className="study-bar">
        <strong>{rep.tree.family}</strong>
        <span className="muted">as {selection.color === "white" ? "White" : "Black"}</span>
        <div className="segmented">
          <button className={mode === "learn" ? "on" : ""} onClick={() => setMode("learn")}>
            Learn
          </button>
          <button className={mode === "quiz" ? "on" : ""} onClick={() => setMode("quiz")}>
            Quiz
          </button>
        </div>
        <span className="muted" title="Positions where you must find a move">
          {counts.positions - counts.fresh} of {counts.positions} positions learned
          {counts.due > 0 && ` · ${counts.due} due`}
        </span>
        <button className="link" onClick={onChange}>
          Change opening
        </button>
      </div>
      {!rep.loaded ? (
        <p className="loading">Loading…</p>
      ) : (
        // Both modes stay mounted so switching between them keeps each one's position.
        <>
          <div className="mode-pane" hidden={mode !== "learn"}>
            <LearnView
              book={book}
              rep={rep}
              db={db}
              active={active && mode === "learn"}
              onQuiz={() => setMode("quiz")}
              onExplore={onExplore}
            />
          </div>
          <div className="mode-pane" hidden={mode !== "quiz"}>
            <QuizView book={book} rep={rep} onExplore={onExplore} />
          </div>
        </>
      )}
    </div>
  );
}

function OpeningPicker(props: {
  book: OpeningBook;
  db: Db | undefined;
  color: Color;
  onColor: (c: Color) => void;
  onPick: (family: string) => void;
  onImport: () => void;
  active: boolean;
}) {
  const { book, db, color, onColor, onPick, onImport, active } = props;
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>();
  const all = useMemo(() => families(book, familyGames), [book]);
  const [sort, setSortState] = useState<FamilySort>(savedSort);
  const setSort = (s: FamilySort) => {
    setSortState(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {
      // Storage can be unavailable; the choice then lasts for this session.
    }
  };
  const [query, setQuery] = useState("");
  const [summaries, setSummaries] = useState<RepertoireSummary[]>([]);
  // Reload when shown: reviews and quizzes in other tabs change the due counts.
  useEffect(() => {
    if (db && active) void repertoireSummaries(db).then(setSummaries);
  }, [db, active]);
  const started = useMemo(
    () => new Map(summaries.filter((s) => s.color === color).map((s) => [s.family, s])),
    [summaries, color],
  );
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = all.filter((f) => words.every((w) => `${f.eco} ${f.name}`.toLowerCase().includes(w)));
    return sortFamilies(hits, sort);
  }, [all, query, sort]);
  // Every row reserves the delete column while any import is listed, so the counts line up.
  const hasImports = shown.some((f) => f.imported);

  return (
    <div className="picker">
      <div className="picker-head">
        <h1>Choose an opening</h1>
        {db && (
          <button className="link" onClick={onImport}>
            Import PGN…
          </button>
        )}
        <div className="segmented">
          <button className={color === "white" ? "on" : ""} onClick={() => onColor("white")}>
            Play as White
          </button>
          <button className={color === "black" ? "on" : ""} onClick={() => onColor("black")}>
            Play as Black
          </button>
        </div>
      </div>
      <input
        className="search"
        type="search"
        placeholder={`Search ${all.length} openings by name or ECO`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <div className="sort-bar">
        <span className="muted">Sort by</span>
        <div className="segmented">
          {(["popularity", "name", "lines"] as const).map((s) => (
            <button key={s} className={sort === s ? "on" : ""} onClick={() => setSort(s)}>
              {s === "popularity" ? "Popularity" : s === "name" ? "Name" : "Lines"}
            </button>
          ))}
        </div>
        <span className="muted note">
          Popularity: games reaching each opening's main position in the Lichess{" "}
          {popularitySource === "masters" ? "masters" : "player"} database
        </span>
      </div>
      <ul className="families">
        {shown.map((f) => {
          const s = started.get(f.name);
          return (
            <li key={f.name}>
              <button onClick={() => onPick(f.name)}>
                <span className="eco">{f.eco}</span>
                <span className="label">{f.name}</span>
                {s && s.due > 0 && <span className="badge due">{s.due} due</span>}
                {s && s.due === 0 && s.cards > 0 && <span className="badge">studying</span>}
                {f.imported && <span className="badge">imported</span>}
                <span className="muted count games" title="Games reaching the main position">
                  {formatGames(f.games)}
                </span>
                <span className="muted count lines">
                  {f.lineCount} {f.lineCount === 1 ? "line" : "lines"}
                </span>
              </button>
              {hasImports && (
                <span className="row-action">
                  {f.imported && db && (
                    <button
                      className={confirmDelete === f.name ? "delete confirm" : "delete"}
                      title="Delete this import and its progress"
                      onClick={() => {
                        if (confirmDelete !== f.name) return setConfirmDelete(f.name);
                        // The book has no way to drop lines, so reload to rebuild it without the import.
                        void deleteImport(db, f.name).then(() => location.reload());
                      }}
                      onBlur={() => setConfirmDelete(undefined)}
                    >
                      {confirmDelete === f.name ? "Delete?" : "✕"}
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="muted">No matches</li>}
      </ul>
    </div>
  );
}

const SORT_KEY = "picker-sort";

function savedSort(): FamilySort {
  try {
    const s = localStorage.getItem(SORT_KEY);
    if (s === "popularity" || s === "name" || s === "lines") return s;
  } catch {
    // Storage can be unavailable; use the default.
  }
  return "popularity";
}

/** "1.4M games", "627K games", "512 games", "no data". */
function formatGames(n: number | undefined): string {
  if (n === undefined) return "no data";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M games`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K games`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K games`;
  return `${n} ${n === 1 ? "game" : "games"}`;
}
