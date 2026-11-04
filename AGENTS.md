# Instructions for AI agents and developers

Read this before changing anything. It tells you what the project is, how it is built, the rules that keep it working, and how to test it.

## Project in one paragraph

TCP Notices tracks shipping notices and contract obligations on time charter party contracts. Contracts own notices. The calendar shows both. It is a **Next.js app (React + TypeScript) on Vercel**. All contracts and notices are stored in a Redis database (Upstash, through Vercel Storage), shared by the whole team behind one team password. A daily Vercel Cron job emails reminders through Resend. The owner is a complete beginner at coding, so explain changes in plain language, and never leave the app in a half-working state.

## Rules that must not be broken

1. **Keep the server code free of extra packages.** `lib/server/` uses only Node built-ins and `fetch` (Redis and Resend are called over their web APIs). The only runtime packages are `next`, `react` and `react-dom`. Ask the owner before adding another.
2. **Keep the server logic outside Next.js.** Endpoints live in `lib/server/handlers.ts` as plain functions that take a web `Request` and return a `Response`. The files in `app/api/**/route.ts` only call them. This is what lets the tests run them directly. If you add an endpoint, add it to the `routes` table at the bottom of `handlers.ts` too.
3. **Never put user text into HTML by hand.** In React, write text as `{value}` and never use `dangerouslySetInnerHTML`. In emails, pass user text through `esc()` in `lib/server/core.ts`. Contract names, notice titles and email addresses are user input.
4. **No `alert()`, `confirm()` or `prompt()`.** Show messages on the page (`#c-msg`, `#n-msg`, `#cl-msg`, `#save-msg`). Deleting a contract uses the two-click button instead of a confirm box.
5. **Save buttons do not rely on form submission.** They are `type="button"` and call `runIfValid()` from `components/forms.ts`, which runs `reportValidity()` and then the handler. Enter in a text box presses the button (`enterPresses()`).
6. **Wrap every `localStorage` read and write in try/catch** (use `read()` and `write()` in `lib/browser.ts`). The browser now only keeps the password, the desktop-alert memory and the import flag. The team data is never stored in the browser.
7. **Dates are `YYYY-MM-DD` strings.** Parse with `parse(s)` (local midnight) and format with `ymd(d)` from `lib/rules.ts`. Do not use `new Date('2026-11-20')` directly, which is UTC and can shift the day. Server reminder dates use the UK day (`londonToday()`).
8. **Do not invent contract terms.** The notice periods and the default 10 and 30 day values are placeholders. Do not present them as legal or contractual facts.
9. **Keep the app usable on a phone** (no sideways scroll at 390 px wide), keep keyboard focus visible, and keep the light and dark colour tokens at the top of `app/globals.css` in sync.
10. **Ask the owner before deleting data features** and before changing the storage keys (Redis or browser). Existing users have data under those keys. Never delete the old browser keys `deadlineCalendar.v2` and `deadlineCalendar.items.v1`; the import only reads them.
11. **Never change saved data without going through `change()`** in `components/App.tsx`. It copies the data, applies the edit, shows it and saves it. Editing `data` directly would skip the save.

## How it fits together

```
app/
  layout.tsx, page.tsx      Next.js page shell (page.tsx just renders <App />)
  globals.css               All styles. Colour tokens at the top (light and dark).
  api/**/route.ts           Thin wrappers that call lib/server/handlers.ts
components/
  App.tsx                   Sign-in, loading, saving, conflicts, import offer, banner, layout
  Calendar.tsx              Month view
  ContractsPane.tsx         Contracts tab (form and cards)
  NoticesPane.tsx           Notices tab ("What is due?", reminders, list by contract)
  EmailPanel.tsx            Test email, preview, send now, sent list, sign out
  forms.ts                  runIfValid, enterPresses
lib/
  types.ts                  Data shapes
  rules.ts                  Date helpers, status, currentRem, remindsOf, PRESETS, email links
  browser.ts                localStorage, old-data import, api() calls to the server
  excel.ts                  Excel export (SheetJS loaded from cdnjs on demand)
  server/core.ts            Redis, password, cleanState, pickDue, emails, runReminders
  server/handlers.ts        The endpoints and the route table
tests/                      See Testing
vercel.json                 Daily cron
next.config.mjs             Two safe headers
```

## Server side

| Address | Job |
|---|---|
| `GET /api/ping` | Public. Says which settings exist (never their values). |
| `GET/PUT /api/state` | Read or save the whole data set in Redis. Checks every field with `cleanState`, and refuses a stale save (409) using a revision number. |
| `GET /api/status` | Last reminder run and the list of emails sent. |
| `POST /api/test-email` | One test email (limited to 20 a day). |
| `POST /api/reminders` | Page buttons: preview (`dryRun`) or send today's reminders now. |
| `GET /api/cron/send-reminders` | Called daily by Vercel Cron (see `vercel.json`). Needs `Authorization: Bearer CRON_SECRET`. |

Rules for the server code:

