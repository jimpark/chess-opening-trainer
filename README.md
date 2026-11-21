# Chess Opening Trainer

Desktop app for macOS and Windows that teaches chess openings as White and Black, then quizzes
the user on the book moves. Built with Tauri 2, React and TypeScript. See
[docs/design.md](docs/design.md).

## Develop

Requires Node 22 and Rust.

```sh
npm install
npm run fetch-stockfish   # download Stockfish for this machine (tauri dev/build also run it)
npm run tauri dev         # run the app
npm run dev               # run the UI in a browser at http://localhost:1420, engine included
npm test                  # core logic tests; the Stockfish test runs if the binary is present
npm run tauri build       # release bundle
```

## License

GPL-3.0-or-later. Opening data from
[lichess-org/chess-openings](https://github.com/lichess-org/chess-openings), CC0. Engine:
[Stockfish](https://stockfishchess.org), GPL-3.0.
