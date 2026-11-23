import { useEffect, useMemo, useRef, useState } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Key, MouchEvent, Piece } from "chessground/types";
import { EMPTY_BOARD_FEN, INITIAL_BOARD_FEN } from "chessops/fen";
import type { Color, Role } from "chessops/types";
import {
  castlingOf,
  possibleCastling,
  setupError,
  setupFen,
  setupFromFen,
  type BoardSetup,
  type CastlingRight,
} from "../core/setup";
import { remeasureOnPress } from "./Board";

/** What a press on the board does: move pieces, remove them, or place the chosen piece. */
type Tool = "move" | "erase" | Piece;

// Chessground's piece images style <piece> elements inside .cg-wrap.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      piece: HTMLAttributes<HTMLElement>;
    }
  }
}

const ROLES: Role[] = ["king", "queen", "rook", "bishop", "knight", "pawn"];

const CASTLING_LABELS: Record<CastlingRight, string> = { K: "O-O", Q: "O-O-O", k: "O-O", q: "O-O-O" };

/** A position another tab asks Setup to edit; a new `id` repeats a request for the same FEN. */
export interface SetupRequest {
  fen: string;
  orientation: Color;
  id: number;
}

interface Props {
  /** False while another tab is shown: keys are ignored. */
  active: boolean;
  /** Loads this position onto the board, replacing the current one. */
  request?: SetupRequest;
  /** Opens the position in Explore with the engine on. */
  onAnalyze: (fen: string, orientation: Color) => void;
}

const startSetup = (): BoardSetup => ({ boardFen: INITIAL_BOARD_FEN, turn: "white", castlingOff: new Set() });

