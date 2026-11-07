# Instructions for AI agents and developers

Read this before changing anything. It tells you what the project is, how it is built, the rules that keep it working, and how to test it.

## Project in one paragraph

TCP Notices is a single-file static web app (`index.html`) that tracks shipping notices and contract obligations on time charter party contracts. Contracts own notices. The calendar shows contract dates and the key notices. Data lives in the visitor's browser and, when they connect it, in a Redis database so a daily server job can email reminders. The owner is a complete beginner at coding, so explain changes in plain language, and never leave the app in a half-working state.

## Rules that must not be broken

1. **Keep it one file, no build step.** Markup, CSS and JavaScript stay in `index.html`. Do not add a framework, bundler or package.json at the repo root (Vercel would then try to build it). Tests have their own `tests/package.json`. The serverless functions in `api/` are the one exception to "single file": keep them dependency-free (Node built-ins and `fetch` only) so no install step is needed.
2. **Plain JavaScript in the existing style** (`var`, `function`, no modules, no arrow-function-heavy code). Match the surrounding code.
3. **Never put user text into `innerHTML`.** Build elements with `el(tag, className, text)`, which uses `textContent`. Contract names, notice titles and email addresses are user input.
4. **No `alert()`, `confirm()` or `prompt()`.** Show messages with `say(elementId, text, good)` into the `#c-msg` and `#n-msg` elements. Pop-ups are blocked when the page runs inside a sandboxed frame (it started life as a Claude artifact).
5. **Save buttons must not rely on form submission.** The buttons are wired with `wireForm(...)`, which calls the form's handler directly after `reportValidity()`. Browsers silently block form submission in a sandboxed frame without `allow-forms`, which once made contracts impossible to save. Do not change the buttons back to plain submit buttons.
6. **Wrap every `localStorage` read and write in try/catch** (use `read()` and `write()`). Storage can be missing or throw. The app must still work in memory.
7. **Dates are `YYYY-MM-DD` strings.** Parse with `parse(s)` (local midnight) and format with `ymd(d)`. Do not use `new Date('2026-11-20')` directly, which is UTC and can shift the day.
8. **Do not invent contract terms.** The notice periods and the default 10 and 30 day values are placeholders. Do not present them as legal or contractual facts.
9. **Keep the app usable on a phone** (no sideways scroll at 390 px wide), keep keyboard focus visible, and keep the light and dark colour tokens at the top of the CSS in sync.
10. **Ask the owner before deleting data features** and before changing the storage keys. Existing users have data under those keys.

## Server side (`api/`)

Vercel serverless functions. Shared code is in `api/_lib.js` (the underscore keeps it from becoming a web address).

| File | Job |
|---|---|
| `ping.js` | Public. Says which settings exist (never their values). |
| `state.js` | GET/PUT the whole data set in Redis. Checks every field with `cleanState`, and refuses a stale save (409) using a revision number. |
| `status.js` | Last reminder run and the list of emails sent. |
| `test-email.js` | One test email (limited to 20 a day). |
| `reminders.js` | Page buttons: preview (`dryRun`) or send today's reminders now. |
| `cron/send-reminders.js` | Called daily by Vercel Cron (see `vercel.json`). Needs `Authorization: Bearer CRON_SECRET`. |

Rules for the server code:

- Every endpoint except `ping` fails closed: no `APP_PASSWORD` means 503, wrong password means 401, and 10 wrong tries from one address in 15 minutes locks it (429).
- Secrets only come from environment variables: `RESEND_API_KEY`, `APP_PASSWORD`, `CRON_SECRET`, optional `RESEND_FROM`, and the Redis variables Vercel adds (`KV_REST_API_URL`, `KV_REST_API_TOKEN`). Never write a secret into a file, a test, a commit or a chat message, and never return one from an endpoint.
- Never trust the page's data. If you add a field to notices or contracts, add it to `cleanState` in `api/_lib.js`, or it is silently dropped on save.
- Reminder dates use the UK calendar day (`Europe/London`), not the server's clock.
- `pickDue` mirrors `currentRem` and `status` in the page. Change them together. A reminder is remembered as sent by the key `noticeId:days:dueDate`, so changing the due date or reaching a later reminder sends again. A failed send is not remembered and is retried next run.
- Redis keys: `tcp:state`, `tcp:sent`, `tcp:log`, `tcp:lastrun`, `tcp:fail:<ip>`, `tcp:testmails:<date>`. Ask the owner before renaming them.
- Browser side: the cloud panel code is in the "Cloud storage" block of `index.html`. It stores the password under the extra localStorage key `deadlineCalendar.cloud.v1`. The page works without the server (file page, sandbox).

