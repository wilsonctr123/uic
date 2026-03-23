/**
 * Failure Diagnoser
 *
 * Classifies Playwright test failures into 4 layers:
 *   A. Test authoring defects (bad locator, wrong assertion, etc.)
 *   B. Environment/precondition defects (missing fixture, no seed data, etc.)
 *   C. Expected runtime behavior (guest 401, self-nav, slow LLM, etc.)
 *   D. Real app defects (JS exception, API 500, broken route, etc.)
 *
 * Each diagnosis includes confidence, repair target, and repair type.
 */

import { readFileSync, existsSync } from 'node:fs';

export type FailureLayer = 'A' | 'B' | 'C' | 'D';

export type FailureCategory =
  // Layer A: Test authoring
  | 'ambiguous-locator'
  | 'dynamic-label'
  | 'disabled-element'
  | 'self-navigation'
  | 'wrong-primitive'
  | 'date-format'
  | 'stale-locator'
  | 'unnamed-element'
  // Layer B: Environment/precondition
  | 'missing-fixture'
  | 'missing-seed-data'
  | 'auth-missing'
  | 'unsupported-api'
  | 'wrong-persona'
  | 'config-mismatch'
  // Layer C: Expected runtime
  | 'expected-401'
  | 'expected-self-nav'
  | 'llm-timeout'
  | 'transient-loading'
  // Layer D: App defect
  | 'js-exception'
  | 'api-500'
  | 'broken-route'
  | 'broken-render'
  | 'form-handler-bug'
  | 'auth-guard-bug'
  | 'css-layout'
  // Unknown
  | 'unknown';

export type RepairTarget = 'test' | 'fixture' | 'seed' | 'config' | 'auth' | 'app';
export type RepairType = 'strengthening' | 'equivalent' | 'weakening' | 'coverage-removal';

export interface Diagnosis {
  testTitle: string;
  testFile: string;
  error: string;
  layer: FailureLayer;
  category: FailureCategory;
  confidence: number;        // 0.0 - 1.0
  repairTarget: RepairTarget;
  repairType: RepairType;
  autoFixable: boolean;
  rationale: string;
  suggestedFix: string;      // human-readable description
  locatorHint?: string;      // improved locator if applicable
}

// ── Pattern matchers ──

const PATTERNS: Array<{
  regex: RegExp;
  errorContains?: string;
  layer: FailureLayer;
  category: FailureCategory;
  confidence: number;
  target: RepairTarget;
  type: RepairType;
  rationale: string;
  fix: string;
}> = [
  // Layer A: Test authoring
  {
    regex: /strict mode violation.*resolved to \d+ elements/s,
    layer: 'A', category: 'ambiguous-locator', confidence: 0.95,
    target: 'test', type: 'equivalent',
    rationale: 'Locator matches multiple elements — needs to be more specific',
    fix: 'Add .first(), { exact: true }, or use a more specific selector',
  },
  {
    regex: /Timeout.*waiting for.*getByRole.*to be visible/s,
    layer: 'A', category: 'dynamic-label', confidence: 0.85,
    target: 'test', type: 'equivalent',
    rationale: 'Element label may be dynamic (user name, generated content)',
    fix: 'Try contextual locator, parent container, or grouping into parent flow',
  },
  {
    regex: /element is not enabled/,
    layer: 'A', category: 'disabled-element', confidence: 0.95,
    target: 'test', type: 'equivalent',
    rationale: 'Element is disabled — cannot interact',
    fix: 'Add isEnabled() guard or mark as blocked with reason',
  },
  {
    regex: /waitForURL.*Timeout/,
    layer: 'A', category: 'self-navigation', confidence: 0.80,
    target: 'test', type: 'equivalent',
    rationale: 'Clicking link to current page — URL does not change',
    fix: 'Replace URL assertion with meaningful UI state assertion',
  },
  {
    regex: /Malformed value/,
    layer: 'A', category: 'date-format', confidence: 0.95,
    target: 'test', type: 'equivalent',
    rationale: 'Date input requires ISO format (YYYY-MM-DD)',
    fix: 'Use fill("2026-01-15") instead of "test input value"',
  },
  {
    regex: /locator\.check.*not a checkbox/i,
    layer: 'A', category: 'wrong-primitive', confidence: 0.90,
    target: 'test', type: 'equivalent',
    rationale: 'Used .check() on non-checkbox element',
    fix: 'Use .click() instead of .check()',
  },
  {
    regex: /getByRole\('button', \{ name: \/button\/i \}\)/,
    layer: 'A', category: 'unnamed-element', confidence: 0.90,
    target: 'test', type: 'equivalent',
    rationale: 'Element has no useful label — locator searches for literal "button"',
    fix: 'Use contextual locator or group into parent flow',
  },

  // Layer B: Environment/precondition
  {
    regex: /ENOENT.*fixtures\/data/,
    layer: 'B', category: 'missing-fixture', confidence: 0.95,
    target: 'fixture', type: 'strengthening',
    rationale: 'Test fixture file not found',
    fix: 'Generate the fixture file',
  },
  {
    regex: /No emails found|No tasks found|No results/i,
    layer: 'B', category: 'missing-seed-data', confidence: 0.70,
    target: 'seed', type: 'strengthening',
    rationale: 'Page shows empty state — needs seeded data',
    fix: 'Run seed script before tests',
  },
  {
    regex: /Login failed|still on login page/i,
    layer: 'B', category: 'auth-missing', confidence: 0.90,
    target: 'auth', type: 'equivalent',
    rationale: 'Authentication failed or missing',
    fix: 'Check credentials, re-run auth setup',
  },

  // Layer A: Stale/unnamed locator — getByText with generic text
  {
    regex: /Timeout.*getByText\(\/[a-z]+\/i\).*to be visible/s,
    layer: 'A', category: 'unnamed-element', confidence: 0.85,
    target: 'test', type: 'equivalent',
    rationale: 'Locator uses generic text pattern that does not match any element',
    fix: 'Skip test — element has no stable locator',
  },
  // Layer A: Element not visible — may require specific app state
  {
    regex: /expect\(locator\)\.toBeVisible.*failed.*Locator.*Expected: visible/s,
    layer: 'A', category: 'stale-locator', confidence: 0.80,
    target: 'test', type: 'equivalent',
    rationale: 'Element not visible — may require specific app state or is conditionally rendered',
    fix: 'Skip test with reason or add state precondition',
  },

  // Layer C: Expected runtime
  {
    regex: /401.*Unauthorized/,
    layer: 'C', category: 'expected-401', confidence: 0.95,
    target: 'test', type: 'equivalent',
    rationale: 'Expected 401 on guest route from /auth/me check',
    fix: 'Filter 401/Unauthorized from console error assertion',
  },
  {
    regex: /toHaveLength.*Expected length:.*0.*Received length/s,
    errorContains: 'Failed to load',
    layer: 'C', category: 'expected-401', confidence: 0.90,
    target: 'test', type: 'equivalent',
    rationale: 'Console errors from expected 401/resource load failures',
    fix: 'Filter expected errors from console error assertion',
  },
  {
    regex: /Test timeout of \d+ms exceeded/,
    layer: 'C', category: 'llm-timeout', confidence: 0.80,
    target: 'test', type: 'equivalent',
    rationale: 'Test timed out — likely waiting for LLM response that is too slow',
    fix: 'Weaken assertion to verify UI entered submitting state',
  },
  {
    regex: /toBeTruthy.*false|hasStatus.*hasResponse/s,
    layer: 'C', category: 'llm-timeout', confidence: 0.75,
    target: 'test', type: 'equivalent',
    rationale: 'LLM response did not arrive within timeout — expected when backend agent is slow',
    fix: 'Weaken assertion to verify UI entered submitting state',
  },

  // Layer D: App defects
  {
    regex: /pageerror|Uncaught|TypeError|ReferenceError/,
    layer: 'D', category: 'js-exception', confidence: 0.85,
    target: 'app', type: 'strengthening',
    rationale: 'Unhandled JavaScript exception in the app',
    fix: 'Fix the source code that threw the exception',
  },
  {
    regex: /status of 500|Internal Server Error/,
    layer: 'D', category: 'api-500', confidence: 0.80,
    target: 'app', type: 'strengthening',
    rationale: 'Backend API returned 500 error',
    fix: 'Fix the backend endpoint',
  },
];

