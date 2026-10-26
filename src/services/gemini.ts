import type { AiResult, ProxyConfig, UsageStats } from '../types';
import { proxyHttpRequest } from './tauriBridge';
import { isTauri } from '@tauri-apps/api/core';
import {
  SYSTEM_INSTRUCTION,
  SCREEN_TASK_INSTRUCTION,
  buildTextQuestionPrompt,
  finalizeResponse,
  parseAiJson,
} from './aiCore';

export interface GeminiRequestOptions {
  imageBase64: string; // "data:image/png;base64,..." or raw base64
  apiKeys: string[];
  activeKeyIndex?: number;
  model: string;
  models?: string[];
  proxy?: ProxyConfig;
  onKeyRotated?: (newIndex: number, keyPreview: string, reason?: string) => void;
  onModelFallback?: (fromModel: string, toModel: string, reason?: string) => void;
}

export interface GeminiTextRequestOptions {
  question: string;
  apiKeys: string[];
  activeKeyIndex?: number;
  model?: string;
  models?: string[];
  proxy?: ProxyConfig;
  onKeyRotated?: (newIndex: number, keyPreview: string, reason?: string) => void;
  onModelFallback?: (fromModel: string, toModel: string, reason?: string) => void;
}

export type GeminiResult = AiResult;

export function getModelFallbackCascade(selectedModel: string, configuredModels?: string[]): string[] {
  const result: string[] = [];

  if (configuredModels && configuredModels.length > 0) {
    if (configuredModels.includes(selectedModel)) {
      result.push(selectedModel);
    }
    for (const m of configuredModels) {
      const clean = m.trim();
      if (clean && !result.includes(clean)) {
        result.push(clean);
      }
    }
  }

  if (selectedModel && !result.includes(selectedModel)) {
    result.unshift(selectedModel);
  }

  const defaultModels = [
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite',
  ];
  for (const m of defaultModels) {
    if (!result.includes(m)) {
      result.push(m);
    }
  }

  return result;
}

async function callGeminiApi(
  url: string,
  requestBody: unknown,
  proxy?: ProxyConfig
): Promise<{ status: number; text: string }> {
  const bodyStr = JSON.stringify(requestBody);
  const headers = { 'Content-Type': 'application/json' };

  if (isTauri()) {
    try {
      const res = await proxyHttpRequest({
        url,
        method: 'POST',
        headers,
        body: bodyStr,
        proxy,
        timeout_ms: 18000,
      });
      return { status: res.status, text: res.body };
    } catch (err: unknown) {
      if (!proxy?.enabled) {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: bodyStr,
        });
        const text = await response.text();
        return { status: response.status, text };
      }
      throw err;
    }
  } else {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyStr,
    });
    const text = await response.text();
    return { status: response.status, text };
  }
}

interface GeminiCallParams {
  parts: Array<
    | { text: string }
    | { inline_data: { mime_type: string; data: string } }
  >;
  apiKeys: string[];
  activeKeyIndex?: number;
  model: string;
  models?: string[];
  proxy?: ProxyConfig;
  onKeyRotated?: (newIndex: number, keyPreview: string, reason?: string) => void;
  onModelFallback?: (fromModel: string, toModel: string, reason?: string) => void;
  fallbackQuestion?: string;
}

