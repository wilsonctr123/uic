/**
 * UIC Configuration — Cowork Assistant (Example App #1)
 *
 * This is the project-specific configuration for the generalized
 * UIC tool. All app-specific details (routes, auth, exclusions)
 * are isolated here — the tool itself is general-purpose.
 */

import type { UicConfig } from './tool/src/config/types.js';

export default {
  app: {
    name: 'Cowork Assistant',
    framework: 'react-vite',
    baseUrl: 'http://localhost:5173',
    startCommand: 'python3 -m src.cli.run_api & cd web && npm run dev',
    startTimeout: 30000,
  },
  auth: {
    strategy: 'ui-flow',
    personas: {
      user: {
        email: '${TEST_USER_EMAIL}',
        password: '${TEST_USER_PASSWORD}',
      },
      admin: {
        email: '${TEST_ADMIN_EMAIL}',
        password: '${TEST_ADMIN_PASSWORD}',
      },
      guest: {},
    },
  },
  discovery: {
    seedRoutes: [
      '/login',
      '/forgot-password',
      '/',
      '/chat',
      '/search',
      '/tasks',
      '/import',
      '/setup',
      '/admin',
    ],
    excludeRoutes: ['/reset-password'],
    maxDepth: 3,
    waitAfterNavigation: 1000,
    viewportWidth: 1440,
    viewportHeight: 900,
    screenshots: true,
  },
  exclusions: [
    { pattern: '/email/:id', reason: 'Dynamic route — requires real email data for meaningful test' },
    { pattern: 'WebSocket streaming', reason: 'Chat streaming requires running backend agent — tested separately' },
    { pattern: 'showDirectoryPicker', reason: 'File System Access API not supported in headless Playwright' },
  ],
} satisfies UicConfig;
