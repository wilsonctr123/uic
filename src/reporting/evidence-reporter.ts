/**
 * Evidence Reporter
 *
 * Generates comprehensive per-test evidence reports in JSON and Markdown.
 * Combines test results, observation data, quality scores, and Claude judgments.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TestEvidence, InteractionQualityScore } from '../config/types.js';

// ── Test-code quality scoring ────────────────────────────────

function extractTestBody(source: string, testName: string): string | null {
  // Normalize curly quotes/apostrophes to straight equivalents for matching
  const normalized = testName
    .replace(/[\u2018\u2019\u0060]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
  // Try simple indexOf first (faster, handles most cases)
  // Also try with escaped apostrophes (source has \' but test results have ')
  const escaped_apos = normalized.replace(/'/g, "\\'");
  const candidates = [normalized, escaped_apos];
  const simplePatterns: string[] = [];
  for (const n of candidates) {
    simplePatterns.push(
      `test('${n}'`, `test("${n}"`,
      `test.skip('${n}'`, `test.skip("${n}"`,
      `setup('${n}'`, `setup("${n}"`,
    );
  }
  let matchIdx = -1;
  for (const pat of simplePatterns) {
    const idx = source.indexOf(pat);
    if (idx !== -1) { matchIdx = idx; break; }
  }
  // Fallback: regex with escaped name
  if (matchIdx === -1) {
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`test\\(['"\`]${escaped}['"\`]`),
      new RegExp(`test\\.skip\\(['"\`]${escaped}['"\`]`),
    ];
    for (const p of patterns) {
      const m = source.match(p);
      if (m && m.index !== undefined) { matchIdx = m.index; break; }
    }
  }
  if (matchIdx === -1) return null;
  // Find the arrow function body `=> {`, not the parameter destructuring `({ page })`
  const arrowIdx = source.indexOf('=>', matchIdx);
  if (arrowIdx === -1) return null;
  const braceStart = source.indexOf('{', arrowIdx + 2);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.substring(braceStart, i + 1); }
  }
  return null;
}

function scoreTestFromCode(testFilePath: string, testName: string): { score: number; signals: string[] } | null {
  if (!existsSync(testFilePath)) return null;
  const source = readFileSync(testFilePath, 'utf-8');
  const body = extractTestBody(source, testName);
  if (!body) return null;

  const signals: string[] = [];
  let score = 2; // base: test exists

  if (/test\.slow\(\)/.test(body)) { score += 1; signals.push('test.slow'); }
  if (/waitForResponse|waitForRequest/.test(body)) { score += 2; signals.push('waitForResponse'); }
  if (/expect\.poll/.test(body)) { score += 2; signals.push('expect.poll'); }
  if (/waitForSelector/.test(body) && !/waitForTimeout/.test(body)) { score += 1; signals.push('waitForSelector'); }
  if (/toContainText|toHaveText|\.length\b/.test(body)) { score += 1; signals.push('contentAssertion'); }
  if (/not\.toMatch.*error|not\.toContain.*error/i.test(body)) { score += 1; signals.push('errorCheck'); }
  const clickCount = (body.match(/\.click\(\)/g) || []).length;
  if (clickCount >= 2) { score += 1; signals.push('prerequisite'); }
  const fillMatch = body.match(/\.fill\(['"`](.{20,})['"`]\)/);
  if (fillMatch) { score += 1; signals.push('smartInput'); }
  if (/toBeGreaterThan/.test(body)) { score += 1; signals.push('countAssertion'); }
  if (/expect\(.*\.status\(\)\)|response\.status/.test(body)) { score += 1; signals.push('statusAssertion'); }

  return { score: Math.min(score, 10), signals };
}

function scoreToBand(score: number): InteractionQualityScore['band'] {
  if (score >= 9) return 'verified';
  if (score >= 7) return 'real';
  if (score >= 5) return 'client-only';
  if (score >= 3) return 'superficial';
  if (score >= 1) return 'no-effect';
  return 'blocked';
}

export interface EvidenceReport {
  generatedAt: string;
  appName: string;
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    realTests: number;
    weakTests: number;
    noOpTests: number;
    averageQuality: number;
    prerequisitesFound: number;
  };
  testsByRoute: Record<string, TestEvidence[]>;
  prerequisitesDiscovered: Array<{
    route: string;
    prerequisite: string;
    unlocks: string;
    effect: string;
  }>;
  flaggedIssues: Array<{
    test: string;
    issue: string;
    severity: 'error' | 'warning' | 'info';
  }>;
}

/**
 * Generate an evidence report from UIC artifacts in the project.
 */
