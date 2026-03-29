/**
 * UIC Intelligence Layer — Scenario Planner
 *
 * Takes AppUnderstanding + UIInventory and generates intelligent test scenarios
 * WITHOUT using an LLM. Uses heuristic reasoning based on the app understanding
 * to produce scenarios that verify the app fulfills its PURPOSE, not just that
 * it renders.
 *
 * Key principles:
 * - NO LLM calls — pure heuristic reasoning from app understanding data
 * - Scenarios derive inputs from understanding.dataModel.sampleData when available
 * - AI features get 30s timeouts; forms get 5s
 * - Each scenario has a reasoning field explaining WHY this test exists
 * - Quality checks are specific to the feature type
 */

import type {
  AppUnderstanding,
  TestScenario,
  Scenario,
  ScenarioStep,
  QualityCheck,
  FeatureMap,
  AiFeature,
} from './types.js';
import type { UIInventory, DiscoveredElement } from '../config/types.js';
import type { LLMClient } from './llm-client.js';
import type { LLMCache } from './llm-cache.js';

// ── Public API ─────────────────────────────────────────────

export function generateTestScenarios(
  understanding: AppUnderstanding,
  inventory: UIInventory,
): TestScenario[] {
  const scenarios: TestScenario[] = [];

  for (const feature of understanding.features) {
    const routeInventory = inventory.routes.find((r) => r.path === feature.route);
    if (!routeInventory) continue;

    const scenario: TestScenario = {
      feature: feature.pageName,
      route: feature.route,
      purpose: feature.purpose,
      scenarios: [],
    };

    // Generate scenarios based on feature type
    if (feature.isAiFeature) {
      const aiFeature = understanding.aiFeatures.find((af) => af.route === feature.route);
      scenario.scenarios.push(
        ...generateAiFeatureScenarios(feature, understanding, aiFeature),
      );
    }

    // Form-based features (settings, import, etc.)
    const formElements = routeInventory.elements.filter(
      (e) =>
        e.classification === 'text-input' ||
        e.classification === 'textarea' ||
        e.classification === 'select' ||
        e.classification === 'email-input' ||
        e.classification === 'date-input',
    );
    if (formElements.length > 0) {
      scenario.scenarios.push(
        ...generateFormScenarios(feature, formElements, understanding),
      );
    }

    // Search features
    if (
      feature.purpose.toLowerCase().includes('search') ||
      routeInventory.elements.some((e) =>
        e.placeholder?.toLowerCase().includes('search'),
      )
    ) {
      scenario.scenarios.push(...generateSearchScenarios(feature, understanding));
    }

    // Navigation/CRUD features
    if (
      feature.purpose.toLowerCase().includes('task') ||
      feature.purpose.toLowerCase().includes('list') ||
      feature.purpose.toLowerCase().includes('crud') ||
      feature.purpose.toLowerCase().includes('manage')
    ) {
      scenario.scenarios.push(...generateCrudScenarios(feature, understanding));
    }

    // Auth-related pages
    if (
      feature.route.includes('login') ||
      feature.route.includes('password') ||
      feature.route.includes('signup') ||
      feature.route.includes('register')
    ) {
      scenario.scenarios.push(...generateAuthScenarios(feature));
    }

    // Always add a smoke test
    scenario.scenarios.push(generateSmokeScenario(feature));

    scenarios.push(scenario);
  }

  return scenarios;
}

// ── AI Feature Scenarios ────────────────────────────────────

