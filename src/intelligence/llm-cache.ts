/**
 * UIC Intelligence Layer — LLM Response Cache
 *
 * Disk-based cache using SHA-256 hash of prompt content as key.
 * Stores cached responses in .uic/llm-cache/ with configurable TTL.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export class LLMCache {
  private cacheDir: string;
  private ttlMs: number;

  constructor(uicDir: string, ttlHours = 24) {
    this.cacheDir = join(uicDir, 'llm-cache');
    this.ttlMs = ttlHours * 60 * 60 * 1000;
    mkdirSync(this.cacheDir, { recursive: true });
  }

  private key(system: string, user: string, model: string): string {
    const hash = createHash('sha256').update(system + user + model).digest('hex');
    return hash.substring(0, 16);
  }

  get(system: string, user: string, model: string): string | null {
    const path = join(this.cacheDir, `${this.key(system, user, model)}.json`);
    if (!existsSync(path)) return null;
    try {
      const stat = statSync(path);
      if (Date.now() - stat.mtimeMs > this.ttlMs) return null;
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      return data.response;
    } catch {
      return null;
    }
  }

  set(system: string, user: string, model: string, response: string): void {
    const path = join(this.cacheDir, `${this.key(system, user, model)}.json`);
    writeFileSync(path, JSON.stringify({
      response,
      model,
      timestamp: new Date().toISOString(),
    }));
  }
}
