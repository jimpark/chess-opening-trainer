import { useEffect, useMemo, useState } from "react";
import type { Color } from "chessops/types";
import type { OpeningBook } from "../core/book";
import { countCards } from "../core/review";
import { deleteImport, repertoireSummaries, type Db, type RepertoireSummary } from "../core/store";
import { families } from "../core/study";
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
}

export function StudyView({ book, db, selection, onSelect, onImported }: Props) {
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
    />
  );
}

function Study({
  book,
  db,
  selection,
  onChange,
}: {
  book: OpeningBook;
  db: Db | undefined;
  selection: Selection;
  onChange: () => void;
}) {
  const [mode, setMode] = useState<Mode>("learn");
  const rep = useRepertoire(book, db, selection.family, selection.color);
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
      ) : mode === "learn" ? (
        <LearnView book={book} rep={rep} db={db} onQuiz={() => setMode("quiz")} />
      ) : (
        <QuizView book={book} rep={rep} />
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
}) {
  const { book, db, color, onColor, onPick, onImport } = props;
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>();
  const all = useMemo(() => families(book), [book]);
  const [query, setQuery] = useState("");
  const [summaries, setSummaries] = useState<RepertoireSummary[]>([]);
  useEffect(() => {
    if (db) void repertoireSummaries(db).then(setSummaries);
  }, [db]);
  const started = useMemo(
    () => new Map(summaries.filter((s) => s.color === color).map((s) => [s.family, s])),
    [summaries, color],
  );
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = all.filter((f) => words.every((w) => `${f.eco} ${f.name}`.toLowerCase().includes(w)));
    // Imports first, then openings already studied with this color.
    const rank = (f: (typeof all)[number]) => (f.imported ? 0 : started.has(f.name) ? 1 : 2);
    return [...hits].sort((a, b) => rank(a) - rank(b));
  }, [all, query, started]);

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
                <span className="muted count">
                  {f.lineCount} {f.lineCount === 1 ? "line" : "lines"}
                </span>
              </button>
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
            </li>
          );
        })}
        {shown.length === 0 && <li className="muted">No matches</li>}
      </ul>
    </div>
  );
}
