/**
 * UIC Intelligence Layer — LLM Client Interface
 *
 * Provider-agnostic interface for LLM completions.
 * Implementations use raw fetch() — no SDK dependencies.
 */

export interface LLMClient {
  complete(params: {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string>;
  readonly provider: string;
}

export interface LLMConfig {
  provider: 'anthropic' | 'openai';
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}
