# TCP Notices

A calendar for tracking **shipping notices** and **contract obligations** on time charter party (TCP) contracts. Add each contract once (vessel, counterparty, delivery and redelivery dates), then add the notices that belong to it. The calendar shows everything, and anything due soon is flagged.

It is one web page (`index.html`) with no build step. On its own it works offline in any browser. With the optional server part (`api/`) it also saves to a Redis database and emails reminders on the right days. Setup steps are in [`SETUP.md`](SETUP.md).

## What it does

- **Contracts tab.** Add a contract with vessel name, counterparty, optional contract reference, delivery date and redelivery date. Edit or delete it later. Each contract has a drop-down (closed to start with) showing how many notices it has and how many need attention. Open it to see the notices as line items (name, due date, status), with open notices first in date order and switched-off ones at the bottom. Click a notice's name to edit it.
- **Notices tab.** Notices are grouped by contract. Each notice has a name, a type (shipping notice or contract obligation), a due date, an on/off switch, and up to three reminders. Switch a notice off once you have actioned it: it stops alerting, drops out of the red banner and gets no more reminder emails. Switch it back on at any time.
- **Standard notices.** *Delivery notice* and *Redelivery notice* work out their due date from the contract. Tick one or more notice periods (1 to 30 days, then 35, 40, 45, 50, 55, 60, 75, 90, 120, 150 and 180) and one notice is created per tick. *Heel nomination*, *Option period lifting* and *Other* take a date you type.
- **Three reminders per notice.** Each reminder has its own number of days before the due date and its own list of email recipients.
- **Calendar.** Month view showing each contract's delivery and redelivery dates (grey), delivery and redelivery notices (green), heel nominations (blue) and option period liftings (orange). Other notices and all reminders are not on the calendar. They are listed on the Notices tab.
- **Alerts.** A red banner lists notices that are inside their reminder window or overdue. Optional desktop notifications work while the page is open.
- **Email.** A notice that needs attention gets *Outlook web* and *Outlook app* links that open a ready-written email to the right recipient list. You press send.
- **Cloud storage and email reminders (optional).** Connect with a team password and the data is saved online, shared across devices. A daily job emails each reminder to its recipient list through Resend. The panel at the bottom of the page can send a test email, preview today's reminders and show what was sent.
- **Excel export.** One button downloads an `.xlsx` with a *Contracts* sheet and a *Notices by contract* sheet.

The notice periods offered are placeholders chosen from general market practice. They are not taken from any real contract. Check them against your own charter parties.

## Using it

1. Open the deployed site, or open `index.html` directly in a browser.
2. On **Contracts**, fill in the form and press *Save contract*.
3. On **Notices**, press *Add a notice*, choose the contract and what is due, set the reminders, and press *Add notice*.

## Where your data lives

By default everything you enter is stored in **your own browser** (`localStorage`) and is not sent anywhere. If you connect cloud storage (see `SETUP.md`), it is also saved in your Redis database.

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

`e2e.js` walks through the whole workflow. `sandbox.js` repeats the key steps inside a restricted frame (see `AGENTS.md` for why that matters). `excel.js` checks what is handed to the Excel export. `api.js` and `cloud-e2e.js` test the server part with stand-ins for Redis and Resend.

## Deploy to Vercel

The site is plain static files, so no build is needed.

1. Sign in at [vercel.com](https://vercel.com) with GitHub.
2. Choose **Add New... > Project** and import this repository.
3. Leave **Framework Preset** as *Other*. Leave the build command and output directory empty.
4. Press **Deploy**. Vercel gives you a public URL.

Every later push to `main` redeploys automatically.

The deployed site address is public. Without cloud storage each visitor only sees their own browser's data. With it, the data is protected by the team password. For email reminders and Redis, follow `SETUP.md`.

## Known limits and next steps

- Reminder emails go out once a day, not at an exact time.
- Resend only emails your own address until you verify a domain (see `SETUP.md`).
- One shared team password and one shared data set. There are no separate user accounts.
- Editing a contract's delivery or redelivery date does not move notices that were already calculated from it.
- Notice periods stop at 180 days.

## Files

| Path | Purpose |
|---|---|
| `index.html` | The whole app: markup, styles and script |
| `AGENTS.md` | Instructions for AI agents and new developers |
| `CLAUDE.md` | Points Claude Code at `AGENTS.md` |
| `SETUP.md` | Step-by-step: Redis, Resend, Vercel settings, testing |
| `api/` | Server functions: storage, password, test email, daily reminders |
| `vercel.json` | Vercel settings: clean URLs, daily cron, time limits |
| `tests/` | Browser tests (Playwright) |
