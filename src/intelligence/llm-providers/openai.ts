/**
 * UIC Intelligence Layer — OpenAI LLM Provider
 *
 * Implements LLMClient using raw fetch() against the OpenAI Chat Completions API.
 * No SDK dependency — keeps UIC zero-dependency for the LLM layer.
 */

import type { LLMClient } from '../llm-client.js';

export class OpenAIClient implements LLMClient {
  readonly provider = 'openai';
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model || 'gpt-4o';
    this.baseUrl = baseUrl || 'https://api.openai.com';
  }

  async complete(params: {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: params.maxTokens || 4096,
        temperature: params.temperature ?? 0,
        messages: [
          { role: 'system', content: params.system },
          { role: 'user', content: params.user },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content || '';
  }
}
