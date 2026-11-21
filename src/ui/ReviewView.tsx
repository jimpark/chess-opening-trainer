import { useCallback, useEffect, useMemo, useState } from "react";
import type { OpeningBook } from "../core/book";
import { planReview } from "../core/review";
import { repertoireSummaries, type Db, type RepertoireSummary } from "../core/store";
import { QuizView } from "./QuizView";
import type { Selection } from "./StudyView";
import { useRepertoire } from "./useRepertoire";

interface Props {
  book: OpeningBook;
  db: Db | undefined;
  onStudy: (s: Selection) => void;
}

/** Repertoires with due positions, and review sessions over them. */
export function ReviewView({ book, db, onStudy }: Props) {
  const [summaries, setSummaries] = useState<RepertoireSummary[] | undefined>();
  const [active, setActive] = useState<Selection | undefined>();

  const load = useCallback(() => {
    if (db) void repertoireSummaries(db).then(setSummaries);
  }, [db]);
  useEffect(load, [load]);

  if (!db) return <p className="loading">Reviews need the database, which is not available.</p>;

  if (active) {
    return (
      <ReviewSession
        key={`${active.family}-${active.color}`}
        book={book}
        db={db}
        selection={active}
        onFinish={() => {
          setActive(undefined);
          load();
        }}
      />
    );
  }

  const studied = (summaries ?? []).filter((s) => s.cards > 0);
  const totalDue = studied.reduce((n, s) => n + s.due, 0);

  return (
    <div className="picker">
      <div className="picker-head">
        <h1>Review</h1>
        <span className="muted">{totalDue === 0 ? "Nothing due" : `${totalDue} positions due`}</span>
      </div>
      {summaries && studied.length === 0 && (
        <p className="muted">
          No positions learned yet. Quiz yourself on an opening in the Study tab; each position you answer is scheduled
          for review.
        </p>
      )}
      <ul className="families">
        {studied.map((s) => (
          <li key={s.id} className="review-row">
            <span className="label">
              {s.family} <span className="muted">as {s.color === "white" ? "White" : "Black"}</span>
            </span>
            <span className="muted count">
              {s.cards} learned{s.due === 0 && s.nextDue ? ` · next ${formatWhen(new Date(s.nextDue))}` : ""}
            </span>
            {s.due > 0 && (
              <button className="primary" onClick={() => setActive({ family: s.family, color: s.color })}>
                Review {s.due}
              </button>
            )}
            <button className="link" onClick={() => onStudy({ family: s.family, color: s.color })}>
              Study
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewSession(props: { book: OpeningBook; db: Db; selection: Selection; onFinish: () => void }) {
  const { book, db, selection, onFinish } = props;
  const rep = useRepertoire(book, db, selection.family, selection.color);
  // Plan once, when the cards have loaded; answers during the session change the cards.
  const [plan, setPlan] = useState<number[] | undefined>();
  useEffect(() => {
    if (rep.loaded && !plan) setPlan(planReview(rep.tree, rep.color, rep.cards, new Date()).map((n) => n.id));
  }, [rep.loaded, rep.tree, rep.color, rep.cards, plan]);
  const review = useMemo(() => (plan && plan.length > 0 ? { targets: plan, onFinish } : undefined), [plan, onFinish]);

  return (
    <div className="study">
      <div className="study-bar">
        <strong>Review: {selection.family}</strong>
        <span className="muted">as {selection.color === "white" ? "White" : "Black"}</span>
        <button className="link" onClick={onFinish}>End review</button>
      </div>
      {!plan ? (
        <p className="loading">Loading…</p>
      ) : review ? (
        <QuizView book={book} rep={rep} review={review} />
      ) : (
        <p className="loading">
          Nothing is due in this opening. <button className="link" onClick={onFinish}>Back</button>
        </p>
      )}
    </div>
  );
}

/** "in 5 min", "in 3 h", "in 2 days". */
function formatWhen(d: Date, now = new Date()): string {
  const min = Math.max(1, Math.round((d.getTime() - now.getTime()) / 60_000));
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `in ${h} h`;
  return `in ${Math.round(h / 24)} days`;
}
