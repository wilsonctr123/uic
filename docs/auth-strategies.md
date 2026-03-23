# Auth Strategies

UIC supports four authentication strategies for browser discovery and testing.
Configure in `uic.config.ts` under the `auth` key.

## 1. `storage-state` — Import Saved Browser State

Use when you have a pre-exported Playwright storage state file (cookies + localStorage).

```typescript
auth: {
  strategy: 'storage-state',
  personas: {
    user: {
      storageStatePath: '.uic/auth/user.json',
    },
  },
}
```

Generate the state file manually:
```bash
npx playwright codegen --save-storage=.uic/auth/user.json http://localhost:3000
```

## 2. `ui-flow` — Drive Login UI

UIC navigates to `/login`, fills email/password fields, clicks submit, and caches the session.

```typescript
auth: {
  strategy: 'ui-flow',
  personas: {
    user: {
      email: '${TEST_USER_EMAIL}',
      password: '${TEST_USER_PASSWORD}',
    },
  },
}
```

For non-standard login forms, provide custom steps:
```typescript
personas: {
  user: {
    loginSteps: [
      { action: 'goto', url: '/auth/signin' },
      { action: 'fill', selector: '#username', value: '${TEST_USER_EMAIL}' },
      { action: 'fill', selector: '#pass', value: '${TEST_USER_PASSWORD}' },
      { action: 'click', selector: 'button[type="submit"]' },
      { action: 'wait', timeout: 3000 },
    ],
  },
}
```

## 3. `api-bootstrap` — Login via API

UIC calls your login API endpoint, then navigates the browser to pick up the session cookie.

```typescript
auth: {
  strategy: 'api-bootstrap',
  personas: {
    user: {
      email: '${TEST_USER_EMAIL}',
      password: '${TEST_USER_PASSWORD}',
      loginEndpoint: '/api/v1/auth/login',
    },
  },
}
```

If the login API expects different field names:
```typescript
loginData: { username: '${TEST_USER_EMAIL}' },
```

## 4. `custom` — Your Own Auth Hook

For complex auth flows (SSO, MFA, OAuth):

```typescript
auth: {
  strategy: 'custom',
  customHook: './auth-hook.js',
}
```

Your hook module must export a function:
```javascript
export default async function authenticate({ baseUrl, persona, config, authDir }) {
  // Return: { context: BrowserContext, persona: string, success: boolean }
}
```

## Persona Abstraction

Contracts reference personas (`user`, `admin`, `guest`), not credentials.
This decouples what is tested from how authentication works.

- `guest` — no authentication, empty browser state
- `user` — standard authenticated user
- `admin` — admin-level access (if applicable)

Environment variables are interpolated at runtime:
```
TEST_USER_EMAIL=test@example.com
TEST_USER_PASSWORD=secret123
```
