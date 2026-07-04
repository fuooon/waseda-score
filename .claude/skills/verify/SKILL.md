---
name: verify
description: Build, launch, and drive the waseda-score app to verify changes end-to-end.
---

# Verifying waseda-score

Vanilla JS + Vite SPA (no framework, no tests). State lives in localStorage
(`waseda-score-current-game`, `waseda-score-teams`, `waseda-score-members`).

## Build & launch

```bash
npm install
npm run build
npm run preview -- --port 4173 --host 127.0.0.1 &
# App URL (note the base path from vite.config.js):
# http://127.0.0.1:4173/waseda-score/
```

`npm run dev` also works (port 5173, same `/waseda-score/` base path).

## Drive it

Use Playwright with the pre-installed Chromium (`import { chromium } from
'/opt/node22/lib/node_modules/playwright/index.mjs'` in cloud sessions).
Flows worth driving:

- First load lands on the scoresheet (`#page-scoresheet.active`); a blank
  game is auto-created if localStorage is empty.
- Hamburger menu (`#menu-btn`) → `.menu-item[data-page=...]` navigates:
  `scoresheet`, `game-setup` (試合情報), `lineup`, `new-game` (confirm dialog!),
  `team-members`, `help`.
- Scoresheet header shortcuts: `#lineup-btn` (🧢 lineup), `#game-settings-btn`
  (⚙️ modal with date/teams/field/start/end time).
- Clicking a `td.score-cell` opens `#score-input-modal`.
- Saving the game-setup form or `#lineup-start-btn` returns to the scoresheet.

## Gotchas

- `new-game` menu item fires a `confirm()` — register a Playwright dialog
  handler before clicking or the click hangs.
- Google Fonts requests fail (`ERR_CONNECTION_RESET`) in sandboxed
  environments — ignore; it's not an app error.
- Navigation re-inits pages, so probe for listener stacking: bounce
  lineup ↔ scoresheet a few times, then click `#next-inning-btn` once and
  assert the label advanced exactly one half-inning.
