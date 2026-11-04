# Instructions for AI agents and developers

Read this before changing anything. It tells you what the project is, how it is built, the rules that keep it working, and how to test it.

## Project in one paragraph

TCP Notices is a single-file static web app (`index.html`) that tracks shipping notices and contract obligations on time charter party contracts. Contracts own notices. The calendar shows both. Data lives in the visitor's browser. The owner is a complete beginner at coding, so explain changes in plain language, and never leave the app in a half-working state.

## Rules that must not be broken

1. **Keep it one file, no build step.** Markup, CSS and JavaScript stay in `index.html`. Do not add a framework, bundler or package.json at the repo root (Vercel would then try to build it). Tests have their own `tests/package.json`.
2. **Plain JavaScript in the existing style** (`var`, `function`, no modules, no arrow-function-heavy code). Match the surrounding code.
3. **Never put user text into `innerHTML`.** Build elements with `el(tag, className, text)`, which uses `textContent`. Contract names, notice titles and email addresses are user input.
4. **No `alert()`, `confirm()` or `prompt()`.** Show messages with `say(elementId, text, good)` into the `#c-msg` and `#n-msg` elements. Pop-ups are blocked when the page runs inside a sandboxed frame (it started life as a Claude artifact).
5. **Save buttons must not rely on form submission.** The buttons are wired with `wireForm(...)`, which calls the form's handler directly after `reportValidity()`. Browsers silently block form submission in a sandboxed frame without `allow-forms`, which once made contracts impossible to save. Do not change the buttons back to plain submit buttons.
6. **Wrap every `localStorage` read and write in try/catch** (use `read()` and `write()`). Storage can be missing or throw. The app must still work in memory.
7. **Dates are `YYYY-MM-DD` strings.** Parse with `parse(s)` (local midnight) and format with `ymd(d)`. Do not use `new Date('2026-11-20')` directly, which is UTC and can shift the day.
8. **Do not invent contract terms.** The notice periods and the default 10 and 30 day values are placeholders. Do not present them as legal or contractual facts.
9. **Keep the app usable on a phone** (no sideways scroll at 390 px wide), keep keyboard focus visible, and keep the light and dark colour tokens at the top of the CSS in sync.
10. **Ask the owner before deleting data features** and before changing the storage keys. Existing users have data under those keys.

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
| `PRESETS`, `applyWhat`, `updateEstimate`, `tickedDays`, `dueFor` | The "What is due?" logic. Delivery and redelivery notices are counted back from a contract date. |
| `wireForm`, `say` | Save-button wiring and on-page messages (see rules 4 and 5). |
| `startEditContract`, `startEditNotice`, `endEdit` | Editing reuses the add forms. `editingC` and `editingN` hold the id being edited. |
| `outlookWebFor`, `mailtoFor` | Build the email links. |
| `exportExcel` | Builds the workbook with SheetJS (loaded from cdnjs). |
| `showTab` | Switches the Contracts and Notices tabs. |

Look-and-feel decisions to keep: teal means shipping notice, purple means contract obligation, grey means delivery or redelivery. Notice lists are deliberately compact (name, date and status, one reminders line, email links only when due).

## Testing

You must run the tests before saying a change works. Loading the page is not enough.

```bash
cd tests && npm install && npx playwright install chromium && npm test
```

- `tests/e2e.js` runs the full workflow in a normal page: add contracts, create notices from ticked days, reminders and recipients, banner, email links, edit, delete, reload persistence, phone width.
- `tests/sandbox.js` runs the key steps inside an iframe with `sandbox="allow-scripts"` only. This reproduces how a published artifact behaves. Anything that works in `e2e.js` but fails here is a real bug for the owner.

- `tests/excel.js` replaces the SheetJS library with a stand-in and checks the rows the page builds for the Excel file (sheets, columns, dates, recipients, contracts with no notices).

The test browser usually cannot reach the internet, so the Google Fonts and SheetJS requests fail. That is expected and the app still works. It also means the real `.xlsx` file cannot be opened and checked offline. Say so when you change the export.

When you add a feature, add checks for it to `e2e.js`. When you fix a bug, add a check that fails without the fix.

## Deploying

Static site on Vercel, deployed from `main` with no build step (see `README.md`). `vercel.json` only turns on clean URLs. Pushing to `main` redeploys.

## Planned: automatic email reminders with Resend

Not built yet. The owner wants emails sent on the reminder days without opening the page. Design constraints:

- A browser page cannot send email or run while closed, and an API key must never be placed in the page. Sending needs server-side code.
- The server needs to read the data, which today exists only in each browser. A shared store is required first.
- Resend's free plan only delivers to the account owner's own address until a domain is verified. Sending to the recipient lists typed in the form needs a verified sending domain.
- Suggested shape: a Vercel serverless function plus a Vercel Cron job (daily) that reads the data, finds reminders whose send date (`due date minus days`) is today, sends them through the Resend API, and records what it sent so nothing is sent twice. The Resend key goes in a Vercel environment variable.
- The owner's company uses Outlook. A Power Automate flow reading a "Reminder schedule" Excel table is a simpler alternative that needs no code hosting.

Agree the approach with the owner before building it, because it adds a server and a data store to a project that currently has neither.

## Working with the owner

- Explain what you changed in plain language, with no jargon.
- Small, tested steps. Say clearly what you could not test.
- Do not claim something works unless you ran it.