export function generateEvidenceReport(projectRoot: string): EvidenceReport {
  const uicDir = resolve(projectRoot, '.uic');

  // Load test results
  const resultsPath = resolve(uicDir, 'test-results.json');
  const testResults = existsSync(resultsPath)
    ? JSON.parse(readFileSync(resultsPath, 'utf-8'))
    : null;

  // Load observations
  const obsPath = resolve(uicDir, 'observed-groups.json');
  const observations = existsSync(obsPath)
    ? JSON.parse(readFileSync(obsPath, 'utf-8'))
    : [];

  // Load inventory
  const invPath = resolve(uicDir, 'inventory.json');
  const inventory = existsSync(invPath)
    ? JSON.parse(readFileSync(invPath, 'utf-8'))
    : null;

  // Load test plan (from Claude agentic phase)
  const planPath = resolve(uicDir, 'test-plan.json');
  const testPlan = existsSync(planPath)
    ? JSON.parse(readFileSync(planPath, 'utf-8'))
    : null;

  // Load Claude judgments
  const judgmentsPath = resolve(uicDir, 'test-judgments.json');
  const judgments = existsSync(judgmentsPath)
    ? JSON.parse(readFileSync(judgmentsPath, 'utf-8'))
    : [];

  // Extract per-test data from Playwright results
  const tests: TestEvidence[] = [];
  const testRootDir = testResults?.config?.rootDir || resolve(projectRoot, 'tests/e2e');
  if (testResults) {
    walkSuites(testResults.suites || [], tests, observations, judgments, undefined, testRootDir);
  }

  // Build route groupings
  const testsByRoute: Record<string, TestEvidence[]> = {};
  for (const test of tests) {
    const route = test.route || '/';
    if (!testsByRoute[route]) testsByRoute[route] = [];
    testsByRoute[route].push(test);
  }

  // Find prerequisites
  const prereqs: EvidenceReport['prerequisitesDiscovered'] = [];
  for (const group of observations) {
    if (group.observation?.prerequisite?.succeeded) {
      prereqs.push({
        route: group.route,
        prerequisite: group.observation.prerequisite.label,
        unlocks: group.id,
        effect: group.observation.prerequisite.effect,
      });
    }
  }

  // Flag issues
  const flagged: EvidenceReport['flaggedIssues'] = [];
  for (const test of tests) {
    if (test.qualityScore.score <= 2 && test.result !== 'skip') {
      flagged.push({
        test: test.testName,
        issue: `No-op test: interaction had no observable effect (quality ${test.qualityScore.score}/10)`,
        severity: 'warning',
      });
    }
    if (test.observation && test.observation.settleTime > 20000) {
      flagged.push({
        test: test.testName,
        issue: `Slow response: took ${(test.observation.settleTime / 1000).toFixed(1)}s`,
        severity: 'warning',
      });
    }
  }

  // Compute summary
  const passed = tests.filter(t => t.result === 'pass').length;
  const failed = tests.filter(t => t.result === 'fail').length;
  const skipped = tests.filter(t => t.result === 'skip').length;
  const scored = tests.filter(t => t.result !== 'skip');
  const realTests = scored.filter(t => t.qualityScore.score >= 7).length;
  const weakTests = scored.filter(t => t.qualityScore.score >= 4 && t.qualityScore.score < 7).length;
  const noOpTests = scored.filter(t => t.qualityScore.score < 4).length;
  const avgQuality = scored.length > 0
    ? scored.reduce((sum, t) => sum + t.qualityScore.score, 0) / scored.length
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    appName: inventory?.appName || 'Unknown App',
    summary: {
      totalTests: tests.length,
      passed,
      failed,
      skipped,
      realTests,
      weakTests,
      noOpTests,
      averageQuality: Math.round(avgQuality * 10) / 10,
      prerequisitesFound: prereqs.length,
    },
    testsByRoute,
    prerequisitesDiscovered: prereqs,
    flaggedIssues: flagged,
  };
}

