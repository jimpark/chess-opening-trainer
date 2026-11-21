import { useState } from "react";
import { lichessBook } from "./bookData";
import { ExploreView } from "./ui/ExploreView";
import { StudyView } from "./ui/StudyView";
import "./App.css";

const book = lichessBook();

type Tab = "study" | "explore";

export default function App() {
  const [tab, setTab] = useState<Tab>("study");
  return (
    <div className="app">
      <nav className="tabs">
        <button className={tab === "study" ? "on" : ""} onClick={() => setTab("study")}>Study</button>
        <button className={tab === "explore" ? "on" : ""} onClick={() => setTab("explore")}>Explore</button>
      </nav>
      <main>{tab === "study" ? <StudyView book={book} /> : <ExploreView book={book} />}</main>
    </div>
  );
}
