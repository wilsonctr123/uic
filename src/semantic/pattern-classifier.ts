/**
 * Pattern Classifier — classifies InteractionGroups into patterns
 * using heuristic score-based signals.
 */

import type {
  ElementGrouping,
  InteractionPattern,
  DiscoveredElement,
  DiscoveredRoute,
} from '../config/types.js';

type Confidence = 'high' | 'medium' | 'low';

interface ClassificationResult {
  pattern: InteractionPattern;
  confidence: Confidence;
}

/** Lookup elements by their selectors from the group */
function resolveMembers(
  group: ElementGrouping,
  elements: DiscoveredElement[],
): DiscoveredElement[] {
  const selectorSet = new Set(group.memberSelectors);
  return elements.filter((el) => selectorSet.has(el.selector));
}

/** Check if an element has a placeholder matching any of the given patterns */
function placeholderMatches(el: DiscoveredElement, patterns: RegExp): boolean {
  return (
    (el.placeholder !== undefined && patterns.test(el.placeholder)) ||
    (el.label !== undefined && patterns.test(el.label))
  );
}

/** Check if element text or label matches a pattern */
function textMatches(el: DiscoveredElement, pattern: RegExp): boolean {
  return (
    (el.text !== undefined && pattern.test(el.text)) ||
    (el.label !== undefined && pattern.test(el.label))
  );
}

// ── Scorer functions ────────────────────────────────────────

type ScorerFn = (
  group: ElementGrouping,
  members: DiscoveredElement[],
  route: DiscoveredRoute,
) => number;

const scoreChat: ScorerFn = (_group, members, route) => {
  let score = 0;
  const chatPlaceholder = /message|ask|chat|conversation/i;

  const hasTextInput = members.some(
    (el) =>
      (el.classification === 'textarea' || el.classification === 'text-input') &&
      placeholderMatches(el, chatPlaceholder),
  );
  if (hasTextInput) score += 0.3;

  const hasButton = members.some((el) => el.classification === 'button');
  if (hasButton) score += 0.3;

  const routeMatchesChat = /chat|message|conversation/i.test(route.path);
  if (routeMatchesChat) score += 0.3;

  return Math.min(score, 1.0);
};

const scoreSearch: ScorerFn = (_group, members, route) => {
  let score = 0;

  const hasSearchBox = members.some(
    (el) =>
      el.role === 'searchbox' ||
      el.classification === 'search-input' ||
      placeholderMatches(el, /search|find|query/i),
  );
  if (hasSearchBox) score += 0.4;

  const hasListOrTable = members.some(
    (el) => el.classification === 'table' || el.tag === 'ul' || el.tag === 'ol',
  );
  if (hasListOrTable) score += 0.4;

  // Bonus if route suggests search
  if (/search|find|query/i.test(route.path)) score += 0.2;

  return Math.min(score, 1.0);
};

const scoreFormSubmit: ScorerFn = (group, members, _route) => {
  let score = 0;

  // Container is a <form> — check the container selector
  if (/\bform\b/i.test(group.containerSelector)) score += 0.3;

  const inputs = members.filter(
    (el) =>
      el.classification === 'text-input' ||
      el.classification === 'email-input' ||
      el.classification === 'textarea' ||
      el.classification === 'select' ||
      el.classification === 'date-input' ||
      el.classification === 'checkbox',
  );
  if (inputs.length >= 2) score += 0.3;

  const hasSubmitButton = members.some(
    (el) =>
      el.classification === 'button' &&
      textMatches(el, /submit|save|create|send|confirm|update/i),
  );
  if (hasSubmitButton) score += 0.3;

  return Math.min(score, 1.0);
};

const scoreAuthFlow: ScorerFn = (_group, members, route) => {
  let score = 0;

  const hasPassword = members.some(
    (el) => el.classification === 'password-input',
  );
  if (hasPassword) score += 0.5;

  const routeMatchesAuth = /login|signin|sign-in|auth/i.test(route.path);
  if (routeMatchesAuth) score += 0.5;

  return Math.min(score, 1.0);
};

const scoreListFilter: ScorerFn = (_group, members, _route) => {
  let score = 0;

  const hasFilterControl = members.some(
    (el) => el.classification === 'select' || el.classification === 'checkbox',
  );
  if (hasFilterControl) score += 0.3;

  const hasListOrTable = members.some(
    (el) => el.classification === 'table' || el.tag === 'ul' || el.tag === 'ol',
  );
  if (hasListOrTable) score += 0.3;

  return Math.min(score, 1.0);
};