## Data model

Stored as one JSON object in `localStorage` under the key `deadlineCalendar.v2`:

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

Other keys:

- `deadlineCalendar.items.v1`: the original flat notice list. Migrated once into a contract called "Unassigned". Do not remove the migration.
- `deadlineCalendar.alerted.v1`: remembers which desktop notifications were already shown.

Older notices may have `remind` (one number) or `reminds` (array of numbers) instead of `rems`. `remindsOf(n)` reads all three shapes. Keep it working.

## How the code is organised

All in the `<script>` at the bottom of `index.html`.

| Function | Job |
|---|---|
| `read`, `write`, `save` | Storage. `save()` persists, re-renders, rechecks reminders. |
| `status(n)` | Returns `{soon, text}`. A notice is "soon" if overdue or due within its largest reminder window. |
| `remindsOf`, `readRems`, `currentRem` | Reminder helpers. `currentRem` picks the reminder you have reached (smallest `days` that is at least the days remaining). |
| `renderCalendar`, `renderSelect`, `renderList`, `renderNotices` | Drawing. `render()` calls all four. |
| `renderList` line items | Each contract card on the Contracts tab has a `details.lineset` drop-down (closed by default; `linesOpen[contractId]` keeps it open across redraws; the summary carries the notice count) listing its notices as `li.line` rows (name button that opens `startEditNotice`, due date, status). Line colour classes are `l-ship` and `l-con`, not `shipping`/`contract`, because `.contract` already styles the grouped boxes on the Notices tab. |
| `eventsOn`, `calKind` | What the calendar shows (owner's request, 2026-11-06): contract delivery and redelivery dates (grey, `leg`), delivery and redelivery notices (green, `dn`, title starts "Delivery notice" or "Redelivery notice"), nominations (blue, `hn`, title contains "nomination") and option liftings (orange, `ol`, title contains "option"). Other notices and reminder dates are deliberately left off the calendar. Chips carry `data-nid` (notice) or `data-cid` (contract date); one `dblclick` listener on `#grid` (which is never replaced) opens `startEditNotice` or `startEditContract`. A day's `onclick` does nothing if that day is already selected, so the redraw does not swallow the second click. |
| `PRESETS`, `applyWhat`, `updateEstimate`, `tickedDays`, `dueFor` | The "What is due?" logic. Delivery and redelivery notices are counted back from a contract date. |
| `wireForm`, `say` | Save-button wiring and on-page messages (see rules 4 and 5). |
| `startEditContract`, `startEditNotice`, `endEdit` | Editing reuses the add forms. `editingC` and `editingN` hold the id being edited. |
| `outlookWebFor`, `mailtoFor` | Build the email links. |
| `exportExcel` | Builds the workbook with SheetJS (loaded from cdnjs). |
| `showTab` | Switches the Contracts and Notices tabs. |

Look-and-feel decisions to keep: in the notice lists, teal means shipping notice and purple means contract obligation. On the calendar, grey is a delivery or redelivery date, green a delivery or redelivery notice, blue a heel nomination and orange an option lifting. All four have light and dark tokens (`--leg`, `--dn`, `--hn`, `--ol` and their `-bg`) that must stay in sync. "What is due?" offers Delivery notice, Redelivery notice, Heel nomination, Option period lifting and Other. The last three take a typed date; option lifting is not calculated from the contract because its period is a contract term we must not invent (rule 8). Notice lists are deliberately compact (on/off switch, name, date and status, one reminders line, email links only when due). The switch is the notice's `done` flag shown the other way round: on means still to do, off means actioned. Switched-off notices get no alerts, banner entries, email links or reminder emails (`pickDue` skips `done`). The switch track uses a neutral colour, not teal or purple, because those mean notice types.

## Testing

You must run the tests before saying a change works. Loading the page is not enough.

```bash
cd tests && npm install && npx playwright install chromium && npm test
```

- `tests/e2e.js` runs the full workflow in a normal page: add contracts, create notices from ticked days, reminders and recipients, banner, email links, edit, delete, reload persistence, phone width.
- `tests/sandbox.js` runs the key steps inside an iframe with `sandbox="allow-scripts"` only. This reproduces how a published artifact behaves. Anything that works in `e2e.js` but fails here is a real bug for the owner.

- `tests/api.js` tests the server code (reminder rules, password limits, data checking, saving, emailing, retries) with stand-ins for Redis and Resend.
- `tests/cloud-e2e.js` runs the page against `tests/server.js`, a local server with the same stand-ins: connecting, auto-save, two devices, conflicts, test email, preview and send.
- `tests/excel.js` replaces the SheetJS library with a stand-in and checks the rows the page builds for the Excel file (sheets, columns, dates, recipients, contracts with no notices).

The stand-ins prove our logic, not the live services. Real Upstash, Resend and Vercel Cron cannot be reached from the test environment, so say so after changing server code and ask the owner to run the checks in `SETUP.md`.

The test browser usually cannot reach the internet, so the Google Fonts and SheetJS requests fail. That is expected and the app still works. It also means the real `.xlsx` file cannot be opened and checked offline. Say so when you change the export.

When you add a feature, add checks for it to `e2e.js`. When you fix a bug, add a check that fails without the fix.

## Deploying

Static site plus serverless functions on Vercel, deployed from `main` with no build step (see `README.md` and `SETUP.md`). `vercel.json` sets clean URLs, function time limits, the daily cron (`0 8 * * *`, UTC) and two safe headers. The Hobby plan runs a cron once a day, at any time within the chosen hour. Pushing to `main` redeploys.

## Email reminders: how they work and what is still open

Built: the page saves to Redis, and a daily Vercel Cron job emails each reminder through Resend on the right day.

- Resend's free test sender (`onboarding@resend.dev`) only delivers to the Resend account owner's own address. Emailing the recipient lists typed in the form needs a domain verified in Resend and `RESEND_FROM` set to an address on it.
- There is one shared password for the whole team, not per-user accounts.
- The data is one shared set. Two people editing at once get a "choose which to keep" prompt rather than a merge.
- Reminders go out once a day (about 08:00 UK, up to an hour late on Hobby). A same-day change made after the run is picked up the next day.

## Next step agreed with the owner: rewrite in Next.js (not started)

Decided on 2026-11-04. Build it on a new branch from `email-reminders`:

- Next.js with React and **TypeScript**, deployed on Vercel (this replaces rule 1's "single file, no package.json" once the rewrite lands; update the rules then).
- **All contracts and notices stored in Redis** (Upstash, through Vercel Storage). No browser-first copy. On first visit, offer to import any data the browser still holds under `deadlineCalendar.v2` (and the old `deadlineCalendar.items.v1`).
- **One shared team password** (`APP_PASSWORD`), no user accounts.
- Email through Resend (`RESEND_API_KEY` is already set in Vercel). Daily Vercel Cron with `CRON_SECRET`.
- Keep the features, look and colours of the current page, and the reminder rules in `api/_lib.js` (`pickDue`, `cleanState`, sent-key format). Port `tests/api.js` and `tests/cloud-e2e.js` to the new app.
- Environment variables the owner sets in Vercel: `KV_REST_API_URL` and `KV_REST_API_TOKEN` (added by the Upstash integration), `APP_PASSWORD`, `CRON_SECRET`, `RESEND_API_KEY`, and later `RESEND_FROM`.
- The build needs registry.npmjs.org reachable. Check with `npm view next version` first.

## Working with the owner

- Explain what you changed in plain language, with no jargon.
- Small, tested steps. Say clearly what you could not test.
- Do not claim something works unless you ran it.
