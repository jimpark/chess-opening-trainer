import { useEffect, useState } from "react";
import { lichessBook } from "./bookData";
import type { Db } from "./core/store";
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

  useEffect(() => {
    void database().then((d) => {
      setDb(d);
      setDbReady(true);
    });
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
      <main>
        {tab === "study" && <StudyView book={book} db={db} selection={selection} onSelect={setSelection} />}
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
        {tab === "explore" && <ExploreView book={book} />}
      </main>
    </div>
  );
}
