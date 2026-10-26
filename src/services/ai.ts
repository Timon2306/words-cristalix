import type { AiProvider, AiResult, AppSettings, ProviderConfig } from '../types';
import {
  analyzeScreenshotWithGemini,
  analyzeTextQuestionWithGemini,
} from './gemini';
import {
  analyzeScreenshotWithDeepSeek,
  analyzeTextQuestionWithDeepSeek,
} from './deepseek';

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
};

export interface AnalyzeCallbacks {
  onKeyRotated?: (newIndex: number, keyPreview: string, reason?: string) => void;
  onModelFallback?: (fromModel: string, toModel: string, reason?: string) => void;
}

export function getActiveProviderConfig(settings: AppSettings): ProviderConfig {
  return settings.providers[settings.provider];
}

function assertKeys(settings: AppSettings): ProviderConfig {
  const config = getActiveProviderConfig(settings);
  if (!config?.apiKeys || config.apiKeys.length === 0) {
    throw new Error(
      `Не настроен API-ключ ${PROVIDER_LABELS[settings.provider]}. Откройте настройки и добавьте ключ.`
    );
  }
  return config;
}

export async function analyzeScreenshot(
  settings: AppSettings,
  imageBase64: string,
  callbacks: AnalyzeCallbacks = {}
): Promise<AiResult> {
  const config = assertKeys(settings);

  if (settings.provider === 'deepseek') {
    return analyzeScreenshotWithDeepSeek({
      imageBase64,
      config,
      onKeyRotated: callbacks.onKeyRotated,
      onModelFallback: callbacks.onModelFallback,
    });
  }

  return analyzeScreenshotWithGemini({
    imageBase64,
    apiKeys: config.apiKeys,
    activeKeyIndex: config.activeKeyIndex,
    model: config.selectedModel,
    models: config.models,
    proxy: settings.proxy,
    onKeyRotated: callbacks.onKeyRotated,
    onModelFallback: callbacks.onModelFallback,
  });
}

export async function analyzeTextQuestion(
  settings: AppSettings,
  question: string,
  callbacks: AnalyzeCallbacks = {}
): Promise<AiResult> {
  const config = assertKeys(settings);

  if (settings.provider === 'deepseek') {
    return analyzeTextQuestionWithDeepSeek({
      question,
      config,
      onKeyRotated: callbacks.onKeyRotated,
      onModelFallback: callbacks.onModelFallback,
    });
  }

  return analyzeTextQuestionWithGemini({
    question,
    apiKeys: config.apiKeys,
    activeKeyIndex: config.activeKeyIndex,
    model: config.selectedModel,
    models: config.models,
    proxy: settings.proxy,
    onKeyRotated: callbacks.onKeyRotated,
    onModelFallback: callbacks.onModelFallback,
  });
}
