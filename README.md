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

Create the first Management login from the command line, then add everyone else in Settings:

```sh
npm run create-user -- Adel_hassan@live.com "Adel Maksoud" <password> management,finance,engineering
```

Settings → Approvers sets who signs each payment-request step; until other people are named, Adel signs all three.

## Build status

Done: logins and roles, chart of accounts, cost centers with automatic project GL codes, customers and vendors,
Expense / Collection / Transfer entries with approval, return and reversal, full history per entry,
trial balance, income statement, balance sheet, general ledger, import of the old app's data,
payment requests (إذن صرف) with Finance → Engineering → Management approval and email, vendor payments,
settings (approvers per step, people and roles, company rules), receipt photos and PDFs on payment requests
and expense entries (phone camera; stored on disk locally, in a private Supabase Storage bucket in production),
sales invoices (INV-00001…, VAT 14%, printable, void by reversal) and customer receipts (RCT-00001…, allocated
to invoices, WHT withheld by the customer goes to WHT receivable).

Next: banks and reconciliation, payroll, tasks, tenders, aging and budget vs actual, Excel/PDF export.
