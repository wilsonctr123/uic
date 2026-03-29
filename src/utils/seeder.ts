/**
 * Data Seeder
 *
 * Seeds the application with test data after auth so that pages aren't empty.
 * Supports API calls, fixture file uploads, and custom scripts.
 * All operations are idempotent — safe to run multiple times.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import type { SeedConfig } from '../config/types.js';

export interface SeedResult {
  success: boolean;
  seeded: string[];
  errors: string[];
}

export async function seedData(
  config: SeedConfig,
  baseUrl: string,
  authCookie?: string,
  projectRoot: string = process.cwd(),
): Promise<SeedResult> {
  const seeded: string[] = [];
  const errors: string[] = [];

  console.log('\n🌱 Seeding test data\n');

  // 1. Run seed script if defined
  if (config.script) {
    const scriptPath = resolve(projectRoot, config.script);
    console.log(`  Running seed script: ${config.script}`);
    try {
      execSync(`bash ${scriptPath}`, { cwd: projectRoot, stdio: 'pipe', timeout: 60000 });
      seeded.push(`script: ${config.script}`);
      console.log(`  ✅ Seed script complete`);
    } catch (err) {
      const msg = `Seed script failed: ${(err as Error).message}`;
      errors.push(msg);
      console.log(`  ⚠ ${msg}`);
    }
  }

  // 2. Execute API calls
  if (config.apiCalls) {
    for (const call of config.apiCalls) {
      const url = `${baseUrl}${call.endpoint}`;
      const desc = call.description || `${call.method} ${call.endpoint}`;
      console.log(`  ${desc}...`);

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (call.authenticated && authCookie) {
          headers['Cookie'] = authCookie;
        }

        const resp = await fetch(url, {
          method: call.method,
          headers,
          body: JSON.stringify(call.body),
        });

        if (resp.ok || resp.status === 409) {
          // 409 = already exists, that's fine (idempotent)
          seeded.push(desc);
          console.log(`  ✅ ${desc}`);
        } else {
          const body = await resp.text().catch(() => '');
          const msg = `${desc}: ${resp.status} ${body.substring(0, 200)}`;
          errors.push(msg);
          console.log(`  ⚠ ${msg}`);
        }
      } catch (err) {
        const msg = `${desc}: ${(err as Error).message}`;
        errors.push(msg);
        console.log(`  ⚠ ${msg}`);
      }
    }
  }

  // 3. Upload fixture files
  if (config.fixtureDir) {
    const fixtureDir = resolve(projectRoot, config.fixtureDir);
    if (existsSync(fixtureDir)) {
      const files = readdirSync(fixtureDir).filter(f => !f.startsWith('.'));
      console.log(`  Uploading ${files.length} fixture files from ${config.fixtureDir}`);

      for (const file of files) {
        const filePath = resolve(fixtureDir, file);
        const ext = extname(file).toLowerCase();

        // Use configured upload endpoint (required — no hardcoded defaults)
        const endpoint = config.fixtureUploadEndpoint;
        if (!endpoint) {
          console.log(`  ⚠ No fixtureUploadEndpoint configured — skipping fixture uploads`);
          break;
        }

        try {
          const fileData = readFileSync(filePath);
          const formData = new FormData();
          const fieldName = config.fixtureFieldName || 'file';
          formData.append(fieldName, new Blob([fileData]), basename(file));

          const headers: Record<string, string> = {};
          if (authCookie) headers['Cookie'] = authCookie;

          const resp = await fetch(`${baseUrl}${endpoint}`, {
            method: 'POST',
            headers,
            body: formData,
          });

          if (resp.ok || resp.status === 409) {
            seeded.push(`upload: ${file}`);
            console.log(`  ✅ Uploaded ${file}`);
          } else {
            const msg = `Upload ${file} failed: HTTP ${resp.status}`;
            console.error(`  ❌ ${msg}`);
            errors.push(msg);
          }
        } catch (err) {
          const msg = `Upload ${file} failed: ${(err as Error).message}`;
          console.error(`  ❌ ${msg}`);
          errors.push(msg);
        }
      }
    } else {
      console.log(`  ⚠ Fixture directory not found: ${config.fixtureDir}`);
    }
  }

  const success = errors.length === 0;
  console.log(`\n  Seeded: ${seeded.length} items${errors.length > 0 ? `, ${errors.length} errors` : ''}\n`);
  return { success, seeded, errors };
}
