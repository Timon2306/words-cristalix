import type { AiResult, ProviderConfig, UsageStats } from '../types';
import { proxyHttpRequest } from './tauriBridge';
import { isTauri } from '@tauri-apps/api/core';
import {
  SYSTEM_INSTRUCTION,
  SCREEN_TASK_INSTRUCTION,
  TEXT_TASK_INSTRUCTION,
  finalizeResponse,
  parseAiJson,
} from './aiCore';
import { estimateDeepSeekCost } from './usage';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const REQUEST_TIMEOUT_MS = 25_000;

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } };

export interface DeepSeekRequestOptions {
  imageBase64?: string;
  question?: string;
  config: ProviderConfig;
  onKeyRotated?: (newIndex: number, keyPreview: string, reason?: string) => void;
  onModelFallback?: (fromModel: string, toModel: string, reason?: string) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getDeepSeekModelCascade(selectedModel: string, configuredModels?: string[]): string[] {
  const result: string[] = [];
  const push = (model?: string) => {
    const clean = model?.trim();
    if (clean && !result.includes(clean)) result.push(clean);
  };

  push(selectedModel);
  for (const model of configuredModels || []) push(model);
  if (result.length === 0) result.push('deepseek-flash');
  return result;
}

function toDataUrl(imageBase64: string): string {
  if (imageBase64.startsWith('data:')) return imageBase64;
  return `data:image/png;base64,${imageBase64}`;
}

function buildUserContent(imageBase64?: string, question?: string): ContentBlock[] {
  if (imageBase64) {
    return [
      // Статичный текст идёт первым — он попадает в кэшируемый префикс.
      { type: 'text', text: SCREEN_TASK_INSTRUCTION },
      { type: 'image_url', image_url: { url: toDataUrl(imageBase64), detail: 'high' } },
    ];
  }

  return [
    { type: 'text', text: TEXT_TASK_INSTRUCTION },
    { type: 'text', text: `Вопрос из мини-игры «Слова»: "${question || ''}"` },
  ];
}

async function callDeepSeekApi(
  requestBody: Record<string, unknown>,
  apiKey: string
): Promise<{ status: number; text: string }> {
  const body = JSON.stringify(requestBody);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  if (isTauri()) {
    // Rust-прокси нужен, чтобы обойти CORS webview. Прокси-сервер здесь НЕ используется:
    // DeepSeek доступен из РФ напрямую.
    const res = await proxyHttpRequest({
      url: DEEPSEEK_API_URL,
      method: 'POST',
      headers,
      body,
      timeout_ms: REQUEST_TIMEOUT_MS,
    });
    return { status: res.status, text: res.body };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    return { status: response.status, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function describeError(status: number, responseText: string): string {
  try {
    const json = JSON.parse(responseText);
    const message = json?.error?.message || json?.message || '';
    if (message) return `${status}: ${message}`;
  } catch {
    // ignore
  }
  const short = responseText.trim().slice(0, 180);
  return short ? `${status}: ${short}` : `HTTP ${status}`;
}

async function requestDeepSeekWithRotation(options: DeepSeekRequestOptions): Promise<AiResult> {
  const { config, imageBase64, question, onKeyRotated, onModelFallback } = options;
  const apiKeys = config.apiKeys || [];

  if (apiKeys.length === 0) {
    throw new Error('Не настроены API-ключи DeepSeek. Откройте настройки и добавьте хотя бы один ключ.');
  }

  const startTime = Date.now();
  const modelsToTry = getDeepSeekModelCascade(config.selectedModel, config.models);
  const fallbackQuestion = imageBase64 ? undefined : question;
  const userContent = buildUserContent(imageBase64, question);

  let currentKeyIndex = (config.activeKeyIndex || 0) % apiKeys.length;
  if (currentKeyIndex < 0) currentKeyIndex = 0;

  let lastError: Error | null = null;
  const errorsLog: string[] = [];

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const currentModel = modelsToTry[mIdx];
    let attemptsThisModel = 0;
    let modelIsUnavailable = false;
    let busyRetried = false;
    let emptyRetried = false;

    while (attemptsThisModel < apiKeys.length) {
      const currentKey = apiKeys[currentKeyIndex]?.trim();
      if (!currentKey) {
        currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
        attemptsThisModel++;
        continue;
      }

      const requestBody: Record<string, unknown> = {
        model: currentModel,
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 1600,
        response_format: { type: 'json_object' },
        // Без размышлений: ответ за секунды, а не за десятки секунд.
        thinking: { type: 'disabled' },
        stream: false,
      };

      let status: number;
      let responseText: string;

      try {
        const result = await callDeepSeekApi(requestBody, currentKey);
        status = result.status;
        responseText = result.text;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        errorsLog.push(`[${currentModel} | Ключ #${currentKeyIndex + 1}] ${lastError.message}`);
        const nextIndex = (currentKeyIndex + 1) % apiKeys.length;
        if (onKeyRotated && apiKeys.length > 1) {
          onKeyRotated(nextIndex, apiKeys[nextIndex]?.slice(0, 6) + '...', 'Ошибка сети');
        }
        currentKeyIndex = nextIndex;
        attemptsThisModel++;
        continue;
      }

      // Кратковременная перегрузка — один повтор на той же ключ/модели.
      if (status === 503 && !busyRetried) {
        busyRetried = true;
        console.warn(`[${currentModel}] 503. Повтор через 350 мс...`);
        await sleep(350);
        continue;
      }

      if (status === 200) {
        let json: unknown;
        try {
          json = JSON.parse(responseText);
        } catch {
          lastError = new Error('DeepSeek вернул некорректный JSON.');
          errorsLog.push(`[${currentModel}] ${lastError.message}`);
          const nextIndex = (currentKeyIndex + 1) % apiKeys.length;
          if (onKeyRotated && apiKeys.length > 1) {
            onKeyRotated(nextIndex, apiKeys[nextIndex]?.slice(0, 6) + '...', 'Некорректный ответ');
          }
          currentKeyIndex = nextIndex;
          attemptsThisModel++;
          continue;
        }

        const content = (json as { choices?: { message?: { content?: unknown } }[] })
          ?.choices?.[0]?.message?.content;

        if (typeof content !== 'string' || !content.trim()) {
          // JSON mode иногда отдаёт пустой content — один повтор.
          if (!emptyRetried) {
            emptyRetried = true;
            await sleep(200);
            continue;
          }
          lastError = new Error('Пустой ответ DeepSeek.');
          errorsLog.push(`[${currentModel} | Ключ #${currentKeyIndex + 1}] ${lastError.message}`);
          const nextIndex = (currentKeyIndex + 1) % apiKeys.length;
          if (onKeyRotated && apiKeys.length > 1) {
            onKeyRotated(nextIndex, apiKeys[nextIndex]?.slice(0, 6) + '...', 'Пустой ответ');
          }
          currentKeyIndex = nextIndex;
          attemptsThisModel++;
          continue;
        }

        const parsedData = finalizeResponse(parseAiJson(content), fallbackQuestion);
        const rawUsage = (json as {
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            prompt_cache_hit_tokens?: number;
            prompt_cache_miss_tokens?: number;
          };
        }).usage;

        const cacheHitTokens = Number(rawUsage?.prompt_cache_hit_tokens) || 0;
        const cacheMissTokens =
          Number(rawUsage?.prompt_cache_miss_tokens) ||
          Math.max(0, (Number(rawUsage?.prompt_tokens) || 0) - cacheHitTokens);
        const outputTokens = Number(rawUsage?.completion_tokens) || 0;

        const usage: UsageStats = {
          provider: 'deepseek',
          model: currentModel,
          inputTokens: cacheHitTokens + cacheMissTokens,
          outputTokens,
          cacheHitTokens,
          cacheMissTokens,
          costUsd: estimateDeepSeekCost(currentModel, cacheHitTokens, cacheMissTokens, outputTokens),
        };

        return {
          data: parsedData,
          usedKeyIndex: currentKeyIndex,
          usedModel: currentModel,
          latencyMs: Date.now() - startTime,
          usage,
        };
      }

      const detail = describeError(status, responseText);
      errorsLog.push(`[${currentModel} | Ключ #${currentKeyIndex + 1}] ${detail}`);

      // Модель не существует / недоступна — переходим к следующей модели каскада.
      if (status === 404 || (status === 400 && /model/i.test(detail))) {
        modelIsUnavailable = true;
        break;
      }

      // 400 — проблема в запросе (например, картинка), ротация ключей не поможет.
      if (status === 400) {
        lastError = new Error(detail);
        break;
      }

      console.warn(`DeepSeek key #${currentKeyIndex + 1} failed on ${currentModel} (${detail})`);
      const nextIndex = (currentKeyIndex + 1) % apiKeys.length;
      if (onKeyRotated && apiKeys.length > 1) {
        onKeyRotated(nextIndex, apiKeys[nextIndex]?.slice(0, 6) + '...', `Ошибка ${status}`);
      }
      currentKeyIndex = nextIndex;
      attemptsThisModel++;
    }

    if (mIdx + 1 < modelsToTry.length) {
      const nextModel = modelsToTry[mIdx + 1];
      if (onModelFallback) {
        onModelFallback(
          currentModel,
          nextModel,
          modelIsUnavailable ? 'Модель недоступна' : 'Переход на резерв'
        );
      }
    }
  }

  const uniqueErrors = [...new Set(errorsLog)];
  const errorDetails = uniqueErrors.length > 0
    ? '\n' + uniqueErrors.map((e) => `• ${e}`).join('\n')
    : lastError?.message || 'Неизвестная ошибка сети';

  throw new Error(
    `Все ключи DeepSeek (${apiKeys.length} шт.) и модели (${modelsToTry.join(', ')}) вернули ошибку:${errorDetails}`
  );
}

export async function analyzeScreenshotWithDeepSeek(options: DeepSeekRequestOptions): Promise<AiResult> {
  return requestDeepSeekWithRotation({ ...options, imageBase64: options.imageBase64, question: undefined });
}

export async function analyzeTextQuestionWithDeepSeek(options: DeepSeekRequestOptions): Promise<AiResult> {
  return requestDeepSeekWithRotation({ ...options, imageBase64: undefined, question: options.question });
}
