/**
 * UIC Intelligence Layer — Output Evaluator
 *
 * Post-test-run quality evaluation for AI features.
 * Reads Playwright JSON results, matches them to AI feature routes,
 * and evaluates output quality using heuristics (no LLM calls).
 */

import { readFileSync, existsSync } from 'fs';
import type { AppUnderstanding, AiFeature, FeatureMap } from './types.js';
import type { LLMClient } from './llm-client.js';

// ── Public Types ──────────────────────────────────────────

export interface OutputEvaluation {
  testName: string;
  route: string;
  input: string;
  output: string;
  relevant: boolean;
  complete: boolean;
  hasCitations: boolean;
  qualityScore: number;      // 0-10
  reasoning: string;
}

// ── Playwright JSON Result Types ──────────────────────────

interface PlaywrightResult {
  suites?: PlaywrightSuite[];
  stats?: { expected?: number; unexpected?: number };
}

interface PlaywrightSuite {
  title: string;
  file?: string;
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

interface PlaywrightSpec {
  title: string;
  ok: boolean;
  tests?: PlaywrightTest[];
}

interface PlaywrightTest {
  results?: PlaywrightTestResult[];
}

interface PlaywrightTestResult {
  status: string;
  attachments?: Array<{ name: string; body?: string; contentType?: string }>;
  stdout?: string[];
  stderr?: string[];
  error?: { message?: string };
}

// ── Citation Patterns ─────────────────────────────────────

const CITATION_PATTERNS = [
  /\[source[:\s]/i,
  /\[citation/i,
  /\[\d+\]/,                           // [1], [2] style refs
  /\bsource:\s/i,
  /\bfrom:\s/i,
  /\breference[sd]?\b/i,
  /\bcited?\b/i,
  /\baccording to\b/i,
  /\bper the\b/i,
  /\bemail from\b/i,
  /\bsubject:\s/i,
  /\bsent by\b/i,
];

// ── Minimum Output Lengths ────────────────────────────────

const MIN_OUTPUT_LENGTH: Record<AiFeature['type'], number> = {
  chat: 50,
  search: 20,
  summarize: 80,
  generate: 40,
  other: 20,
};

// ── Public API ────────────────────────────────────────────

/**
 * Evaluate test outputs for AI features.
 * Reads Playwright JSON test results and checks if AI outputs meet quality criteria.
 * This is heuristic-based — no LLM calls.
 */
export function evaluateOutputs(
  understanding: AppUnderstanding,
  testResultsPath: string,
): OutputEvaluation[] {
  if (!existsSync(testResultsPath)) return [];

  let results: PlaywrightResult;
  try {
    results = JSON.parse(readFileSync(testResultsPath, 'utf-8'));
  } catch {
    return [];
  }

  const evaluations: OutputEvaluation[] = [];

  // Build keyword set from understanding's data model for relevance checking
  const keywords = buildKeywordSet(understanding);

  // Build route-to-AI-feature map for quick lookup
  const aiFeaturesByRoute = new Map<string, AiFeature>();
  for (const af of understanding.aiFeatures) {
    aiFeaturesByRoute.set(af.route, af);
  }

  // Also track all AI-related route paths (including partials)
  const aiRoutes = new Set(understanding.aiFeatures.map(f => f.route));

  // Walk the Playwright JSON results tree
  walkSuites(results.suites || [], (specTitle, suitePath, spec) => {
    // Match this test to an AI feature route
    const matchedRoute = findMatchingRoute(specTitle, suitePath, aiRoutes, understanding.features);
    if (!matchedRoute) return;

    const aiFeature = aiFeaturesByRoute.get(matchedRoute);
    if (!aiFeature) return;

    // Extract output text from test results
    const { input, output } = extractTestOutput(spec);
    if (!output) return;

    // Evaluate quality dimensions
    const relevant = checkRelevance(output, keywords, aiFeature);
    const minLen = MIN_OUTPUT_LENGTH[aiFeature.type] || 20;
    const complete = output.length >= minLen;
    const hasCitations = checkCitations(output);

    // Compute quality score as a weighted average (0-10)
    const { score, reasoning } = computeQualityScore(
      relevant, complete, hasCitations, output, aiFeature,
    );

    evaluations.push({
      testName: specTitle,
      route: matchedRoute,
      input,
      output: output.substring(0, 500),  // truncate for report
      relevant,
      complete,
      hasCitations,
      qualityScore: score,
      reasoning,
    });
  });

  return evaluations;
}

// ── Internal Helpers ──────────────────────────────────────

/**
 * Build a set of keywords from the understanding's data model.
 * Used to check if AI outputs are topically relevant.
 */
function buildKeywordSet(understanding: AppUnderstanding): Set<string> {
  const kw = new Set<string>();

  // Entity names and field names
  for (const entity of understanding.dataModel.entities) {
    kw.add(entity.name.toLowerCase());
    kw.add(entity.tableName.toLowerCase());
    for (const field of entity.keyFields) {
      kw.add(field.toLowerCase().replace(/_/g, ' '));
    }
  }

  // Sample data: extract subject lines, names, etc.
  for (const [_key, samples] of Object.entries(understanding.dataModel.sampleData)) {
    for (const sample of samples) {
      for (const val of Object.values(sample)) {
        if (typeof val === 'string' && val.length > 3 && val.length < 100) {
          // Extract meaningful words (3+ chars) from sample values
          const words = val.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
          for (const w of words) {
            kw.add(w);
          }
        }
      }
    }
  }

  // Record count keys (entity type names)
  for (const key of Object.keys(understanding.dataModel.recordCounts)) {
    kw.add(key.toLowerCase());
  }

  // Feature purposes (extract nouns)
  for (const feature of understanding.features) {
    const words = feature.purpose.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
    for (const w of words) {
      kw.add(w);
    }
  }

  return kw;
}

/**
 * Walk Playwright suite tree, calling callback for each spec.
 */
function walkSuites(
  suites: PlaywrightSuite[],
  callback: (specTitle: string, suitePath: string[], spec: PlaywrightSpec) => void,
  path: string[] = [],
): void {
  for (const suite of suites) {
    const currentPath = [...path, suite.title];

    for (const spec of suite.specs || []) {
      callback(spec.title, currentPath, spec);
    }

    if (suite.suites) {
      walkSuites(suite.suites, callback, currentPath);
    }
  }
}

/**
 * Match a test spec to an AI feature route.
 * Uses suite path, spec title, and feature route patterns.
 */
function findMatchingRoute(
  specTitle: string,
  suitePath: string[],
  aiRoutes: Set<string>,
  features: FeatureMap[],
): string | null {
  const fullPath = [...suitePath, specTitle].join(' ').toLowerCase();

  // Direct route match: test title or suite name contains route path
  for (const route of aiRoutes) {
    const routeSegment = route.replace(/^\//, '').toLowerCase();
    if (routeSegment && fullPath.includes(routeSegment)) {
      return route;
    }
  }

  // Match by feature page name
  for (const feature of features) {
    if (!feature.isAiFeature) continue;
    const pageName = feature.pageName.toLowerCase();
    if (fullPath.includes(pageName)) {
      return feature.route;
    }
  }

  // Match by AI-related keywords in the test title
  const aiKeywords = ['chat', 'search', 'query', 'ask', 'ai', 'llm', 'generate', 'summarize', 'deep think'];
  const titleLower = specTitle.toLowerCase();
  if (aiKeywords.some(kw => titleLower.includes(kw))) {
    // Return the first AI route as a fallback
    for (const route of aiRoutes) {
      return route;
    }
  }

  return null;
}

/**
 * Extract test input and output text from a Playwright spec.
 * Looks in test result attachments, stdout, and error messages.
 */
function extractTestOutput(spec: PlaywrightSpec): { input: string; output: string } {
  let input = '';
  let output = '';

  for (const test of spec.tests || []) {
    for (const result of test.results || []) {
      // Check attachments for captured output
      for (const att of result.attachments || []) {
        if (att.name === 'ai-output' || att.name === 'response-text') {
          output = att.body || '';
        }
        if (att.name === 'ai-input' || att.name === 'query-text') {
          input = att.body || '';
        }
      }

      // Check stdout for captured text (tests often console.log output)
      for (const line of result.stdout || []) {
        if (line.startsWith('AI_OUTPUT:')) {
          output = line.substring('AI_OUTPUT:'.length).trim();
        }
        if (line.startsWith('AI_INPUT:')) {
          input = line.substring('AI_INPUT:'.length).trim();
        }
      }

      // If no explicit output captured, check error messages for assertion content
      if (!output && result.error?.message) {
        // Playwright assertion errors often contain "Expected ... Received ..."
        const received = result.error.message.match(/Received:\s*"([^"]+)"/);
        if (received) {
          output = received[1];
        }
      }
    }
  }

  return { input, output };
}

/**
 * Check if the output is relevant to the domain by matching against keywords.
 */
function checkRelevance(output: string, keywords: Set<string>, _aiFeature: AiFeature): boolean {
  const outputLower = output.toLowerCase();
  const words = outputLower.split(/\s+/);

  // Count keyword matches
  let matches = 0;
  for (const word of words) {
    // Clean punctuation from word edges
    const cleaned = word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    if (cleaned.length >= 3 && keywords.has(cleaned)) {
      matches++;
    }
  }

  // Require at least 2 keyword matches, or 1 if output is short
  const threshold = output.length < 100 ? 1 : 2;
  return matches >= threshold;
}

/**
 * Check if the output contains citation/source reference patterns.
 */
function checkCitations(output: string): boolean {
  return CITATION_PATTERNS.some(pattern => pattern.test(output));
}

/**
 * Compute a 0-10 quality score from the evaluation dimensions.
 */
function computeQualityScore(
  relevant: boolean,
  complete: boolean,
  hasCitations: boolean,
  output: string,
  aiFeature: AiFeature,
): { score: number; reasoning: string } {
  const reasons: string[] = [];
  let score = 0;

  // Relevance: 0-4 points (most important)
  if (relevant) {
    score += 4;
    reasons.push('output contains domain-relevant content');
  } else {
    reasons.push('output lacks domain-relevant keywords');
  }

  // Completeness: 0-3 points
  if (complete) {
    score += 2;
    reasons.push('output meets minimum length');

    // Bonus for substantial output
    const minLen = MIN_OUTPUT_LENGTH[aiFeature.type] || 20;
    if (output.length >= minLen * 3) {
      score += 1;
      reasons.push('output is substantive');
    }
  } else {
    reasons.push(`output too short (${output.length} chars)`);
  }

  // Citations: 0-2 points (important for chat/search/summarize)
  if (hasCitations) {
    score += 2;
    reasons.push('output includes source references');
  } else if (['chat', 'search', 'summarize'].includes(aiFeature.type)) {
    reasons.push('expected citations but none found');
  } else {
    // Citations not expected for generate/other — give partial credit
    score += 1;
    reasons.push('citations not required for this feature type');
  }

  // No-error bonus: 0-1 point
  const errorIndicators = /\b(error|failed|exception|unavailable|timeout)\b/i;
  if (!errorIndicators.test(output)) {
    score += 1;
    reasons.push('no error indicators in output');
  } else {
    reasons.push('output contains error-like text');
  }

  return {
    score: Math.min(10, score),
    reasoning: reasons.join('; '),
  };
}

// ── Claude-Powered Output Evaluation ────────────────────────

/**
 * Evaluate AI feature outputs using Claude LLM for deeper quality judgment.
 * Falls back to heuristic evaluation if LLM call fails.
 */
export async function evaluateOutputsWithLLM(
  understanding: AppUnderstanding,
  testResultsPath: string,
  llmClient: LLMClient,
): Promise<OutputEvaluation[]> {
  if (!existsSync(testResultsPath)) return [];

  let results: PlaywrightResult;
  try {
    results = JSON.parse(readFileSync(testResultsPath, 'utf-8'));
  } catch {
    return [];
  }

  // Find tests for AI feature routes
  const aiRoutes = new Set(understanding.aiFeatures.map(f => f.route));
  const aiTestOutputs: Array<{testName: string, route: string, output: string}> = [];

  // Walk test results to find AI feature test outputs
  walkSuites(results.suites || [], (specTitle, suitePath, spec) => {
    const matchedRoute = findMatchingRoute(specTitle, suitePath, aiRoutes, understanding.features);
    if (!matchedRoute) return;

    const { input, output } = extractTestOutput(spec);
    if (!output) return;

    aiTestOutputs.push({ testName: specTitle, route: matchedRoute, output });
  });

  if (aiTestOutputs.length === 0) return [];

  const system = `You are evaluating AI feature outputs in a webapp.
For each test case, judge:
- relevant (0-10): Does the output actually answer the question using the app's data?
- complete (0-10): Is the response thorough enough?
- hasCitations (true/false): Does it reference source material?
- qualityScore (0-10): Overall quality
- reasoning: One sentence explaining your judgment

Return a JSON array of evaluations.`;

  const user = `## App Context
${understanding.projectGoal}
Available data: ${JSON.stringify(understanding.dataModel.recordCounts)}

## Test Outputs to Evaluate
${aiTestOutputs.map((t, i) => `### ${i + 1}. ${t.testName}\nRoute: ${t.route}\nOutput: "${t.output.substring(0, 500)}"`).join('\n\n')}`;

  try {
    const response = await llmClient.complete({ system, user, maxTokens: 2048 });
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return evaluateOutputs(understanding, testResultsPath);

    const llmEvals: Array<{
      relevant: number;
      complete: number;
      hasCitations: boolean;
      qualityScore: number;
      reasoning: string;
    }> = JSON.parse(jsonMatch[0]);

    // Map LLM evaluations back to OutputEvaluation format
    return llmEvals.map((ev, i) => {
      const testOutput = aiTestOutputs[i];
      return {
        testName: testOutput?.testName || `test-${i}`,
        route: testOutput?.route || '',
        input: '',
        output: testOutput?.output.substring(0, 500) || '',
        relevant: (ev.relevant ?? 0) >= 5,
        complete: (ev.complete ?? 0) >= 5,
        hasCitations: ev.hasCitations ?? false,
        qualityScore: ev.qualityScore ?? 0,
        reasoning: ev.reasoning || '',
      };
    });
  } catch {
    return evaluateOutputs(understanding, testResultsPath);
  }
}
