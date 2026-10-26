import React from 'react';
import { Camera, FileText, Crosshair, Settings, MousePointer, Loader2, Zap, ZapOff, Folder } from 'lucide-react';
import type { AppStatus } from '../types';

interface HeaderProps {
  status: AppStatus;
  statusMessage?: string;
  clickthrough: boolean;
  hasCaptureArea: boolean;
  mode: 'screen' | 'logs';
  autoSubmitTop1: boolean;
  datasetCount?: number;
  onOpenDataset?: () => void;
  onTriggerCapture: () => void;
  onOpenSelector: () => void;
  onToggleMode: () => void;
  onToggleAutoSubmitTop1: () => void;
  onToggleClickthrough: () => void;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  statusMessage,
  clickthrough,
  hasCaptureArea,
  mode,
  autoSubmitTop1,
  datasetCount = 0,
  onOpenDataset,
  onTriggerCapture,
  onOpenSelector,
  onToggleMode,
  onToggleAutoSubmitTop1,
  onToggleClickthrough,
  onOpenSettings,
}) => {
  const isBusy = status === 'capturing' || status === 'analyzing';

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between px-3 py-2 bg-zinc-950/95 border-b border-zinc-800/80 select-none cursor-move rounded-t-xl"
    >
      {/* Статус и логотип */}
      <div data-tauri-drag-region className="flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            isBusy
              ? 'bg-amber-400 animate-pulse'
              : status === 'error'
              ? 'bg-red-400'
              : 'bg-emerald-400'
          }`}
          title={statusMessage || status}
        />
        <div data-tauri-drag-region className="flex items-center gap-1.5 min-w-0">
          <span data-tauri-drag-region className="text-xs font-semibold text-zinc-200">
            Words
          </span>
          <span data-tauri-drag-region className="text-[10px] text-zinc-400 truncate max-w-[120px]">
            {statusMessage || (hasCaptureArea ? 'Alt+Q' : 'Выделите область')}
          </span>
        </div>
      </div>

      {/* Компактные кнопки управления */}
      <div className="flex items-center gap-0.5 cursor-default">
        {/* Кнопка ручного захвата */}
        <button
          onClick={onTriggerCapture}
          disabled={isBusy}
          title={mode === 'screen' ? 'Сделать снимок (Alt+Q)' : 'Проверить логи'}
          className={`p-1.5 rounded-md transition-colors ${
            isBusy
              ? 'text-zinc-500 cursor-not-allowed'
              : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
          }`}
        >
          {isBusy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : mode === 'screen' ? (
            <Camera className="w-3.5 h-3.5" />
          ) : (
            <FileText className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Переключатель режима: экран / логи */}
        <button
          onClick={onToggleMode}
          title={mode === 'screen' ? 'Режим: Экран (клик для логов)' : 'Режим: Логи (клик для экрана)'}
          className="px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 border border-zinc-800 transition-colors"
        >
          {mode === 'screen' ? 'SCR' : 'LOG'}
        </button>

        {/* Авто-ввод Топ-1 */}
        <button
          onClick={onToggleAutoSubmitTop1}
          title={autoSubmitTop1 ? 'Авто-отправка Топ-1: ВКЛ' : 'Авто-отправка Топ-1: ВЫКЛ'}
          className={`p-1.5 rounded-md transition-colors ${
            autoSubmitTop1
              ? 'text-amber-400 bg-zinc-800/80 hover:bg-zinc-800'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
          }`}
        >
          {autoSubmitTop1 ? (
            <Zap className="w-3.5 h-3.5 fill-amber-400" />
          ) : (
            <ZapOff className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Выбор области (только для режима экрана) */}
        {mode === 'screen' && (
          <button
            onClick={onOpenSelector}
            title={hasCaptureArea ? 'Изменить область экрана' : 'Выбрать область экрана'}
            className={`p-1.5 rounded-md transition-colors ${
              hasCaptureArea
                ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
                : 'text-amber-400 hover:bg-zinc-800 animate-pulse'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Сквозные клики */}
        <button
          onClick={onToggleClickthrough}
          title={clickthrough ? 'Сквозные клики: ВКЛ' : 'Сквозные клики: ВЫКЛ'}
          className={`p-1.5 rounded-md transition-colors ${
            clickthrough
              ? 'text-emerald-400 bg-zinc-800/80 hover:bg-zinc-800'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
          }`}
        >
          <MousePointer className="w-3.5 h-3.5" />
        </button>

        {/* Папка базы вопросов */}
        {onOpenDataset && (
          <button
            onClick={onOpenDataset}
            title={`База вопросов: ${datasetCount} уникальных (клик — открыть папку со скринами и вопросами)`}
            className="px-1.5 py-1 rounded-md text-[10px] font-mono text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors flex items-center gap-1"
          >
            <Folder className="w-3.5 h-3.5" />
            <span className="text-[9px] font-sans">{datasetCount}</span>
          </button>
        )}

        {/* Настройки */}
        <button
          onClick={onOpenSettings}
          title="Настройки"
          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
