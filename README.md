# Chess Opening Trainer

Desktop app for macOS and Windows that teaches chess openings as White and Black, then quizzes
the user on the book moves. Built with Tauri 2, React and TypeScript. See
[docs/design.md](docs/design.md).

## Develop

Requires Node 22 and Rust.

```sh
npm install
npm run tauri dev     # run the app
npm test              # core logic tests
npm run tauri build   # release bundle
```

## License

GPL-3.0-or-later. Opening data from
[lichess-org/chess-openings](https://github.com/lichess-org/chess-openings), CC0.