function generateAiFeatureScenarios(
  feature: FeatureMap,
  understanding: AppUnderstanding,
  aiFeature?: AiFeature,
): Scenario[] {
  const scenarios: Scenario[] = [];
  const routeSlug = slugify(feature.route);

  // Derive real queries from the app's data model
  const sampleQueries = deriveSampleQueries(understanding);
  const primaryQuery = sampleQueries[0] || 'What are the most important items?';
  const secondaryQuery = sampleQueries[1] || 'Show me recent activity';

  // Extract keywords from sample data for relevance checks
  const relevanceKeywords = deriveRelevanceKeywords(understanding);
  const relevancePattern = relevanceKeywords.length > 0
    ? relevanceKeywords.slice(0, 5).join('|')
    : 'result|found|answer';

  // 1. Core query scenario — uses REAL data from the app's data model
  scenarios.push({
    id: `${routeSlug}-core-query`,
    name: `Query with data-derived input`,
    reasoning:
      `The app's data model contains ${describeDataModel(understanding)}. ` +
      `This tests the core AI feature with a query that should match real data, ` +
      `verifying the response references actual content rather than generic output.`,
    priority: 'critical',
    steps: [
      { action: 'goto', target: feature.route, description: `Navigate to ${feature.pageName}` },
      ...findAndFillChatInput(feature, primaryQuery),
      ...submitAndWait(feature, 30000),
    ],
    expectedBehavior: `Response should reference content related to "${primaryQuery}" from the app's data`,
    qualityChecks: [
      {
        type: 'relevance',
        description: `Response should contain keywords related to the query`,
        assertion: `expect(text).toMatch(/${relevancePattern}/i)`,
      },
      {
        type: 'content-length',
        description: 'Response should be substantive, not empty or trivially short',
        assertion: 'expect(text.length).toBeGreaterThan(50)',
      },
      {
        type: 'no-error',
        description: 'Response should not contain error messages',
        assertion: "expect(text).not.toMatch(/error|exception|failed to|something went wrong/i)",
      },
    ],
    timeout: 30000,
    prerequisites: [],
  });

  // 2. Test different modes if available
  const modes = aiFeature?.modes || [];
  if (modes.length >= 2) {
    scenarios.push({
      id: `${routeSlug}-mode-comparison`,
      name: `Compare ${modes[0]} vs ${modes[1]} modes`,
      reasoning:
        `The AI feature has ${modes.length} modes (${modes.join(', ')}). ` +
        `Different modes should produce meaningfully different outputs. ` +
        `This verifies mode selection works and affects the response.`,
      priority: 'high',
      steps: [
        { action: 'goto', target: feature.route, description: `Navigate to ${feature.pageName}` },
        // Select the second mode (first is usually default)
        {
          action: 'click',
          target: modes[1],
          description: `Switch to ${modes[1]} mode`,
          value: modes[1],
        },
        ...findAndFillChatInput(feature, secondaryQuery),
        ...submitAndWait(feature, 30000),
      ],
      expectedBehavior: `${modes[1]} mode should produce a response — possibly more detailed or structured than ${modes[0]}`,
      qualityChecks: [
        {
          type: 'relevance',
          description: `${modes[1]} mode response should be relevant to the query`,
          assertion: `expect(text).toMatch(/${relevancePattern}/i)`,
        },
        {
          type: 'content-length',
          description: `${modes[1]} mode should produce substantive output`,
          assertion: 'expect(text.length).toBeGreaterThan(50)',
        },
      ],
      timeout: 30000,
      prerequisites: [],
    });
  }

  // 3. Check output quality — citations/sources
  if (aiFeature?.qualityCriteria?.some((c) => /citation|source|reference/i.test(c))) {
    scenarios.push({
      id: `${routeSlug}-citations`,
      name: 'Verify response includes citations or sources',
      reasoning:
        `The AI feature's quality criteria include citations/sources. ` +
        `This verifies the response doesn't just answer but also shows where the answer came from.`,
      priority: 'high',
      steps: [
        { action: 'goto', target: feature.route, description: `Navigate to ${feature.pageName}` },
        ...findAndFillChatInput(feature, primaryQuery),
        ...submitAndWait(feature, 30000),
      ],
      expectedBehavior: 'Response should include source citations or references to original content',
      qualityChecks: [
        {
          type: 'citations',
          description: 'Response should contain citation markers or source references',
          assertion: "expect(text).toMatch(/source|citation|from:|subject:|reference|\\[\\d+\\]/i)",
        },
        {
          type: 'relevance',
          description: 'Citations should relate to the query topic',
          assertion: `expect(text).toMatch(/${relevancePattern}/i)`,
        },
      ],
      timeout: 30000,
      prerequisites: [],
    });
  }

  // 4. Edge case: empty query
  scenarios.push({
    id: `${routeSlug}-empty-query`,
    name: 'Handle empty query gracefully',
    reasoning:
      'Users may accidentally submit without typing. The app should not crash or show ' +
      'a raw error — it should show a helpful message or prevent submission.',
    priority: 'medium',
    steps: [
      { action: 'goto', target: feature.route, description: `Navigate to ${feature.pageName}` },
      ...findAndFillChatInput(feature, ''),
      {
        action: 'click',
        target: 'button[type="submit"], button:has-text("Send"), button:has-text("Ask"), button:has-text("Submit")',
        description: 'Attempt to submit empty query',
      },
      { action: 'wait', description: 'Wait for any response or validation', timeout: 3000 },
    ],
    expectedBehavior: 'Should either prevent submission, show validation message, or handle gracefully',
    qualityChecks: [
      {
        type: 'no-error',
        description: 'No unhandled errors from empty submission',
        assertion: "expect(text).not.toMatch(/unhandled|uncaught|500|internal server/i)",
      },
    ],
    timeout: 5000,
    prerequisites: [],
  });

  // 5. Edge case: very long query
  const longQuery =
    'Please analyze all the emails from the past quarter regarding budget discussions, ' +
    'engineering hiring plans, product roadmap changes, and any patent filings that were ' +
    'discussed in team meetings. Include a summary of action items and deadlines mentioned ' +
    'in each thread, cross-referencing with calendar events and task assignments. ' +
    'Also note any conflicting information between different email threads.';

  scenarios.push({
    id: `${routeSlug}-long-query`,
    name: 'Handle long, complex query',
    reasoning:
      'Real users write detailed, multi-part queries. This tests whether the AI feature ' +
      'can handle a substantive query without truncation errors or timeouts.',
    priority: 'medium',
    steps: [
      { action: 'goto', target: feature.route, description: `Navigate to ${feature.pageName}` },
      ...findAndFillChatInput(feature, longQuery),
      ...submitAndWait(feature, 30000),
    ],
    expectedBehavior: 'Should produce a coherent response addressing at least part of the complex query',
    qualityChecks: [
      {
        type: 'content-length',
        description: 'Complex query should produce a detailed response',
        assertion: 'expect(text.length).toBeGreaterThan(100)',
      },
      {
        type: 'no-error',
        description: 'No errors from long input',
        assertion: "expect(text).not.toMatch(/error|too long|exceeded|limit/i)",
      },
    ],
    timeout: 30000,
    prerequisites: [],
  });

  // 6. Test for non-existent data (graceful empty response)
  scenarios.push({
    id: `${routeSlug}-no-results`,
    name: 'Query about non-existent data',
    reasoning:
      'When a user asks about something not in the corpus, the app should respond gracefully ' +
      "rather than hallucinating. This tests the system's ability to say 'I don't know'.",
    priority: 'high',
    steps: [
      { action: 'goto', target: feature.route, description: `Navigate to ${feature.pageName}` },
      ...findAndFillChatInput(feature, 'What is the recipe for chocolate souffle?'),
      ...submitAndWait(feature, 30000),
    ],
    expectedBehavior: 'Should indicate no relevant data found or give a graceful empty response',
    qualityChecks: [
      {
        type: 'no-error',
        description: 'Should not crash when no results found',
        assertion: "expect(text).not.toMatch(/error|exception|failed/i)",
      },
      {
        type: 'content-length',
        description: 'Should produce some response (even if acknowledging no results)',
        assertion: 'expect(text.length).toBeGreaterThan(10)',
      },
    ],
    timeout: 30000,
    prerequisites: [],
  });

  return scenarios;
}

