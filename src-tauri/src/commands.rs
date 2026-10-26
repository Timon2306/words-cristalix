use arboard::Clipboard;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use image::{codecs::png::{CompressionType, FilterType, PngEncoder}, ExtendedColorType, ImageEncoder};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, io::Cursor, str::FromStr, thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use xcap::Monitor;

#[cfg(windows)]
pub fn focus_minecraft_window() -> bool {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
        IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow, BringWindowToTop,
        SW_RESTORE, SW_SHOW,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::SetFocus;
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;

    extern "system" {
        fn AttachThreadInput(id_attach: u32, id_attach_to: u32, f_attach: i32) -> i32;
    }

    struct SearchData {
        target_hwnd: HWND,
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let data = &mut *(lparam as *mut SearchData);
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }

        let mut title: [u16; 512] = [0; 512];
        let len = GetWindowTextW(hwnd, title.as_mut_ptr(), 512);
        if len > 0 {
            let s = String::from_utf16_lossy(&title[..len as usize]);
            let lower = s.to_lowercase();
            // Поиск окна Minecraft, Cristalix, Lunar, Badlion
            if lower.contains("minecraft") || lower.contains("cristalix") || lower.contains("lunar") || lower.contains("badlion") {
                data.target_hwnd = hwnd;
                return 0; // Найдено целевое окно! Прекращаем перебор
            }
        }
        1
    }

    let mut data = SearchData { target_hwnd: std::ptr::null_mut() };
    unsafe {
        EnumWindows(Some(enum_proc), &mut data as *mut SearchData as LPARAM);
    }

    if !data.target_hwnd.is_null() {
        unsafe {
            if IsIconic(data.target_hwnd) != 0 {
                ShowWindow(data.target_hwnd, SW_RESTORE);
            } else {
                ShowWindow(data.target_hwnd, SW_SHOW);
            }
            BringWindowToTop(data.target_hwnd);

            let foreground_hwnd = GetForegroundWindow();
            if foreground_hwnd != data.target_hwnd {
                let foreground_thread = GetWindowThreadProcessId(foreground_hwnd, std::ptr::null_mut());
                let current_thread = GetCurrentThreadId();

                if foreground_thread != 0 && foreground_thread != current_thread {
                    AttachThreadInput(current_thread, foreground_thread, 1);
                }
                SetForegroundWindow(data.target_hwnd);
                SetFocus(data.target_hwnd);
                if foreground_thread != 0 && foreground_thread != current_thread {
                    AttachThreadInput(current_thread, foreground_thread, 0);
                }
            }
        }
        return true;
    }
    false
}

#[cfg(windows)]
pub fn release_modifier_keys() {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, KEYEVENTF_KEYUP, VK_CONTROL, VK_LCONTROL, VK_LMENU, VK_LSHIFT,
        VK_MENU, VK_RCONTROL, VK_RMENU, VK_RSHIFT, VK_SHIFT,
    };
    unsafe {
        keybd_event(VK_MENU as u8, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_LMENU as u8, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_RMENU as u8, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_CONTROL as u8, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_LCONTROL as u8, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_RCONTROL as u8, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_SHIFT as u8, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_LSHIFT as u8, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_RSHIFT as u8, 0, KEYEVENTF_KEYUP, 0);
    }
}



/// Координаты выделенной области экрана с поддержкой сериализации для фронтенда.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct AreaCoords {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// Опциональный коэффициент масштабирования экрана (devicePixelRatio), если передан с фронтенда
    #[serde(default)]
    pub scale_factor: Option<f64>,
}

/// Потокобезопасное хранилище текущих активных горячих клавиш и последних выбранных координат.
pub struct OverlayState {
    pub shortcuts: Mutex<HashMap<String, String>>,
    pub last_coords: Mutex<Option<AreaCoords>>,
}