function walkSuites(
  suites: any[],
  tests: TestEvidence[],
  observations: any[],
  judgments: any[],
  parentFile?: string,
  testRootDir?: string,
): void {
  for (const suite of suites) {
    for (const spec of suite.specs || []) {
      const testName = spec.title || '';
      const route = extractRoute(suite.title, testName);
      const testStatus = spec.tests?.[0]?.status;
      const result = testStatus === 'skipped' ? 'skip' : (spec.ok ? 'pass' : 'fail');

      // Find matching observation
      const obs = findObservation(observations, route, testName);

      // Find matching judgment
      const judgment = judgments.find((j: any) => j.testId === testName);

      // Build quality score (observation-based, then enhanced by test-code analysis)
      let qualityScore: InteractionQualityScore = obs?.qualityScore || {
        score: result === 'skip' ? 0 : (result === 'pass' ? 6 : 2),
        band: result === 'skip' ? 'blocked' : (result === 'pass' ? 'client-only' : 'no-effect'),
        signals: {
          attempted: result !== 'skip',
          mutationCount: obs?.mutations?.length || 0,
          networkRequestCount: obs?.networkRequests?.length || 0,
          outputChanged: false,
          outputLengthDelta: 0,
          itemCountDelta: 0,
          hasErrorIndicator: false,
          urlChanged: false,
        },
      };

      // Enhance quality with test-code analysis
      const suiteFile = suite.file || parentFile;
      if (suiteFile && testRootDir) {
        const filePath = resolve(testRootDir, suiteFile);
        const codeResult = scoreTestFromCode(filePath, testName);
        if (codeResult && codeResult.score > qualityScore.score) {
          qualityScore = {
            ...qualityScore,
            score: codeResult.score,
            band: scoreToBand(codeResult.score),
          };
        }
      }

      tests.push({
        testId: testName,
        testName,
        route,
        input: obs?.inputUsed,
        action: inferAction(testName),
        observation: obs ? {
          mutationCount: obs.mutations?.length || 0,
          networkRequests: (obs.networkRequests || []).map((r: any) => `${r.method} ${r.url} → ${r.status}`),
          settleTime: obs.settleTime || 0,
          outputBefore: obs.outputDelta?.before?.substring(0, 100),
          outputAfter: obs.outputDelta?.after?.substring(0, 100),
        } : undefined,
        prerequisitesUsed: obs?.prerequisite ? [obs.prerequisite] : undefined,
        qualityScore,
        claudeJudgment: judgment ? {
          verdict: judgment.verdict,
          reasoning: judgment.reasoning,
        } : undefined,
        result: result as 'pass' | 'fail' | 'skip',
        resultReason: spec.tests?.[0]?.results?.[0]?.error?.message?.substring(0, 200),
      });
    }
    if (suite.suites) {
      walkSuites(suite.suites, tests, observations, judgments, suite.file || parentFile, testRootDir);
    }
  }
}

function extractRoute(suiteTitle: string, testName: string): string {
  // Try to extract route from suite title or test name
  const routeMatch = testName.match(/^(\/.+?)[:\/\s]/);
  if (routeMatch) return routeMatch[1];
  const suiteMatch = suiteTitle.match(/^(Home|Chat|Search|Tasks|Import|Login)/i);
  if (suiteMatch) return '/' + suiteMatch[1].toLowerCase();
  return '/';
}

function inferAction(testName: string): string {
  if (testName.includes('click')) return 'click';
  if (testName.includes('fill')) return 'fill';
  if (testName.includes('navigate')) return 'navigate';
  if (testName.includes('toggle')) return 'toggle';
  if (testName.includes('upload')) return 'upload';
  if (testName.includes('page loads')) return 'smoke';
  if (testName.includes('composite')) return 'composite';
  if (testName.includes('journey')) return 'journey';
  return 'interact';
}

