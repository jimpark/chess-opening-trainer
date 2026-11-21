import { useState } from "react";
import type { Color } from "chessops/types";
import type { OpeningBook } from "../core/book";
import { addImportedLines, linesFromPgn } from "../core/pgnImport";
import { addImportedComments, saveImport, type Db } from "../core/store";
import { families } from "../core/study";

interface Props {
  book: OpeningBook;
  db: Db;
  color: Color;
  onImported: (name: string, color: Color) => void;
  onCancel: () => void;
}

/** Imports a PGN file or pasted PGN as a new opening to study. */
export function ImportDialog({ book, db, color, onImported, onCancel }: Props) {
  const [name, setName] = useState("");
  const [pgn, setPgn] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  /** Set after an import that left something out, so the user sees what before moving on. */
  const [imported, setImported] = useState<{ name: string; lines: number } | undefined>();

  const readFile = (file: File) => {
    void file.text().then((text) => {
      setPgn(text);
      if (!name) setName(file.name.replace(/\.pgn$/i, ""));
    });
  };

  const submit = async () => {
    const trimmed = name.trim();
    setError(undefined);
    if (!trimmed) return setError("Give the import a name.");
    if (families(book).some((f) => f.name.toLowerCase() === trimmed.toLowerCase())) {
      return setError(`An opening named "${trimmed}" already exists. Choose another name.`);
    }
    const parsed = linesFromPgn(pgn);
    setSkipped(parsed.skipped);
    if (parsed.lines.length === 0) return setError("The PGN has no lines from the standard starting position.");
    setBusy(true);
    try {
      await saveImport(db, trimmed, pgn);
      await addImportedComments(db, parsed.comments);
      const lines = addImportedLines(book, trimmed, parsed.lines);
      if (parsed.skipped.length > 0) setImported({ name: trimmed, lines });
      else onImported(trimmed, color);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (imported) {
    return (
      <div className="import">
        <h2>Imported {imported.name}</h2>
        <p>
          {imported.lines} {imported.lines === 1 ? "line" : "lines"} added. Left out:
        </p>
        <ul className="skipped muted">
          {skipped.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
        <div className="controls">
          <button className="primary" onClick={() => onImported(imported.name, color)}>
            Study {imported.name}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="import">
      <h2>Import PGN</h2>
      <p className="muted">
        Every mainline and variation becomes a line to study, and comments in braces attach to their moves. Games must
        start from the standard position.
      </p>
      <label>
        Name
        <input className="search" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Italian repertoire" />
      </label>
      <label>
        PGN file <input type="file" accept=".pgn,text/plain" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
      </label>
      <textarea
        className="pgn"
        value={pgn}
        onChange={(e) => setPgn(e.target.value)}
        placeholder={'Or paste PGN here, for example:\n1. e4 e5 2. Nf3 Nc6 3. Bc4 {Aim at f7.} Bc5 (3... Nf6 4. d3) *'}
        rows={8}
      />
      {error && <p className="feedback bad">{error}</p>}
      {skipped.length > 0 && (
        <div className="muted">
          Left out:
          <ul className="skipped">
            {skipped.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="controls">
        <button className="primary" onClick={() => void submit()} disabled={busy || pgn.trim() === ""}>
          Import
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