impl Default for OverlayState {
    fn default() -> Self {
        let mut default_map = HashMap::new();
        default_map.insert("capture_hotkey".to_string(), "Alt+Q".to_string());
        default_map.insert("pick_word_1".to_string(), "Alt+1".to_string());
        default_map.insert("pick_word_2".to_string(), "Alt+2".to_string());
        default_map.insert("pick_word_3".to_string(), "Alt+3".to_string());
        default_map.insert("pick_word_4".to_string(), "Alt+4".to_string());
        default_map.insert("pick_word_5".to_string(), "Alt+5".to_string());
        default_map.insert("toggle_hud".to_string(), "Alt+H".to_string());

        Self {
            shortcuts: Mutex::new(default_map),
            last_coords: Mutex::new(None),
        }
    }
}

/// Захватывает произвольную область экрана по абсолютным координатам с учетом DPI/масштабирования.
/// Возвращает строку `data:image/png;base64,...` без записи временных файлов на диск.
#[tauri::command]
pub async fn capture_screen_area(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    if width == 0 || height == 0 {
        return Err("Ширина и высота области захвата должны быть больше 0.".to_string());
    }

    // Определяем текущий коэффициент масштабирования основного окна или целевого монитора
    let window_scale = app
        .get_webview_window("main")
        .and_then(|w| w.scale_factor().ok())
        .unwrap_or(1.0);

    // Выполняем блокирующий захват в отдельном пуле потоков, чтобы не блокировать цикл событий Tauri
    tauri::async_runtime::spawn_blocking(move || {
        // Находим монитор, которому принадлежит начальная точка (или берем основной монитор)
        let monitor = Monitor::from_point(x, y)
            .or_else(|_| {
                Monitor::all().and_then(|mut monitors| {
                    monitors
                        .drain(..)
                        .next()
                        .ok_or_else(|| xcap::XCapError::new("Мониторы не найдены"))
                })
            })
            .map_err(|e| format!("Ошибка поиска монитора для захвата: {e}"))?;

        let mon_x = monitor.x();
        let mon_y = monitor.y();
        let mon_w = monitor.width();
        let mon_h = monitor.height();
        let mon_scale = monitor.scale_factor() as f64;

        // Выбираем актуальный коэффициент масштабирования (если координаты пришли в логических пикселях CSS,
        // а физическое разрешение монитора выше, проверяем выход за рамки и корректно переводим в физические пиксели)
        let effective_scale = if mon_scale > 1.0 { mon_scale } else { window_scale };

        // Рассчитываем локальные координаты относительно верхнего левого угла монитора.
        let rel_x_raw = (x - mon_x).max(0) as u32;
        let rel_y_raw = (y - mon_y).max(0) as u32;

        let (crop_x, crop_y, crop_w, crop_h) = if rel_x_raw + width <= mon_w && rel_y_raw + height <= mon_h {
            (rel_x_raw, rel_y_raw, width, height)
        } else {
            // Пересчет из логических (DIP) координат в физические пиксели при нестандартном DPI
            let scaled_x = ((x - mon_x) as f64 * effective_scale).round().max(0.0) as u32;
            let scaled_y = ((y - mon_y) as f64 * effective_scale).round().max(0.0) as u32;
            let scaled_w = (width as f64 * effective_scale).round().max(1.0) as u32;
            let scaled_h = (height as f64 * effective_scale).round().max(1.0) as u32;
            (scaled_x, scaled_y, scaled_w, scaled_h)
        };

        // Захватываем кадр с целевого монитора напрямую в оперативную память
        let full_image = monitor
            .capture_image()
            .map_err(|e| format!("Ошибка захвата экрана через xcap: {e}"))?;

        let img_w = full_image.width();
        let img_h = full_image.height();

        if crop_x >= img_w || crop_y >= img_h {
            return Err(format!(
                "Координаты захвата ({crop_x}, {crop_y}) выходят за границы монитора ({img_w}x{img_h})."
            ));
        }

        // Безопасная подрезка по реальным границам буфера кадра
        let safe_w = crop_w.min(img_w - crop_x);
        let safe_h = crop_h.min(img_h - crop_y);

        let cropped = image::imageops::crop_imm(&full_image, crop_x, crop_y, safe_w, safe_h).to_image();

        // Быстрое кодирование в PNG в памяти (CompressionType::Fast минимизирует задержку до < 5-10 мс)
        let mut png_buffer = Cursor::new(Vec::with_capacity((safe_w * safe_h) as usize));
        let encoder = PngEncoder::new_with_quality(
            &mut png_buffer,
            CompressionType::Fast,
            FilterType::NoFilter,
        );

        encoder
            .write_image(
                cropped.as_raw(),
                cropped.width(),
                cropped.height(),
                ExtendedColorType::Rgba8,
            )
            .map_err(|e| format!("Ошибка кодирования PNG в памяти: {e}"))?;

        let encoded_b64 = BASE64_STANDARD.encode(png_buffer.into_inner());
        Ok(format!("data:image/png;base64,{encoded_b64}"))
    })
    .await
    .map_err(|e| format!("Ошибка выполнения потока захвата: {e}"))?
}

