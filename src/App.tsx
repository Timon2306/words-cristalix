import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { AreaCoords, AppSettings, AppStatus, UsageStats, WordSuggestion } from './types';
import { loadSettings, loadSettingsFromDisk, saveSettings } from './services/storage';
import {
  captureScreenArea,
  sendWordToGame,
  setHudClickthrough,
  openSelectorWindow,
  registerHotkeys,
  startLogWatcher,
  stopLogWatcher,
  recordQuestionToDataset,
  openDatasetFolder,
  getDatasetCount,
} from './services/tauriBridge';
import {
  analyzeScreenshot,
  analyzeTextQuestion,
  PROVIDER_LABELS,
} from './services/ai';
import { loadUsageTotals, recordUsage } from './services/usage';
import type { UsageTotals } from './services/usage';
import { useTauriEvents } from './hooks/useTauriEvents';
import { Header } from './components/Header';
import { WordList } from './components/WordList';
import { SettingsModal } from './components/SettingsModal';
import { AreaSelector } from './components/AreaSelector';

const HudOverlay: React.FC = () => {
  // Стейт основного окна HUD
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [words, setWords] = useState<WordSuggestion[]>([]);
  const [question, setQuestion] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [status, setStatus] = useState<AppStatus>('idle');
  const [statusMessage, setStatusMessage] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | undefined>();
  const [usedModel, setUsedModel] = useState<string | undefined>();
  const [usage, setUsage] = useState<UsageStats | undefined>();
  const [usageTotals, setUsageTotals] = useState<UsageTotals>(() => loadUsageTotals());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [datasetCount, setDatasetCount] = useState<number>(0);

  // Рефы для предотвращения устаревания замыканий в обработчиках событий
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const wordsRef = useRef(words);
  wordsRef.current = words;
  const statusRef = useRef(status);
  statusRef.current = status;

  // Сохранение настроек в localStorage и AppData при изменении
  const updateSettings = useCallback((updated: AppSettings) => {
    setSettings(updated);
    saveSettings(updated);
  }, []);

  // Запоминаем активный ключ текущего провайдера, не затирая настройки второго.
  const updateActiveKeyIndex = useCallback(
    (newIndex: number) => {
      const latest = settingsRef.current;
      const config = latest.providers[latest.provider];
      if (!config || config.activeKeyIndex === newIndex) return;
      updateSettings({
        ...latest,
        providers: {
          ...latest.providers,
          [latest.provider]: { ...config, activeKeyIndex: newIndex },
        },
      });
    },
    [updateSettings]
  );

  // Первоначальная загрузка настроек из постоянного файла AppData и счетчика базы вопросов
  useEffect(() => {
    loadSettingsFromDisk().then((diskSettings) => {
      setSettings(diskSettings);
    });
    getDatasetCount().then(setDatasetCount).catch(() => {});
  }, []);

  // Регистрация глобальных хоткеев
  useEffect(() => {
    registerHotkeys({
      capture_hotkey: settings.shortcuts.capture,
      toggle_hud: settings.shortcuts.toggleHud,
      pick_word_1: settings.shortcuts.pick1,
      pick_word_2: settings.shortcuts.pick2,
      pick_word_3: settings.shortcuts.pick3,
      pick_word_4: settings.shortcuts.pick4,
      pick_word_5: settings.shortcuts.pick5,
    }).catch((err) => {
      console.warn('Failed to register hotkeys in Tauri:', err);
    });
  }, [settings.shortcuts]);

  // Управление жизненным циклом лог-вотчера (Режим 2)
  useEffect(() => {
    if (settings.mode === 'logs' && settings.logPath?.trim()) {
      startLogWatcher(settings.logPath)
        .then(() => {
          setStatusMessage('Лог-вотчер активен');
        })
        .catch((err) => {
          console.warn('Не удалось запустить лог-вотчер:', err);
        });
    } else {
      stopLogWatcher().catch(() => {});
    }

    return () => {
      stopLogWatcher().catch(() => {});
    };
  }, [settings.mode, settings.logPath]);

  // Выбор слова и отправка в игру
  const handlePickWord = useCallback(
    async (wordToSubmit: string) => {
      try {
        await sendWordToGame(wordToSubmit, settingsRef.current.autoSubmit);
      } catch (err: unknown) {
        console.error('Failed to send word to game:', err);
        setErrorMessage(
          err instanceof Error ? err.message : 'Не удалось отправить слово в Minecraft'
        );
      }
    },
    []
  );

  // Захват экрана и вызов Gemini API
  const handleCapture = useCallback(async () => {
    const currentSettings = settingsRef.current;
    if (statusRef.current === 'capturing' || statusRef.current === 'analyzing') return;

    if (currentSettings.mode === 'screen' && !currentSettings.captureArea) {
      setIsSettingsOpen(false);
      openSelectorWindow().catch((err) => console.error(err));
      setStatusMessage('Выделите область вопроса');
      return;
    }

    const activeConfig = currentSettings.providers[currentSettings.provider];
    if (!activeConfig || activeConfig.apiKeys.length === 0) {
      setIsSettingsOpen(true);
      setErrorMessage(`Добавьте API-ключ ${PROVIDER_LABELS[currentSettings.provider]} в настройках`);
      return;
    }

    setErrorMessage(null);
    setStatus('capturing');
    setStatusMessage('Захват экрана...');

    try {
      if (!currentSettings.captureArea) {
        throw new Error('Область захвата не выбрана.');
      }

      // 1. Снимаем выделенную область экрана в оперативную память
      const imageBase64 = await captureScreenArea(currentSettings.captureArea);

      // 2. Отправляем в выбранный ИИ (Gemini Vision / DeepSeek Vision)
      setStatus('analyzing');
      setStatusMessage(`ИИ анализирует (${PROVIDER_LABELS[currentSettings.provider]})...`);

      const result = await analyzeScreenshot(currentSettings, imageBase64, {
        onKeyRotated: (newIndex, preview, reason) => {
          setStatusMessage(`Ротация: ключ ${preview}${reason ? ` (${reason})` : ''}`);
          updateActiveKeyIndex(newIndex);
        },
        onModelFallback: (_fromModel, toModel) => {
          setStatusMessage(`Резерв: переход на ${toModel}`);
        },
      });

      const foundWords = result.data.words || [];
      setWords(foundWords);
      setQuestion(result.data.question);
      setCategory(result.data.category);
      setLatencyMs(result.latencyMs);
      setUsedModel(result.usedModel);
      if (result.usage) {
        setUsage(result.usage);
        setUsageTotals(recordUsage(result.usage));
      }
      setStatus('success');

      // 3. Сохраняем уникальный вопрос и скриншот (если включено) в локальную базу датасета
      const recognizedQuestion = result.data.question;
      if (recognizedQuestion && recognizedQuestion.trim()) {
        const screenshotToSave = currentSettings.saveScreenshots ? imageBase64 : undefined;
        recordQuestionToDataset(recognizedQuestion, result.data.category, screenshotToSave)
          .then((res) => {
            if (res.is_new) {
              setDatasetCount(res.total_questions);
              console.log(`[Dataset] Сохранен новый вопрос #${res.total_questions}: ${res.question}`);
            }
          })
          .catch((e) => console.warn('Ошибка записи в датасет:', e));
      }

      // 4. МГНОВЕННАЯ АВТО-ОТПРАВКА ТОП-1 СЛОВА (если включена)
      if (currentSettings.autoSubmitTop1OnCapture && foundWords.length > 0) {
        const topWord = foundWords[0].word;
        setStatusMessage(`⚡ Отправлено: ${topWord}`);
        await handlePickWord(topWord);
      } else {
        setStatusMessage(`Найдено ${foundWords.length} слов`);
      }

      // Сохраняем успешно сработавший ключ
      updateActiveKeyIndex(result.usedKeyIndex);
    } catch (err: unknown) {
      console.error('Capture and analysis failed:', err);
      setStatus('error');
      const msg = err instanceof Error ? err.message : 'Ошибка при обращении к ИИ';
      setErrorMessage(msg);
      setStatusMessage('Ошибка анализа');
    }
  }, [handlePickWord, updateActiveKeyIndex]);

  // Обработка текстового вопроса (из логов Cristalix)
  const handleProcessTextQuestion = useCallback(
    async (textQuestion: string) => {
      const currentSettings = settingsRef.current;
      if (statusRef.current === 'analyzing') return;

      const activeConfig = currentSettings.providers[currentSettings.provider];
      if (!activeConfig || activeConfig.apiKeys.length === 0) {
        setErrorMessage(`Добавьте API-ключ ${PROVIDER_LABELS[currentSettings.provider]} в настройках`);
        return;
      }

      setErrorMessage(null);
      setStatus('analyzing');
      setStatusMessage('ИИ читает лог...');

      try {
        const result = await analyzeTextQuestion(currentSettings, textQuestion, {
          onKeyRotated: (newIndex, preview, reason) => {
            setStatusMessage(`Ротация: ключ ${preview}${reason ? ` (${reason})` : ''}`);
            updateActiveKeyIndex(newIndex);
          },
          onModelFallback: (_fromModel, toModel) => {
            setStatusMessage(`Резерв: переход на ${toModel}`);
          },
        });

        const foundWords = result.data.words || [];
        setWords(foundWords);
        setQuestion(result.data.question);
        setCategory(result.data.category);
        setLatencyMs(result.latencyMs);
        setUsedModel(result.usedModel);
        if (result.usage) {
          setUsage(result.usage);
          setUsageTotals(recordUsage(result.usage));
        }
        setStatus('success');

        // Авто-отправка Топ-1 слова
        if (currentSettings.autoSubmitTop1OnCapture && foundWords.length > 0) {
          const topWord = foundWords[0].word;
          setStatusMessage(`⚡ Отправлено: ${topWord}`);
          await handlePickWord(topWord);
        } else {
          setStatusMessage(`Лог: найдено ${foundWords.length} слов`);
        }

        // Сохраняем уникальный вопрос из лога в датасет
        const recognizedQuestion = result.data.question || textQuestion;
        if (recognizedQuestion && recognizedQuestion.trim()) {
          recordQuestionToDataset(recognizedQuestion, result.data.category)
            .then((res) => {
              if (res.is_new) {
                setDatasetCount(res.total_questions);
                console.log(`[Dataset] Новый вопрос из логов #${res.total_questions}: ${res.question}`);
              }
            })
            .catch(() => {});
        }

        updateActiveKeyIndex(result.usedKeyIndex);
      } catch (err: unknown) {
        console.error('Log analysis failed:', err);
        setStatus('error');
        const msg = err instanceof Error ? err.message : 'Ошибка анализа текста лога';
        setErrorMessage(msg);
        setStatusMessage('Ошибка ИИ');
      }
    },
    [handlePickWord, updateActiveKeyIndex]
  );

  // Открытие папки с базой вопросов и скриншотами в проводнике Windows
  const handleOpenDataset = useCallback(async () => {
    try {
      await openDatasetFolder();
    } catch (err) {
      console.error('Failed to open dataset folder:', err);
    }
  }, []);

  // Парсер строк логов Cristalix
  const parseCristalixLogLine = useCallback(
    (line: string) => {
      // Ищем маркеры мини-игры "Слова" в чате
      const lower = line.toLowerCase();
      const hasChat = line.includes('[CHAT]');
      const isQuestion =
        lower.includes('назовите') ||
        lower.includes('слова (') ||
        lower.includes('тема:') ||
        lower.includes('категория:');

      if (hasChat && isQuestion) {
        // Очищаем строку от временных меток и префиксов
        let cleaned = line;
        const chatIdx = line.indexOf('[CHAT]');
        if (chatIdx !== -1) {
          cleaned = line.substring(chatIdx + 6).trim();
        }
        // Убираем стрелочки » и системные символы
        const arrowIdx = cleaned.indexOf('»');
        if (arrowIdx !== -1) {
          cleaned = cleaned.substring(arrowIdx + 1).trim();
        }

        if (cleaned.length > 5) {
          handleProcessTextQuestion(cleaned);
        }
      }
    },
    [handleProcessTextQuestion]
  );

  // Слушатели событий от Rust-бэкенда
  useTauriEvents({
    onTriggerCapture: () => {
      handleCapture();
    },
    onPickWordByIndex: (index: number) => {
      const currentWords = wordsRef.current;
      if (currentWords && currentWords[index]) {
        handlePickWord(currentWords[index].word);
      }
    },
    onAreaSelected: (coords: AreaCoords) => {
      updateSettings({
        ...settingsRef.current,
        captureArea: coords,
      });
      setStatus('idle');
      setStatusMessage('Область сохранена');
    },
    onClickthroughChanged: (active: boolean) => {
      updateSettings({
        ...settingsRef.current,
        clickthrough: active,
      });
    },
    onCristalixLogLine: (line: string) => {
      if (settingsRef.current.mode === 'logs') {
        parseCristalixLogLine(line);
      }
    },
    onLogWatcherStarted: () => {
      setStatusMessage('Логи активны');
    },
    onLogWatcherStopped: () => {
      setStatusMessage('Логи остановлены');
    },
  });

  // Переключение сквозных кликов мыши
  const handleToggleClickthrough = async () => {
    const nextVal = !settings.clickthrough;
    try {
      await setHudClickthrough(nextVal);
      updateSettings({ ...settings, clickthrough: nextVal });
    } catch (err) {
      console.error('Failed to toggle clickthrough:', err);
    }
  };

  // Переключение режима (Экран vs Логи)
  const handleToggleMode = () => {
    const nextMode = settings.mode === 'screen' ? 'logs' : 'screen';
    updateSettings({ ...settings, mode: nextMode });
    setStatus('idle');
    setStatusMessage(
      nextMode === 'screen' ? 'Режим: Скриншот' : 'Режим: Логи Cristalix'
    );
  };

  // Переключение авто-отправки Топ-1
  const handleToggleAutoSubmitTop1 = () => {
    const nextVal = !settings.autoSubmitTop1OnCapture;
    updateSettings({ ...settings, autoSubmitTop1OnCapture: nextVal });
    setStatusMessage(nextVal ? '⚡ Авто-отправка ВКЛ' : 'Авто-отправка ВЫКЛ');
  };

  const shortcutsList = [
    settings.shortcuts.pick1,
    settings.shortcuts.pick2,
    settings.shortcuts.pick3,
    settings.shortcuts.pick4,
    settings.shortcuts.pick5,
  ];

  return (
    <div className="w-full h-full p-2 flex flex-col box-border">
      <div className="flex-1 flex flex-col bg-zinc-950/95 backdrop-blur-xl border border-zinc-800 rounded-xl shadow-2xl overflow-hidden">
        {/* Шапка HUD */}
        <Header
          status={status}
          statusMessage={statusMessage}
          clickthrough={settings.clickthrough}
          hasCaptureArea={!!settings.captureArea}
          mode={settings.mode || 'screen'}
          autoSubmitTop1={settings.autoSubmitTop1OnCapture ?? false}
          datasetCount={datasetCount}
          onOpenDataset={handleOpenDataset}
          onTriggerCapture={handleCapture}
          onOpenSelector={() => openSelectorWindow()}
          onToggleMode={handleToggleMode}
          onToggleAutoSubmitTop1={handleToggleAutoSubmitTop1}
          onToggleClickthrough={handleToggleClickthrough}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />

        {/* Список слов */}
        <WordList
          words={words}
          question={question}
          category={category}
          latencyMs={latencyMs}
          usedModel={usedModel}
          usage={usage}
          usageTotals={usageTotals}
          autoSubmit={settings.autoSubmit}
          shortcuts={shortcutsList}
          isBusy={status === 'capturing' || status === 'analyzing'}
          errorMessage={errorMessage}
          onPickWord={handlePickWord}
          onOpenSelector={() => openSelectorWindow()}
          hasCaptureArea={!!settings.captureArea}
        />

        {/* Модалка настроек */}
        <SettingsModal
          key={isSettingsOpen ? 'settings-open' : 'settings-closed'}
          settings={settings}
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onSave={updateSettings}
        />
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  const isSelectorWindow = window.location.hash === '#/selector';
  return isSelectorWindow ? <AreaSelector /> : <HudOverlay />;
};

export default App;
