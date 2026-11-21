import { useEffect, useRef } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import type { Position } from "chessops/chess";
import { chessgroundDests } from "chessops/compat";
import { parseSquare } from "chessops/util";
import { normalizeUci } from "../core/book";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";

export interface BoardProps {
  pos: Position;
  fen: string;
  orientation: "white" | "black";
  lastMove?: string;
  shapes?: DrawShape[];
  /** False disables moving pieces. Defaults to true. */
  interactive?: boolean;
  /**
   * Called with a UCI move, castling written as the king taking its rook (e1h1) like the book.
   * If the parent does not change any board prop in response, the board takes the move back. Pawn moves to the last rank promote to a queen. */
  onMove: (uci: string) => void;
}

export function uciSquares(uci: string): [Key, Key] {
  return [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key];
}

export function Board({ pos, fen, orientation, lastMove, shapes, interactive = true, onMove }: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const config = useRef<Config>({});
  /** Incremented each time props are applied, to detect a move the parent ignored. */
  const applied = useRef(0);

  useEffect(() => {
    api.current = Chessground(el.current!, {
      movable: { free: false, showDests: true },
      draggable: { showGhost: true },
      highlight: { lastMove: true, check: true },
    });
    // Chessground measures the board once and re-measures only on scroll or window resize. Our
    // layout can move the board without either (the eval bar pushes it right), which makes a
    // dragged piece sit off the cursor and drop on the wrong square. Re-measuring at the start of
    // each press fixes that; capture runs before chessground's own handler on the board.
    const wrap = el.current!;
    const remeasure = () => api.current?.state.dom.bounds.clear();
    wrap.addEventListener("mousedown", remeasure, { capture: true });
    wrap.addEventListener("touchstart", remeasure, { capture: true, passive: true });
    return () => {
      wrap.removeEventListener("mousedown", remeasure, { capture: true });
      wrap.removeEventListener("touchstart", remeasure, { capture: true });
      api.current?.destroy();
    };
  }, []);

  useEffect(() => {
    const turn = pos.turn;
    config.current = {
      fen,
      orientation,
      turnColor: turn,
      check: pos.isCheck() ? turn : false,
      lastMove: lastMove ? uciSquares(lastMove) : undefined,
      movable: {
        color: interactive ? turn : undefined,
        dests: chessgroundDests(pos) as Map<Key, Key[]>,
        events: {
          after: (orig, dest) => {
            const piece = pos.board.get(parseSquare(orig)!);
            const rank = dest[1];
            const promotes = piece?.role === "pawn" && (rank === "8" || rank === "1");
            const before = applied.current;
            onMoveRef.current(normalizeUci(pos, `${orig}${dest}${promotes ? "q" : ""}`));
            setTimeout(() => {
              if (applied.current === before) api.current?.set(config.current);
            }, 50);
          },
        },
      },
      drawable: { autoShapes: shapes ?? [] },
    };
    applied.current++;
    api.current?.set(config.current);
    // set() does not redraw auto shapes that changed, so apply them separately.
    api.current?.setAutoShapes(shapes ?? []);
  }, [pos, fen, orientation, lastMove, shapes, interactive]);

  return <div className="board" ref={el} />;
}
