/**
 * UIC Intelligence Layer — LLM Client Factory
 *
 * Resolves API key from config or environment variables and creates
 * the appropriate LLMClient instance.
 */

import type { LLMClient, LLMConfig } from './llm-client.js';
import { AnthropicClient } from './llm-providers/anthropic.js';
import { OpenAIClient } from './llm-providers/openai.js';

export function createLLMClient(config?: LLMConfig): LLMClient | null {
  // Try config first
  if (config?.apiKey) {
    if (config.provider === 'openai') {
      return new OpenAIClient(config.apiKey, config.model, config.baseUrl);
    }
    return new AnthropicClient(config.apiKey, config.model, config.baseUrl);
  }

  // Try env vars
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return new AnthropicClient(anthropicKey, config?.model);
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return new OpenAIClient(openaiKey, config?.model);
  }

  // No key found
  return null;
}