/// Копирует слово в системный буфер обмена Windows и отправляет его в чат Minecraft.
#[tauri::command]
pub async fn send_word_to_game(word: String, auto_submit: bool) -> Result<(), String> {
    let trimmed = word.trim().to_string();
    if trimmed.is_empty() {
        return Err("Передано пустое слово для отправки в игру.".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        // 1. Копируем слово в буфер обмена Windows
        let mut clipboard = Clipboard::new()
            .map_err(|e| format!("Не удалось инициализировать буфер обмена Windows: {e}"))?;
        clipboard
            .set_text(&trimmed)
            .map_err(|e| format!("Не удалось скопировать слово в буфер обмена: {e}"))?;

        // 2. Фокусируем окно Minecraft / Cristalix и сбрасываем зажатые модификаторы
        #[cfg(windows)]
        {
            let _ = focus_minecraft_window();
            release_modifier_keys();
        }

        // Даем Windows 70 мс на переключение фокуса в клиент игры
        thread::sleep(Duration::from_millis(70));

        #[cfg(windows)]
        release_modifier_keys();

        // 3. Инициализируем нативный эмулятор ввода Enigo (SendInput на Windows)
        let mut enigo = Enigo::new(&Settings::default())
            .map_err(|e| format!("Не удалось инициализировать контроллер ввода Enigo: {e}"))?;

        if auto_submit {
            // Нажимаем клавишу открытия чата 'T'
            enigo
                .key(Key::Unicode('t'), Direction::Click)
                .map_err(|e| format!("Ошибка нажатия клавиши чата (T): {e}"))?;

            // Безопасная микро-пауза 65 мс для появления поля ввода чата
            thread::sleep(Duration::from_millis(65));

            // Эмулируем вставку текста Ctrl + V
            send_ctrl_v(&mut enigo)?;

            // Пауза 50 мс перед отправкой
            thread::sleep(Duration::from_millis(50));

            // Нажимаем Enter для отправки сообщения
            enigo
                .key(Key::Return, Direction::Click)
                .map_err(|e| format!("Ошибка нажатия клавиши Enter: {e}"))?;
        } else {
            send_ctrl_v(&mut enigo)?;
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("Ошибка потока эмуляции ввода: {e}"))?
}

/// Вспомогательная функция надежной эмуляции комбинации `Ctrl + V`.
fn send_ctrl_v(enigo: &mut Enigo) -> Result<(), String> {
    enigo
        .key(Key::Control, Direction::Press)
        .map_err(|e| format!("Ошибка зажатия клавиши Ctrl: {e}"))?;
    thread::sleep(Duration::from_millis(12));

    let v_res = enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| format!("Ошибка нажатия клавиши V: {e}"));

    thread::sleep(Duration::from_millis(12));
    let ctrl_release_res = enigo
        .key(Key::Control, Direction::Release)
        .map_err(|e| format!("Ошибка отпускания клавиши Ctrl: {e}"));

    v_res?;
    ctrl_release_res?;
    Ok(())
}

/// Переключает режим пропуска кликов мыши сквозь окно HUD (`main`) прямо в окно Minecraft.
#[tauri::command]
pub fn set_hud_clickthrough(app: AppHandle, ignore_cursor: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Главное окно 'main' не найдено.".to_string())?;

    window
        .set_ignore_cursor_events(ignore_cursor)
        .map_err(|e| format!("Не удалось переключить режим click-through: {e}"))?;

    // Уведомляем фронтенд о текущем статусе режима прозрачности для мыши
    let _ = app.emit("hud-clickthrough-changed", ignore_cursor);
    Ok(())
}

/// Открывает полноэкранное прозрачное окно выбора области экрана (`selector`).
#[tauri::command]
pub fn open_selector_window(app: AppHandle) -> Result<(), String> {
    let selector = app
        .get_webview_window("selector")
        .ok_or_else(|| "Окно выбора области 'selector' не найдено в конфигурации.".to_string())?;

    selector
        .show()
        .map_err(|e| format!("Не удалось показать окно 'selector': {e}"))?;
    selector
        .set_always_on_top(true)
        .map_err(|e| format!("Не удалось закрепить окно 'selector' поверх всех окон: {e}"))?;
    selector
        .set_focus()
        .map_err(|e| format!("Не удалось сфокусировать окно 'selector': {e}"))?;

    Ok(())
}

/// Скрывает окно выделения области (`selector`) и, если переданы координаты, сохраняет и рассылает их.
#[tauri::command]
pub fn close_selector_window(
    app: AppHandle,
    state: State<'_, OverlayState>,
    coords: Option<AreaCoords>,
) -> Result<(), String> {
    if let Some(selector) = app.get_webview_window("selector") {
        selector
            .hide()
            .map_err(|e| format!("Не удалось скрыть окно 'selector': {e}"))?;
    }

    if let Some(selected_coords) = coords {
        *state.last_coords.lock() = Some(selected_coords);
        app.emit("area-selected", selected_coords)
            .map_err(|e| format!("Не удалось отправить событие 'area-selected': {e}"))?;
    }

    Ok(())
}

/// Динамически регистрирует глобальные горячие клавиши из настроек UI.
#[tauri::command]
pub fn register_hotkeys(
    app: AppHandle,
    state: State<'_, OverlayState>,
    shortcuts: HashMap<String, String>,
) -> Result<(), String> {
    let mut stored_shortcuts = state.shortcuts.lock();

    // Обновляем локальный словарь переданными значениями
    for (action, accel) in shortcuts {
        let trimmed = accel.trim().to_string();
        if !trimmed.is_empty() {
            stored_shortcuts.insert(action, trimmed);
        }
    }

    apply_shortcuts_internal(&app, &stored_shortcuts)
}

/// Внутренняя функция перерегистрации всех глобальных хоткеев в `tauri-plugin-global-shortcut`.
pub fn apply_shortcuts_internal(
    app: &AppHandle,
    shortcuts_map: &HashMap<String, String>,
) -> Result<(), String> {
    let global_shortcut = app.global_shortcut();

    // Сбрасываем старые привязки перед регистрацией обновленного набора
    global_shortcut
        .unregister_all()
        .map_err(|e| format!("Не удалось очистить предыдущие глобальные хоткеи: {e}"))?;

    for (action_key, accelerator_str) in shortcuts_map {
        let shortcut = Shortcut::from_str(accelerator_str).map_err(|e| {
            format!("Некорректный формат комбинации клавиш '{accelerator_str}' для '{action_key}': {e}")
        })?;

        let action = action_key.clone();
        let app_handle = app.clone();

        global_shortcut
            .on_shortcut(shortcut, move |_app, _scut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }

                match action.as_str() {
                    "capture_hotkey" => {
                        let _ = app_handle.emit("trigger-capture", ());
                    }
                    "pick_word_1" => {
                        let _ = app_handle.emit("trigger-pick-word", serde_json::json!({ "index": 0 }));
                    }
                    "pick_word_2" => {
                        let _ = app_handle.emit("trigger-pick-word", serde_json::json!({ "index": 1 }));
                    }
                    "pick_word_3" => {
                        let _ = app_handle.emit("trigger-pick-word", serde_json::json!({ "index": 2 }));
                    }
                    "pick_word_4" => {
                        let _ = app_handle.emit("trigger-pick-word", serde_json::json!({ "index": 3 }));
                    }
                    "pick_word_5" => {
                        let _ = app_handle.emit("trigger-pick-word", serde_json::json!({ "index": 4 }));
                    }
                    "toggle_hud" => {
                        if let Some(hud_window) = app_handle.get_webview_window("main") {
                            let is_visible = hud_window.is_visible().unwrap_or(true);
                            if is_visible {
                                let _ = hud_window.hide();
                            } else {
                                let _ = hud_window.show();
                                let _ = hud_window.set_always_on_top(true);
                            }
                            let _ = app_handle.emit("hud-visibility-changed", !is_visible);
                        }
                    }
                    _ => {}
                }
            })
            .map_err(|e| {
                format!("Не удалось зарегистрировать хоткей '{accelerator_str}' ({action_key}): {e}")
            })?;
    }

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProxyConfig {
    pub enabled: bool,
    #[serde(default)]
    pub protocol: Option<String>,
    pub host: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpRequestPayload {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub proxy: Option<ProxyConfig>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpResponsePayload {
    pub status: u16,
    pub status_text: String,
    pub body: String,
    pub headers: HashMap<String, String>,
}

const DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

pub fn parse_proxy_config(proxy_conf: &ProxyConfig) -> Result<Option<reqwest::Proxy>, String> {
    if !proxy_conf.enabled || proxy_conf.host.trim().is_empty() {
        return Ok(None);
    }

    let mut raw_host = proxy_conf.host.trim().to_string();
    let mut username = proxy_conf
        .username
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let mut password = proxy_conf
        .password
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // 1. Формат user:pass@host:port (или http://user:pass@host:port)
    if let Some(at_idx) = raw_host.find('@') {
        let auth_part = &raw_host[..at_idx];
        let host_part = &raw_host[at_idx + 1..];
        let auth_clean = auth_part
            .trim_start_matches("http://")
            .trim_start_matches("https://")
            .trim_start_matches("socks5h://")
            .trim_start_matches("socks5://");
        if let Some(colon_idx) = auth_clean.find(':') {
            username = Some(auth_clean[..colon_idx].to_string());
            password = Some(auth_clean[colon_idx + 1..].to_string());
        } else {
            username = Some(auth_clean.to_string());
        }
        raw_host = host_part.to_string();
    }
    // 2. Формат ip:port:user:pass (распространенный формат в магазинах прокси)
    else {
        let parts: Vec<String> = raw_host.split(':').map(|s| s.to_string()).collect();
        if parts.len() == 4 && !raw_host.contains('/') {
            raw_host = format!("{}:{}", parts[0], parts[1]);
            username = Some(parts[2].clone());
            password = Some(parts[3].clone());
        }
    }

    let is_socks = proxy_conf.protocol.as_deref() == Some("socks5")
        || raw_host.starts_with("socks5://")
        || raw_host.starts_with("socks5h://");

    let clean_host = raw_host
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .trim_start_matches("socks5h://")
        .trim_start_matches("socks5://")
        .trim();

    let proxy_url = if is_socks {
        format!("socks5://{}", clean_host)
    } else {
        format!("http://{}", clean_host)
    };

    let mut proxy = reqwest::Proxy::all(&proxy_url)
        .map_err(|e| format!("Некорректный адрес прокси '{proxy_url}': {e}"))?;

    if let Some(user) = username {
        let pass = password.unwrap_or_default();
        proxy = proxy.basic_auth(&user, &pass);
    }

    Ok(Some(proxy))
}

#[tauri::command]
pub async fn proxy_http_request(payload: HttpRequestPayload) -> Result<HttpResponsePayload, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(DEFAULT_USER_AGENT);

    if let Some(proxy_conf) = payload.proxy {
        if let Some(reqwest_proxy) = parse_proxy_config(&proxy_conf)? {
            builder = builder.proxy(reqwest_proxy);
        }
    }

    let timeout = Duration::from_millis(payload.timeout_ms.unwrap_or(20000));
    builder = builder.timeout(timeout);

    let client = builder.build().map_err(|e| format!("Ошибка создания HTTP-клиента: {e}"))?;

    let method_str = payload.method.unwrap_or_else(|| "POST".to_string()).to_uppercase();
    let method = reqwest::Method::from_str(&method_str)
        .map_err(|e| format!("Недопустимый HTTP-метод '{method_str}': {e}"))?;

    let mut request = client.request(method, &payload.url);

    if let Some(headers) = payload.headers {
        for (k, v) in headers {
            request = request.header(k, v);
        }
    }

    if let Some(body) = payload.body {
        request = request.body(body);
    }

    let response = request.send().await.map_err(|e| {
        format!("Ошибка сети при запросе через прокси: {e}")
    })?;

    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or("").to_string();

    let mut resp_headers = HashMap::new();
    for (name, val) in response.headers() {
        if let Ok(val_str) = val.to_str() {
            resp_headers.insert(name.to_string(), val_str.to_string());
        }
    }

    let body = response.text().await.map_err(|e| {
        format!("Не удалось прочитать тело ответа: {e}")
    })?;

    Ok(HttpResponsePayload {
        status,
        status_text,
        body,
        headers: resp_headers,
    })
}

#[tauri::command]
pub async fn test_proxy_connection(proxy: ProxyConfig) -> Result<String, String> {
    if !proxy.enabled || proxy.host.trim().is_empty() {
        return Err("Прокси выключен или не указан адрес хоста".to_string());
    }

    let parsed_proxy = parse_proxy_config(&proxy)?
        .ok_or_else(|| "Прокси выключен или не указан хост".to_string())?;

    let client = reqwest::Client::builder()
        .proxy(parsed_proxy)
        .user_agent(DEFAULT_USER_AGENT)
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Ошибка создания HTTP-клиента: {e}"))?;

    let start = std::time::Instant::now();

    // 1. Проверяем доступность целевого API Google Gemini
    let google_res = client.get("https://generativelanguage.googleapis.com")
        .send()
        .await;

    let elapsed = start.elapsed().as_millis();

    match google_res {
        Ok(_resp) => {
            // Google ответил через туннель прокси (TLS рукопожатие успешно)
            let mut ip_info = String::new();
            if let Ok(ip_resp) = client.get("https://api.ipify.org?format=json").send().await {
                if let Ok(ip_text) = ip_resp.text().await {
                    #[derive(Deserialize)]
                    struct IpRes { ip: String }
                    if let Ok(parsed) = serde_json::from_str::<IpRes>(&ip_text) {
                        ip_info = format!(" • IP: {}", parsed.ip);
                    }
                }
            }

            Ok(format!("✓ Прокси работает! Google Gemini доступен{ip_info} (пинг: {elapsed} мс)"))
        }
        Err(e) => {
            let err_display = e.to_string();
            let err_debug = format!("{:?}", e);

            let is_dropped = err_display.contains("Proxy CONNECT aborted")
                || err_display.contains("connection closed")
                || err_display.contains("reset by peer")
                || err_debug.contains("TunnelUnexpectedEof")
                || err_debug.contains("IncompleteMessage")
                || err_debug.contains("UnexpectedEof")
                || err_debug.contains("unexpected eof");

            let is_auth_fail = err_display.contains("407")
                || err_display.contains("Proxy Authentication")
                || err_debug.contains("407");

            let is_timeout = err_display.contains("timed out")
                || err_display.contains("Timeout")
                || err_debug.contains("TimedOut");

            if is_auth_fail {
                Err("Ошибка 407: Неверный логин или пароль прокси.".to_string())
            } else if is_dropped {
                Err("Прокси сбросил соединение (Tunnel EOF). Проверьте:\n1) Включена ли авторизация по логину/паролю в панели провайдера (или привязан ли ваш IP 46.172.123.221);\n2) Соответствует ли порт (для HTTP часто отдельный порт, для SOCKS5 — другой);\n3) Активен ли тариф прокси.".to_string())
            } else if is_timeout {
                Err("Таймаут: прокси-сервер не ответил в течение 10 секунд (проверьте IP и порт).".to_string())
            } else {
                Err(format!("Не удалось связаться через прокси: {err_display}"))
            }
        }
    }
}

fn get_settings_file_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Не удалось определить AppData папку: {e}"))?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Не удалось создать папку AppData {}: {e}", dir.display()))?;
    }
    Ok(dir.join("settings.json"))
}