// ── Form Scenarios ──────────────────────────────────────────

function generateFormScenarios(
  feature: FeatureMap,
  formElements: DiscoveredElement[],
  understanding: AppUnderstanding,
): Scenario[] {
  const scenarios: Scenario[] = [];
  const routeSlug = slugify(feature.route);

  // 1. Fill with realistic data and submit
  const fillSteps: ScenarioStep[] = [
    { action: 'goto', target: feature.route, description: `Navigate to ${feature.pageName}` },
  ];

  for (const el of formElements) {
    const value = deriveRealisticValue(el, understanding);
    const target = bestSelector(el);
    fillSteps.push({
      action: 'fill',
      target,
      value,
      description: `Fill ${el.label || el.placeholder || el.classification} with "${value}"`,
    });
  }

  scenarios.push({
    id: `${routeSlug}-form-happy-path`,
    name: `Fill and submit ${feature.pageName} form`,
    reasoning:
      `This page has ${formElements.length} form fields. ` +
      `Testing the happy path with realistic data verifies the form accepts valid input ` +
      `and produces a success confirmation.`,
    priority: 'high',
    steps: [
      ...fillSteps,
      {
        action: 'click',
        target: 'button[type="submit"], button:has-text("Save"), button:has-text("Submit"), button:has-text("Create"), button:has-text("Update")',
        description: 'Submit the form',
      },
      { action: 'wait', description: 'Wait for submission response', timeout: 5000 },
    ],
    expectedBehavior: 'Form should submit successfully and show a confirmation or redirect',
    qualityChecks: [
      {
        type: 'no-error',
        description: 'No errors after form submission',
        assertion: "expect(text).not.toMatch(/error|failed|invalid/i)",
      },
    ],
    timeout: 5000,
    prerequisites: [],
  });

  // 2. Validation tests — test with invalid data
  const passwordFields = formElements.filter(
    (e) => e.classification === 'password-input' ||
      (e.placeholder || '').toLowerCase().includes('password') ||
      (e.label || '').toLowerCase().includes('password'),
  );

  const emailFields = formElements.filter(
    (e) => e.classification === 'email-input' ||
      (e.placeholder || '').toLowerCase().includes('email') ||
      (e.label || '').toLowerCase().includes('email'),
  );

  // Short password validation
  if (passwordFields.length > 0) {
    scenarios.push({
      id: `${routeSlug}-short-password`,
      name: 'Reject short password',
      reasoning:
        'Password fields should enforce minimum length. Submitting a very short password ' +
        'should trigger a validation error, not silently succeed.',
      priority: 'medium',
      steps: [
        { action: 'goto', target: feature.route, description: `Navigate to ${feature.pageName}` },
        ...fillFormExcept(formElements, passwordFields[0], 'ab', understanding),
        {
          action: 'click',
          target: 'button[type="submit"], button:has-text("Save"), button:has-text("Submit")',
          description: 'Submit with short password',
        },
        { action: 'wait', description: 'Wait for validation', timeout: 3000 },
      ],
      expectedBehavior: 'Should show password validation error',
      qualityChecks: [
        {
          type: 'relevance',
          description: 'Should show a password-related error or remain on the form',
          assertion: "expect(text).toMatch(/password|short|minimum|weak|invalid|error|required/i)",
        },
      ],
      timeout: 5000,
      prerequisites: [],
    });
  }

  // Mismatched passwords
  if (passwordFields.length >= 2) {
    scenarios.push({
      id: `${routeSlug}-mismatched-passwords`,
      name: 'Reject mismatched passwords',
      reasoning:
        'Two password fields suggest a password + confirm pattern. Entering different values ' +
        'should trigger a mismatch error.',
      priority: 'medium',
      steps: [
        { action: 'goto', target: feature.route, description: `Navigate to ${feature.pageName}` },
        {
          action: 'fill',
          target: bestSelector(passwordFields[0]),
          value: 'SecurePassword123!',
          description: 'Fill password field',
        },
        {
          action: 'fill',
          target: bestSelector(passwordFields[1]),
          value: 'DifferentPassword456!',
          description: 'Fill confirm password with different value',
        },
        {
          action: 'click',
          target: 'button[type="submit"], button:has-text("Save"), button:has-text("Submit")',
          description: 'Submit with mismatched passwords',
        },
        { action: 'wait', description: 'Wait for validation', timeout: 3000 },
      ],
      expectedBehavior: 'Should show password mismatch error',
      qualityChecks: [
        {
          type: 'relevance',
          description: 'Should show mismatch or confirmation error',
          assertion: "expect(text).toMatch(/match|confirm|mismatch|different|error/i)",
        },
      ],
      timeout: 5000,
      prerequisites: [],
    });
  }

  // Empty required fields
  scenarios.push({
    id: `${routeSlug}-empty-required`,
    name: 'Reject empty required fields',
    reasoning:
      'Submitting a form with all fields empty should trigger required field validation, ' +
      'not silently succeed or crash.',
    priority: 'medium',
    steps: [
      { action: 'goto', target: feature.route, description: `Navigate to ${feature.pageName}` },
      {
        action: 'click',
        target: 'button[type="submit"], button:has-text("Save"), button:has-text("Submit")',
        description: 'Submit without filling any fields',
      },
      { action: 'wait', description: 'Wait for validation', timeout: 3000 },
    ],
    expectedBehavior: 'Should show required field errors or prevent submission',
    qualityChecks: [
      {
        type: 'no-error',
        description: 'Should not crash on empty submission',
        assertion: "expect(text).not.toMatch(/unhandled|uncaught|500|internal server/i)",
      },
    ],
    timeout: 5000,
    prerequisites: [],
  });

  return scenarios;
}