async function requestGeminiWithRotation(
  params: GeminiCallParams
): Promise<GeminiResult> {
  const { parts, apiKeys, model, models, proxy, onKeyRotated, onModelFallback, fallbackQuestion } = params;

  if (!apiKeys || apiKeys.length === 0) {
    throw new Error('Не настроены API-ключи Google Gemini. Откройте настройки и добавьте хотя бы один ключ.');
  }

  const startTime = Date.now();
  const modelsToTry = getModelFallbackCascade(model, models);

  let currentKeyIndex = (params.activeKeyIndex || 0) % apiKeys.length;
  if (currentKeyIndex < 0) currentKeyIndex = 0;

  let lastError: Error | null = null;
  const errorsLog: string[] = [];

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const currentModel = modelsToTry[mIdx];
    let attemptsThisModel = 0;
    let modelIsNotFound = false;

    while (attemptsThisModel < apiKeys.length) {
      const currentKey = apiKeys[currentKeyIndex]?.trim();
      if (!currentKey) {
        currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
        attemptsThisModel++;
        continue;
      }

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          currentModel
        )}:generateContent?key=${currentKey}`;

        // thinkingBudget: 1 ускоряет ответ с 13 секунд до 3-4 секунд
        const requestBody: {
          system_instruction: { parts: { text: string }[] };
          contents: { role: string; parts: unknown[] }[];
          generationConfig: {
            temperature: number;
            response_mime_type: string;
            thinkingConfig?: { thinkingBudget: number };
          };
        } = {
          system_instruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }],
          },
          contents: [
            {
              role: 'user',
              parts,
            },
          ],
          generationConfig: {
            temperature: 0.1,
            response_mime_type: 'application/json',
            thinkingConfig: {
              thinkingBudget: 1,
            },
          },
        };

        let { status, text: responseText } = await callGeminiApi(url, requestBody, proxy);

        // При 503 (кратковременный всплеск нагрузки) делаем микро-паузу 350мс и повторяем 1 раз
        if (status === 503) {
          console.warn(`[${currentModel}] Всплеск нагрузки (503). Повтор через 350 мс...`);
          await new Promise((r) => setTimeout(r, 350));
          const retryRes = await callGeminiApi(url, requestBody, proxy);
          status = retryRes.status;
          responseText = retryRes.text;
        }

        // Если модель не поддерживает thinkingConfig, пробуем повторить без него
        if (status === 400 && responseText.includes('thinking_config')) {
          delete requestBody.generationConfig.thinkingConfig;
          const retryRes = await callGeminiApi(url, requestBody, proxy);
          status = retryRes.status;
          responseText = retryRes.text;
        }

        if (status !== 200) {
          let errorDetail = '';
          try {
            const errJson = JSON.parse(responseText);
            const msg = errJson.error?.message || '';
            const errStatus = errJson.error?.status || '';
            if (status === 404) {
              errorDetail = `404 Модель недоступна (${msg || 'Not Found'})`;
            } else if (status === 429) {
              errorDetail = `429 Исчерпан лимит запросов (${errStatus || 'Quota Exceeded'})`;
            } else if (status === 503) {
              errorDetail = `503 Высокая нагрузка на модель (${errStatus || 'High Demand'})`;
            } else {
              errorDetail = `${status} ${errStatus}: ${msg}`;
            }
          } catch {
            errorDetail = `${status}: ${responseText.slice(0, 120)}`;
          }

          if (status === 404) {
            console.warn(`Model ${currentModel} returned 404 Not Found. Skipping to next model in cascade.`);
            modelIsNotFound = true;
            errorsLog.push(`[${currentModel}] ${errorDetail}`);
            break;
          }

          console.warn(`Key #${currentKeyIndex + 1} failed on ${currentModel} (HTTP ${status}): ${errorDetail}`);
          errorsLog.push(`[${currentModel} | Ключ #${currentKeyIndex + 1}] ${errorDetail}`);

          const nextIndex = (currentKeyIndex + 1) % apiKeys.length;
          const preview = apiKeys[nextIndex]?.slice(0, 6) + '...';
          if (onKeyRotated && apiKeys.length > 1) {
            onKeyRotated(nextIndex, preview, `Ошибка ${status}`);
          }
          currentKeyIndex = nextIndex;
          attemptsThisModel++;
          continue;
        }

        const json = JSON.parse(responseText);
        const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawText) {
          throw new Error('Пустой ответ от Gemini API.');
        }

        const parsedData = finalizeResponse(parseAiJson(rawText), fallbackQuestion);

        const usageMeta = json.usageMetadata;
        const cacheHitTokens = usageMeta?.cachedContentTokenCount ?? 0;
        const inputTokens = usageMeta?.promptTokenCount ?? 0;
        const outputTokens =
          (usageMeta?.candidatesTokenCount ?? 0) + (usageMeta?.thoughtsTokenCount ?? 0);
        const usage: UsageStats = {
          provider: 'gemini',
          model: currentModel,
          inputTokens,
          outputTokens,
          cacheHitTokens,
          cacheMissTokens: Math.max(0, inputTokens - cacheHitTokens),
        };

        const latencyMs = Date.now() - startTime;
        return {
          data: parsedData,
          usedKeyIndex: currentKeyIndex,
          usedModel: currentModel,
          latencyMs,
          usage,
        };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(`Attempt with key #${currentKeyIndex + 1} and model ${currentModel} failed:`, err);
        errorsLog.push(`[${currentModel} | Ключ #${currentKeyIndex + 1}] ${lastError.message}`);

        const nextIndex = (currentKeyIndex + 1) % apiKeys.length;
        const preview = apiKeys[nextIndex]?.slice(0, 6) + '...';
        if (onKeyRotated && apiKeys.length > 1) {
          onKeyRotated(nextIndex, preview, 'Ошибка сети');
        }
        currentKeyIndex = nextIndex;
        attemptsThisModel++;
      }
    }

    if (mIdx + 1 < modelsToTry.length) {
      const nextModel = modelsToTry[mIdx + 1];
      console.warn(`All keys failed for ${currentModel}. Falling back to next model: ${nextModel}`);
      if (onModelFallback) {
        onModelFallback(currentModel, nextModel, modelIsNotFound ? 'Модель недоступна' : 'Переход на резерв');
      }
    }
  }

  const uniqueErrors = [...new Set(errorsLog)];
  const errorDetails = uniqueErrors.length > 0
    ? '\n' + uniqueErrors.map((e) => `• ${e}`).join('\n')
    : lastError?.message || 'Неизвестная ошибка сети';

  throw new Error(
    `Все ключи (${apiKeys.length} шт.) и модели (${modelsToTry.join(', ')}) вернули ошибку:${errorDetails}`
  );
}