- Every endpoint except `ping` fails closed: no `APP_PASSWORD` means 503, wrong password means 401, and 10 wrong tries from one address in 15 minutes locks it (429).
- Secrets only come from environment variables: `RESEND_API_KEY`, `APP_PASSWORD`, `CRON_SECRET`, optional `RESEND_FROM`, and the Redis variables Vercel adds (`KV_REST_API_URL`, `KV_REST_API_TOKEN`). Never write a secret into a file, a test, a commit or a chat message, and never return one from an endpoint.
- Never trust the page's data. If you add a field to notices or contracts, add it to `types.ts` and to `cleanState` in `lib/server/core.ts`, or it is silently dropped on save.
- Reminder dates use the UK calendar day (`Europe/London`), not the server's clock.
- `pickDue` mirrors `currentRem` and `status` in `lib/rules.ts`. Change them together. A reminder is remembered as sent by the key `noticeId:days:dueDate`, so changing the due date or reaching a later reminder sends again. A failed send is not remembered and is retried next run.
- Redis keys: `tcp:state`, `tcp:sent`, `tcp:log`, `tcp:lastrun`, `tcp:fail:<ip>`, `tcp:testmails:<date>`. Ask the owner before renaming them.

## Data model

Stored in Redis under `tcp:state` as `{ state, rev, updatedAt }`, where `state` is:

```js
{
  contracts: [
    { id, ref, vessel, party, delivery: 'YYYY-MM-DD', redelivery: 'YYYY-MM-DD' }
  ],
  notices: [
    {
      id, cid,                      // cid = id of the owning contract
      title,
      type: 'shipping' | 'contract',
      date: 'YYYY-MM-DD',           // due date
      rems: [ { days: 7, to: ['a@x.com'] }, ... ],   // up to 3 reminders, largest days first
      done: false
    }
  ]
}
```

Older notices may have `remind` (one number) or `reminds` (array of numbers) instead of `rems`. `remindsOf(n)` reads all three shapes, and `cleanState` keeps them. Keep both working.

Browser keys (`localStorage`):

- `deadlineCalendar.cloud.v1`: `{ pw }`, the team password, so you stay signed in. Sign out clears it.
- `deadlineCalendar.alerted.v1`: which desktop notifications were already shown.
- `deadlineCalendar.imported.v1`: set once this browser's old data was imported, or the person chose "Don't ask again here".
- `deadlineCalendar.v2` and `deadlineCalendar.items.v1`: written by the **old** single-file page. Read only, for the import offer. The flat `items.v1` list is migrated into a contract called "Unassigned", as before.

## Saving and two people at once

- Every edit calls `change()`. The page shows it at once and saves 0.5 seconds later (a burst of edits becomes one save). The line under the title says "Saving...", "All changes saved" or why it is not saved, with a "Try again" button.
- Each save sends the revision it started from. If someone else saved in between, the server answers 409 and the page shows "Someone else saved changes" with **Use the saved version** or **Keep my version**. Nothing is overwritten silently.
- The page fetches the latest data when you come back to the tab and every minute, but only when nothing is waiting to be saved.
- Closing the tab with an unsaved change makes the browser ask "Leave site?".

## Look and feel

Teal means shipping notice, purple means contract obligation, grey means delivery or redelivery. Notice lists are deliberately compact (name, date and status, one reminders line, email links only when due). The HTML element ids from the old page (`c-vessel`, `n-what`, `cl-msg` and so on) were kept on purpose; the tests use them.

## Testing

You must run the tests before saying a change works. Loading the page is not enough.

```bash
npm install
npx playwright install chromium
npm test
```

- `tests/api.test.ts` tests the server code (reminder rules, password limits, data checking, saving, conflicts, emailing, retries) by calling the handlers directly with stand-ins for Redis and Resend (`tests/fakes.ts`).
- `tests/browser.test.ts` runs the real page in Chromium against `tests/harness/server.ts`: sign-in, the whole contracts and notices workflow, Excel rows, failed saves, the email panel, two devices and conflicts, importing old browser data, sign out, and phone width.
- The test server bundles `components/App.tsx` with esbuild instead of Next.js, and serves the handlers itself. So the tests prove our code, **not** Next.js's build or routing. After changing anything in `app/`, `next.config.mjs` or `package.json`, also run `npm run build`.
- `npm run typecheck` checks the TypeScript.
- To use an installed Chrome instead of Playwright's: `CHROME_PATH=/path/to/chrome npm test`.

The stand-ins prove our logic, not the live services. Real Upstash, Resend and Vercel Cron cannot be reached from the test environment, so say so after changing server code and ask the owner to run the checks in `SETUP.md`.

The test browser usually cannot reach the internet, so the tests answer the Google Fonts and SheetJS requests themselves. That means the real `.xlsx` file is not opened and checked. Say so when you change the export.

When you add a feature, add checks for it to `browser.test.ts`. When you fix a bug, add a check that fails without the fix.

## Deploying

Vercel builds the Next.js app (`next build`) from the branch you deploy, and runs the daily cron (`0 8 * * *`, UTC) from `vercel.json`. The Hobby plan runs a cron once a day, at any time within the chosen hour. See `SETUP.md`.

## What is still open

- Resend's free test sender (`onboarding@resend.dev`) only delivers to the Resend account owner's own address. Emailing the recipient lists needs a domain verified in Resend and `RESEND_FROM` set to an address on it.
- One shared password for the whole team, not per-user accounts.
- Two people editing at once get a "choose which to keep" prompt rather than a merge.
- Reminders go out once a day (about 08:00 UK, up to an hour late on Hobby). A same-day change made after the run is picked up the next day.
- There is no `package-lock.json` yet: it could not be created in the environment where the rewrite was built (no access to the package registry). Run `npm install` once and commit the lock file it creates.

## Working with the owner

- Explain what you changed in plain language, with no jargon.
- Small, tested steps. Say clearly what you could not test.
- Do not claim something works unless you ran it.
