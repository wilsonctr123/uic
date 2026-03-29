import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  InteractionGroup,
  UicConfig,
  InteractionPattern,
} from '../config/types.js';
import { generateWaitCode } from './wait-strategy.js';
import { generateOutputValidation } from './output-judge.js';

export interface CompositeGenResult {
  testFile: string;
  testCount: number;
  observationBased: number;
  heuristicBased: number;
}

/**
 * Generates multi-step Playwright tests from InteractionGroups with observations.
 * Writes all tests to `${outputDir}/composites.spec.ts`.
 */
export function generateCompositeTests(
  groups: InteractionGroup[],
  config: UicConfig,
  outputDir: string,
): CompositeGenResult {
  const testBlocks: string[] = [];
  let observationBased = 0;
  let heuristicBased = 0;

  for (const group of groups) {
    if (group.pattern === 'unknown') {
      continue;
    }

    const testCode = generateTestForPattern(group, config);
    if (testCode) {
      testBlocks.push(testCode);
      if (group.observation) {
        observationBased++;
      } else {
        heuristicBased++;
      }
    }
  }

  // Also generate generic tests for unknown-pattern groups
  for (const group of groups) {
    if (group.pattern === 'unknown') {
      const testCode = generateGenericTest(group, config);
      if (testCode) {
        testBlocks.push(testCode);
        if (group.observation) {
          observationBased++;
        } else {
          heuristicBased++;
        }
      }
    }
  }

  const fileContent = buildTestFile(testBlocks, config);
  mkdirSync(outputDir, { recursive: true });
  const testFile = join(outputDir, 'composites.spec.ts');
  writeFileSync(testFile, fileContent, 'utf-8');

  return {
    testFile,
    testCount: testBlocks.length,
    observationBased,
    heuristicBased,
  };
}

function buildTestFile(testBlocks: string[], config: UicConfig): string {
  const lines = [
    `import { test, expect } from '@playwright/test';`,
    ``,
    `// Auto-generated composite tests for ${config.app.name}`,
    `// Generated at: ${new Date().toISOString()}`,
    ``,
    ...testBlocks,
  ];
  return lines.join('\n') + '\n';
}

function generateTestForPattern(
  group: InteractionGroup,
  config: UicConfig,
): string | null {
  const route = resolveRoute(group.route, config.app.baseUrl);
  const inputSelector = getFirstMemberSelector(group.members.inputs);
  const triggerSelector = getFirstMemberSelector(group.members.triggers);
  const outputZone = group.members.outputs[0];

  if (!triggerSelector) {
    return null;
  }

  // Generate prerequisite step if one was discovered during observation
  let prereqCode = '';
  if (group.observation?.prerequisite?.succeeded) {
    const prereq = group.observation.prerequisite;
    const prereqSelector = escapeQuotes(prereq.selector);
    prereqCode = `  // Prerequisite: ${prereq.effect}\n` +
      `  await page.locator('${prereqSelector}').click();\n` +
      `  await page.waitForTimeout(500);\n\n`;
  }

  const fallbackOracle = inferOracleFromPattern(group.pattern);
  const waitCode = generateWaitCode(group.observation, fallbackOracle, '    ', group.route);
  const validationCode = outputZone
    ? generateOutputValidation(outputZone.selector, undefined, '    ')
    : '';

  switch (group.pattern) {
    case 'chat':
      return generateChatTest(group, route, inputSelector, triggerSelector, waitCode, validationCode, prereqCode);

    case 'search':
      return generateSearchTest(group, route, inputSelector, triggerSelector, waitCode, validationCode, prereqCode);

    case 'form-submit':
      return generateFormTest(group, route, triggerSelector, waitCode, validationCode, prereqCode);

    default:
      return generateGenericTest(group, config, prereqCode);
  }
}

function generateChatTest(
  group: InteractionGroup,
  route: string,
  inputSelector: string | null,
  triggerSelector: string,
  waitCode: string,
  validationCode: string,
  prereqCode: string = '',
): string {
  const escapedRoute = escapeQuotes(route);
  const escapedTrigger = escapeQuotes(triggerSelector);

  const lines = [
    `test('composite: ${escapeQuotes(group.route)} chat — send and verify response', async ({ page }) => {`,
    `  await page.goto('${escapedRoute}');`,
  ];

  if (prereqCode) lines.push(prereqCode);

  if (inputSelector) {
    lines.push(
      `  // Fill input`,
      `  await page.locator('${escapeQuotes(inputSelector)}').fill('Hello');`,
    );
  }

  lines.push(
    `  // Submit`,
    `  await page.locator('${escapedTrigger}').click();`,
    `  // Wait for response`,
    waitCode,
  );

  if (validationCode) {
    lines.push(`  // Validate output`, validationCode);
  }

  lines.push(`});`, ``);
  return lines.join('\n');
}