// ── Search Scenarios ────────────────────────────────────────

function generateSearchScenarios(
  feature: FeatureMap,
  understanding: AppUnderstanding,
): Scenario[] {
  const scenarios: Scenario[] = [];
  const routeSlug = slugify(feature.route);

  // Derive search terms from the app's actual data
  const sampleTerms = deriveSampleSearchTerms(understanding);
  const existingTerm = sampleTerms[0] || 'budget';
  const relevanceKeywords = deriveRelevanceKeywords(understanding);
  const relevancePattern = relevanceKeywords.length > 0
    ? relevanceKeywords.slice(0, 5).join('|')
    : existingTerm;

  // 1. Search for term that exists in seed data
  scenarios.push({
    id: `${routeSlug}-search-existing`,
    name: `Search for "${existingTerm}" (exists in data)`,
    reasoning:
      `The app's data contains content related to "${existingTerm}". ` +
      `Searching for this term should return results, verifying the search feature works ` +
      `with real data.`,
    priority: 'critical',
    steps: [
      { action: 'goto', target: feature.route, description: `Navigate to ${feature.pageName}` },
      {
        action: 'fill',
        target: 'input[type="search"], input[placeholder*="search" i], input[placeholder*="find" i], input[role="searchbox"]',
        value: existingTerm,
        description: `Type "${existingTerm}" in search`,
      },
      {
        action: 'press',
        target: 'Enter',
        description: 'Submit search',
      },
      { action: 'wait', description: 'Wait for search results', timeout: 10000 },
    ],
    expectedBehavior: `Search results should contain items related to "${existingTerm}"`,
    qualityChecks: [
      {
        type: 'relevance',
        description: `Results should contain content related to "${existingTerm}"`,
        assertion: `expect(text).toMatch(/${relevancePattern}/i)`,
      },
      {
        type: 'content-length',
        description: 'Results should have substantive content',
        assertion: 'expect(text.length).toBeGreaterThan(20)',
      },
    ],
    timeout: 10000,
    prerequisites: [],
  });

  // 2. Search for term that doesn't exist
  scenarios.push({
    id: `${routeSlug}-search-no-results`,
    name: 'Search for non-existent term',
    reasoning:
      'Searching for a term with no matches should show an empty state or "no results" ' +
      'message, not crash or show stale data.',
    priority: 'high',
    steps: [
      { action: 'goto', target: feature.route, description: `Navigate to ${feature.pageName}` },
      {
        action: 'fill',
        target: 'input[type="search"], input[placeholder*="search" i], input[placeholder*="find" i], input[role="searchbox"]',
        value: 'xyznonexistent12345',
        description: 'Type a term with no matches',
      },
      {
        action: 'press',
        target: 'Enter',
        description: 'Submit search',
      },
      { action: 'wait', description: 'Wait for empty results', timeout: 5000 },
    ],
    expectedBehavior: 'Should show empty state or "no results" message',
    qualityChecks: [
      {
        type: 'no-error',
        description: 'Should not error on empty results',
        assertion: "expect(text).not.toMatch(/error|exception|failed/i)",
      },
    ],
    timeout: 5000,
    prerequisites: [],
  });

  // 3. Search modes (if the feature has multiple search modes)
  if (feature.keyElements.some((k) => /mode|filter|type/i.test(k))) {
    scenarios.push({
      id: `${routeSlug}-search-mode-switch`,
      name: 'Switch search mode and re-search',
      reasoning:
        'The search feature has multiple modes or filters. Switching modes should ' +
        'update results appropriately.',
      priority: 'medium',
      steps: [
        { action: 'goto', target: feature.route, description: `Navigate to ${feature.pageName}` },
        {
          action: 'fill',
          target: 'input[type="search"], input[placeholder*="search" i], input[role="searchbox"]',
          value: existingTerm,
          description: `Type "${existingTerm}" in search`,
        },
        {
          action: 'press',
          target: 'Enter',
          description: 'Submit initial search',
        },
        { action: 'wait', description: 'Wait for initial results', timeout: 10000 },
        {
          action: 'click',
          target: 'button:has-text("mode"), button:has-text("filter"), select, [role="tab"]',
          description: 'Switch search mode or apply filter',
        },
        { action: 'wait', description: 'Wait for updated results', timeout: 5000 },
      ],
      expectedBehavior: 'Results should update after mode switch',
      qualityChecks: [
        {
          type: 'no-error',
          description: 'Mode switch should not produce errors',
          assertion: "expect(text).not.toMatch(/error|exception|failed/i)",
        },
      ],
      timeout: 15000,
      prerequisites: [],
    });
  }

  return scenarios;
}

