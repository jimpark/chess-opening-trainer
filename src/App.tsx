import { useEffect, useState } from "react";
import { lichessBook } from "./bookData";
import { addImportedLines, linesFromPgn } from "./core/pgnImport";
import { imports, type Db } from "./core/store";
import { database } from "./platform/db";
import { ExploreView } from "./ui/ExploreView";
import { ReviewView } from "./ui/ReviewView";
import { StudyView, type Selection } from "./ui/StudyView";
import "./App.css";

const book = lichessBook();

type Tab = "study" | "review" | "explore";

export default function App() {
  const [tab, setTab] = useState<Tab>("study");
  const [selection, setSelection] = useState<Selection | undefined>();
  const [db, setDb] = useState<Db | undefined>();
  const [dbReady, setDbReady] = useState(false);
  /** Incremented when an import adds lines to the book, to rebuild views that read it. */
  const [bookVersion, setBookVersion] = useState(0);

  useEffect(() => {
    void (async () => {
      const d = await database();
      // Imported lines join the book before anything renders it.
      if (d) {
        for (const imp of await imports(d)) addImportedLines(book, imp.name, linesFromPgn(imp.pgn).lines);
      }
      setDb(d);
      setDbReady(true);
    })();
  }, []);

  if (!dbReady) return <p className="loading">Loading…</p>;

  const tabButton = (t: Tab, label: string) => (
    <button className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
      {label}
    </button>
  );

  return (
    <div className="app">
      <nav className="tabs">
        {tabButton("study", "Study")}
        {tabButton("review", "Review")}
        {tabButton("explore", "Explore")}
        {!db && <span className="muted nav-note">Progress is not saved: no database</span>}
      </nav>
      <main key={bookVersion}>
        {tab === "study" && (
          <StudyView
            book={book}
            db={db}
            selection={selection}
            onSelect={setSelection}
            onImported={(name, color) => {
              setBookVersion((v) => v + 1);
              setSelection({ family: name, color });
            }}
          />
        )}
        {tab === "review" && (
          <ReviewView
            book={book}
            db={db}
            onStudy={(s) => {
              setSelection(s);
              setTab("study");
            }}
          />
        )}
        {tab === "explore" && <ExploreView book={book} db={db} />}
      </main>
    </div>
  );
}
