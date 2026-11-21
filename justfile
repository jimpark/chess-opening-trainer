# Chess Opening Trainer tasks. Run `just` to list them.

set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

# List recipes
default:
    @just --list --unsorted

# Install npm packages and Stockfish for this machine
install:
    npm ci
    npm run fetch-stockfish

# Install Stockfish for the given Rust target triples (default: this machine)
stockfish *targets:
    node scripts/fetch-stockfish.mjs {{targets}}

# Run the desktop app in development mode
dev:
    npm run tauri dev

alias run := dev

# Run the UI in a browser at http://localhost:1420, with engine and database bridges
web:
    npm run dev

# Run all tests
test: test-ts test-rust

# Run TypeScript tests; pass a file or name filter to narrow them
test-ts *args:
    npx vitest run {{args}}

# Run TypeScript tests in watch mode
test-watch:
    npx vitest

# Run Rust tests
test-rust:
    cargo test --manifest-path src-tauri/Cargo.toml

# Type-check the app and the Vite config
typecheck:
    npm run typecheck

# Run Clippy on the Rust code
lint:
    cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

# Format TypeScript, CSS, JSON, Markdown and Rust
fmt:
    npx prettier --write .
    cargo fmt --manifest-path src-tauri/Cargo.toml

# Fail if any file is not formatted
fmt-check:
    npx prettier --check .
    cargo fmt --manifest-path src-tauri/Cargo.toml -- --check

# Run every check that should pass before a commit
check: typecheck lint fmt-check test

# Build release bundles for this platform (macOS: .app and .dmg; Windows: .msi and .exe)
build:
    npm run tauri build

# Build only the macOS .app bundle, the fastest release build
build-app:
    npm run tauri build -- --bundles app

# Build the web assets only
build-web:
    npm run build

# Build the .app and copy it to /Applications (macOS)
[macos]
install-app: build-app
    rm -rf "/Applications/Chess Opening Trainer.app"
    cp -R "src-tauri/target/release/bundle/macos/Chess Opening Trainer.app" /Applications/

# Build the installer and run it (Windows)
[windows]
install-app: build
    Start-Process -Wait (Get-ChildItem src-tauri/target/release/bundle/nsis/*.exe | Select-Object -First 1).FullName

# Delete the browser dev database in .dev-data/
reset-dev-data:
    node -e "require('fs').rmSync('.dev-data', { recursive: true, force: true })"

# Delete build output: dist/ and the Rust target directory
clean:
    node -e "require('fs').rmSync('dist', { recursive: true, force: true })"
    cargo clean --manifest-path src-tauri/Cargo.toml