// ── CRUD Scenarios ──────────────────────────────────────────

function generateCrudScenarios(
  feature: FeatureMap,
  understanding: AppUnderstanding,
): Scenario[] {
  const scenarios: Scenario[] = [];
  const routeSlug = slugify(feature.route);

  // Derive a realistic item name from the data model
  const entityNames = understanding.dataModel.entities.map((e) => e.name.toLowerCase());
  const primaryEntity = entityNames[0] || 'item';

  // 1. Create a new item
  scenarios.push({
    id: `${routeSlug}-create-item`,
    name: `Create a new ${primaryEntity}`,
    reasoning:
      `This page manages ${primaryEntity}s. Creating a new one tests the core CRUD ` +
      `functionality and verifies the item appears in the list afterward.`,
    priority: 'high',
    steps: [
      { action: 'goto', target: feature.route, description: `Navigate to ${feature.pageName}` },
      {
        action: 'click',
        target: 'button:has-text("New"), button:has-text("Create"), button:has-text("Add"), button:has-text("+")',
        description: `Click to create new ${primaryEntity}`,
      },
      { action: 'wait', description: 'Wait for creation form/dialog', timeout: 3000 },
      {
        action: 'fill',
        target: 'input[type="text"], input[placeholder*="title" i], input[placeholder*="name" i], textarea',
        value: `Test ${primaryEntity} ${Date.now()}`,
        description: `Enter ${primaryEntity} details`,
      },
      {
        action: 'click',
        target: 'button[type="submit"], button:has-text("Save"), button:has-text("Create"), button:has-text("Add")',
        description: 'Submit creation',
      },
      { action: 'wait', description: 'Wait for confirmation', timeout: 5000 },
    ],
    expectedBehavior: `New ${primaryEntity} should appear in the list`,
    qualityChecks: [
      {
        type: 'no-error',
        description: 'Creation should not produce errors',
        assertion: "expect(text).not.toMatch(/error|failed/i)",
      },
    ],
    timeout: 10000,
    prerequisites: [],
  });

  // 2. List loads with existing data
  scenarios.push({
    id: `${routeSlug}-list-loads`,
    name: `${feature.pageName} list loads with data`,
    reasoning:
      `Verifying the list page loads and displays existing ${primaryEntity}s. ` +
      `This is a baseline check that the data layer is connected.`,
    priority: 'critical',
    steps: [
      { action: 'goto', target: feature.route, description: `Navigate to ${feature.pageName}` },
      { action: 'wait', description: 'Wait for list to populate', timeout: 5000 },
    ],
    expectedBehavior: `Should display a list of ${primaryEntity}s`,
    qualityChecks: [
      {
        type: 'content-length',
        description: 'Page should have substantive content (list items)',
        assertion: 'expect(text.length).toBeGreaterThan(50)',
      },
      {
        type: 'no-error',
        description: 'List should load without errors',
        assertion: "expect(text).not.toMatch(/error|failed to load|no data/i)",
      },
    ],
    timeout: 5000,
    prerequisites: [],
  });

  return scenarios;
}

// ── Auth Scenarios ──────────────────────────────────────────

