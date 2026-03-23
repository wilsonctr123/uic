/**
 * Widget Adapters
 *
 * Small opt-in adapters for widgets that need special treatment.
 * These handle cases where the generic primitive generator would
 * produce wrong assertions (e.g., Chip with inline styles, file input).
 */

import type { Affordance } from '../config/types.js';

/**
 * Returns custom test action code if the affordance matches a known
 * widget pattern, or null to use the generic generator.
 */
export function getWidgetAdapter(aff: Affordance): string | null {
  // ── Chip / filter buttons ──
  // Chips use inline styles, not CSS classes. Assert click doesn't crash.
  if (isFilterChip(aff)) {
    const locator = makeLocator(aff);
    return `    // Chip/filter: click and verify no crash (inline styles, not CSS class)\n` +
           `    await ${locator}.click();\n` +
           `    await expect(${locator}).toBeVisible();`;
  }

  // ── File upload via native input ──
  if (aff.elementType === 'file-input') {
    const locator = `page.locator('input[type="file"]').nth(${getFileInputIndex(aff)})`;
    const mimeType = aff.route === '/import' && aff.label?.includes('email')
      ? "'message/rfc822'" : "'text/plain'";
    const fileName = aff.route === '/import' ? "'test.eml'" : "'test-file.txt'";
    return `    // File upload via native input (not drag-drop)\n` +
           `    await ${locator}.setInputFiles({\n` +
           `      name: ${fileName},\n` +
           `      mimeType: ${mimeType},\n` +
           `      buffer: Buffer.from('From: test@test.com\\nSubject: Test\\n\\nBody'),\n` +
           `    });`;
  }

  // ── Chat/search input with Enter submit ──
  if (isChatOrSearchInput(aff)) {
    const locator = makeLocator(aff);
    return `    // Text input with Enter-to-submit behavior\n` +
           `    await ${locator}.fill('test query');\n` +
           `    await ${locator}.press('Enter');`;
  }

  // ── Select dropdown ──
  if (aff.elementType === 'select') {
    const locator = makeLocator(aff);
    return `    // Select dropdown: pick a different option\n` +
           `    const opts = await ${locator}.locator('option').allTextContents();\n` +
           `    if (opts.length > 1) await ${locator}.selectOption({ index: 1 });`;
  }

  return null; // use generic generator
}

// ── Helper: detect filter chips ──
function isFilterChip(aff: Affordance): boolean {
  if (aff.elementType !== 'button') return false;
  const label = (aff.label || '').toLowerCase();
  // Short labels that are typically filter chips
  const chipPatterns = [
    'hybrid', 'keyword', 'semantic',  // search mode
    'all', 'open', 'in progress', 'done',  // task status
    'all priorities', 'high', 'medium', 'low',  // task priority
    'ask', 'search', 'triage', 'agent',  // home mode
    'quick', 'deep think',  // depth mode
  ];
  return chipPatterns.some(p => label.includes(p)) || aff.oracle === 'attribute-changes';
}

// ── Helper: detect chat/search inputs ──
function isChatOrSearchInput(aff: Affordance): boolean {
  if (aff.elementType !== 'input' && aff.elementType !== 'textarea') return false;
  const ph = (aff.target.placeholder || '').toLowerCase();
  return ph.includes('ask') || ph.includes('search') || ph.includes('conversation');
}

// ── Helper: get file input index on route ──
function getFileInputIndex(aff: Affordance): number {
  // Default to first file input; could be smarter with route context
  return 0;
}

// ── Locator builder (shared logic with main generator) ──
function makeLocator(aff: Affordance): string {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Best: role + name
  if (aff.target.role && aff.target.name) {
    return `page.getByRole('${aff.target.role}', { name: /${escape(aff.target.name)}/i })`;
  }
  // Good: placeholder
  if (aff.target.placeholder) {
    return `page.getByPlaceholder(/${escape(aff.target.placeholder)}/i)`;
  }
  // Good: label text → role-based
  if (aff.label && aff.label.length > 1 && aff.label.length < 50) {
    if (aff.elementType === 'button') return `page.getByRole('button', { name: /${escape(aff.label)}/i })`;
    if (aff.elementType === 'link') return `page.getByRole('link', { name: /${escape(aff.label)}/i })`;
    return `page.getByText(/${escape(aff.label)}/i)`;
  }
  // Fallback with .first()
  return `page.locator('${aff.target.selector}').first()`;
}
