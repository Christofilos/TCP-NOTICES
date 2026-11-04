# TCP Notices

A calendar for tracking **shipping notices** and **contract obligations** on time charter party (TCP) contracts. Add each contract once (vessel, counterparty, delivery and redelivery dates), then add the notices that belong to it. The calendar shows everything, and anything due soon is flagged.

It is a Next.js web app on Vercel. Everything is saved in one shared database, so the whole team sees the same contracts and notices on every device, and a daily job emails each reminder on the right day. Setup steps are in [`SETUP.md`](SETUP.md).

## What it does

- **Team password.** One shared password opens the app. Each device remembers it until you press *Sign out on this device*.
- **Contracts tab.** Add a contract with vessel name, counterparty, optional contract reference, delivery date and redelivery date. Edit or delete it later.
- **Notices tab.** Notices are grouped by contract. Each notice has a name, a type (shipping notice or contract obligation), a due date, a done tick, and up to three reminders.
- **Standard notices.** *Delivery notice* and *Redelivery notice* work out their due date from the contract. Tick one or more notice periods (1 to 30 days, then 35, 40, 45, 50, 55, 60, 75, 90, 120, 150 and 180) and one notice is created per tick. *Heel nomination* and *Other* take a date you type.
- **Three reminders per notice.** Each reminder has its own number of days before the due date and its own list of email recipients.
- **Calendar.** Month view showing notices (teal for shipping, purple for contract obligations) and each contract's delivery and redelivery dates (grey). Click a day to use it as the due date.
- **Alerts.** A red banner lists notices that are inside their reminder window or overdue. Optional desktop notifications work while the page is open.
- **Email.** The server emails each reminder to its recipients about 08:00 UK time on the right day. A notice that needs attention also gets *Outlook web* and *Outlook app* links that open a ready-written email.
- **Saving.** Every change is saved straight away for the whole team. If two people change things at the same moment, the second one is asked which version to keep.
- **Importing from the old version.** If a browser still holds data from the old single-page version, the app offers to add it to the team data. Nothing already saved is changed, and the old copy in the browser is left in place.
- **Excel export.** One button downloads an `.xlsx` with a *Contracts* sheet and a *Notices by contract* sheet.

The notice periods offered are placeholders chosen from general market practice. They are not taken from any real contract. Check them against your own charter parties.

## Using it

1. Open the deployed site and type the team password.
2. On **Contracts**, fill in the form and press *Save contract*.
3. On **Notices**, press *Add a notice*, choose the contract and what is due, set the reminders, and press *Add notice*.

## Run and test on your own computer

You need Node.js 20 or later.

```bash
npm install
npx playwright install chromium
npm test          # server tests and browser tests (no real database or email needed)
npm run dev       # the app at http://localhost:3000 (needs the settings from SETUP.md in a .env.local file)
```

The tests use stand-ins for the database and for Brevo, so they need no settings and send no email.

## Files

| Path | Purpose |
|---|---|
| `app/` | The Next.js page, styles and the web addresses under `/api` |
| `components/` | The parts of the page (calendar, contracts, notices, email panel) |
| `lib/` | Rules, data checking, reminders, database and email code |
| `tests/` | Automated tests |
| `AGENTS.md` | Instructions for AI agents and new developers |
| `CLAUDE.md` | Points Claude Code at `AGENTS.md` |
| `SETUP.md` | Step-by-step: database, Brevo, Vercel settings, checking it works |
| `vercel.json` | The daily reminder job |

## Known limits

- Reminder emails go out once a day, not at an exact time.
- Emails are sent from one sender address verified in Brevo; free-mail addresses may land in spam (see `SETUP.md`).
- One shared team password and one shared data set. There are no separate user accounts.
- Editing a contract's delivery or redelivery date does not move notices that were already calculated from it.
- Notice periods stop at 180 days.
