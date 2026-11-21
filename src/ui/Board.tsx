import { useEffect, useRef } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import type { Position } from "chessops/chess";
import { chessgroundDests } from "chessops/compat";
import { parseSquare } from "chessops/util";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";

export interface BoardProps {
  pos: Position;
  fen: string;
  orientation: "white" | "black";
  lastMove?: string;
  shapes?: DrawShape[];
  /** Called with a UCI move. Pawn moves to the last rank promote to a queen. */
  onMove: (uci: string) => void;
}

export function uciSquares(uci: string): [Key, Key] {
  return [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key];
}

export function Board({ pos, fen, orientation, lastMove, shapes, onMove }: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    api.current = Chessground(el.current!, {
      movable: { free: false, showDests: true },
      draggable: { showGhost: true },
      highlight: { lastMove: true, check: true },
    });
    return () => api.current?.destroy();
  }, []);

  useEffect(() => {
    const turn = pos.turn;
    const config: Config = {
      fen,
      orientation,
      turnColor: turn,
      check: pos.isCheck() ? turn : false,
      lastMove: lastMove ? uciSquares(lastMove) : undefined,
      movable: {
        color: turn,
        dests: chessgroundDests(pos) as Map<Key, Key[]>,
        events: {
          after: (orig, dest) => {
            const piece = pos.board.get(parseSquare(orig)!);
            const rank = dest[1];
            const promotes = piece?.role === "pawn" && (rank === "8" || rank === "1");
            onMoveRef.current(`${orig}${dest}${promotes ? "q" : ""}`);
          },
        },
      },
      drawable: { autoShapes: shapes ?? [] },
    };
    api.current?.set(config);
  }, [pos, fen, orientation, lastMove, shapes]);

  return <div className="board" ref={el} />;
}

