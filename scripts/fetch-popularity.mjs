#!/usr/bin/env node
// Fetches how many games reached each opening family's main position from the Lichess opening
// explorer, and writes data/popularity.json. The app reads that file; it makes no network calls.
//
// A family's main position is the end of the line named exactly after the family (1. e4 c5 for
// the Sicilian Defense), or of the family's shortest line when no line has that name. The shortest
// line alone can be a sideline: for Queen's Gambit Declined it is the Marshall Defense.
//
// By default the script queries the masters database, which needs no login. With LICHESS_TOKEN set
// (a personal API token from lichess.org/account/oauth/token), it queries the Lichess player
// database instead.
//
// Usage: node scripts/fetch-popularity.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const token = process.env.LICHESS_TOKEN;
const source = token ? "lichess" : "masters";
const endpoint = `https://explorer.lichess.ovh/${source}`;

/**
 * Main line per family from the Lichess TSVs: a line named exactly after the family beats any
 * other, then the shorter line, then the lower ECO code.
 */
function familyRoots() {
  const roots = new Map();
  for (const file of ["a", "b", "c", "d", "e"]) {
    const rows = readFileSync(join(root, "data", "lichess", `${file}.tsv`), "utf8")
      .split("\n")
      .slice(1);
    for (const row of rows) {
      if (!row.trim()) continue;
      const [eco, name, pgn] = row.split("\t");
      const family = name.split(":")[0].trim();
      const sans = pgn.split(/\s+/).filter((t) => t && !/^\d+\.+$/.test(t));
      const exact = name === family;
      const best = roots.get(family);
      const better =
        !best ||
        (exact && !best.exact) ||
        (exact === best.exact &&
          (sans.length < best.sans.length || (sans.length === best.sans.length && eco < best.eco)));
      if (better) roots.set(family, { eco, sans, exact });
    }
  }
  return roots;
}

function fenAfter(sans) {
  const pos = Chess.default();
  for (const san of sans) pos.play(parseSan(pos, san));
  return makeFen(pos.toSetup());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(fen) {
  const params = new URLSearchParams({ fen, moves: "0", topGames: "0", recentGames: "0" });
  if (source === "lichess") params.set("variant", "standard");
  const headers = { "User-Agent": "chess-opening-trainer build script" };
  if (token) headers.Authorization = `Bearer ${token}`;
  for (;;) {
    const res = await fetch(`${endpoint}?${params}`, { headers });
    // Lichess asks clients to wait a full minute after a 429.
    if (res.status === 429) {
      console.log("Rate limited; waiting 60 s");
      await sleep(60_000);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${fen}`);
    return res.json();
  }
}

const roots = familyRoots();
const families = {};
let i = 0;
for (const [family, { sans }] of [...roots].sort(([a], [b]) => a.localeCompare(b))) {
  const fen = fenAfter(sans);
  const r = await query(fen);
  families[family] = { games: r.white + r.draws + r.black, moves: sans.join(" ") };
  console.log(`${++i}/${roots.size} ${family}: ${families[family].games}`);
  // One request at a time, about one per second.
  await sleep(1000);
}

const out = { source, fetchedAt: new Date().toISOString().slice(0, 10), families };
writeFileSync(join(root, "data", "popularity.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote data/popularity.json (${source} database)`);
