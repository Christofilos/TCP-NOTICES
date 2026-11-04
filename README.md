# TCP Notices

A calendar for tracking **shipping notices** and **contract obligations** on time charter party (TCP) contracts. Add each contract once (vessel, counterparty, delivery and redelivery dates), then add the notices that belong to it. The calendar shows everything, and anything due soon is flagged.

It is a single static web page. There is no server, no build step and no account. Open `index.html` in a browser and it works.

## What it does

- **Contracts tab.** Add a contract with vessel name, counterparty, optional contract reference, delivery date and redelivery date. Edit or delete it later.
- **Notices tab.** Notices are grouped by contract. Each notice has a name, a type (shipping notice or contract obligation), a due date, a done tick, and up to three reminders.
- **Standard notices.** *Delivery notice* and *Redelivery notice* work out their due date from the contract. Tick one or more notice periods (1 to 30 days, then 35, 40, 45, 50, 55, 60, 75, 90, 120, 150 and 180) and one notice is created per tick. *Heel nomination* and *Other* take a date you type.
- **Three reminders per notice.** Each reminder has its own number of days before the due date and its own list of email recipients.
- **Calendar.** Month view showing notices (teal for shipping, purple for contract obligations) and each contract's delivery and redelivery dates (grey).
- **Alerts.** A red banner lists notices that are inside their reminder window or overdue. Optional desktop notifications work while the page is open.
- **Email.** A notice that needs attention gets *Outlook web* and *Outlook app* links that open a ready-written email to the right recipient list. You press send.
- **Excel export.** One button downloads an `.xlsx` with a *Contracts* sheet and a *Notices by contract* sheet.

The notice periods offered are placeholders chosen from general market practice. They are not taken from any real contract. Check them against your own charter parties.

## Using it

1. Open the deployed site, or open `index.html` directly in a browser.
2. On **Contracts**, fill in the form and press *Save contract*.
3. On **Notices**, press *Add a notice*, choose the contract and what is due, set the reminders, and press *Add notice*.

## Where your data lives

Everything you enter is stored in **your own browser** (`localStorage`). It is not sent anywhere.

- Each browser and each device has its own separate data.
- Clearing site data, or using a private window, erases it.
- Use **Download contracts and notices (Excel)** regularly as a backup.

## Run and test locally

No install is needed to use the app. Just open `index.html`.

To run the automated browser tests:

```bash
cd tests
npm install
npx playwright install chromium
npm test
```

`e2e.js` walks through the whole workflow. `sandbox.js` repeats the key steps inside a restricted frame (see `AGENTS.md` for why that matters). `excel.js` checks what is handed to the Excel export.

## Deploy to Vercel

The site is plain static files, so no build is needed.

1. Sign in at [vercel.com](https://vercel.com) with GitHub.
2. Choose **Add New... > Project** and import this repository.
3. Leave **Framework Preset** as *Other*. Leave the build command and output directory empty.
4. Press **Deploy**. Vercel gives you a public URL.

Every later push to `main` redeploys automatically.

Note that the deployed site is public, but each visitor only ever sees their own browser's data.

## Known limits and next steps

- **No automatic emails yet.** A web page cannot send email, or run when closed. Sending reminders by itself needs a server-side job and a shared data store. A plan using the Resend email service is described in `AGENTS.md`.
- Editing a contract's delivery or redelivery date does not move notices that were already calculated from it.
- Notice periods stop at 180 days.

## Files

| Path | Purpose |
|---|---|
| `index.html` | The whole app: markup, styles and script |
| `AGENTS.md` | Instructions for AI agents and new developers |
| `CLAUDE.md` | Points Claude Code at `AGENTS.md` |
| `vercel.json` | Minimal Vercel settings |
| `tests/` | Browser tests (Playwright) |
