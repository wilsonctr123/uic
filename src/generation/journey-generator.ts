/**
 * Journey Test Generator
 *
 * Generates multi-step Playwright tests from journey definitions.
 * Each journey becomes a test that walks through a real user flow.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { JourneyConfig, JourneyStep, UicConfig } from '../config/types.js';

export interface JourneyGenResult {
  testFile: string;
  journeyCount: number;
  stepCount: number;
}

/**
 * Generate a Playwright locator string from a step target.
 * Supports:
 *   - role:name format (e.g., "button:Submit", "link:Home")
 *   - CSS selectors (e.g., ".my-class", "#my-id", "div > span")
 *   - placeholder: prefix (e.g., "placeholder:Search...")
 *   - text: prefix (e.g., "text:Click me")
 */
function targetToLocator(target: string): string {
  if (!target) return `page.locator('body')`;

  // role:name format
  const roleMatch = target.match(/^(button|link|textbox|heading|checkbox|tab|dialog|menuitem|searchbox|combobox):(.+)$/i);
  if (roleMatch) {
    const role = roleMatch[1].toLowerCase();
    const name = roleMatch[2].replace(/'/g, "\\'");
    return `page.getByRole('${role}', { name: /${name}/i })`;
  }

  // placeholder: prefix
  if (target.startsWith('placeholder:')) {
    const ph = target.slice(12).replace(/'/g, "\\'");
    return `page.getByPlaceholder(/${ph}/i)`;
  }

  // text: prefix
  if (target.startsWith('text:')) {
    const txt = target.slice(5).replace(/'/g, "\\'");
    return `page.getByText(/${txt}/i)`;
  }

  // CSS selector
  const escaped = target.replace(/'/g, "\\'");
  return `page.locator('${escaped}')`;
}

function generateStepCode(step: JourneyStep, indent: string): string {
  const timeout = step.timeout || 5000;
  const desc = step.description ? `  // ${step.description}\n${indent}` : '';

  switch (step.action) {
    case 'goto':
      return `${desc}await page.goto('${step.target || '/'}');
${indent}await page.waitForLoadState('domcontentloaded');`;

    case 'click': {
      const loc = targetToLocator(step.target || 'body');
      return `${desc}await ${loc}.waitFor({ timeout: ${timeout} });
${indent}await ${loc}.click();`;
    }

    case 'fill': {
      const loc = targetToLocator(step.target || 'input');
      const val = (step.value || '').replace(/'/g, "\\'");
      return `${desc}await ${loc}.waitFor({ timeout: ${timeout} });
${indent}await ${loc}.fill('${val}');`;
    }

    case 'upload': {
      const loc = targetToLocator(step.target || 'input[type="file"]');
      const val = (step.value || 'tests/e2e/fixtures/data/test-data.csv').replace(/'/g, "\\'");
      return `${desc}await ${loc}.setInputFiles('${val}');`;
    }

    case 'wait':
      if (step.target) {
        const loc = targetToLocator(step.target);
        return `${desc}await ${loc}.waitFor({ timeout: ${timeout} });`;
      }
      return `${desc}await page.waitForTimeout(${timeout});`;

    case 'assert-visible': {
      const loc = targetToLocator(step.target || 'body');
      return `${desc}await expect(${loc}).toBeVisible({ timeout: ${timeout} });`;
    }

    case 'assert-hidden': {
      const loc = targetToLocator(step.target || 'body');
      return `${desc}await expect(${loc}).toBeHidden({ timeout: ${timeout} });`;
    }

    case 'assert-url': {
      const val = (step.value || '/').replace(/'/g, "\\'");
      const escaped = val.replace(/\//g, '\\/');
      return `${desc}await expect(page).toHaveURL(/${escaped}/i, { timeout: ${timeout} });`;
    }

    case 'assert-text': {
      const loc = targetToLocator(step.target || 'body');
      const val = (step.value || '').replace(/'/g, "\\'");
      return `${desc}await expect(${loc}).toContainText('${val}', { timeout: ${timeout} });`;
    }

    default:
      return `${desc}// Unknown action: ${step.action}`;
  }
}

export interface JourneyGenOptions {
  /** When true, skip writing if journeys.spec.ts already exists. Default: false. */
  noOverwrite?: boolean;
}

export function generateJourneyTests(
  journeys: JourneyConfig[],
  config: UicConfig,
  outputDir: string,
  options: JourneyGenOptions = {},
): JourneyGenResult {
  if (journeys.length === 0) {
    return { testFile: '', journeyCount: 0, stepCount: 0 };
  }

  mkdirSync(outputDir, { recursive: true });

  // --no-overwrite: skip if file already exists
  const outputFile = join(outputDir, 'journeys.spec.ts');
  if (options.noOverwrite && existsSync(outputFile)) {
    console.log('  ⏭ Skipping journeys.spec.ts (exists, use --force to regenerate)');
    return { testFile: outputFile, journeyCount: journeys.length, stepCount: journeys.reduce((n, j) => n + j.steps.length, 0) };
  }

  let totalSteps = 0;
  const indent = '    ';

  const testBlocks = journeys.map(journey => {
    totalSteps += journey.steps.length;
    const stepsCode = journey.steps
      .map(step => generateStepCode(step, indent))
      .join(`\n\n${indent}`);

    return `  test('journey: ${journey.name}', async ({ page }) => {
${indent}test.slow(); // journeys are multi-step, allow more time

${indent}${stepsCode}
  });`;
  }).join('\n\n');

  const testFile = `import { test, expect } from '@playwright/test';

test.describe('User Journeys', () => {
  test.describe.configure({ mode: 'serial' });

${testBlocks}
});
`;

  writeFileSync(outputFile, testFile);

  return {
    testFile: outputFile,
    journeyCount: journeys.length,
    stepCount: totalSteps,
  };
}

/**
 * Auto-generate default journeys from discovered routes.
 * Used when no explicit journeys are defined in config.
 */
export function synthesizeDefaultJourneys(
  config: UicConfig,
  routes: string[],
): JourneyConfig[] {
  const journeys: JourneyConfig[] = [];
  const hasAuth = config.auth?.strategy && config.auth.strategy !== 'storage-state';
  const persona = Object.keys(config.auth?.personas || {})[0] || 'user';

  // Journey 1: Navigation tour — visit every route, assert no crash
  if (routes.length > 1) {
    const navSteps: JourneyStep[] = [];
    for (const route of routes) {
      navSteps.push(
        { action: 'goto', target: route, description: `Navigate to ${route}` },
        { action: 'wait', timeout: 1000 },
      );
    }
    journeys.push({
      id: 'navigation-tour',
      name: 'Visit all routes without errors',
      persona,
      required: true,
      steps: navSteps,
    });
  }

  return journeys;
}
