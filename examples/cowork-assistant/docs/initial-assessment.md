# Phase 1 — Initial Assessment

**Date**: 2026-03-23
**Repository**: Cowork-assistant (AI Executive Assistant)

## Stack Summary

| Attribute | Value |
|-----------|-------|
| Frontend Framework | React 19.2.4 (SPA) |
| Build Tool | Vite 8.0.1 |
| Package Manager | npm |
| Router | React Router v7 (config-based) |
| Styling | Tailwind CSS v4 + custom CSS variables |
| Data Fetching | TanStack React Query v5 |
| Auth Model | Session cookies (httpOnly, 30-day, SHA-256 hashed) |
| Backend | FastAPI (Python) serving React from `/web/dist/` |
| Dev Server | `cd web && npm run dev` (port 5173, proxy to :8765) |
| Existing Frontend Tests | **None** |
| Existing E2E Tests | **None** |
| Playwright Installed | **No** (before this session) |
| CI Test Step | **None** (deploy.yml only does git pull + docker up) |

## Application Type

- Single Page Application (SPA)
- Internal/productivity dashboard tool
- Multi-tenant with cookie-based auth
- Both authenticated and unauthenticated surfaces

## Routes Discovered (10 total)

### Public (3)
| Route | Page | Purpose |
|-------|------|---------|
| `/login` | Login.tsx | Email/password sign-in |
| `/forgot-password` | ForgotPassword.tsx | Request password reset |
| `/reset-password` | ResetPassword.tsx | Set new password via token |

### Protected (7+)
| Route | Page | Purpose |
|-------|------|---------|
| `/` | Home.tsx | Dashboard with quick ask/search |
| `/chat` | Chat.tsx | Multi-turn AI chat with streaming |
| `/search` | Search.tsx | Hybrid FTS+vector+graph search |
| `/tasks` | Tasks.tsx | Task management with priorities |
| `/import` | Import.tsx | Email/document/Slack import |
| `/setup` | Setup.tsx | API keys, folder config, password |
| `/email/:id` | EmailDetail.tsx | Email thread viewer |
| `/admin` | Admin.tsx | User management (admin-only) |

## Key Interactive Surface

- **Forms**: Login, signup, forgot-password, reset-password, create task, create user, change password, slack import, setup config
- **Tables**: Search results (paginated, selectable), admin users, import results
- **Chat**: WebSocket streaming, session management, markdown rendering, citations
- **File Operations**: Drag-drop email/document upload, folder picker (File System Access API), attachment download
- **Navigation**: Top navbar with responsive mobile menu, session sidebar in chat
- **Dialogs/Modals**: Reset password modal (admin), bulk delete confirmation
- **State Variants**: Loading, error, empty, success, streaming, disabled

## Auth Flow

1. User submits email/password to `POST /auth/login`
2. Server sets `session_token` httpOnly cookie (30-day)
3. All subsequent requests include cookie automatically
4. `RequireAuth` component wraps protected routes, redirects to `/login` on 401
5. Admin routes additionally check `user.is_admin`

## Existing Test Infrastructure

- **Backend**: 21 pytest files in `tests/` (unit/integration, no browser)
- **Frontend**: Zero test files, zero test dependencies
- **CI/CD**: No test gate — deploys on push to main

## Assessment

This repository has **zero frontend testing infrastructure**. Building a browser-first testing system is greenfield. The cookie-based auth requires test fixtures that authenticate before accessing protected routes. The WebSocket chat streaming and File System Access API features will require special handling in Playwright.
