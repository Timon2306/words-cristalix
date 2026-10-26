export interface AreaCoords {
  x: number;
  y: number;
  width: number;
  height: number;
  scale_factor?: number;
}

export interface WordSuggestion {
  word: string;
  length: number;
  definition?: string;
}

export interface GeminiResponseFormat {
  question: string;
  category?: string;
  words: WordSuggestion[];
}

export interface ProxyConfig {
  enabled: boolean;
  protocol?: 'http' | 'socks5';
  host: string;
  username?: string;
  password?: string;
}

export type AiProvider = 'gemini' | 'deepseek';

export interface ProviderConfig {
  apiKeys: string[];
  activeKeyIndex: number;
  models: string[];
  selectedModel: string;
}

export interface UsageStats {
  provider: AiProvider;
  model: string;
  /** Все входные токены (кэш + некэш). */
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  /** Оценка стоимости запроса в USD (для DeepSeek считается по прайсу). */
  costUsd?: number;
}

export interface AiResult {
  data: GeminiResponseFormat;
  usedKeyIndex: number;
  usedModel: string;
  latencyMs: number;
  usage?: UsageStats;
}

export interface AppSettings {
  provider: AiProvider;
  providers: Record<AiProvider, ProviderConfig>;
  proxy: ProxyConfig;
  mode: 'screen' | 'logs'; // Режим 1: Скриншот экрана, Режим 2: Логи Cristalix
  logPath: string;
  autoSubmit: boolean; // Auto type T -> Ctrl+V -> Enter
  autoSubmitTop1OnCapture: boolean; // Сразу отправлять лучшее слово при скриншоте/детекте
  saveScreenshots: boolean; // Сохранение скриншотов в локальную папку
  clickthrough: boolean;
  captureArea: AreaCoords | null;
  shortcuts: {
    capture: string;
    pick1: string;
    pick2: string;
    pick3: string;
    pick4: string;
    pick5: string;
    toggleHud: string;
  };
}

export type AppStatus = 'idle' | 'capturing' | 'analyzing' | 'success' | 'error';
