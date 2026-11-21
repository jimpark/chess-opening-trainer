use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// The Stockfish process, started on the first command sent to it.
#[derive(Default)]
struct Engine(Mutex<Option<CommandChild>>);

/// Writes one UCI command to Stockfish, starting the process if it is not running.
/// Engine output arrives as `engine-line` events, one per line.
#[tauri::command]
fn engine_send(app: AppHandle, engine: State<Engine>, line: String) -> Result<(), String> {
    let mut child = engine.0.lock().map_err(|e| e.to_string())?;
    if child.is_none() {
        *child = Some(spawn_engine(&app)?);
    }
    child
        .as_mut()
        .expect("engine started above")
        .write(format!("{line}\n").as_bytes())
        .map_err(|e| e.to_string())
}

fn spawn_engine(app: &AppHandle) -> Result<CommandChild, String> {
    let (mut rx, child) = app
        .shell()
        .sidecar("stockfish")
        .map_err(|e| e.to_string())?
        .spawn()
        .map_err(|e| e.to_string())?;

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
                    let _ = app.emit("engine-line", line);
                }
                CommandEvent::Terminated(_) => {
                    if let Ok(mut child) = app.state::<Engine>().0.lock() {
                        *child = None;
                    }
                    let _ = app.emit("engine-exit", ());
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .manage(Engine::default())
        .invoke_handler(tauri::generate_handler![engine_send])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Ok(mut child) = app.state::<Engine>().0.lock() {
                    if let Some(child) = child.take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