function findObservation(observations: any[], route: string, testName: string): any {
  return observations.find((o: any) =>
    o.route === route && o.observation
  )?.observation;
}

/**
 * Format the evidence report as a human-readable Markdown string.
 */
export function formatEvidenceMarkdown(report: EvidenceReport): string {
  const lines: string[] = [];
  const s = report.summary;

  lines.push(`# UIC Test Evidence Report — ${report.appName}`);
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total tests | ${s.totalTests} |`);
  lines.push(`| Passed | ${s.passed} |`);
  lines.push(`| Failed | ${s.failed} |`);
  lines.push(`| Skipped | ${s.skipped} |`);
  lines.push(`| Real tests (7-10) | ${s.realTests} (${pct(s.realTests, s.totalTests)}) |`);
  lines.push(`| Weak tests (4-6) | ${s.weakTests} (${pct(s.weakTests, s.totalTests)}) |`);
  lines.push(`| No-op tests (0-3) | ${s.noOpTests} (${pct(s.noOpTests, s.totalTests)}) |`);
  lines.push(`| Average quality | ${s.averageQuality}/10 |`);
  lines.push(`| Prerequisites found | ${s.prerequisitesFound} |`);
  lines.push('');

  // Tests by route
  lines.push('## Tests by Route');
  lines.push('');

  for (const [route, tests] of Object.entries(report.testsByRoute)) {
    lines.push(`### ${route} — ${tests.length} tests`);
    lines.push('');
    lines.push('| # | Test | Input | Action | Mutations | Network | Quality | Result |');
    lines.push('|---|------|-------|--------|-----------|---------|---------|--------|');

    tests.forEach((t, i) => {
      const input = t.input ? `"${t.input.substring(0, 30)}"` : '—';
      const mutations = t.observation ? `${t.observation.mutationCount}` : '—';
      const network = t.observation?.networkRequests?.length
        ? t.observation.networkRequests[0].substring(0, 40)
        : '—';
      const quality = `${t.qualityScore.score}/10 ${t.qualityScore.band}`;
      const result = t.result.toUpperCase();
      const name = t.testName.substring(0, 50);

      lines.push(`| ${i + 1} | ${name} | ${input} | ${t.action} | ${mutations} | ${network} | ${quality} | ${result} |`);
    });
    lines.push('');
  }

  // Quality distribution
  lines.push('## Quality Distribution');
  lines.push('');
  const allTests = Object.values(report.testsByRoute).flat();
  const bands = ['verified', 'real', 'client-only', 'superficial', 'no-effect', 'blocked'] as const;
  const bandRanges: Record<string, [number, number]> = {
    verified: [9, 10], real: [7, 8], 'client-only': [5, 6],
    superficial: [3, 4], 'no-effect': [1, 2], blocked: [0, 0],
  };
  for (const band of bands) {
    const [lo, hi] = bandRanges[band];
    const count = allTests.filter(t => t.qualityScore.score >= lo && t.qualityScore.score <= hi).length;
    const bar = '█'.repeat(Math.min(count, 40));
    lines.push(`${band.padEnd(12)} (${lo}-${hi}):  ${bar} ${count} tests`);
  }
  lines.push('');

  // Prerequisites
  if (report.prerequisitesDiscovered.length > 0) {
    lines.push('## Prerequisites Discovered');
    lines.push('');
    lines.push('| Route | Prerequisite | Unlocks | Effect |');
    lines.push('|-------|-------------|---------|--------|');
    for (const p of report.prerequisitesDiscovered) {
      lines.push(`| ${p.route} | ${p.prerequisite} | ${p.unlocks} | ${p.effect} |`);
    }
    lines.push('');
  }

  // Flagged issues
  if (report.flaggedIssues.length > 0) {
    lines.push('## Flagged Issues');
    lines.push('');
    lines.push('| # | Test | Issue | Severity |');
    lines.push('|---|------|-------|----------|');
    report.flaggedIssues.forEach((f, i) => {
      lines.push(`| ${i + 1} | ${f.test.substring(0, 40)} | ${f.issue} | ${f.severity} |`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round(n / total * 100)}%`;
}
