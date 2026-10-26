pub mod commands;
pub mod log_watcher;

use commands::{
    apply_shortcuts_internal, capture_screen_area, close_selector_window,
    get_appdata_settings_path, get_dataset_count, load_settings_from_appdata,
    open_dataset_folder, open_selector_window, proxy_http_request,
    record_question_to_dataset, register_hotkeys, save_settings_to_appdata,
    send_word_to_game, set_hud_clickthrough, test_proxy_connection, OverlayState,
};
use log_watcher::{get_log_watcher_status, start_log_watcher, stop_log_watcher, LogWatcherState};
use tauri::Manager;

/// Включает Per-Monitor DPI Awareness v2 на Windows, чтобы координаты захвата экрана
/// и геометрия окон оверлея работали без размытия и смещения при масштабировании 125% / 150% / 200%.
#[cfg(windows)]
fn enable_windows_dpi_awareness() {
    use windows_sys::Win32::UI::HiDpi::{
        SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    enable_windows_dpi_awareness();

    tauri::Builder::default()
        .manage(OverlayState::default())
        .manage(LogWatcherState::default())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<OverlayState>();
            let default_shortcuts = state.shortcuts.lock().clone();

            // Регистрируем дефолтные глобальные хоткеи при старте приложения (Alt+Q, Alt+1..5, Alt+H)
            if let Err(err) = apply_shortcuts_internal(&handle, &default_shortcuts) {
                eprintln!("[MC-Words-Overlay] Предупреждение при регистрации хоткеев: {err}");
            }

            // Гарантируем, что главное окно HUD поверх всех окон и активно при запуске
            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.set_always_on_top(true);
                let _ = main_win.center();
                let _ = main_win.show();
                let _ = main_win.set_focus();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capture_screen_area,
            send_word_to_game,
            register_hotkeys,
            set_hud_clickthrough,
            open_selector_window,
            close_selector_window,
            start_log_watcher,
            stop_log_watcher,
            get_log_watcher_status,
            proxy_http_request,
            test_proxy_connection,
            load_settings_from_appdata,
            save_settings_to_appdata,
            get_appdata_settings_path,
            record_question_to_dataset,
            open_dataset_folder,
            get_dataset_count,
        ])
        .run(tauri::generate_context!())
        .expect("Критическая ошибка при запуске приложения Tauri v2");
}
