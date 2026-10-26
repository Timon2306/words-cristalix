import type { UsageStats } from '../types';

/**
 * Цены DeepSeek в USD за 1M токенов (Flash / Pro).
 * Источник: https://api-docs.deepseek.com/quick_start/pricing/
 * Peak: 01:00-04:00 и 06:00-10:00 UTC по будням, остальное — off-peak.
 */
interface DeepSeekPrice {
  cacheHit: number;
  cacheMiss: number;
  output: number;
}

const DEEPSEEK_FLASH_OFF_PEAK: DeepSeekPrice = { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 };
const DEEPSEEK_FLASH_PEAK: DeepSeekPrice = { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 };
const DEEPSEEK_PRO_OFF_PEAK: DeepSeekPrice = { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 };
const DEEPSEEK_PRO_PEAK: DeepSeekPrice = { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 };

function isPeakTime(at: Date): boolean {
  const day = at.getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) return false;
  const hour = at.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

function getDeepSeekPrice(model: string, at: Date): DeepSeekPrice {
  const isPro = /(?:^|-)pro(?:-|$)/i.test(model);
  if (isPro) return isPeakTime(at) ? DEEPSEEK_PRO_PEAK : DEEPSEEK_PRO_OFF_PEAK;
  return isPeakTime(at) ? DEEPSEEK_FLASH_PEAK : DEEPSEEK_FLASH_OFF_PEAK;
}

export function estimateDeepSeekCost(
  model: string,
  cacheHitTokens: number,
  cacheMissTokens: number,
  outputTokens: number,
  at: Date = new Date()
): number {
  const price = getDeepSeekPrice(model, at);
  return (
    (cacheHitTokens / 1_000_000) * price.cacheHit +
    (cacheMissTokens / 1_000_000) * price.cacheMiss +
    (outputTokens / 1_000_000) * price.output
  );
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 10_000) return `${Math.round(count / 1000)}k`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

export function formatUsd(value?: number): string {
  if (!value || value <= 0) return '0';
  if (value < 0.001) return value.toFixed(5);
  if (value < 0.1) return value.toFixed(4);
  if (value < 1) return value.toFixed(3);
  return value.toFixed(2);
}

export function getCachePercent(usage: UsageStats): number | null {
  const total = usage.cacheHitTokens + usage.cacheMissTokens;
  if (total <= 0) return null;
  return Math.round((usage.cacheHitTokens / total) * 100);
}

/* ─── Накопленная статистика (localStorage) ─────────────────────────────── */

export interface UsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

const USAGE_STORAGE_KEY = 'mc_words_assistant_usage_v1';
const EMPTY_TOTALS: UsageTotals = { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };

export function loadUsageTotals(): UsageTotals {
  try {
    const raw = localStorage.getItem(USAGE_STORAGE_KEY);
    if (!raw) return { ...EMPTY_TOTALS };
    const parsed = JSON.parse(raw) as Partial<UsageTotals>;
    return {
      requests: Number(parsed.requests) || 0,
      inputTokens: Number(parsed.inputTokens) || 0,
      outputTokens: Number(parsed.outputTokens) || 0,
      costUsd: Number(parsed.costUsd) || 0,
    };
  } catch {
    return { ...EMPTY_TOTALS };
  }
}

export function recordUsage(usage: UsageStats): UsageTotals {
  const totals = loadUsageTotals();
  const next: UsageTotals = {
    requests: totals.requests + 1,
    inputTokens: totals.inputTokens + usage.inputTokens,
    outputTokens: totals.outputTokens + usage.outputTokens,
    costUsd: totals.costUsd + (usage.costUsd || 0),
  };
  try {
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function resetUsageTotals(): UsageTotals {
  try {
    localStorage.removeItem(USAGE_STORAGE_KEY);
  } catch {
    // ignore
  }
  return { ...EMPTY_TOTALS };
}
