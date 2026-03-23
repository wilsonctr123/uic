# Project Configuration Guide

## Overview

UIC separates general tool behavior from project-specific details through
`uic.config.ts`. This file is the only thing a consumer needs to customize.

## Config Shape

```typescript
interface UicConfig {
  app: {
    name: string;           // Display name
    framework?: string;     // Auto-detected: react, vue, nextjs, etc.
    baseUrl: string;        // Where the app runs
    startCommand?: string;  // How to start dev server
    startTimeout?: number;  // Startup wait time (ms)
  };
  auth?: {
    strategy: 'storage-state' | 'ui-flow' | 'api-bootstrap' | 'custom';
    personas?: Record<string, PersonaConfig>;
    customHook?: string;    // Path to custom auth module
  };
  discovery: {
    seedRoutes: string[];   // Routes to crawl
    excludeRoutes?: string[]; // Routes to skip
    maxDepth?: number;      // Navigation depth (default: 3)
    waitAfterNavigation?: number; // Settle time (default: 1000ms)
    screenshots?: boolean;  // Capture screenshots (default: true)
  };
  contract?: {
    path?: string;          // Contract file path
    inventoryPath?: string; // Inventory file path
    reportPath?: string;    // Report file path
  };
  exclusions?: Array<{
    pattern: string;        // What to exclude
    reason: string;         // Why it's excluded
  }>;
}
```

## Environment Variables

String values in config support `${ENV_VAR}` interpolation:

```typescript
personas: {
  user: {
    email: '${TEST_USER_EMAIL}',    // Reads from environment
    password: '${TEST_USER_PASSWORD}',
  },
}
```

## Auth Strategies

### storage-state
Import pre-saved browser state (cookies, localStorage).
Best for: CI environments where auth state is prepared separately.

### ui-flow
Drive the login UI through Playwright, cache the resulting state.
Best for: Standard login forms. Automatically caches and reuses.

### api-bootstrap
Call a login API endpoint, inject the resulting session into the browser.
Best for: Apps with API-based auth (REST, GraphQL).

### custom
Provide your own auth module that exports an `authenticate` function.
Best for: SSO, MFA, OAuth, or anything non-standard.

## Exclusions

Use exclusions for routes or features that can't be meaningfully
tested through browser automation:

```typescript
exclusions: [
  { pattern: '/email/:id', reason: 'Dynamic route needs fixture data' },
  { pattern: 'WebSocket', reason: 'Requires running backend service' },
  { pattern: 'showDirectoryPicker', reason: 'Not supported in headless' },
]
```

Exclusions are recorded in the contract for transparency —
they're never silently omitted.
