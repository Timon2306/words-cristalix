import { invoke } from '@tauri-apps/api/core';
import type { AreaCoords } from '../types';

export async function captureScreenArea(coords: AreaCoords): Promise<string> {
  return await invoke<string>('capture_screen_area', {
    x: Math.round(coords.x),
    y: Math.round(coords.y),
    width: Math.round(coords.width),
    height: Math.round(coords.height),
  });
}

export async function sendWordToGame(word: string, autoSubmit: boolean): Promise<void> {
  await invoke('send_word_to_game', {
    word,
    autoSubmit,
  });
}

export async function registerHotkeys(shortcuts: Record<string, string>): Promise<void> {
  await invoke('register_hotkeys', {
    shortcuts,
  });
}

export async function setHudClickthrough(ignoreCursor: boolean): Promise<void> {
  await invoke('set_hud_clickthrough', {
    ignoreCursor,
  });
}

export async function openSelectorWindow(): Promise<void> {
  await invoke('open_selector_window');
}

export async function closeSelectorWindow(coords?: AreaCoords): Promise<void> {
  await invoke('close_selector_window', {
    coords: coords || null,
  });
}

export async function startLogWatcher(path?: string): Promise<string> {
  return await invoke<string>('start_log_watcher', { path: path || null });
}

export async function stopLogWatcher(): Promise<void> {
  await invoke('stop_log_watcher');
}

export async function getLogWatcherStatus(): Promise<{ running: boolean; path: string }> {
  return await invoke<{ running: boolean; path: string }>('get_log_watcher_status');
}

export interface HttpRequestPayload {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  proxy?: import('../types').ProxyConfig;
  timeout_ms?: number;
}

export interface HttpResponsePayload {
  status: number;
  status_text: string;
  body: string;
  headers: Record<string, string>;
}

export async function proxyHttpRequest(payload: HttpRequestPayload): Promise<HttpResponsePayload> {
  return await invoke<HttpResponsePayload>('proxy_http_request', { payload });
}

export async function testProxyConnection(proxy: import('../types').ProxyConfig): Promise<string> {
  return await invoke<string>('test_proxy_connection', { proxy });
}

export async function loadSettingsFromAppData(): Promise<string | null> {
  return await invoke<string | null>('load_settings_from_appdata');
}

export async function saveSettingsToAppData(settingsJson: string): Promise<string> {
  return await invoke<string>('save_settings_to_appdata', { settingsJson });
}

export async function getAppDataSettingsPath(): Promise<string> {
  return await invoke<string>('get_appdata_settings_path');
}

export interface RecordQuestionResult {
  is_new: boolean;
  total_questions: number;
  question: string;
  screenshot_file?: string;
  dataset_folder: string;
}

export async function recordQuestionToDataset(
  question: string,
  category?: string,
  imageBase64?: string
): Promise<RecordQuestionResult> {
  return await invoke<RecordQuestionResult>('record_question_to_dataset', {
    question,
    category: category || null,
    imageBase64: imageBase64 || null,
  });
}

export async function openDatasetFolder(): Promise<string> {
  return await invoke<string>('open_dataset_folder');
}

export async function getDatasetCount(): Promise<number> {
  return await invoke<number>('get_dataset_count');
}


