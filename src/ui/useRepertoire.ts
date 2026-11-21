import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Color } from "chessops/types";
import type { OpeningBook } from "../core/book";
import type { MoveResult } from "../core/quiz";
import {
  addLineProgress,
  cardsOf,
  clearLineProgress,
  lineProgress,
  recordAnswer,
  repertoireFor,
  type Db,
  type ProgressKind,
  type StoredCard,
} from "../core/store";
import { buildStudyTree, type StudyNode, type StudyTree } from "../core/study";

const lineKey = (n: StudyNode) => n.ucis.join(" ");

export interface RepertoireState {
  tree: StudyTree;
  color: Color;
  /** False until saved data has loaded. */
  loaded: boolean;
  cards: ReadonlyMap<string, StoredCard>;
  /** Leaf node ids seen in Learn. */
  seen: ReadonlySet<number>;
  /** Leaf node ids completed in Quiz. */
  completed: ReadonlySet<number>;
  markLine(kind: ProgressKind, leaf: StudyNode): void;
  clearLines(kind: ProgressKind): void;
  /** Applies a quiz answer to its card. With `onlyExisting`, positions without a card are skipped. */
  record(result: MoveResult, onlyExisting?: boolean): void;
  /** Reloads cards from the database, for changes made elsewhere, such as in a review. */
  reloadCards(): void;
}

/** Loads and saves one opening and color: its cards and line progress. Works without a database. */
export function useRepertoire(book: OpeningBook, db: Db | undefined, family: string, color: Color): RepertoireState {
  const tree = useMemo(() => buildStudyTree(book, family), [book, family]);
  const [repId, setRepId] = useState<number | undefined>();
  const [loaded, setLoaded] = useState(!db);
  const [cards, setCards] = useState<ReadonlyMap<string, StoredCard>>(new Map());
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const [seen, setSeen] = useState<ReadonlySet<number>>(new Set());
  const [completed, setCompleted] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    if (!db) return;
    let live = true;
    setLoaded(false);
    void (async () => {
      const rep = await repertoireFor(db, family, color);
      const [c, s, d] = await Promise.all([
        cardsOf(db, rep.id),
        lineProgress(db, rep.id, "seen"),
        lineProgress(db, rep.id, "completed"),
      ]);
      if (!live) return;
      const ids = (keys: Set<string>) => new Set(tree.leaves.filter((l) => keys.has(lineKey(l))).map((l) => l.id));
      setRepId(rep.id);
      setCards(c);
      setSeen(ids(s));
      setCompleted(ids(d));
      setLoaded(true);
    })();
    return () => {
      live = false;
    };
  }, [db, tree, family, color]);

  const markLine = useCallback(
    (kind: ProgressKind, leaf: StudyNode) => {
      const set = kind === "seen" ? setSeen : setCompleted;
      set((prev) => (prev.has(leaf.id) ? prev : new Set(prev).add(leaf.id)));
      if (db && repId !== undefined) void addLineProgress(db, repId, kind, lineKey(leaf));
    },
    [db, repId],
  );

  const clearLines = useCallback(
    (kind: ProgressKind) => {
      (kind === "seen" ? setSeen : setCompleted)(new Set());
      if (db && repId !== undefined) void clearLineProgress(db, repId, kind);
    },
    [db, repId],
  );

  const record = useCallback(
    (result: MoveResult, onlyExisting = false) => {
      if (!db || repId === undefined) return;
      const epd = tree.nodes[result.nodeId].epd;
      if (onlyExisting && !cardsRef.current.has(epd)) return;
      void (async () => {
        const card = await recordAnswer(db, repId, epd, result.grade, result.uci);
        if (card) setCards((prev) => new Map(prev).set(epd, card));
      })();
    },
    [db, repId, tree],
  );

  const reloadCards = useCallback(() => {
    if (db && repId !== undefined) void cardsOf(db, repId).then(setCards);
  }, [db, repId]);

  return { tree, color, loaded, cards, seen, completed, markLine, clearLines, record, reloadCards };
}