export async function analyzeScreenshotWithGemini(
  options: GeminiRequestOptions
): Promise<GeminiResult> {
  const { imageBase64, apiKeys, model, models, proxy, onKeyRotated, onModelFallback, activeKeyIndex } = options;

  let cleanBase64 = imageBase64;
  let mimeType = 'image/png';
  if (cleanBase64.includes(',')) {
    const parts = cleanBase64.split(',');
    const match = parts[0].match(/data:(.*?);base64/);
    if (match) mimeType = match[1];
    cleanBase64 = parts[1];
  }

  return requestGeminiWithRotation({
    parts: [
      {
        text: SCREEN_TASK_INSTRUCTION,
      },
      {
        inline_data: {
          mime_type: mimeType,
          data: cleanBase64,
        },
      },
    ],
    apiKeys,
    activeKeyIndex,
    model,
    models,
    proxy,
    onKeyRotated,
    onModelFallback,
  });
}

export async function analyzeTextQuestionWithGemini(
  optionsOrQuestion: GeminiTextRequestOptions | string,
  apiKeys?: string[],
  model?: string,
  activeKeyIndex?: number,
  onKeyRotated?: (newIndex: number, keyPreview: string, reason?: string) => void,
  proxy?: ProxyConfig,
  onModelFallback?: (fromModel: string, toModel: string, reason?: string) => void
): Promise<GeminiResult> {
  let options: GeminiTextRequestOptions;
  if (typeof optionsOrQuestion === 'string') {
    options = {
      question: optionsOrQuestion,
      apiKeys: apiKeys || [],
      model: model || 'gemini-3.5-flash-lite',
      activeKeyIndex: activeKeyIndex || 0,
      onKeyRotated,
      proxy,
      onModelFallback,
    };
  } else {
    options = optionsOrQuestion;
  }

  const question = options.question?.trim() || '';
  const selectedModel = options.model || 'gemini-3.5-flash-lite';

  return requestGeminiWithRotation({
    parts: [
      {
        text: buildTextQuestionPrompt(question),
      },
    ],
    apiKeys: options.apiKeys,
    activeKeyIndex: options.activeKeyIndex,
    model: selectedModel,
    models: options.models,
    proxy: options.proxy,
    onKeyRotated: options.onKeyRotated,
    onModelFallback: options.onModelFallback,
    fallbackQuestion: question,
  });
}
