import { useEffect, useState } from "react";
import { commentFor, setComment, type Db, type MoveComment } from "../core/store";

/** Shows the comment on a move and lets the user write or edit it. */
export function CommentBox({ db, epd, uci, san }: { db: Db | undefined; epd: string; uci: string; san: string }) {
  const [comment, setCurrent] = useState<MoveComment | undefined>();
  const [draft, setDraft] = useState<string | undefined>();

  useEffect(() => {
    setCurrent(undefined);
    setDraft(undefined);
    if (!db) return;
    let live = true;
    void commentFor(db, epd, uci).then((c) => live && setCurrent(c));
    return () => {
      live = false;
    };
  }, [db, epd, uci]);

  if (!db) return null;

  if (draft !== undefined) {
    const save = async () => {
      await setComment(db, epd, uci, draft);
      setCurrent(draft.trim() ? { text: draft.trim(), source: "user" } : undefined);
      setDraft(undefined);
    };
    return (
      <section className="comment">
        <h2>Comment on {san}</h2>
        <textarea
          value={draft}
          rows={3}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Keep arrow keys and letters from reaching the board's shortcuts.
            e.stopPropagation();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
            if (e.key === "Escape") setDraft(undefined);
          }}
        />
        <div className="controls">
          <button className="primary" onClick={() => void save()}>Save</button>
          <button onClick={() => setDraft(undefined)}>Cancel</button>
        </div>
      </section>
    );
  }

  return (
    <section className="comment">
      <h2>
        Comment on {san}
        {comment?.source === "import" && <span className="muted"> · from PGN</span>}
      </h2>
      {comment && <p>{comment.text}</p>}
      <button className="link" onClick={() => setDraft(comment?.text ?? "")}>
        {comment ? "Edit" : "Add a comment"}
      </button>
    </section>
  );
}