function generateAuthScenarios(feature: FeatureMap): Scenario[] {
  const scenarios: Scenario[] = [];
  const routeSlug = slugify(feature.route);
  const isLogin = feature.route.includes('login') || feature.route.includes('signin');
  const isSignup = feature.route.includes('signup') || feature.route.includes('register');
  const isPasswordReset = feature.route.includes('password') || feature.route.includes('reset');

  if (isLogin) {
    // Valid login
    scenarios.push({
      id: `${routeSlug}-valid-login`,
      name: 'Login with valid credentials',
      reasoning:
        'The login page is the gateway to the app. Testing with valid credentials ensures ' +
        'the authentication flow works end-to-end.',
      priority: 'critical',
      steps: [
        { action: 'goto', target: feature.route, description: 'Navigate to login page' },
        {
          action: 'fill',
          target: 'input[type="email"], input[name="email"], input[placeholder*="email" i]',
          value: '${TEST_USER_EMAIL}',
          description: 'Enter email',
        },
        {
          action: 'fill',
          target: 'input[type="password"], input[name="password"]',
          value: '${TEST_USER_PASSWORD}',
          description: 'Enter password',
        },
        {
          action: 'click',
          target: 'button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")',
          description: 'Click login',
        },
        { action: 'wait', description: 'Wait for redirect', timeout: 8000 },
      ],
      expectedBehavior: 'Should redirect away from login page to the main app',
      qualityChecks: [
        {
          type: 'no-error',
          description: 'Login should not produce errors',
          assertion: "expect(text).not.toMatch(/invalid|incorrect|failed/i)",
        },
      ],
      timeout: 10000,
      prerequisites: [],
    });

    // Invalid login
    scenarios.push({
      id: `${routeSlug}-invalid-login`,
      name: 'Login with invalid credentials',
      reasoning:
        'Invalid credentials should show a clear error message, not crash or expose ' +
        'system information.',
      priority: 'high',
      steps: [
        { action: 'goto', target: feature.route, description: 'Navigate to login page' },
        {
          action: 'fill',
          target: 'input[type="email"], input[name="email"], input[placeholder*="email" i]',
          value: 'nonexistent@example.com',
          description: 'Enter invalid email',
        },
        {
          action: 'fill',
          target: 'input[type="password"], input[name="password"]',
          value: 'WrongPassword123!',
          description: 'Enter wrong password',
        },
        {
          action: 'click',
          target: 'button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")',
          description: 'Click login',
        },
        { action: 'wait', description: 'Wait for error message', timeout: 5000 },
      ],
      expectedBehavior: 'Should show an authentication error message',
      qualityChecks: [
        {
          type: 'relevance',
          description: 'Should show an auth error (not a system error)',
          assertion: "expect(text).toMatch(/invalid|incorrect|wrong|unauthorized|error|failed/i)",
        },
        {
          type: 'no-error',
          description: 'Should not expose system errors or stack traces',
          assertion: "expect(text).not.toMatch(/traceback|stack|exception|500/i)",
        },
      ],
      timeout: 5000,
      prerequisites: [],
    });
  }

  if (isSignup) {
    scenarios.push({
      id: `${routeSlug}-signup-validation`,
      name: 'Signup form validation',
      reasoning:
        'The signup form should enforce basic validation (email format, password strength) ' +
        'before allowing account creation.',
      priority: 'high',
      steps: [
        { action: 'goto', target: feature.route, description: 'Navigate to signup page' },
        {
          action: 'fill',
          target: 'input[type="email"], input[name="email"]',
          value: 'not-an-email',
          description: 'Enter invalid email format',
        },
        {
          action: 'fill',
          target: 'input[type="password"], input[name="password"]',
          value: 'ab',
          description: 'Enter too-short password',
        },
        {
          action: 'click',
          target: 'button[type="submit"], button:has-text("Sign up"), button:has-text("Create")',
          description: 'Attempt to sign up',
        },
        { action: 'wait', description: 'Wait for validation', timeout: 3000 },
      ],
      expectedBehavior: 'Should show validation errors for email and password',
      qualityChecks: [
        {
          type: 'relevance',
          description: 'Should show validation errors',
          assertion: "expect(text).toMatch(/invalid|email|password|short|weak|error|required/i)",
        },
      ],
      timeout: 5000,
      prerequisites: [],
    });
  }

  if (isPasswordReset) {
    scenarios.push({
      id: `${routeSlug}-password-reset-flow`,
      name: 'Password reset form works',
      reasoning:
        'The password reset page should accept an email and show a confirmation, ' +
        'verifying the form flow works even if we cannot test the actual email delivery.',
      priority: 'medium',
      steps: [
        { action: 'goto', target: feature.route, description: 'Navigate to password reset' },
        {
          action: 'fill',
          target: 'input[type="email"], input[name="email"]',
          value: 'test@example.com',
          description: 'Enter email for password reset',
        },
        {
          action: 'click',
          target: 'button[type="submit"], button:has-text("Reset"), button:has-text("Send")',
          description: 'Submit reset request',
        },
        { action: 'wait', description: 'Wait for confirmation', timeout: 5000 },
      ],
      expectedBehavior: 'Should show a confirmation that reset email was sent',
      qualityChecks: [
        {
          type: 'no-error',
          description: 'Reset flow should not error',
          assertion: "expect(text).not.toMatch(/error|failed|500/i)",
        },
      ],
      timeout: 5000,
      prerequisites: [],
    });
  }

  return scenarios;
}

// ── Smoke Scenario ──────────────────────────────────────────

function generateSmokeScenario(feature: FeatureMap): Scenario {
  return {
    id: `${slugify(feature.route)}-smoke`,
    name: `${feature.pageName} loads without errors`,
    reasoning:
      `Baseline smoke test: verify ${feature.pageName} (${feature.route}) loads, ` +
      `renders visible content, and has no console errors or failed network requests.`,
    priority: 'critical',
    steps: [
      { action: 'goto', target: feature.route, description: `Navigate to ${feature.pageName}` },
      {
        action: 'assert-visible',
        target: 'body',
        description: 'Verify page body is visible',
      },
    ],
    expectedBehavior: 'Page loads with visible content and no errors',
    qualityChecks: [
      {
        type: 'no-error',
        description: 'No console errors or failed requests',
        assertion: "expect(text).not.toMatch(/error|exception|failed/i)",
      },
      {
        type: 'content-length',
        description: 'Page should have rendered content (not blank)',
        assertion: 'expect(text.length).toBeGreaterThan(10)',
      },
    ],
    timeout: 5000,
    prerequisites: [],
  };
}

// ── Helper Functions ────────────────────────────────────────