#[tauri::command]
pub fn load_settings_from_appdata(app_handle: AppHandle) -> Result<Option<String>, String> {
    let path = get_settings_file_path(&app_handle)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Ошибка чтения {}: {e}", path.display()))?;
    Ok(Some(content))
}

#[tauri::command]
pub fn save_settings_to_appdata(app_handle: AppHandle, settings_json: String) -> Result<String, String> {
    let path = get_settings_file_path(&app_handle)?;
    std::fs::write(&path, &settings_json)
        .map_err(|e| format!("Ошибка записи {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_appdata_settings_path(app_handle: AppHandle) -> Result<String, String> {
    let path = get_settings_file_path(&app_handle)?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetQuestionItem {
    pub id: usize,
    pub question: String,
    pub category: Option<String>,
    pub screenshot: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordResult {
    pub is_new: bool,
    pub total_questions: usize,
    pub question: String,
    pub screenshot_file: Option<String>,
    pub dataset_folder: String,
}

fn get_dataset_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Не удалось определить AppData папку: {e}"))?;
    let dataset_dir = base_dir.join("dataset");
    if !dataset_dir.exists() {
        std::fs::create_dir_all(&dataset_dir)
            .map_err(|e| format!("Не удалось создать папку dataset {}: {e}", dataset_dir.display()))?;
    }
    Ok(dataset_dir)
}

fn normalize_question_text(q: &str) -> String {
    q.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
}

#[tauri::command]
pub async fn record_question_to_dataset(
    app: AppHandle,
    question: String,
    category: Option<String>,
    image_base64: Option<String>,
) -> Result<RecordResult, String> {
    let clean_question = question.trim().to_string();
    if clean_question.is_empty() {
        return Err("Передан пустой вопрос".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let dataset_dir = get_dataset_dir(&app)?;
        let json_path = dataset_dir.join("questions.json");
        let txt_path = dataset_dir.join("questions.txt");
        let screenshots_dir = dataset_dir.join("screenshots");

        let mut items: Vec<DatasetQuestionItem> = if json_path.exists() {
            let content = std::fs::read_to_string(&json_path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        };

        let norm_target = normalize_question_text(&clean_question);
        let exists = items.iter().any(|item| normalize_question_text(&item.question) == norm_target);

        let dataset_folder_str = dataset_dir.to_string_lossy().to_string();

        if exists {
            return Ok(RecordResult {
                is_new: false,
                total_questions: items.len(),
                question: clean_question,
                screenshot_file: None,
                dataset_folder: dataset_folder_str,
            });
        }

        let new_id = items.len() + 1;
        let mut screenshot_rel = None;

        if let Some(b64) = image_base64 {
            let raw_b64 = if let Some(idx) = b64.find(',') {
                &b64[idx + 1..]
            } else {
                &b64
            };
            if let Ok(bytes) = BASE64_STANDARD.decode(raw_b64.trim()) {
                if !screenshots_dir.exists() {
                    let _ = std::fs::create_dir_all(&screenshots_dir);
                }
                let filename = format!("q_{:03}.png", new_id);
                let filepath = screenshots_dir.join(&filename);
                if std::fs::write(&filepath, bytes).is_ok() {
                    screenshot_rel = Some(format!("screenshots/{}", filename));
                }
            }
        }

        let now_str = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_default();

        let new_item = DatasetQuestionItem {
            id: new_id,
            question: clean_question.clone(),
            category: category.clone(),
            screenshot: screenshot_rel.clone(),
            timestamp: now_str,
        };

        items.push(new_item);

        if let Ok(serialized) = serde_json::to_string_pretty(&items) {
            let _ = std::fs::write(&json_path, serialized);
        }

        let mut txt_lines = Vec::new();
        for item in &items {
            let cat = item.category.as_deref().unwrap_or("Общее");
            txt_lines.push(format!("{}. {} [{}]", item.id, item.question, cat));
        }
        let _ = std::fs::write(&txt_path, txt_lines.join("\r\n"));

        Ok(RecordResult {
            is_new: true,
            total_questions: items.len(),
            question: clean_question,
            screenshot_file: screenshot_rel,
            dataset_folder: dataset_folder_str,
        })
    })
    .await
    .map_err(|e| format!("Ошибка сохранения датасета: {e}"))?
}

#[tauri::command]
pub fn open_dataset_folder(app: AppHandle) -> Result<String, String> {
    let dataset_dir = get_dataset_dir(&app)?;
    let path_str = dataset_dir.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer")
            .arg(&dataset_dir)
            .spawn();
    }

    Ok(path_str)
}

#[tauri::command]
pub fn get_dataset_count(app: AppHandle) -> Result<usize, String> {
    let dataset_dir = get_dataset_dir(&app)?;
    let json_path = dataset_dir.join("questions.json");
    if !json_path.exists() {
        return Ok(0);
    }
    let content = std::fs::read_to_string(&json_path).unwrap_or_default();
    let items: Vec<serde_json::Value> = serde_json::from_str(&content).unwrap_or_default();
    Ok(items.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_proxy_parsing() {
        let conf1 = ProxyConfig {
            enabled: true,
            protocol: None,
            host: "192.0.2.1:8080:testuser:testpass".to_string(),
            username: None,
            password: None,
        };
        let p1 = parse_proxy_config(&conf1);
        assert!(p1.is_ok());

        let conf2 = ProxyConfig {
            enabled: true,
            protocol: None,
            host: "http://testuser:testpass@192.0.2.1:8080".to_string(),
            username: None,
            password: None,
        };
        let p2 = parse_proxy_config(&conf2);
        assert!(p2.is_ok());

        let conf3 = ProxyConfig {
            enabled: true,
            protocol: None,
            host: "192.0.2.1:8080".to_string(),
            username: Some("testuser".to_string()),
            password: Some("testpass".to_string()),
        };
        let p3 = parse_proxy_config(&conf3);
        assert!(p3.is_ok());

        let conf4 = ProxyConfig {
            enabled: true,
            protocol: Some("socks5".to_string()),
            host: "192.0.2.1:8080".to_string(),
            username: Some("testuser".to_string()),
            password: Some("testpass".to_string()),
        };
        let p4 = parse_proxy_config(&conf4);
        assert!(p4.is_ok());
    }
}


