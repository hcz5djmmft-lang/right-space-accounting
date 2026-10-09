# Right Space Accounting (web app)

The new accounting and operations system for Right Space Development: books, cost centers, payment requests
with approvals, payroll, tasks and tenders. English UI, EGP only. It replaces the single-page claude.ai artifact;
the rules carried over from it are in the requirements doc and in `src/lib/ledger.ts` / `src/lib/books.ts`.

## Stack

- Next.js (React) app, one codebase for phone and desktop.
- PostgreSQL database (hosted on Supabase). Ledger rules are enforced in the database too:
  posted entries cannot be changed or deleted, every posted entry must balance, nothing posts on or before the lock date,
  system accounts cannot be deleted. See `db/migrations/001_core.sql`.
- Each person signs in with their own email and password; roles: management, finance, engineering, projects, tenders.

## Run locally

```sh
npm install
cp .env.example .env.local          # set DATABASE_URL
npm run migrate                     # creates the tables
npm run import:old -- <export.js|json>   # loads a copy of the old app's data (sample-data.js works)
npm run create-user -- you@example.com "Your Name" <password> management
npm run dev                         # http://localhost:3000
```

Tests: `npm test` (needs a throwaway database at TEST_DATABASE_URL, default `rsa_test`; it is wiped on every run).

## First login

On a fresh database the app shows a welcome page (`/setup`) that creates the first Management login from the browser;
everyone else is added in Settings → People. With `SETUP_CODE` set, the welcome page asks for that code first.
Locally the command line works too:

```sh
npm run create-user -- Adel_hassan@live.com "Adel Maksoud" <password> management,finance,engineering
```

Settings → Approvers sets who signs each payment-request step; until other people are named, Adel signs all three.

## Deployment

Production runs on Vercel (the app) and Supabase (Postgres with daily backups, and a private Storage bucket for the
receipt photos), both in Frankfurt. The step-by-step guide for the owner is in the project's go-live document.

- Environment variables on Vercel, for Production only: `DATABASE_URL` (the Supabase transaction pooler, port 6543),
  `APP_URL`, `APP_TZ=Africa/Cairo`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `STORAGE_BUCKET=attachments`, `SETUP_CODE`;
  later `SMTP_URL` and `EMAIL_FROM` for the approval emails. A test copy gets its own values under Preview, plus
  `MIGRATE_PREVIEW=1`.
- `npm run build` applies `db/migrations/*.sql` before building, so every deployment updates its own database
  (under an advisory lock, so two builds cannot collide). A production build without `DATABASE_URL` fails on purpose;
  a preview build leaves tables alone unless `MIGRATE_PREVIEW=1` is set for the Preview environment.
- Connections outside localhost use TLS; prepared statements are off on port 6543. Each function keeps at most two
  connections; the pooler multiplexes them.
- Server actions accept bodies up to 9 MB; phone photos above 1.5 MB are shrunk in the browser before upload.
- Ten wrong passwords in a row lock a login for fifteen minutes. Temporary passwords are shown once on screen and
  never written to the address bar or the log.

## Build status

Done: logins and roles, chart of accounts, cost centers with automatic project GL codes, customers and vendors,
Expense / Collection / Transfer entries with approval, return and reversal, full history per entry,
trial balance, income statement, balance sheet, general ledger, import of the old app's data,
payment requests (إذن صرف) with Finance → Engineering → Management approval and email, vendor payments,
settings (approvers per step, people and roles, company rules), receipt photos and PDFs on payment requests
and expense entries (phone camera; stored on disk locally, in a private Supabase Storage bucket in production),
sales invoices (INV-00001…, VAT 14%, printable, void by reversal) and customer receipts (RCT-00001…, allocated
to invoices, WHT withheld by the customer goes to WHT receivable), Banks & cash (balances, activity with running
balance, statement reconciliation by ticking cleared lines; Finance only), Payroll (employees, monthly runs with
overtime and deductions, Egyptian social insurance 11% / 18.75% between 2,700 and 16,700, salary tax on annualised
pay with the 20,000 exemption and progressive brackets, posting per project or department, salary payment; Finance only),
Tasks (board To do → In progress → Review → Done, assignee, due date, priority, comments, links from documents),
Tenders (BOQ per trade with paste from Excel, up to 12 bidders per trade with currency, wastage and discount,
comparison and award per trade, markup per trade and client price with VAT, Excel CSV and printable offer,
a won tender becomes a cost center with its contract value and cost budget; Tenders role),
Reports: cost centers (revenue, cost and budget used per project, grouped by type, service or unit), budget vs actual
per GL code (with committed payment requests), aging of payables and receivables by days past due, VAT, WHT and
deductions for the returns; every report exports to Excel (CSV) and prints to PDF.

Next: the owner creates the Supabase and Vercel accounts and deploys (see Deployment); then the cut-over import of the live books.
