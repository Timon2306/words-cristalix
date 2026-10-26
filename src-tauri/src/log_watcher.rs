use parking_lot::Mutex;
use std::{
    fs::File,
    io::{BufRead, BufReader, Seek, SeekFrom},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter};

pub struct LogWatcherState {
    pub is_running: Arc<AtomicBool>,
    pub current_path: Mutex<Option<String>>,
}

impl Default for LogWatcherState {
    fn default() -> Self {
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
            current_path: Mutex::new(None),
        }
    }
}

/// Возвращает путь по умолчанию к логам Cristalix Minigames.
pub fn get_default_cristalix_log_path() -> String {
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        let p = PathBuf::from(userprofile)
            .join(".cristalix")
            .join("updates")
            .join("Minigames")
            .join("logs")
            .join("latest.log");
        return p.to_string_lossy().to_string();
    }
    String::new()
}

/// Запускает фоновый поток мониторинга файла логов Cristalix.
#[tauri::command]
pub fn start_log_watcher(
    app: AppHandle,
    state: tauri::State<'_, LogWatcherState>,
    path: Option<String>,
) -> Result<String, String> {
    let resolved_path = path
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(get_default_cristalix_log_path);

    // Останавливаем предыдущий поток, если был запущен
    state.is_running.store(false, Ordering::SeqCst);
    thread::sleep(Duration::from_millis(50));

    let running_flag = state.is_running.clone();
    running_flag.store(true, Ordering::SeqCst);
    *state.current_path.lock() = Some(resolved_path.clone());

    let target_path = resolved_path.clone();
    let app_clone = app.clone();

    thread::spawn(move || {
        let p = PathBuf::from(&target_path);
        let mut file = match File::open(&p) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("[LogWatcher] Не удалось открыть файл логов {target_path}: {e}");
                let _ = app_clone.emit("log-watcher-error", format!("Не удалось открыть файл: {e}"));
                return;
            }
        };

        // Перемещаемся в самый конец файла, чтобы обрабатывать только новые события
        let _ = file.seek(SeekFrom::End(0));
        let mut reader = BufReader::new(file);
        let mut line_buf = String::new();

        let _ = app_clone.emit("log-watcher-started", &target_path);

        while running_flag.load(Ordering::SeqCst) {
            line_buf.clear();
            match reader.read_line(&mut line_buf) {
                Ok(0) => {
                    // Конец файла (новых строк пока нет) — ждем короткую паузу
                    thread::sleep(Duration::from_millis(80));
                }
                Ok(_) => {
                    let trimmed = line_buf.trim();
                    if !trimmed.is_empty() {
                        let _ = app_clone.emit("cristalix-log-line", trimmed);
                    }
                }
                Err(err) => {
                    eprintln!("[LogWatcher] Ошибка чтения строки: {err}");
                    thread::sleep(Duration::from_millis(200));
                }
            }
        }

        let _ = app_clone.emit("log-watcher-stopped", ());
    });

    Ok(resolved_path)
}

/// Останавливает мониторинг файла логов.
#[tauri::command]
pub fn stop_log_watcher(state: tauri::State<'_, LogWatcherState>) -> Result<(), String> {
    state.is_running.store(false, Ordering::SeqCst);
    Ok(())
}

/// Возвращает статус и текущий путь логов.
#[tauri::command]
pub fn get_log_watcher_status(
    state: tauri::State<'_, LogWatcherState>,
) -> Result<serde_json::Value, String> {
    let running = state.is_running.load(Ordering::SeqCst);
    let path = state
        .current_path
        .lock()
        .clone()
        .unwrap_or_else(get_default_cristalix_log_path);

    Ok(serde_json::json!({
        "running": running,
        "path": path,
    }))
}
