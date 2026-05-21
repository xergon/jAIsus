# jAIsus end-to-end tests

Playwright tests covering the critical user paths — onboarding, chat,
favorites, parables, settings/export.

All AI and voice endpoints (`/api/chat`, `/api/tts`, `/api/vision`,
`/api/teachings`, `/api/summarize`, `/api/daily`) are mocked via Playwright
route handlers in `fixtures.ts`, so the tests never make real calls to
Claude, ElevenLabs, or any other paid service.

## First-time setup

```sh
npm install -D @playwright/test
npx playwright install chromium
```

`@playwright/test` is already listed in `package.json`'s `devDependencies`,
but the `npx playwright install` step is what actually downloads the browser
binary — run it once after a fresh checkout.

## Running

```sh
npm run test:e2e        # headless, one run
npm run test:e2e:ui     # interactive UI mode — debug + watch
```

Playwright will boot `npm run dev` on `http://localhost:3000` automatically.
If you already have the dev server running, it reuses your existing process
(locally only — CI always boots fresh).

## What's mocked

Every external/paid endpoint is intercepted with `page.route()` inside the
shared `mockApis` fixture in `fixtures.ts`:

- **POST `/api/chat`** — returns a stub AI SDK v6 event-stream containing
  one assistant message (`"Peace be with you, friend."`).
- **POST `/api/tts`** — returns 500. The client falls back to the browser's
  built-in `SpeechSynthesis`, which produces no audible output in headless
  Chromium but completes without error.
- **POST `/api/vision`** — returns a fixed scene description JSON.
- **POST `/api/teachings`** — returns one short stub teaching.
- **POST `/api/summarize`** — returns an empty summary.
- **GET `/api/daily`** — returns a fixed verse + reflection.

If a test needs a different stub, register a more specific `page.route()`
inside that test — handlers registered later take priority.

## Project structure

```
e2e/
  fixtures.ts             # shared test + expect, API mocks, clearStorage
  onboarding.spec.ts      # 4-slide carousel + seen flag
  chat.spec.ts            # text input, empty-state stack, suggested prompts
  favorites.spec.ts       # heart → save → list → remove
  parables.spec.ts        # drawer → reader → ask jAIsus
  settings-export.spec.ts # export menu + Markdown download
```

Always import from `./fixtures`, not directly from `@playwright/test` —
that's how the mocks and storage cleanup are guaranteed to run:

```ts
import { test, expect } from './fixtures';
```

## When a test fails

The HTML report lands in `playwright-report/index.html`. Open it with:

```sh
npx playwright show-report
```

Screenshots are captured on failure; videos and traces are retained on
failure or first retry — all visible inside the report viewer.

## Notes / caveats

- The suite runs against **Mobile Chrome** only (Pixel 5 device emulation).
  jAIsus is mobile-first and the layout, hit targets, and voice-mode toggle
  behavior are tuned for portrait phones. Desktop coverage isn't worth the
  extra wall-clock time at this stage.
- If `tsc --noEmit` complains about missing `@playwright/test` types before
  you've run `npm install`, that's expected — the package is in
  `devDependencies` and will be resolved once installed.
- A second, pre-existing test directory lives at `./tests` and runs against
  a different config (`playwright-live.config.ts`). The new e2e suite is
  intentionally independent — they don't share fixtures or mocks.
