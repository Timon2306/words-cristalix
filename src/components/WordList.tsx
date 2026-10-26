import React from 'react';
import type { UsageStats, WordSuggestion } from '../types';
import type { UsageTotals } from '../services/usage';
import { formatTokens, formatUsd, getCachePercent } from '../services/usage';
import { WordCard } from './WordCard';
import { AlertCircle } from 'lucide-react';

interface WordListProps {
  words: WordSuggestion[];
  question?: string;
  category?: string;
  latencyMs?: number;
  usedModel?: string;
  usage?: UsageStats;
  usageTotals?: UsageTotals;
  autoSubmit: boolean;
  shortcuts: string[];
  isBusy: boolean;
  errorMessage?: string | null;
  onPickWord: (word: string) => void;
  onOpenSelector: () => void;
  hasCaptureArea: boolean;
}

export const WordList: React.FC<WordListProps> = ({
  words,
  question,
  category,
  latencyMs,
  usedModel,
  usage,
  usageTotals,
  autoSubmit,
  shortcuts,
  isBusy,
  errorMessage,
  onPickWord,
  onOpenSelector,
  hasCaptureArea,
}) => {
  const cachePercent = usage ? getCachePercent(usage) : null;
  const modelLabel = usedModel
    ? usedModel.replace(/^gemini-/, '').replace(/^deepseek-/, 'ds-')
    : undefined;

  return (
    <div className="flex-1 flex flex-col p-2.5 overflow-y-auto space-y-2">
      {/* Ошибка */}
      {errorMessage && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-red-950/30 border border-red-800/40 text-red-300 text-xs">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-red-400" />
          <div className="flex-1 text-[11px] leading-tight">
            <span className="font-semibold block mb-0.5">Ошибка:</span>
            <span>{errorMessage}</span>
          </div>
        </div>
      )}

      {/* Вопрос / тема */}
      {question && (
        <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800/80 flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px] text-zinc-400">
            <span className="uppercase tracking-wider font-semibold text-zinc-400">
              {category || 'Вопрос'}
            </span>
            <div className="flex items-center gap-1.5 font-mono text-zinc-400">
              {modelLabel && (
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                  {modelLabel}
                </span>
              )}
              {latencyMs && <span className="text-zinc-500">{latencyMs} мс</span>}
            </div>
          </div>
          <div className="text-xs font-medium text-zinc-200 break-words">
            «{question}»
          </div>
        </div>
      )}

      {/* Токены / кэш / стоимость */}
      {usage && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 -mt-0.5 text-[9px] font-mono text-zinc-500">
          <span title="Входные / выходные токены">
            ↑{formatTokens(usage.inputTokens)} ↓{formatTokens(usage.outputTokens)}
          </span>
          {cachePercent !== null && (
            <span
              className={cachePercent > 0 ? 'text-emerald-400/80' : 'text-zinc-500'}
              title="Доля входных токенов, взятых из кэша"
            >
              кэш {cachePercent}%
            </span>
          )}
          {usage.costUsd !== undefined && (
            <span className="text-emerald-300/90" title="Стоимость этого запроса">
              ${formatUsd(usage.costUsd)}
            </span>
          )}
          {usageTotals && usageTotals.requests > 0 && usageTotals.costUsd > 0 && (
            <span
              className="ml-auto text-zinc-500"
              title={`Всего запросов: ${usageTotals.requests}`}
            >
              Σ ${formatUsd(usageTotals.costUsd)}
            </span>
          )}
        </div>
      )}

      {/* Список слов */}
      {words.length > 0 ? (
        <div className="space-y-1.5">
          {words.map((suggestion, idx) => (
            <WordCard
              key={`${suggestion.word}-${idx}`}
              index={idx}
              suggestion={suggestion}
              shortcutLabel={shortcuts[idx] || `Alt+${idx + 1}`}
              autoSubmit={autoSubmit}
              onPickWord={onPickWord}
            />
          ))}
        </div>
      ) : !isBusy && !errorMessage ? (
        /* Минималистичное пустое состояние */
        <div className="flex-1 flex flex-col items-center justify-center text-center p-3 text-zinc-500 text-xs">
          {!hasCaptureArea ? (
            <div className="space-y-2">
              <span className="text-[11px] text-zinc-400 block">
                Область вопроса не выбрана
              </span>
              <button
                onClick={onOpenSelector}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-750 text-zinc-200 border border-zinc-700 text-xs font-medium transition-colors"
              >
                Выбрать область
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              <span className="font-mono text-zinc-300 font-semibold text-xs">Alt + Q</span>
              <span className="text-[11px] text-zinc-500 block">для поиска слов</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};
