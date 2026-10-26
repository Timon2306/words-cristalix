import type { AiProvider, AppSettings, ProviderConfig } from '../types';
import {
  loadSettingsFromAppData,
  saveSettingsToAppData,
  getAppDataSettingsPath,
} from './tauriBridge';
import { isTauri } from '@tauri-apps/api/core';

const STORAGE_KEY = 'mc_words_assistant_settings_v1';

export const DEFAULT_GEMINI_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite',
];

export const DEFAULT_DEEPSEEK_MODELS = ['deepseek-flash'];

const DEPRECATED_GEMINI_MODELS = ['gemini-1.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-exp'];

export const DEFAULT_PROVIDER_CONFIGS: Record<AiProvider, ProviderConfig> = {
  gemini: {
    apiKeys: [],
    activeKeyIndex: 0,
    models: [...DEFAULT_GEMINI_MODELS],
    selectedModel: DEFAULT_GEMINI_MODELS[0],
  },
  deepseek: {
    apiKeys: [],
    activeKeyIndex: 0,
    models: [...DEFAULT_DEEPSEEK_MODELS],
    selectedModel: DEFAULT_DEEPSEEK_MODELS[0],
  },
};

export const DEFAULT_SETTINGS: AppSettings = {
  provider: 'gemini',
  providers: {
    gemini: { ...DEFAULT_PROVIDER_CONFIGS.gemini, models: [...DEFAULT_GEMINI_MODELS] },
    deepseek: { ...DEFAULT_PROVIDER_CONFIGS.deepseek, models: [...DEFAULT_DEEPSEEK_MODELS] },
  },
  proxy: {
    enabled: false,
    host: '',
    username: '',
    password: '',
  },
  mode: 'screen',
  logPath: '',
  autoSubmit: false,
  autoSubmitTop1OnCapture: false,
  saveScreenshots: false,
  clickthrough: false,
  captureArea: null,
  shortcuts: {
    capture: 'Alt+Q',
    pick1: 'Alt+1',
    pick2: 'Alt+2',
    pick3: 'Alt+3',
    pick4: 'Alt+4',
    pick5: 'Alt+5',
    toggleHud: 'Alt+H',
  },
};

function normalizeModelList(value: unknown, fallback: string[], deprecated: string[] = []): string[] {
  if (!Array.isArray(value)) return [...fallback];

  const list = value
    .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
    .map((m) => m.trim())
    .filter((m) => !deprecated.includes(m));

  return list.length > 0 ? list : [...fallback];
}

function normalizeKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
    .map((k) => k.trim());
}

function normalizeProviderConfig(raw: unknown, defaults: ProviderConfig): ProviderConfig {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const deprecated = defaults === DEFAULT_PROVIDER_CONFIGS.gemini ? DEPRECATED_GEMINI_MODELS : [];
  const models = normalizeModelList(source.models, defaults.models, deprecated);

  let selectedModel =
    typeof source.selectedModel === 'string' ? source.selectedModel.trim() : '';
  if (!selectedModel || deprecated.includes(selectedModel)) {
    selectedModel = models[0];
  }
  if (!models.includes(selectedModel)) {
    models.unshift(selectedModel);
  }

  const apiKeys = normalizeKeys(source.apiKeys);
  const rawIndex = Number(source.activeKeyIndex);
  const activeKeyIndex = Number.isInteger(rawIndex) && rawIndex >= 0
    ? Math.min(rawIndex, Math.max(0, apiKeys.length - 1))
    : 0;

  return { apiKeys, activeKeyIndex, models, selectedModel };
}

export function parseRawSettings(rawJson: string): AppSettings {
  const parsed = JSON.parse(rawJson) as Record<string, any>;
  const hasProviders = parsed.providers && typeof parsed.providers === 'object';

  // Старый формат (плоские apiKeys/models/selectedModel) мигрируем в providers.gemini.
  const legacyGemini = {
    apiKeys: parsed.apiKeys,
    activeKeyIndex: parsed.activeKeyIndex,
    models: parsed.models,
    selectedModel: parsed.selectedModel,
  };

  const providers: Record<AiProvider, ProviderConfig> = {
    gemini: normalizeProviderConfig(
      hasProviders ? parsed.providers.gemini : legacyGemini,
      DEFAULT_PROVIDER_CONFIGS.gemini
    ),
    deepseek: normalizeProviderConfig(
      hasProviders ? parsed.providers.deepseek : parsed.deepseek,
      DEFAULT_PROVIDER_CONFIGS.deepseek
    ),
  };

  const provider: AiProvider = parsed.provider === 'deepseek' ? 'deepseek' : 'gemini';

  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    provider,
    providers,
    proxy: {
      ...DEFAULT_SETTINGS.proxy,
      ...(parsed.proxy || {}),
    },
    shortcuts: {
      ...DEFAULT_SETTINGS.shortcuts,
      ...(parsed.shortcuts || {}),
    },
  };
}

// Быстрая синхронная загрузка из localStorage (для начального рендера React)
export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return parseRawSettings(raw);
  } catch (err) {
    console.error('Failed to load settings from localStorage:', err);
    return DEFAULT_SETTINGS;
  }
}

// Надежная асинхронная загрузка из постоянного файла AppData (%APPDATA%/com.mcwords.overlay/settings.json)
export async function loadSettingsFromDisk(): Promise<AppSettings> {
  if (isTauri()) {
    try {
      const appDataContent = await loadSettingsFromAppData();
      if (appDataContent && appDataContent.trim().length > 0) {
        const settings = parseRawSettings(appDataContent);
        // Синхронизируем в localStorage
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch {
          // ignore
        }
        console.log('[Storage] Настройки успешно загружены из AppData JSON');
        return settings;
      }
    } catch (err) {
      console.warn('[Storage] Ошибка чтения настроек из AppData:', err);
    }
  }

  // Если в AppData файла еще нет — берем из localStorage и сразу сохраняем в AppData
  const localSettings = loadSettings();
  if (isTauri()) {
    try {
      await saveSettingsToAppData(JSON.stringify(localSettings, null, 2));
      console.log('[Storage] Начальные настройки сохранены в AppData');
    } catch {
      // ignore
    }
  }
  return localSettings;
}

// Сохранение настроек одновременно в localStorage и в постоянный файл в AppData
export function saveSettings(settings: AppSettings): void {
  const jsonStr = JSON.stringify(settings, null, 2);

  // 1. Сохраняем в localStorage
  try {
    localStorage.setItem(STORAGE_KEY, jsonStr);
  } catch (err) {
    console.error('Failed to save settings to localStorage:', err);
  }

  // 2. Сохраняем в постоянный файл AppData
  if (isTauri()) {
    saveSettingsToAppData(jsonStr)
      .then((path) => {
        console.log(`[Storage] Настройки надежно записаны в AppData: ${path}`);
      })
      .catch((err) => {
        console.error('[Storage] Не удалось записать настройки в AppData:', err);
      });
  }
}

export async function fetchAppDataPath(): Promise<string | null> {
  if (isTauri()) {
    try {
      return await getAppDataSettingsPath();
    } catch {
      return null;
    }
  }
  return null;
}
