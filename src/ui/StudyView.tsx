import { useMemo, useState } from "react";
import type { Color } from "chessops/types";
import type { OpeningBook } from "../core/book";
import { buildStudyTree, families } from "../core/study";
import { LearnView } from "./LearnView";
import { QuizView } from "./QuizView";

type Mode = "learn" | "quiz";

export function StudyView({ book }: { book: OpeningBook }) {
  const [family, setFamily] = useState<string | undefined>();
  const [color, setColor] = useState<Color>("white");
  const [mode, setMode] = useState<Mode>("learn");
  const tree = useMemo(() => (family ? buildStudyTree(book, family) : undefined), [book, family]);

  if (!tree) {
    return <OpeningPicker book={book} color={color} onColor={setColor} onPick={setFamily} />;
  }

  return (
    <div className="study">
      <div className="study-bar">
        <strong>{tree.family}</strong>
        <span className="muted">as {color === "white" ? "White" : "Black"}</span>
        <div className="segmented">
          <button className={mode === "learn" ? "on" : ""} onClick={() => setMode("learn")}>Learn</button>
          <button className={mode === "quiz" ? "on" : ""} onClick={() => setMode("quiz")}>Quiz</button>
        </div>
        <button className="link" onClick={() => setFamily(undefined)}>Change opening</button>
      </div>
      {mode === "learn" ? (
        <LearnView key={`${tree.family}-${color}`} book={book} tree={tree} color={color} onQuiz={() => setMode("quiz")} />
      ) : (
        <QuizView key={`${tree.family}-${color}`} book={book} tree={tree} color={color} />
      )}
    </div>
  );
}

function OpeningPicker(props: {
  book: OpeningBook;
  color: Color;
  onColor: (c: Color) => void;
  onPick: (family: string) => void;
}) {
  const { book, color, onColor, onPick } = props;
  const all = useMemo(() => families(book), [book]);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((f) => words.every((w) => `${f.eco} ${f.name}`.toLowerCase().includes(w)));
  }, [all, query]);

  return (
    <div className="picker">
      <div className="picker-head">
        <h1>Choose an opening</h1>
        <div className="segmented">
          <button className={color === "white" ? "on" : ""} onClick={() => onColor("white")}>Play as White</button>
          <button className={color === "black" ? "on" : ""} onClick={() => onColor("black")}>Play as Black</button>
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
        {shown.map((f) => (
          <li key={f.name}>
            <button onClick={() => onPick(f.name)}>
              <span className="eco">{f.eco}</span>
              <span className="label">{f.name}</span>
              <span className="muted count">{f.lineCount} {f.lineCount === 1 ? "line" : "lines"}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="muted">No matches</li>}
      </ul>
    </div>
  );
}
