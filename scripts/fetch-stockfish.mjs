#!/usr/bin/env node
// Downloads the pinned Stockfish release and installs it as a Tauri sidecar in
// src-tauri/binaries/stockfish-<target triple>[.exe].
//
// Usage: node scripts/fetch-stockfish.mjs [target-triple ...]
// With no arguments, installs the binary for the host's Rust target triple.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "sf_19";
const BASE = `https://github.com/official-stockfish/Stockfish/releases/download/${VERSION}`;

/** Release asset, SHA-256, and binary name inside the archive, per Rust target triple. */
const ASSETS = {
  "aarch64-apple-darwin": {
    file: "stockfish-macos-universal.tar.gz",
    sha256: "a1f0e3bcc5a6927a11fe6fc8e54a779754645f3c2bae2cf13420fd1957adaa77",
    binary: "stockfish-macos-universal",
    lipoArch: "arm64",
  },
  "x86_64-apple-darwin": {
    file: "stockfish-macos-universal.tar.gz",
    sha256: "a1f0e3bcc5a6927a11fe6fc8e54a779754645f3c2bae2cf13420fd1957adaa77",
    binary: "stockfish-macos-universal",
    lipoArch: "x86_64",
  },
  "x86_64-pc-windows-msvc": {
    file: "stockfish-windows-x86-64-universal.zip",
    sha256: "3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7",
    binary: "stockfish-windows-x86-64-universal.exe",
  },
  "aarch64-pc-windows-msvc": {
    file: "stockfish-windows-arm64-universal.zip",
    sha256: "8372ad3f0d7276deb2c70f801f541ec7db463219fc6d9c7592864e542aa4f401",
    binary: "stockfish-windows-arm64-universal.exe",
  },
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "binaries");

function hostTriple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  return out.match(/^host: (\S+)$/m)[1];
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(p, name);
      if (found) return found;
    } else if (entry.name === name) return p;
  }
  return undefined;
}

async function install(triple) {
  const asset = ASSETS[triple];
  if (!asset) throw new Error(`No Stockfish asset for ${triple}. Known: ${Object.keys(ASSETS).join(", ")}`);
  const ext = triple.includes("windows") ? ".exe" : "";
  const dest = join(outDir, `stockfish-${triple}${ext}`);

  const work = mkdtempSync(join(tmpdir(), "stockfish-"));
  try {
    console.log(`Downloading ${asset.file}`);
    const res = await fetch(`${BASE}/${asset.file}`);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    const data = Buffer.from(await res.arrayBuffer());
    const digest = createHash("sha256").update(data).digest("hex");
    if (digest !== asset.sha256) throw new Error(`SHA-256 mismatch for ${asset.file}: ${digest}`);

    const archive = join(work, asset.file);
    writeFileSync(archive, data);
    // bsdtar on macOS and Windows 10+ extracts both .tar.gz and .zip.
    execFileSync("tar", ["-xf", archive, "-C", work]);

    const binary = findFile(work, asset.binary);
    if (!binary) throw new Error(`${asset.binary} not found in ${asset.file}`);
    mkdirSync(outDir, { recursive: true });
    if (asset.lipoArch) {
      execFileSync("lipo", [binary, "-thin", asset.lipoArch, "-output", dest]);
    } else {
      copyFileSync(binary, dest);
    }
    copyFileSync(findFile(work, "Copying.txt"), join(outDir, "stockfish-COPYING.txt"));
    console.log(`Installed ${dest}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const targets = process.argv.slice(2);
for (const triple of targets.length > 0 ? targets : [hostTriple()]) {
  const ext = triple.includes("windows") ? ".exe" : "";
  if (targets.length === 0 && existsSync(join(outDir, `stockfish-${triple}${ext}`))) {
    console.log(`Stockfish for ${triple} is already installed`);
    continue;
  }
  await install(triple);
}
