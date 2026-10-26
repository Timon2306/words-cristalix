import React, { useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  Loader2,
  Eye,
  EyeOff,
  Folder,
  ArrowUp,
  ArrowDown,
  RotateCcw,
} from 'lucide-react';
import type { AiProvider, AppSettings, ProviderConfig, ProxyConfig } from '../types';
import { testProxyConnection, openDatasetFolder } from '../services/tauriBridge';
import {
  DEFAULT_DEEPSEEK_MODELS,
  DEFAULT_GEMINI_MODELS,
  DEFAULT_PROVIDER_CONFIGS,
} from '../services/storage';

interface SettingsModalProps {
  settings: AppSettings;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updated: AppSettings) => void;
}

const QUICK_MODELS: Record<AiProvider, { id: string; label: string }[]> = {
  deepseek: [
    { id: 'deepseek-flash', label: 'V4.1 Flash 1017' },
    { id: 'deepseek-v4-pro', label: 'V4 Pro' },
  ],
  gemini: [
    { id: 'gemini-3.5-flash-lite', label: '3.5 Flash-Lite' },
    { id: 'gemini-3.5-flash', label: '3.5 Flash (Стабильная)' },
    { id: 'gemini-3-flash-preview', label: '3 Flash Preview (2.7с)' },
    { id: 'gemini-flash-lite-latest', label: 'Flash-Lite Latest' },
  ],
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  isOpen,
  onClose,
  onSave,
}) => {
  const [activeTab, setActiveTab] = useState<'api' | 'proxy' | 'models' | 'shortcuts'>('api');
  const [provider, setProvider] = useState<AiProvider>(settings.provider || 'gemini');
  const [providerConfigs, setProviderConfigs] = useState<Record<AiProvider, ProviderConfig>>(() => ({
    gemini: {
      ...DEFAULT_PROVIDER_CONFIGS.gemini,
      ...(settings.providers?.gemini || {}),
      apiKeys: [...(settings.providers?.gemini?.apiKeys || [])],
      models: [...(settings.providers?.gemini?.models || DEFAULT_GEMINI_MODELS)],
    },
    deepseek: {
      ...DEFAULT_PROVIDER_CONFIGS.deepseek,
      ...(settings.providers?.deepseek || {}),
      apiKeys: [...(settings.providers?.deepseek?.apiKeys || [])],
      models: [...(settings.providers?.deepseek?.models || DEFAULT_DEEPSEEK_MODELS)],
    },
  }));
  const [newKeyInput, setNewKeyInput] = useState('');
  const [customModelInput, setCustomModelInput] = useState('');

  const activeConfig = providerConfigs[provider];
  const apiKeys = activeConfig.apiKeys;
  const activeKeyIndex = activeConfig.activeKeyIndex;
  const models = activeConfig.models;

  const updateActiveConfig = (patch: Partial<ProviderConfig>) => {
    setProviderConfigs((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], ...patch },
    }));
  };

  const [proxy, setProxy] = useState<ProxyConfig>(
    settings.proxy || {
      enabled: false,
      host: '',
      username: '',
      password: '',
    }
  );
  const [showPassword, setShowPassword] = useState(false);
  const [isTestingProxy, setIsTestingProxy] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [mode, setMode] = useState<'screen' | 'logs'>(settings.mode || 'screen');
  const [logPath, setLogPath] = useState(settings.logPath || '');
  const [autoSubmit, setAutoSubmit] = useState(settings.autoSubmit ?? false);
  const [autoSubmitTop1OnCapture, setAutoSubmitTop1OnCapture] = useState(
    settings.autoSubmitTop1OnCapture ?? false
  );
  const [saveScreenshots, setSaveScreenshots] = useState(
    settings.saveScreenshots ?? false
  );
  const [shortcuts, setShortcuts] = useState(settings.shortcuts);
  const [savedNotice, setSavedNotice] = useState(false);

  if (!isOpen) return null;

  // Добавление API ключей
  const handleAddKeys = () => {
    if (!newKeyInput.trim()) return;

    const tokens = newKeyInput
      .split(/[\r\n,;]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 5);

    if (tokens.length === 0) return;

    const updated = [...apiKeys];
    let addedCount = 0;

    for (const token of tokens) {
      if (!updated.includes(token)) {
        updated.push(token);
        addedCount++;
      }
    }

    if (addedCount > 0) {
      updateActiveConfig({ apiKeys: updated });
    }
    setNewKeyInput('');
  };

  const handleRemoveKey = (index: number) => {
    const updated = apiKeys.filter((_, i) => i !== index);
    updateActiveConfig({
      apiKeys: updated,
      activeKeyIndex: Math.min(activeKeyIndex, Math.max(0, updated.length - 1)),
    });
  };

  const handleClearAllKeys = () => {
    if (window.confirm('Удалить все добавленные API ключи?')) {
      updateActiveConfig({ apiKeys: [], activeKeyIndex: 0 });
    }
  };

  // Управление списком моделей (каскад)
  const handleAddModel = (modelToAdd?: string) => {
    const target = (modelToAdd || customModelInput).trim();
    if (!target) return;
    if (!models.includes(target)) {
      updateActiveConfig({ models: [...models, target] });
    }
    setCustomModelInput('');
  };

  const handleRemoveModel = (index: number) => {
    if (models.length <= 1) {
      alert('В списке должна остаться хотя бы одна модель.');
      return;
    }
    updateActiveConfig({ models: models.filter((_, i) => i !== index) });
  };

  const handleMoveModel = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= models.length) return;
    const next = [...models];
    const temp = next[index];
    next[index] = next[newIndex];
    next[newIndex] = temp;
    updateActiveConfig({ models: next });
  };

  const handleResetModels = () => {
    updateActiveConfig({
      models: [...(provider === 'deepseek' ? DEFAULT_DEEPSEEK_MODELS : DEFAULT_GEMINI_MODELS)],
    });
  };

  const handleTestProxy = async () => {
    if (!proxy.host.trim()) {
      setProxyTestResult({ ok: false, msg: 'Введите адрес и порт' });
      return;
    }

    setIsTestingProxy(true);
    setProxyTestResult(null);

    try {
      const res = await testProxyConnection({
        ...proxy,
        enabled: true,
      });
      setProxyTestResult({ ok: true, msg: res });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setProxyTestResult({ ok: false, msg: errMsg });
    } finally {
      setIsTestingProxy(false);
    }
  };

  const handleSave = () => {
    const normalize = (config: ProviderConfig, fallbackModel: string): ProviderConfig => {
      const modelList = config.models.length > 0 ? config.models : [fallbackModel];
      return {
        ...config,
        models: modelList,
        selectedModel: modelList[0],
        activeKeyIndex: Math.min(
          config.activeKeyIndex,
          Math.max(0, config.apiKeys.length - 1)
        ),
      };
    };

    onSave({
      ...settings,
      provider,
      providers: {
        gemini: normalize(providerConfigs.gemini, DEFAULT_GEMINI_MODELS[0]),
        deepseek: normalize(providerConfigs.deepseek, DEFAULT_DEEPSEEK_MODELS[0]),
      },
      proxy,
      mode,
      logPath,
      autoSubmit,
      autoSubmitTop1OnCapture,
      saveScreenshots,
      shortcuts,
    });
    setSavedNotice(true);
    setTimeout(() => {
      setSavedNotice(false);
      onClose();
    }, 500);
  };

  const maskKey = (key: string) => {
    if (key.length <= 10) return '••••••••••';
    return `${key.slice(0, 6)}••••${key.slice(-4)}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/70 backdrop-blur-sm select-none">
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-zinc-200">
        {/* Заголовок */}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-zinc-800/80">
          <span className="text-xs font-semibold text-zinc-200">
            Настройки
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Вкладки */}
        <div className="flex border-b border-zinc-800/80 bg-zinc-950/40 text-xs">
          <button
            onClick={() => setActiveTab('api')}
            className={`flex-1 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'api'
                ? 'border-zinc-200 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Ключи ({apiKeys.length})
          </button>

          <button
            onClick={() => setActiveTab('proxy')}
            className={`flex-1 py-2 font-medium border-b-2 transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'proxy'
                ? 'border-zinc-200 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>Прокси</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                proxy.enabled && proxy.host.trim() ? 'bg-emerald-400' : 'bg-zinc-600'
              }`}
            />
          </button>

          <button
            onClick={() => setActiveTab('models')}
            className={`flex-1 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'models'
                ? 'border-zinc-200 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Модели ({models.length})
          </button>

          <button
            onClick={() => setActiveTab('shortcuts')}
            className={`flex-1 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'shortcuts'
                ? 'border-zinc-200 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Бинда
          </button>
        </div>

        {/* Содержимое вкладок */}
        <div className="p-3.5 overflow-y-auto max-h-80 space-y-3 text-xs">
          {/* ВКЛАДКА: API КЛЮЧИ */}
          {activeTab === 'api' && (
            <div className="space-y-2.5">
              {/* Выбор провайдера */}
              <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-zinc-950 border border-zinc-800">
                {(['deepseek', 'gemini'] as AiProvider[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setProvider(p);
                      setNewKeyInput('');
                      setCustomModelInput('');
                    }}
                    className={`py-1.5 rounded-md text-[11px] font-medium transition-colors flex items-center justify-center gap-1 ${
                      provider === p
                        ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <span>{p === 'deepseek' ? 'DeepSeek' : 'Gemini'}</span>
                    {p === 'deepseek' && (
                      <span className="text-[8px] px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 font-sans">
                        без VPN
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <p className="text-[10px] leading-snug text-zinc-500 px-0.5">
                {provider === 'deepseek'
                  ? 'Ключ с platform.deepseek.com. Работает из РФ напрямую, без VPN и прокси. Кэш системного промпта включается автоматически.'
                  : 'Ключи Google AI Studio. Для доступа из РФ нужен прокси во вкладке «Прокси».'}
              </p>

              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder={
                    provider === 'deepseek'
                      ? 'Вставьте API-ключ DeepSeek (sk-...), можно пачкой'
                      : 'Вставьте API-ключ Gemini (можно пачкой)'
                  }
                  value={newKeyInput}
                  onChange={(e) => setNewKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddKeys()}
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-zinc-600 focus:outline-none text-xs font-mono text-zinc-200"
                />
                <button
                  onClick={handleAddKeys}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 flex items-center gap-1 font-medium transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Добавить</span>
                </button>
              </div>

              <div className="flex justify-between items-center text-[10px] text-zinc-400 px-0.5">
                <span>Список ключей (авто-ротация при ошибках):</span>
                {apiKeys.length > 0 && (
                  <button
                    onClick={handleClearAllKeys}
                    className="text-zinc-400 hover:text-red-400 transition-colors"
                  >
                    Очистить
                  </button>
                )}
              </div>

              {/* Список добавленных ключей */}
              <div className="space-y-1 max-h-44 overflow-y-auto pr-0.5">
                {apiKeys.length === 0 ? (
                  <div className="text-center py-5 text-zinc-500 text-xs border border-dashed border-zinc-800 rounded-lg">
                    Нет ключей. Вставьте ключ {provider === 'deepseek' ? 'DeepSeek' : 'Gemini'} выше.
                  </div>
                ) : (
                  apiKeys.map((key, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border transition-all ${
                        i === activeKeyIndex
                          ? 'bg-zinc-800/60 border-zinc-600 text-zinc-100'
                          : 'bg-zinc-950/60 border-zinc-800 text-zinc-300'
                      }`}
                    >
                      <div
                        className="flex items-center gap-2 font-mono text-[11px] cursor-pointer flex-1"
                        onClick={() => updateActiveConfig({ activeKeyIndex: i })}
                        title="Сделать активным"
                      >
                        <span className="text-zinc-500">#{i + 1}</span>
                        <span>{maskKey(key)}</span>
                        {i === activeKeyIndex && (
                          <span className="px-1 py-0.2 rounded text-[9px] bg-zinc-800 text-zinc-300 border border-zinc-700 font-sans">
                            Активен
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemoveKey(i)}
                        className="p-1 rounded text-zinc-500 hover:text-red-400 transition-colors"
                        title="Удалить"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ВКЛАДКА: ПРОКСИ */}
          {activeTab === 'proxy' && (
            <div className="space-y-2.5">
              {provider === 'deepseek' && (
                <div className="p-2 rounded-lg bg-emerald-950/20 border border-emerald-800/30 text-[10px] leading-snug text-emerald-300/80">
                  Прокси применяется только к Gemini. DeepSeek работает из РФ напрямую, без VPN.
                </div>
              )}

              {/* Переключатель */}
              <label className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800 cursor-pointer">
                <span className="font-medium text-zinc-200">
                  Использовать прокси (HTTP / SOCKS5)
                </span>
                <input
                  type="checkbox"
                  checked={proxy.enabled}
                  onChange={(e) => setProxy({ ...proxy, enabled: e.target.checked })}
                  className="w-4 h-4 rounded text-zinc-200 bg-zinc-900 border-zinc-700 focus:ring-0 cursor-pointer"
                />
              </label>

              {/* Выбор протокола HTTP / SOCKS5 */}
              <div className="flex rounded-lg bg-zinc-950 p-0.5 border border-zinc-800 text-[11px]">
                <button
                  type="button"
                  onClick={() => setProxy({ ...proxy, protocol: 'http' })}
                  className={`flex-1 py-1 rounded-md font-medium transition-colors ${
                    (proxy.protocol || 'http') === 'http'
                      ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  HTTP / HTTPS
                </button>
                <button
                  type="button"
                  onClick={() => setProxy({ ...proxy, protocol: 'socks5' })}
                  className={`flex-1 py-1 rounded-md font-medium transition-colors ${
                    proxy.protocol === 'socks5'
                      ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  SOCKS5
                </button>
              </div>

              {/* Поля */}
              <div className="space-y-2">
                <div className="space-y-1">
                  <span className="text-[11px] text-zinc-400 block">Адрес и порт (можно IP:порт или IP:порт:логин:пароль)</span>
                  <input
                    type="text"
                    placeholder="84.252.101.133:43916"
                    value={proxy.host}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      const detectedProtocol = (val.startsWith('socks5://') || val.startsWith('socks5h://'))
                        ? 'socks5'
                        : val.startsWith('http://')
                        ? 'http'
                        : proxy.protocol || 'http';

                      if (val.includes('@')) {
                        const clean = val.replace(/^(https?|socks5h?):\/\//i, '');
                        const [authPart, hostPart] = clean.split('@');
                        if (hostPart && authPart) {
                          const [u, p] = authPart.split(':');
                          setProxy((prev) => ({
                            ...prev,
                            protocol: detectedProtocol,
                            host: hostPart.trim(),
                            username: u ? u.trim() : prev.username,
                            password: p ? p.trim() : prev.password,
                          }));
                          return;
                        }
                      } else {
                        const parts = val.split(':');
                        if (parts.length === 4 && !val.includes('/')) {
                          setProxy((prev) => ({
                            ...prev,
                            protocol: detectedProtocol,
                            host: `${parts[0].trim()}:${parts[1].trim()}`,
                            username: parts[2].trim(),
                            password: parts[3].trim(),
                          }));
                          return;
                        }
                      }
                      setProxy({ ...proxy, protocol: detectedProtocol, host: e.target.value });
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-zinc-600 focus:outline-none text-xs font-mono text-zinc-200"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Логин</span>
                    <input
                      type="text"
                      placeholder="Логин"
                      value={proxy.username || ''}
                      onChange={(e) => setProxy({ ...proxy, username: e.target.value })}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-zinc-600 focus:outline-none text-xs font-mono text-zinc-200"
                    />
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Пароль</span>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Пароль"
                        value={proxy.password || ''}
                        onChange={(e) => setProxy({ ...proxy, password: e.target.value })}
                        className="w-full px-2.5 py-1.5 pr-7 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-zinc-600 focus:outline-none text-xs font-mono text-zinc-200"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleTestProxy}
                  disabled={isTestingProxy}
                  className="w-full py-1.5 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-200 font-medium flex items-center justify-center gap-1.5 transition-colors text-xs"
                >
                  {isTestingProxy ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Проверка...</span>
                    </>
                  ) : (
                    <span>Проверить прокси</span>
                  )}
                </button>

                {proxyTestResult && (
                  <div
                    className={`p-2 rounded-lg border text-[11px] ${
                      proxyTestResult.ok
                        ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300'
                        : 'bg-red-950/30 border-red-800/40 text-red-300'
                    }`}
                  >
                    {proxyTestResult.msg}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ВКЛАДКА: МОДЕЛИ (Каскад приоритета + ручной ввод) */}
          {activeTab === 'models' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[10px] text-zinc-500 px-0.5">
                <span>
                  Провайдер:{' '}
                  <span className="text-zinc-200 font-medium">
                    {provider === 'deepseek' ? 'DeepSeek' : 'Gemini'}
                  </span>
                </span>
                <span>меняется во вкладке «Ключи»</span>
              </div>

              {/* Добавление своей модели вручную */}
              <div className="space-y-1.5">
                <span className="text-[11px] text-zinc-400 block">
                  Каскад моделей (если 1-я не ответит — идёт на 2-ю):
                </span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder={
                      provider === 'deepseek'
                        ? 'Название (напр. deepseek-flash)'
                        : 'Название (напр. gemini-3.5-flash-lite)'
                    }
                    value={customModelInput}
                    onChange={(e) => setCustomModelInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddModel()}
                    className="flex-1 px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-zinc-600 focus:outline-none text-xs font-mono text-zinc-200"
                  />
                  <button
                    onClick={() => handleAddModel()}
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 flex items-center gap-1 font-medium transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Добавить</span>
                  </button>
                </div>

                {/* Быстрые кнопки добавления */}
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {QUICK_MODELS[provider].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleAddModel(p.id)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                        models.includes(p.id)
                          ? 'bg-zinc-800/50 border-zinc-750 text-zinc-400 opacity-60'
                          : 'bg-zinc-950 border-zinc-800 hover:border-zinc-600 text-zinc-300'
                      }`}
                    >
                      + {p.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handleResetModels}
                    className="px-1.5 py-0.5 rounded text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors ml-auto flex items-center gap-1"
                    title="Сбросить список моделей"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>Сброс</span>
                  </button>
                </div>

                {provider === 'deepseek' && (
                  <div className="p-2 rounded-lg bg-zinc-950/60 border border-zinc-800 text-[10px] leading-snug text-zinc-500">
                    Flash: $0.15/1M вход · $0.003/1M из кэша · $0.6/1M выход (off-peak).
                    Режим размышлений выключен для мгновенного ответа.
                  </div>
                )}
              </div>

              {/* Список настроенных моделей в порядке каскада */}
              <div className="space-y-1 max-h-36 overflow-y-auto pr-0.5">
                {models.map((m, index) => (
                  <div
                    key={m}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border transition-colors ${
                      index === 0
                        ? 'bg-zinc-800/80 border-zinc-600 text-zinc-100'
                        : 'bg-zinc-950/60 border-zinc-800 text-zinc-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-mono text-[11px] truncate flex-1">
                      <span className="text-zinc-500 font-sans text-[10px]">
                        #{index + 1}
                      </span>
                      <span className="truncate">{m}</span>
                      {index === 0 ? (
                        <span className="px-1 py-0.2 rounded text-[9px] bg-zinc-700/80 text-zinc-200 border border-zinc-600 font-sans">
                          Основная
                        </span>
                      ) : (
                        <span className="px-1 py-0.2 rounded text-[9px] bg-zinc-900 text-zinc-400 border border-zinc-800 font-sans">
                          Резерв {index}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 ml-2">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => handleMoveModel(index, 'up')}
                        className={`p-1 rounded transition-colors ${
                          index === 0 ? 'text-zinc-600 cursor-not-allowed' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                        }`}
                        title="Поднять приоритет"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={index === models.length - 1}
                        onClick={() => handleMoveModel(index, 'down')}
                        className={`p-1 rounded transition-colors ${
                          index === models.length - 1 ? 'text-zinc-600 cursor-not-allowed' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                        }`}
                        title="Понизить приоритет"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={models.length <= 1}
                        onClick={() => handleRemoveModel(index)}
                        className={`p-1 rounded transition-colors ${
                          models.length <= 1 ? 'text-zinc-700 cursor-not-allowed' : 'text-zinc-500 hover:text-red-400'
                        }`}
                        title="Удалить из списка"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Режим работы */}
              <div className="pt-2 border-t border-zinc-800 space-y-1.5">
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMode('screen')}
                    className={`py-1.5 px-2 rounded-lg border text-xs font-medium transition-colors ${
                      mode === 'screen'
                        ? 'bg-zinc-800 border-zinc-600 text-zinc-100'
                        : 'bg-zinc-950/60 border-zinc-800 text-zinc-400'
                    }`}
                  >
                    📸 Экран
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('logs')}
                    className={`py-1.5 px-2 rounded-lg border text-xs font-medium transition-colors ${
                      mode === 'logs'
                        ? 'bg-zinc-800 border-zinc-600 text-zinc-100'
                        : 'bg-zinc-950/60 border-zinc-800 text-zinc-400'
                    }`}
                  >
                    📜 Логи Cristalix
                  </button>
                </div>

                {mode === 'logs' && (
                  <input
                    type="text"
                    value={logPath}
                    onChange={(e) => setLogPath(e.target.value)}
                    className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-[10px] font-mono text-zinc-300"
                  />
                )}
              </div>

              {/* Чекбоксы авто-ввода */}
              <div className="pt-1.5 border-t border-zinc-800 space-y-1.5">
                <label className="flex items-center justify-between cursor-pointer text-xs text-zinc-300">
                  <span>⚡ Авто-отправка Топ-1 в чат</span>
                  <input
                    type="checkbox"
                    checked={autoSubmitTop1OnCapture}
                    onChange={(e) => setAutoSubmitTop1OnCapture(e.target.checked)}
                    className="w-4 h-4 rounded bg-zinc-900 border-zinc-700"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer text-xs text-zinc-300">
                  <span>Ввод в чат (T + Enter)</span>
                  <input
                    type="checkbox"
                    checked={autoSubmit}
                    onChange={(e) => setAutoSubmit(e.target.checked)}
                    className="w-4 h-4 rounded bg-zinc-900 border-zinc-700"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer text-xs text-zinc-300">
                  <span>Сохранять скриншоты в папку</span>
                  <input
                    type="checkbox"
                    checked={saveScreenshots}
                    onChange={(e) => setSaveScreenshots(e.target.checked)}
                    className="w-4 h-4 rounded bg-zinc-900 border-zinc-700"
                  />
                </label>
              </div>

              {/* Папка базы вопросов */}
              <div className="pt-1.5 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => openDatasetFolder().catch(console.error)}
                  className="w-full py-1.5 px-2.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-300 text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Folder className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Открыть папку базы вопросов и скринов</span>
                </button>
              </div>
            </div>
          )}

          {/* ВКЛАДКА: БИНДЫ */}
          {activeTab === 'shortcuts' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950/60 border border-zinc-800">
                <span className="text-zinc-300">Поиск слов</span>
                <input
                  type="text"
                  value={shortcuts.capture}
                  onChange={(e) => setShortcuts({ ...shortcuts, capture: e.target.value })}
                  className="w-20 px-1.5 py-1 rounded bg-zinc-900 border border-zinc-700 text-center font-mono text-xs text-zinc-200"
                />
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950/60 border border-zinc-800">
                <span className="text-zinc-300">Скрыть HUD</span>
                <input
                  type="text"
                  value={shortcuts.toggleHud}
                  onChange={(e) => setShortcuts({ ...shortcuts, toggleHud: e.target.value })}
                  className="w-20 px-1.5 py-1 rounded bg-zinc-900 border border-zinc-700 text-center font-mono text-xs text-zinc-200"
                />
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950/60 border border-zinc-800 text-zinc-400">
                <span>Слова 1-5</span>
                <span className="font-mono text-xs">Alt+1 .. Alt+5</span>
              </div>
            </div>
          )}
        </div>

        {/* Нижняя панель */}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-t border-zinc-800/80 bg-zinc-950/60">
          <span className="text-[11px] text-zinc-400 font-mono">
            {savedNotice ? '✓ Сохранено в AppData!' : '💾 AppData'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 text-xs transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleSave}
              className="px-3.5 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs transition-colors"
            >
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
