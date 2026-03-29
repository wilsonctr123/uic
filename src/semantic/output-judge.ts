import type { ValidationResult } from '../config/types.js';

const DEFAULT_ERROR_PATTERNS = [
  'error',
  'failed',
  'exception',
  'unavailable',
  'timeout',
  '500',
  '404',
  'denied',
  'forbidden',
];

/**
 * Generate Playwright assertion code for output validation.
 * Returns TypeScript code that checks the output isn't an error.
 */
export function generateOutputValidation(
  outputSelector: string,
  customErrorPatterns?: string[],
  indent: string = '    ',
): string {
  const allPatterns = [...DEFAULT_ERROR_PATTERNS];
  if (customErrorPatterns) {
    allPatterns.push(...customErrorPatterns);
  }

  const patternRegex = allPatterns.join('|');
  const escapedSelector = outputSelector.replace(/'/g, "\\'");

  const lines = [
    `${indent}// Heuristic validation: check output isn't an error`,
    `${indent}const outputText = await page.locator('${escapedSelector}').last().textContent();`,
    `${indent}expect(outputText).toBeTruthy();`,
    `${indent}expect(outputText).not.toMatch(/${patternRegex}/i);`,
    `${indent}expect(outputText!.length).toBeGreaterThan(5);`,
  ];

  return lines.join('\n');
}

/**
 * Generate code that checks the page for common error indicators:
 * - Elements with [role="alert"]
 * - Elements with .error classes
 * - HTTP status indicators in the page content
 */
export function generateErrorDetectionCode(indent: string = '    '): string {
  const lines = [
    `${indent}// Error detection: check for alert roles, error classes, and HTTP status indicators`,
    `${indent}const alertElements = await page.locator('[role="alert"]').all();`,
    `${indent}for (const alert of alertElements) {`,
    `${indent}  const alertText = await alert.textContent();`,
    `${indent}  expect(alertText).not.toMatch(/error|failed|exception/i);`,
    `${indent}}`,
    `${indent}`,
    `${indent}const errorElements = await page.locator('.error, .error-message, .error-text').all();`,
    `${indent}expect(errorElements.length).toBe(0);`,
    `${indent}`,
    `${indent}// Check for HTTP error status codes in visible page text`,
    `${indent}const bodyText = await page.locator('body').textContent();`,
    `${indent}expect(bodyText).not.toMatch(/\\b(500 Internal Server Error|404 Not Found|403 Forbidden)\\b/);`,
  ];

  return lines.join('\n');
}