// ── Main diagnosis function ──

export function diagnoseFailure(testTitle: string, testFile: string, error: string): Diagnosis {
  // Strip ANSI escape codes for pattern matching
  const cleanError = error.replace(/\x1b\[[0-9;]*m/g, '');
  for (const pattern of PATTERNS) {
    if (pattern.regex.test(cleanError)) {
      if (pattern.errorContains && !cleanError.includes(pattern.errorContains)) continue;
      return {
        testTitle,
        testFile,
        error: error.substring(0, 500),
        layer: pattern.layer,
        category: pattern.category,
        confidence: pattern.confidence,
        repairTarget: pattern.target,
        repairType: pattern.type,
        autoFixable: pattern.layer !== 'D',
        rationale: pattern.rationale,
        suggestedFix: pattern.fix,
      };
    }
  }

  // Unknown failure
  return {
    testTitle,
    testFile,
    error: error.substring(0, 500),
    layer: 'A',
    category: 'unknown',
    confidence: 0.3,
    repairTarget: 'test',
    repairType: 'equivalent',
    autoFixable: false,
    rationale: 'Unknown failure pattern — needs manual review',
    suggestedFix: 'Review test output and error manually',
  };
}

// ── Batch diagnosis from test results ──

interface TestResult {
  suites?: TestSuite[];
}

interface TestSuite {
  title: string;
  file?: string;
  specs?: Array<{ title: string; ok: boolean; tests?: Array<{ results?: Array<{ error?: { message?: string } }> }> }>;
  suites?: TestSuite[];
}

export function diagnoseAllFailures(resultsPath: string): Diagnosis[] {
  if (!existsSync(resultsPath)) return [];

  const results: TestResult = JSON.parse(readFileSync(resultsPath, 'utf-8'));
  const diagnoses: Diagnosis[] = [];

  function walk(suite: TestSuite, prefix: string) {
    const suitePath = prefix ? `${prefix} > ${suite.title}` : suite.title;
    const file = suite.file || '';

    for (const spec of suite.specs || []) {
      if (spec.ok) continue;

      // Extract error message from test results
      let errorMsg = '';
      for (const test of spec.tests || []) {
        for (const result of test.results || []) {
          if (result.error?.message) {
            errorMsg = result.error.message;
            break;
          }
        }
        if (errorMsg) break;
      }

      if (!errorMsg) errorMsg = `Test failed: ${spec.title}`;

      diagnoses.push(diagnoseFailure(spec.title, file, errorMsg));
    }

    for (const child of suite.suites || []) {
      walk(child, suitePath);
    }
  }

  for (const suite of results.suites || []) {
    walk(suite, '');
  }

  return diagnoses;
}