function slugify(route: string): string {
  return route.replace(/^\//, '').replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '') || 'home';
}

function bestSelector(el: DiscoveredElement): string {
  if (el.testId) return `[data-testid="${el.testId}"]`;
  if (el.role && el.label) return `[role="${el.role}"][aria-label="${el.label}"]`;
  if (el.placeholder) return `[placeholder="${el.placeholder}"]`;
  if (el.label) return `[aria-label="${el.label}"]`;
  return el.selector;
}

/** Derive realistic sample queries from the app's data model */
function deriveSampleQueries(understanding: AppUnderstanding): string[] {
  const queries: string[] = [];
  const { sampleData, entities, recordCounts } = understanding.dataModel;

  // Try to build queries from actual sample data
  for (const entity of entities) {
    const samples = sampleData[entity.tableName] || sampleData[entity.name.toLowerCase()];
    if (!samples || samples.length === 0) continue;

    const sample = samples[0];

    // Email entities
    if (/email|message/i.test(entity.name)) {
      if (sample.subject) {
        // Extract a topic keyword from the subject
        const topicWord = extractTopicWord(sample.subject);
        queries.push(`What emails discuss ${topicWord}?`);
      }
      if (sample.from_name || sample.from) {
        queries.push(`Show me emails from ${sample.from_name || sample.from}`);
      }
    }

    // Task/todo entities
    if (/task|todo|ticket/i.test(entity.name)) {
      queries.push('What are my open tasks and their deadlines?');
    }

    // Document/file entities
    if (/document|file|attachment/i.test(entity.name)) {
      if (sample.name || sample.title || sample.filename) {
        queries.push(`Find documents about ${extractTopicWord(sample.name || sample.title || sample.filename)}`);
      }
    }

    // Generic: use key fields to formulate a query
    if (queries.length === 0 && entity.keyFields.length > 0) {
      const fieldName = entity.keyFields[0];
      const value = sample[fieldName];
      if (typeof value === 'string' && value.length > 3) {
        queries.push(`Tell me about ${extractTopicWord(value)}`);
      }
    }
  }

  // Fallback: use the project goal to derive queries
  if (queries.length === 0 && understanding.projectGoal) {
    queries.push(`What is the most important information?`);
    queries.push(`Summarize recent activity`);
  }

  return queries;
}

/** Derive search terms from sample data */
function deriveSampleSearchTerms(understanding: AppUnderstanding): string[] {
  const terms: string[] = [];
  const { sampleData, entities } = understanding.dataModel;

  for (const entity of entities) {
    const samples = sampleData[entity.tableName] || sampleData[entity.name.toLowerCase()];
    if (!samples || samples.length === 0) continue;

    for (const sample of samples.slice(0, 3)) {
      if (sample.subject) terms.push(extractTopicWord(sample.subject));
      if (sample.title) terms.push(extractTopicWord(sample.title));
      if (sample.name && typeof sample.name === 'string') terms.push(extractTopicWord(sample.name));
    }
  }

  // Deduplicate and filter
  return [...new Set(terms.filter((t) => t.length > 2))];
}

/** Derive relevance keywords from sample data for assertion patterns */
function deriveRelevanceKeywords(understanding: AppUnderstanding): string[] {
  const keywords: string[] = [];
  const { sampleData, entities } = understanding.dataModel;

  for (const entity of entities) {
    const samples = sampleData[entity.tableName] || sampleData[entity.name.toLowerCase()];
    if (!samples || samples.length === 0) continue;

    for (const sample of samples.slice(0, 5)) {
      for (const field of ['subject', 'title', 'name', 'from_name', 'category', 'type']) {
        const val = sample[field];
        if (typeof val === 'string' && val.length > 2) {
          // Extract meaningful words (skip very common words)
          const words = val.split(/\s+/).filter(
            (w: string) => w.length > 3 && !/^(the|and|for|with|from|that|this|have|been)$/i.test(w),
          );
          keywords.push(...words.slice(0, 2));
        }
      }
    }
  }

  return [...new Set(keywords)].slice(0, 10);
}

/** Extract a meaningful topic word from a title/subject string */
function extractTopicWord(text: string): string {
  if (!text) return 'recent items';
  const words = text.split(/\s+/).filter(
    (w) => w.length > 3 && !/^(the|and|for|with|from|that|this|have|been|your|about|just)$/i.test(w),
  );
  // Return 1-3 meaningful words
  return words.slice(0, 3).join(' ') || text.slice(0, 30);
}

/** Describe the data model for reasoning strings */
function describeDataModel(understanding: AppUnderstanding): string {
  const parts: string[] = [];
  for (const [table, count] of Object.entries(understanding.dataModel.recordCounts)) {
    parts.push(`${count} ${table}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'application data';
}

/** Derive a realistic form value based on the element's metadata */
function deriveRealisticValue(
  el: DiscoveredElement,
  understanding: AppUnderstanding,
): string {
  const ph = (el.placeholder || '').toLowerCase();
  const label = (el.label || '').toLowerCase();
  const name = (el.name || '').toLowerCase();
  const combined = `${ph} ${label} ${name}`;

  if (el.classification === 'email-input' || combined.includes('email')) return 'test@example.com';
  if (el.classification === 'password-input' || combined.includes('password')) return 'SecurePassword123!';
  if (combined.includes('search') || combined.includes('query')) return deriveSampleSearchTerms(understanding)[0] || 'test search';
  if (combined.includes('title')) return 'Q4 Engineering Retrospective';
  if (combined.includes('name') && combined.includes('first')) return 'Jane';
  if (combined.includes('name') && combined.includes('last')) return 'Smith';
  if (combined.includes('name')) return 'Jane Smith';
  if (combined.includes('phone') || combined.includes('tel')) return '+1-555-0100';
  if (combined.includes('url') || combined.includes('link') || combined.includes('website')) return 'https://example.com';
  if (combined.includes('date')) return '2026-03-15';
  if (combined.includes('channel')) return '#engineering';
  if (combined.includes('description') || combined.includes('note') || el.classification === 'textarea') {
    return 'This is a detailed test entry with enough content to verify the form handles multi-line input correctly.';
  }
  if (combined.includes('address')) return '123 Main Street, Suite 100';
  if (combined.includes('zip') || combined.includes('postal')) return '94105';
  if (combined.includes('city')) return 'San Francisco';
  if (combined.includes('state')) return 'California';
  if (combined.includes('country')) return 'United States';
  if (combined.includes('company') || combined.includes('organization')) return 'Acme Corporation';
  if (combined.includes('amount') || combined.includes('price')) return '99.99';
  if (combined.includes('number') || combined.includes('count') || combined.includes('quantity')) return '42';

  // Default: use the placeholder or a reasonable generic value
  return el.placeholder || 'test input value';
}

/** Create fill steps for all form fields, overriding one specific field */
function fillFormExcept(
  formElements: DiscoveredElement[],
  overrideElement: DiscoveredElement,
  overrideValue: string,
  understanding: AppUnderstanding,
): ScenarioStep[] {
  const steps: ScenarioStep[] = [];
  for (const el of formElements) {
    const target = bestSelector(el);
    const value = el === overrideElement ? overrideValue : deriveRealisticValue(el, understanding);
    steps.push({
      action: 'fill',
      target,
      value,
      description: `Fill ${el.label || el.placeholder || el.classification} with "${value}"`,
    });
  }
  return steps;
}

/** Build steps to find and fill the chat/query input on an AI feature page */
function findAndFillChatInput(feature: FeatureMap, query: string): ScenarioStep[] {
  return [
    {
      action: 'fill',
      target: 'textarea, input[type="text"], input[placeholder*="ask" i], input[placeholder*="query" i], input[placeholder*="message" i], input[placeholder*="search" i]',
      value: query,
      description: query ? `Type query: "${query.slice(0, 60)}${query.length > 60 ? '...' : ''}"` : 'Leave input empty',
    },
  ];
}

/** Build steps to submit a chat query and wait for the AI response */
function submitAndWait(feature: FeatureMap, timeout: number): ScenarioStep[] {
  return [
    {
      action: 'press',
      target: 'Enter',
      description: 'Submit the query (Enter key)',
    },
    {
      action: 'wait',
      description: 'Wait for AI response to appear',
      timeout,
    },
  ];
}

// ── Claude-Powered Scenario Generation ────────────────────

/**
 * Generate test scenarios using Claude LLM for higher-quality reasoning.
 * Falls back to heuristic generation if LLM fails or returns nothing.
 */
export async function generateTestScenariosWithLLM(
  understanding: AppUnderstanding,
  inventory: UIInventory,
  llmClient: LLMClient,
  cache: LLMCache,
): Promise<TestScenario[]> {
  const allScenarios: TestScenario[] = [];

  for (const feature of understanding.features) {
    const routeInventory = inventory.routes.find(r => r.path === feature.route);
    if (!routeInventory) continue;

    const elements = routeInventory.elements.map(e =>
      `${e.type}: "${e.label || e.placeholder || e.selector}" (${e.role || 'no role'})`
    ).join('\n');

    const system = `You are a senior QA engineer writing test scenarios. Return a JSON array of scenarios.
Each scenario must have: id, name, reasoning, priority, steps[], expectedBehavior, qualityChecks[], timeout, prerequisites[].
Each step: { action: "goto"|"fill"|"click"|"press"|"wait"|"assert-visible"|"assert-text", target?: string, value?: string, description: string }
Each qualityCheck: { type: "relevance"|"completeness"|"citations"|"timing"|"no-error"|"content-length", description: string, assertion: string }

Rules:
- Test BUSINESS LOGIC, not just DOM state
- Use REAL inputs derived from the app's data, not "Hello" or "test"
- For AI features: test output QUALITY (is it relevant? complete? cited?)
- Include edge cases: empty input, very long input, nonexistent data
- Set timeout to 30000 for AI features, 5000 for forms`;

    const user = `## Feature: ${feature.pageName} (${feature.route})
Purpose: ${feature.purpose}
Expected: ${feature.expectedBehavior}
AI Feature: ${feature.isAiFeature ? 'Yes' : 'No'}
${feature.isAiFeature ? `AI Details: ${JSON.stringify(understanding.aiFeatures.find(a => a.route === feature.route))}` : ''}

## UI Elements on This Page
${elements}

## App Context
Project: ${understanding.projectGoal}
Data: ${JSON.stringify(understanding.dataModel.recordCounts)}
Sample: ${JSON.stringify(understanding.dataModel.sampleData).substring(0, 1000)}

Generate 5-8 test scenarios for this feature.`;

    const cacheKey = `scenarios:${feature.route}`;
    const cached = cache.get(system, user, cacheKey);

    let scenarios: Scenario[];
    if (cached) {
      try { scenarios = JSON.parse(cached); } catch { scenarios = []; }
    } else {
      try {
        const response = await llmClient.complete({ system, user, maxTokens: 4096, temperature: 0 });
        // Extract JSON array from response (Claude sometimes wraps in markdown)
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        scenarios = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
        cache.set(system, user, cacheKey, JSON.stringify(scenarios));
      } catch (err) {
        console.warn(`  Claude scenario gen failed for ${feature.route}, using heuristic`);
        scenarios = [];
      }
    }

    if (scenarios.length > 0) {
      allScenarios.push({ feature: feature.pageName, route: feature.route, purpose: feature.purpose, scenarios });
    }
  }

  // Fall back to heuristic for any features Claude didn't cover
  if (allScenarios.length === 0) {
    return generateTestScenarios(understanding, inventory);
  }

  return allScenarios;
}
