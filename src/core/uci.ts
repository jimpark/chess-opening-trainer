/**
 * UCI protocol for a chess engine that exchanges text lines. The transport (a Tauri sidecar, a
 * WebAssembly worker, a child process in tests) supplies `send` and calls `receive` for each line.
 */

export type Score = { cp: number } | { mate: number };

export interface PvLine {
  /** 1-based rank among MultiPV lines. */
  multipv: number;
  depth: number;
  /** From White's point of view. */
  score: Score;
  /** Principal variation in UCI, starting with the move searched. */
  pv: string[];
}

export interface Analysis {
  fen: string;
  depth: number;
  /** Sorted by multipv. */
  lines: PvLine[];
  bestmove: string | undefined;
}

export interface AnalyzeOptions {
  /** Stop at this depth. Omit for an infinite search that runs until stopped. */
  depth?: number;
  multipv?: number;
  /** Restrict the search to these UCI moves. */
  searchmoves?: string[];
  /** Called after each depth with the lines so far. */
  onUpdate?: (a: Analysis) => void;
}

export interface Search {
  /** Resolves when the engine reports bestmove, after completion or `stop()`. */
  result: Promise<Analysis>;
  stop(): void;
}

interface Pending {
  fen: string;
  white: boolean;
  lines: Map<number, PvLine>;
  depth: number;
  options: AnalyzeOptions;
  resolve: (a: Analysis) => void;
}

/** Parses an "info" line with a score and PV. Returns undefined for other lines and bound scores. */
export function parseInfo(line: string): PvLine | undefined {
  if (!line.startsWith("info ")) return undefined;
  const t = line.split(/\s+/);
  const at = (key: string) => t.indexOf(key);
  const pvAt = at("pv");
  const scoreAt = at("score");
  if (pvAt < 0 || scoreAt < 0) return undefined;
  if (t[scoreAt + 3] === "lowerbound" || t[scoreAt + 3] === "upperbound") return undefined;
  const kind = t[scoreAt + 1];
  const value = Number(t[scoreAt + 2]);
  const score: Score = kind === "mate" ? { mate: value } : { cp: value };
  const multipvAt = at("multipv");
  return {
    depth: Number(t[at("depth") + 1]),
    multipv: multipvAt >= 0 ? Number(t[multipvAt + 1]) : 1,
    score,
    pv: t.slice(pvAt + 1).filter(Boolean),
  };
}

function negate(s: Score): Score {
  return "cp" in s ? { cp: -s.cp } : { mate: -s.mate };
}

export class UciSession {
  private readonly queue: Pending[] = [];
  private readonly waiters: { token: string; resolve: () => void }[] = [];
  private ready: Promise<void> | undefined;
  private multipv = 1;

  constructor(
    private readonly send: (line: string) => void,
    private readonly options: Record<string, string | number> = {},
  ) {}

  /** Feeds one line of engine output. */
  receive(line: string): void {
    line = line.trim();
    const waiter = this.waiters[0];
    if (waiter && line === waiter.token) {
      this.waiters.shift();
      waiter.resolve();
      return;
    }

    const current = this.queue[0];
    if (!current) return;

    if (line.startsWith("bestmove")) {
      this.queue.shift();
      const move = line.split(/\s+/)[1];
      current.resolve(this.snapshot(current, move === "(none)" ? undefined : move));
      return;
    }

    const info = parseInfo(line);
    if (!info) return;
    if (info.depth > current.depth) {
      // A new depth starts: report the completed one first.
      if (current.lines.size > 0) current.options.onUpdate?.(this.snapshot(current, undefined));
      current.depth = info.depth;
    }
    current.lines.set(info.multipv, { ...info, score: current.white ? info.score : negate(info.score) });
  }

  /** Starts a search. A search already running is stopped and resolves with what it has. */
  analyze(fen: string, options: AnalyzeOptions = {}): Search {
    const multipv = options.multipv ?? 1;
    let resolve!: (a: Analysis) => void;
    const result = new Promise<Analysis>((r) => (resolve = r));
    const pending: Pending = { fen, white: fen.split(" ")[1] !== "b", lines: new Map(), depth: 0, options, resolve };

    const start = async () => {
      await this.init();
      if (this.queue.length > 0) this.send("stop");
      this.queue.push(pending);
      if (multipv !== this.multipv) {
        this.send(`setoption name MultiPV value ${multipv}`);
        this.multipv = multipv;
      }
      this.send(`position fen ${fen}`);
      const limit = options.depth ? `depth ${options.depth}` : "infinite";
      const moves = options.searchmoves?.length ? ` searchmoves ${options.searchmoves.join(" ")}` : "";
      this.send(`go ${limit}${moves}`);
    };
    const started = start();

    return {
      result,
      stop: () => {
        void started.then(() => {
          // The engine runs only the most recent "go"; a later search has already stopped this one.
          if (this.queue.at(-1) === pending) this.send("stop");
        });
      },
    };
  }

  /** Sends "uci", applies options, and waits for "readyok". Runs once. */
  init(): Promise<void> {
    this.ready ??= (async () => {
      const uciok = this.waitFor("uciok");
      this.send("uci");
      await uciok;
      for (const [name, value] of Object.entries(this.options)) {
        this.send(`setoption name ${name} value ${value}`);
      }
      const readyok = this.waitFor("readyok");
      this.send("isready");
      await readyok;
    })();
    return this.ready;
  }

  private waitFor(token: string): Promise<void> {
    return new Promise((resolve) => this.waiters.push({ token, resolve }));
  }

  private snapshot(p: Pending, bestmove: string | undefined): Analysis {
    const lines = [...p.lines.values()].sort((a, b) => a.multipv - b.multipv);
    return { fen: p.fen, depth: p.depth, lines, bestmove };
  }
}

/** Score as text from White's point of view: "+0.34", "-1.20", "#3", "#-2". */
export function formatScore(s: Score): string {
  if ("mate" in s) return `#${s.mate}`;
  const pawns = s.cp / 100;
  return `${pawns > 0 ? "+" : pawns < 0 ? "−" : ""}${Math.abs(pawns).toFixed(2)}`;
}

/** Score in centipawns from White's point of view, with mates mapped to ±100,000 minus distance. */
export function scoreValue(s: Score): number {
  if ("cp" in s) return s.cp;
  return s.mate > 0 ? 100_000 - s.mate : -100_000 - s.mate;
}
