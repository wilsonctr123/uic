import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  reporter: [
    ['list'],
    ['json', { outputFile: '.uic/test-results.json' }],
  ],
  projects: [
    {
      name: 'auth-setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'authenticated',
      dependencies: ['auth-setup'],
      use: {
        storageState: '.uic/auth/user.json',
      },
      testIgnore: /auth-invariants|public-routes/,
    },
    {
      name: 'guest',
      testMatch: /auth-invariants|public-routes/,
      use: {
        storageState: { cookies: [], origins: [] },
      },
    },
  ],
});