const scoreCrudCreate: ScorerFn = (group, members, _route) => {
  let score = 0;

  // Has a form-like container
  if (/\bform\b/i.test(group.containerSelector)) score += 0.2;

  const hasCreateButton = members.some(
    (el) =>
      el.classification === 'button' &&
      textMatches(el, /create|add|new/i),
  );
  if (hasCreateButton) score += 0.4;

  const inputs = members.filter(
    (el) =>
      el.classification === 'text-input' ||
      el.classification === 'email-input' ||
      el.classification === 'textarea',
  );
  if (inputs.length >= 1) score += 0.2;

  return Math.min(score, 1.0);
};

const scoreTogglePanel: ScorerFn = (_group, members, _route) => {
  let score = 0;

  const buttons = members.filter((el) => el.classification === 'button');
  const inputs = members.filter(
    (el) =>
      el.classification === 'text-input' ||
      el.classification === 'email-input' ||
      el.classification === 'textarea' ||
      el.classification === 'password-input' ||
      el.classification === 'search-input',
  );

  // Single button with no inputs
  if (buttons.length >= 1 && inputs.length === 0) score += 0.3;

  return Math.min(score, 1.0);
};

const scoreModalDialog: ScorerFn = (group, _members, _route) => {
  let score = 0;

  if (/\[role="dialog"\]|\brole="dialog"/i.test(group.containerSelector)) {
    score += 0.8;
  }

  return Math.min(score, 1.0);
};

const scorePagination: ScorerFn = (_group, members, _route) => {
  let score = 0;

  const hasPaginationButton = members.some(
    (el) =>
      el.classification === 'button' &&
      textMatches(el, /next|prev|previous|page\s*\d/i),
  );
  if (hasPaginationButton) score += 0.4;

  const hasMultiplePagButtons = members.filter(
    (el) =>
      el.classification === 'button' &&
      textMatches(el, /next|prev|previous|page|\d+/i),
  ).length >= 2;
  if (hasMultiplePagButtons) score += 0.4;

  return Math.min(score, 1.0);
};

const scoreWizard: ScorerFn = (_group, members, _route) => {
  let score = 0;

  const hasStepIndicator = members.some((el) =>
    textMatches(el, /step|next|continue|back|previous/i),
  );
  if (hasStepIndicator) score += 0.3;

  const inputs = members.filter(
    (el) =>
      el.classification === 'text-input' ||
      el.classification === 'email-input' ||
      el.classification === 'textarea' ||
      el.classification === 'select',
  );
  if (inputs.length >= 1) score += 0.3;

  const hasNextButton = members.some(
    (el) =>
      el.classification === 'button' &&
      textMatches(el, /next|continue|proceed/i),
  );
  if (hasNextButton) score += 0.3;

  return Math.min(score, 1.0);
};

/** Pattern scorers in priority order */
const PATTERN_SCORERS: Array<{ pattern: InteractionPattern; scorer: ScorerFn }> = [
  { pattern: 'modal-dialog', scorer: scoreModalDialog },
  { pattern: 'auth-flow', scorer: scoreAuthFlow },
  { pattern: 'chat', scorer: scoreChat },
  { pattern: 'search', scorer: scoreSearch },
  { pattern: 'form-submit', scorer: scoreFormSubmit },
  { pattern: 'crud-create', scorer: scoreCrudCreate },
  { pattern: 'pagination', scorer: scorePagination },
  { pattern: 'wizard', scorer: scoreWizard },
  { pattern: 'list-filter', scorer: scoreListFilter },
  { pattern: 'toggle-panel', scorer: scoreTogglePanel },
];

/**
 * Classifies an ElementGrouping into a recognized InteractionPattern.
 *
 * Runs all scorer functions and picks the highest scoring pattern.
 * Returns 'unknown' if no pattern scores >= 0.3.
 */
export function classifyPattern(
  group: ElementGrouping,
  elements: DiscoveredElement[],
  route: DiscoveredRoute,
): ClassificationResult {
  const members = resolveMembers(group, elements);

  let bestPattern: InteractionPattern = 'unknown';
  let bestScore = 0;

  for (const { pattern, scorer } of PATTERN_SCORERS) {
    const score = scorer(group, members, route);
    if (score > bestScore) {
      bestScore = score;
      bestPattern = pattern;
    }
  }

  // Threshold: must score >= 0.3 to be classified
  if (bestScore < 0.3) {
    return { pattern: 'unknown', confidence: 'low' };
  }

  // Determine confidence
  let confidence: Confidence;
  if (bestScore >= 0.7) {
    confidence = 'high';
  } else if (bestScore >= 0.4) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return { pattern: bestPattern, confidence };
}
