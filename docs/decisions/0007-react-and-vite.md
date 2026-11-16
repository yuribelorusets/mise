# 7. React and Vite, served by the same Express server

November 2026 · Accepted

## Context

The original pages were plain HTML and JavaScript. The owner app is phone-first and used in the kitchen: a count screen, editable proposal cards, recipes with nested ingredients, and a camera later for receipts. That's real UI state.

## Decision

`web/` is a React + TypeScript app built with Vite, using React Router and TanStack Query, plain CSS with design variables, and a few components of my own. No UI kit. In development Vite passes `/api` to Express; in production Express serves the built files, so it's still one process and one deploy. The look is a printed prep sheet, not a dashboard: high contrast, numbers in aligned columns, 44 px tap targets for wet hands, and a dark mode.

## Alternatives

- **SvelteKit.** Less code, but it wants to own the server, and it's less common in the roles I'm applying for.
- **Keep plain HTML and redesign it.** No build step, but forms and the camera get messy without components.

## Consequences

Express needs to send unknown app routes back to `index.html`, or reloading `/count` returns a 404. The frontend has its own tests (Vitest and Testing Library, then Playwright).