export function SetupView({ active, request, onAnalyze }: Props) {
  const [setup, setSetup] = useState<BoardSetup>(startSetup);
  const [orientation, setOrientation] = useState<Color>("white");
  const [tool, setTool] = useState<Tool>("move");
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  useEffect(() => {
    if (!request) return;
    const s = setupFromFen(request.fen);
    if (s) setSetup(s);
    setOrientation(request.orientation);
    setTool("move");
  }, [request]);

  useEffect(() => {
    const cg = Chessground(el.current!, {
      fen: setup.boardFen,
      orientation,
      movable: { free: true, color: "both", showDests: false },
      // A king dragged two squares would take its rook along, and a click on a second piece would
      // capture it instead of choosing it.
      autoCastle: false,
      selectable: { enabled: false },
      premovable: { enabled: false },
      draggable: { showGhost: true, deleteOnDropOff: true },
      highlight: { lastMove: false, check: false },
      events: {
        change: () => setSetup((s) => ({ ...s, boardFen: cg.getFen() })),
        select: (key) => applyTool(cg, key, toolRef.current),
      },
    });
    api.current = cg;
    const stop = remeasureOnPress(el.current!, cg);
    return () => {
      stop();
      cg.destroy();
    };
    // The board is created once; the effects below apply later changes.
  }, []);

  /** Places or removes a piece on a pressed square when a piece or the eraser is chosen. */
  function applyTool(cg: Api, key: Key, t: Tool) {
    if (t === "move") return;
    const here = cg.state.pieces.get(key);
    const same = t !== "erase" && here?.role === t.role && here.color === t.color;
    // Pressing a square that already holds the chosen piece removes it, so a misclick is undone.
    cg.setPieces(new Map([[key, t === "erase" || same ? undefined : t]]));
    setSetup((s) => ({ ...s, boardFen: cg.getFen() }));
  }

  useEffect(() => {
    const cg = api.current;
    if (!cg) return;
    if (cg.getFen() !== setup.boardFen) cg.set({ fen: setup.boardFen });
  }, [setup.boardFen]);

  useEffect(() => {
    api.current?.set({ orientation });
  }, [orientation]);

  useEffect(() => {
    // With a piece or the eraser chosen, presses place or remove pieces instead of moving them.
    api.current?.set({ movable: { color: tool === "move" ? "both" : undefined } });
  }, [tool]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "f") setOrientation((o) => (o === "white" ? "black" : "white"));
      else if (e.key === "Escape") setTool("move");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const fen = useMemo(() => setupFen(setup), [setup]);
  const error = useMemo(() => setupError(setup), [setup]);
  const possible = useMemo(() => possibleCastling(setup.boardFen), [setup.boardFen]);
  const castling = useMemo(() => castlingOf(setup), [setup]);

  /**
   * Starts dragging a copy of the piece, which lands where the mouse is released. A press that
   * places nothing is a click and chooses the piece as the tool; a drop leaves the tool alone.
   */
  const pickPiece = (piece: Piece, e: MouchEvent) => {
    const cg = api.current;
    if (!cg) return;
    const before = cg.getFen();
    cg.state.dom.bounds.clear();
    cg.dragNewPiece(piece, e, true);
    // Chessground drops the piece in its document listener, which runs before this window one.
    const end = e.type === "touchstart" ? "touchend" : "mouseup";
    window.addEventListener(end, () => cg.getFen() === before && setTool(piece), { once: true });
  };

  const toggleCastling = (right: CastlingRight) =>
    setSetup((s) => {
      const off = new Set(s.castlingOff);
      if (off.has(right)) off.delete(right);
      else off.add(right);
      return { ...s, castlingOff: off };
    });

  const isTool = (t: Tool) =>
    typeof t === "string" || typeof tool === "string" ? t === tool : t.role === tool.role && t.color === tool.color;

  return (
    <div className="explore setup">
      <div className="board-column">
        <div className="board" ref={el} />
        <div className="controls">
          <button onClick={() => setSetup(startSetup())} title="Put every piece on its starting square">
            Start position
          </button>
          <button
            onClick={() => setSetup((s) => ({ ...s, boardFen: EMPTY_BOARD_FEN, castlingOff: new Set() }))}
            title="Remove every piece"
          >
            Clear
          </button>
          <button onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))} title="Flip board (F)">
            ⇅ Flip
          </button>
        </div>
      </div>

      <aside className="panel">
        <section>
          <h2>Pieces</h2>
          <p className="muted setup-hint">
            Click a piece, then click squares to place it. Or drag a piece onto the board. In Move, drag a piece off the
            board to remove it.
          </p>
          <div className="palette cg-wrap">
            {(["white", "black"] as const).map((color) => (
              <div className="palette-row" key={color}>
                {ROLES.map((role) => (
                  <button
                    key={role}
                    className={isTool({ color, role }) ? "on" : ""}
                    title={`${color} ${role}`}
                    onMouseDown={(e) => pickPiece({ color, role }, e.nativeEvent)}
                    onTouchStart={(e) => pickPiece({ color, role }, e.nativeEvent)}
                  >
                    <piece className={`${color} ${role}`} />
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="segmented tools">
            <button className={tool === "move" ? "on" : ""} onClick={() => setTool("move")} title="Move pieces (Esc)">
              Move
            </button>
            <button className={tool === "erase" ? "on" : ""} onClick={() => setTool("erase")}>
              Erase
            </button>
          </div>
        </section>

        <section>
          <h2>Side to move</h2>
          <div className="segmented">
            {(["white", "black"] as const).map((c) => (
              <button
                key={c}
                className={setup.turn === c ? "on" : ""}
                onClick={() => setSetup((s) => ({ ...s, turn: c }))}
              >
                {c === "white" ? "White" : "Black"}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>Castling</h2>
          <div className="castling">
            {(["white", "black"] as const).map((color) => (
              <div key={color}>
                <span className="castling-side">{color === "white" ? "White" : "Black"}</span>
                {(color === "white" ? (["K", "Q"] as const) : (["k", "q"] as const)).map((r) => (
                  <label
                    key={r}
                    className={possible.has(r) ? "" : "muted"}
                    title={possible.has(r) ? undefined : "The king and rook are not on their starting squares"}
                  >
                    <input
                      type="checkbox"
                      checked={castling.has(r)}
                      disabled={!possible.has(r)}
                      onChange={() => toggleCastling(r)}
                    />
                    {CASTLING_LABELS[r]}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>FEN</h2>
          <input className="search fen" readOnly value={fen} onFocus={(e) => e.target.select()} />
        </section>

        <section className="analyze">
          <button className="primary" disabled={error !== undefined} onClick={() => onAnalyze(fen, orientation)}>
            Analyze in Explore
          </button>
          {error && <p className="warn">{error}</p>}
        </section>
      </aside>
    </div>
  );
}
