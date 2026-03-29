/**
 * UIC Intelligence Layer — Anthropic LLM Provider
 *
 * Implements LLMClient using raw fetch() against the Anthropic Messages API.
 * No SDK dependency — keeps UIC zero-dependency for the LLM layer.
 */

import type { LLMClient } from '../llm-client.js';

export class AnthropicClient implements LLMClient {
  readonly provider = 'anthropic';
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model || 'claude-sonnet-4-20250514';
    this.baseUrl = baseUrl || 'https://api.anthropic.com';
  }

  async complete(params: {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: params.maxTokens || 4096,
        temperature: params.temperature ?? 0,
        system: params.system,
        messages: [{ role: 'user', content: params.user }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>;
    };
    return data.content[0]?.text || '';
  }
}
