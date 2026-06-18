# AGENTS Guide - jumumpangpang

This file is for autonomous coding agents working in this repository.
It is intentionally operational and evidence-based (from project config and code).

## At a Glance
- Stack: Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS 4, shadcn/ui.
- State: Zustand for client state, React Query for async/server state.
- Aliases: `@/*` is configured in `tsconfig.json` and used across the codebase.
- Validation baseline: `npm run lint` and `npm run build` on every meaningful change.

## Project Layout
- `app/`: App Router entrypoints and route pages (`orders`, `inquiries`, `me`, etc.).
- `components/`: Feature and shared UI composition.
- `components/ui/`: Base shadcn-style primitives (button, dialog, table, etc.).
- `hooks/`: Reusable hooks (`use-dashboard-data`, `use-mobile`).
- `lib/constants/`: Domain constants (for example order status groupings).
- `lib/mock-data/`: Mock fixtures currently used by many screens.
- `lib/stores/`: Zustand stores.
- `lib/utils.ts`: Shared utility helpers (`cn`).
- `types/`: Shared domain interfaces and union types.
- `docs/`: Product and architecture notes.

## Product Planning Docs
- Current MVP source of truth: `docs/00_문서맵/00_문서맵_주문팡팡_소싱라이프_최종기획.md`.
- Start from the document map above, then update only the affected files under `docs/01_서비스기획/` through `docs/09_와이어프레임/`.
- Historical references to `docs/08_주문수집소싱라이프_MVP기획/` are not current for this repository; that folder is not part of the active doc set.
- The MVP planning docs are intentionally split by topic so agents can update only the affected part.
- When changing order workflow, SourcingLife integration, invoice handling, marketplace API mapping, or related UI labels, update the matching planning docs listed in the document map.
- After meaningful product behavior changes, update the relevant planning doc and append a short entry to `docs/00_문서맵/99_변경이력.md`.
- Do not reintroduce Taobao direct payment or internal forwarder/warehouse management into the MVP unless the user explicitly changes the scope.

## Setup and Core Commands
- Install deps: `npm install`
- Dev server: `npm run dev`
- Lint: `npm run lint`
- Production build: `npm run build`
- Run built app: `npm run start`

## Test Commands (Important)
There is currently no configured test runner.

Evidence:
- `package.json` has no `test` script.
- No `jest`, `vitest`, or `cypress` dependencies are installed.
- No `*.test.*` / `*.spec.*` files are present.

Because of this:
- Single-test command is not available yet.
- Do not invent `npm test` usage in this repo.
- Use `npm run lint` + `npm run build` as required validation.

If you add a test runner later, also add and document:
- `npm run test`
- `npm run test:watch`
- A single-test command (example shape: `npm run test -- path/to/file.test.ts`)

## Suggested Validation Flow Per Change
1. Run `npm run lint`.
2. Run `npm run build`.
3. If a new test setup is introduced, run its targeted single-test command too.

## TypeScript and Imports
- TypeScript is strict (`"strict": true` in `tsconfig.json`).
- Prefer explicit interfaces/types for props and domain models.
- Use `@/*` imports, not deep relative traversals.
- Keep shared types in `types/` when reused across modules.
- Avoid `any`; use concrete types, unions, or generics.
- Keep module exports typed (especially store actions and hook return values).

## Naming Conventions
- File names: `kebab-case` (`order-table.tsx`, `dashboard-store.ts`).
- Components: `PascalCase` names.
- Hooks: `useXxx` naming (`useDashboardMetrics`).
- Store hooks: `useXxxStore` naming.
- Constants: `UPPER_SNAKE_CASE` for grouped maps where appropriate.
- Prefer named exports for reusable modules.
- Default exports are mainly used for route `page.tsx` / layout files.

## Client vs Server Components
- Default to Server Components in `app/` unless interactivity is required.
- Add `"use client"` only when using hooks, browser APIs, or client event handling.
- Keep `"use client"` at the top of the file.
- Provider wrappers that use client-only libs belong in client components.

## React and UI Patterns
- Reuse existing primitives in `components/ui` before adding new base components.
- Use `cn()` from `lib/utils.ts` for class merging.
- Follow existing variant patterns (CVA in `components/ui/button.tsx`).
- Keep component props small and focused; split large views into subcomponents.
- Prefer composition over duplicate markup for repeated sections/modals.
- Co-locate feature components under their domain folder (`components/orders`, etc.).

## Formatting and Style Discipline
Formatting in this repo is currently mixed across files.

Rules for agents:
- Match the existing style of the file you are editing.
- Do not perform repository-wide formatting churn unless explicitly requested.
- Keep diffs minimal and intention-revealing.
- Use semicolons/quote style consistently within a file.
- Keep import blocks tidy and remove unused imports.

## Error Handling and User Feedback
- Favor explicit guards for nullable props/state (`if (!order) return null`).
- Use actionable UI feedback patterns already present (for example `sonner` toasts).
- Do not swallow errors silently.
- Keep async handlers deterministic and user-safe.
- When introducing network calls, define clear loading/error/success states.

## State Management Guidelines
- Use Zustand (`lib/stores`) for shared client-side UI/domain state.
- Use React Query hooks for async data retrieval/caching patterns.
- Keep transient local UI state in component-level `useState`.
- Derive filtered views with `useMemo` when appropriate.
- Keep store actions small and predictable.

## Security and Config Rules
- Never commit secrets or `.env.local`.
- Only client-safe variables may use `NEXT_PUBLIC_`.
- Validate external image domains in `next.config.ts` if adding new sources.
- Avoid exposing sensitive identifiers in logs or UI.

## Git and PR Expectations
- Keep commits scoped to one coherent change.
- Follow existing concise commit style (`feat:`, `docs:`, `init:`, etc. as used).
- For UI-impacting changes, include screenshots/GIFs in PR descriptions.
- Reference related docs/spec notes in `docs/` when relevant.

## Cursor/Copilot Rule Integration
Checked locations:
- `.cursor/rules/`
- `.cursorrules`
- `.github/copilot-instructions.md`

Current status:
- No Cursor rule files found.
- No Copilot instruction file found.

If those files are added later:
- Treat them as higher-priority, tool-specific behavior overlays.
- Merge their constraints into this AGENTS guide promptly.

## Agent Execution Checklist
Before coding:
- Identify nearest existing pattern in same feature area.
- Confirm target files and dependency boundaries.

During coding:
- Keep edits minimal and local.
- Reuse existing utilities/components first.
- Preserve established naming and import conventions.

Before finishing:
- Run `npm run lint`.
- Run `npm run build`.
- Update docs when behavior or architecture meaningfully changes.

This AGENTS guide should be kept in sync with `package.json`, lint/build config,
and any future test-runner setup.