function generateSearchTest(
  group: InteractionGroup,
  route: string,
  inputSelector: string | null,
  triggerSelector: string,
  waitCode: string,
  validationCode: string,
  prereqCode: string = '',
): string {
  const escapedRoute = escapeQuotes(route);
  const escapedTrigger = escapeQuotes(triggerSelector);

  const lines = [
    `test('composite: ${escapeQuotes(group.route)} search — query and verify results', async ({ page }) => {`,
    `  await page.goto('${escapedRoute}');`,
  ];

  if (prereqCode) lines.push(prereqCode);

  if (inputSelector) {
    lines.push(
      `  await page.locator('${escapeQuotes(inputSelector)}').fill('test');`,
    );
  }

  lines.push(
    `  await page.locator('${escapedTrigger}').click();`,
    waitCode,
  );

  if (validationCode) {
    lines.push(validationCode);
  }

  lines.push(`});`, ``);
  return lines.join('\n');
}

function generateFormTest(
  group: InteractionGroup,
  route: string,
  triggerSelector: string,
  waitCode: string,
  validationCode: string,
  prereqCode: string = '',
): string {
  const escapedRoute = escapeQuotes(route);
  const escapedTrigger = escapeQuotes(triggerSelector);

  const lines = [
    `test('composite: ${escapeQuotes(group.route)} form — fill and submit', async ({ page }) => {`,
    `  await page.goto('${escapedRoute}');`,
  ];

  if (prereqCode) lines.push(prereqCode);
  lines.push(`  // Fill all inputs`);

  // Generate fill code for each input in the group
  for (const inputId of group.members.inputs) {
    const selector = extractSelectorFromId(inputId);
    lines.push(
      `  await page.locator('${escapeQuotes(selector)}').fill('test-value');`,
    );
  }

  lines.push(
    `  // Submit`,
    `  await page.locator('${escapedTrigger}').click();`,
    waitCode,
  );

  if (validationCode) {
    lines.push(validationCode);
  }

  lines.push(`});`, ``);
  return lines.join('\n');
}

function generateGenericTest(
  group: InteractionGroup,
  config: UicConfig,
  prereqCode: string = '',
): string {
  const route = resolveRoute(group.route, config.app.baseUrl);
  const triggerSelector = getFirstMemberSelector(group.members.triggers);
  const outputZone = group.members.outputs[0];
  const fallbackOracle = inferOracleFromPattern(group.pattern);

  if (!triggerSelector) {
    return '';
  }

  const waitCode = generateWaitCode(group.observation, fallbackOracle, '    ', group.route);
  const validationCode = outputZone
    ? generateOutputValidation(outputZone.selector, undefined, '    ')
    : '';

  const patternLabel = group.pattern === 'unknown' ? 'interact' : group.pattern;
  const escapedRoute = escapeQuotes(route);
  const escapedTrigger = escapeQuotes(triggerSelector);

  const lines = [
    `test('composite: ${escapeQuotes(group.route)} ${patternLabel} — interact and verify', async ({ page }) => {`,
    `  await page.goto('${escapedRoute}');`,
  ];

  if (prereqCode) lines.push(prereqCode);

  // Fill inputs if any
  const inputSelector = getFirstMemberSelector(group.members.inputs);
  if (inputSelector) {
    lines.push(
      `  await page.locator('${escapeQuotes(inputSelector)}').fill('test');`,
    );
  }

  lines.push(
    `  await page.locator('${escapedTrigger}').click();`,
    waitCode,
  );

  if (validationCode) {
    lines.push(validationCode);
  }

  lines.push(`});`, ``);
  return lines.join('\n');
}

// ── Helpers ──────────────────────────────────────────────

function resolveRoute(route: string, _baseUrl: string): string {
  if (route.startsWith('http')) {
    // Strip to just the path — tests use baseURL from Playwright config
    try {
      const url = new URL(route);
      return url.pathname || '/';
    } catch {
      return route;
    }
  }
  return route.startsWith('/') ? route : '/' + route;
}

/**
 * Extract a usable selector from a member ID.
 * Member IDs may be affordance IDs like "aff_route_btn_0" — in that case
 * we can't resolve to a real selector without the full affordance ledger,
 * so we return the ID as a data-testid selector fallback.
 */
function getFirstMemberSelector(memberIds: string[]): string | null {
  if (memberIds.length === 0) return null;
  return extractSelectorFromId(memberIds[0]);
}

function extractSelectorFromId(id: string): string {
  // If the ID looks like a CSS selector already, use it directly
  if (id.startsWith('.') || id.startsWith('#') || id.startsWith('[') || id.includes('>') || id.includes(' ')) {
    return id;
  }
  // Try to extract a human-readable label from the affordance ID
  // IDs look like "aff_route_btn_0" — extract meaningful parts
  const parts = id.replace(/^aff_/, '').replace(/_\d+$/, '').split('_');
  const label = parts.filter(p => !['btn', 'lnk', 'inp', 'txt'].includes(p) || parts.length <= 2).join(' ');
  if (label) {
    return `text=${label}`;
  }
  // Last resort: use getByText with the raw ID (will likely need manual fix)
  return `text=${id}`;
}

function inferOracleFromPattern(pattern: InteractionPattern): import('../config/types.js').OracleType {
  switch (pattern) {
    case 'chat':
    case 'search':
    case 'list-filter':
    case 'crud-create':
    case 'pagination':
      return 'element-appears';

    case 'form-submit':
    case 'auth-flow':
    case 'wizard':
      return 'url-changes';

    case 'toggle-panel':
    case 'modal-dialog':
      return 'element-appears';

    default:
      return 'no-crash';
  }
}

function escapeQuotes(s: string): string {
  return s.replace(/'/g, "\\'");
}
