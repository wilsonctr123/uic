/**
 * Pre-flight Checks
 *
 * Verifies environment prerequisites before starting services.
 * Each check has a test command and optional fix command.
 */

import { execSync } from 'node:child_process';
import type { PreflightConfig } from '../config/types.js';

export interface PreflightResult {
  passed: boolean;
  results: CheckResult[];
}

export interface CheckResult {
  name: string;
  passed: boolean;
  fixed: boolean;
  error?: string;
}

export async function runPreflight(
  config: PreflightConfig,
  projectRoot: string,
): Promise<PreflightResult> {
  const results: CheckResult[] = [];
  let allPassed = true;

  console.log('\n🔍 Pre-flight checks\n');

  for (const check of config.checks) {
    const required = check.required !== false;

    // Run the test command
    try {
      execSync(check.test, { cwd: projectRoot, stdio: 'pipe', timeout: 30000 });
      console.log(`  ✅ ${check.name}`);
      results.push({ name: check.name, passed: true, fixed: false });
      continue;
    } catch {
      // Test failed — try fix if available
    }

    if (check.fix) {
      console.log(`  ⚠ ${check.name} — fixing...`);
      try {
        execSync(check.fix, { cwd: projectRoot, stdio: 'pipe', timeout: 120000 });
        // Verify the fix worked
        try {
          execSync(check.test, { cwd: projectRoot, stdio: 'pipe', timeout: 30000 });
          console.log(`  ✅ ${check.name} (fixed)`);
          results.push({ name: check.name, passed: true, fixed: true });
          continue;
        } catch {
          // Fix didn't help
        }
      } catch (fixErr) {
        // Fix command itself failed
      }
    }

    // Failed
    if (required) {
      console.log(`  ❌ ${check.name}`);
      allPassed = false;
      results.push({
        name: check.name,
        passed: false,
        fixed: false,
        error: `Check failed: ${check.test}${check.fix ? ` (fix also failed: ${check.fix})` : ''}`,
      });
    } else {
      console.log(`  ⚠ ${check.name} (optional, skipped)`);
      results.push({ name: check.name, passed: false, fixed: false });
    }
  }

  console.log('');
  return { passed: allPassed, results };
}
