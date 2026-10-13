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

HR (the Admin & HR department, Finance and Management) keeps every employee's file under HR → Employees: personal and contract data,
Office or Site, the Employment Documents checklist with photos or scans per document, and the login, created from the file
(the employee gets the file's name and department). Tasks are assigned to employees, with or without a login. Salary figures stay under Payroll.

Attendance: everyone with an employee file clocks in and out on the phone (Clock in): a selfie and the GPS position go with each tap.
Office staff may clock in only within the office radius once HR has set the office location (HR → Attendance → Attendance settings);
site staff clock in anywhere and HR sees where. HR → Attendance shows the month per employee, the selfies and places to check, lateness
and overtime; "Fill overtime and lateness from timesheets" on a payroll run prices them from each person's hourly cost
((basic + allowances) ÷ standard monthly hours). Designers start and stop design work on a project from the same page; the hours and
their cost show on the project and under Attendance → Design hours per project.

Leave: everyone asks from the phone (Leave → Ask for leave); the head of their department signs first, then HR (a head who is also HR
signs both at once), and each request waits on the Approvals page. Annual leave is 21 working days a year, 30 after ten years of service
or from age 50, pro rata in the hire year; casual leave comes off that balance two days at a time; sick, unpaid and other leave have no balance.
HR → Pay items holds the month's bonuses, typed overtime, penalties, advances to recover, loans (an instalment a month from the first month)
and other deductions; "Fill from timesheets and pay items" on the payroll run takes them and the approved unpaid days in. HR → HR reports:
reminders (contracts and probations ending, no insurance number, missing documents, waiting requests, open days), headcount, leave balances,
documents and each person's KPIs from their tasks and attendance.

Projects: Finance or an engineer adds a project (Projects → Cost centers → New project), which opens the company's Project
Information form AF-PI-01 (35 answers in six sections, a notes box on every field, unit photos, drawings and the general layout The Designer box of section 3 is a picker of all employees (or a typed name and contact for an outside designer): picking an employee gives them the project as a task under Tasks (one open task per project, replaced when the designer changes) and makes them the owner of the project's drawing sets.
as files). "Mark the form complete" moves the project to the Design phase (or straight to QS and pricing when the interior design
is already ready); the phases Project form → Design → QS and pricing → Planning → Execution → Handover show on the project page and
in the list, and Finance or an engineer can move a project by hand with a note. Engineering has two sections, Technical Office and
Site execution (departments under Engineering: members get Engineering's permissions, and a section without a head sends its requests
to the head of Engineering). Settings → Org chart names who holds each position (director of engineering, head of design, technical
office head, designers, planning, QS, pricing, cost control, site engineers, procurement, HR and Finance heads).

Design: every project in the Design phase appears under Projects → Design with three drawing sets, the Main Concept 2D, the Main
Concept 3D and the Shop drawings, each started with the company's default list of drawings (the designer adds, removes and revises
drawings and attaches the files from the phone). "Submit for approval" sends a set to the head of design, then the technical office
head, then the director of engineering (the org-chart holders, or the section and department heads, or Management; each can send it
back with a note); an approved concept goes to the client, whose approval or changes the designer records; approved shop drawings are
issued for construction (every drawing is stamped with its issue date and the project moves to QS and pricing). Each set has a group
chat for the designer and the signers, with every step noted. The Drawing register lists every drawing with its revisions and status,
Finishes & materials keeps what the client chose per room, and the Design status and Hours and cost tabs show where each set waits
and the design hours against the design fee set on the project.

QS and pricing: Projects → QS and pricing holds the Master BOQ workbook of the technical office. An estimate per project (with
revisions) carries the five calculators, bathroom and kitchen plumbing rough-in (dimensions, distances to the risers, the fixtures
and appliances), electrical rough-in (points per room: lights, switches, sockets, power, heater, TV, data) and the sanitary and
electrical finishing lists; the app counts the materials with the workbook's formulas, waste factors and whole purchase units, and
their totals price the linked Master BOQ items (bathroom × the number of bathrooms + labour, kitchen + labour, electrical, sanitary,
electrical finishing); the other items take typed quantities and rates. The dry cost is 70 % of the client price (risk 10 %, margin
20 %, both changeable) and VAT 14 % is shown apart. The Rate table tab holds the unit prices (Procurement, the engineers or Finance
change them; a new estimate takes the prices of the day). "Client BOQ (print)" prints the quotation at client rates with the logo;
"Send to the client" freezes the estimate, "Client accepted" makes it the contract (the project's contract value), its Master BOQ
the project's budget on BOQ vs actual, its materials the project's material plan, and moves the project to Planning; "New revision"
copies an estimate. The BOQ summary tab lists every project's dry cost, risk, margin, client price and contract.

Settings → Departments names the head of each department (the first signer of its payment requests) and what its members may do;
Settings → People puts each login in a department. The final approval is given by the people ticked under Settings → Approvals.

## Deployment

Production runs on Vercel (the app) and Supabase (Postgres with daily backups, and a private Storage bucket for the
receipt photos), both in Frankfurt. The step-by-step guide for the owner is in the project's go-live document.

- Environment variables on Vercel, for Production only: `DATABASE_URL` (the Supabase **Session pooler** line, port 5432, pasted exactly as
  Connect shows it, `[YOUR-PASSWORD]` included; the transaction pooler on 6543 loses replies to pipelined queries), `DATABASE_PASSWORD`
  (the database password on its own, any characters; it replaces `[YOUR-PASSWORD]`, or whatever password the line holds), `APP_URL`, `APP_TZ=Africa/Cairo`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `STORAGE_BUCKET=attachments`, `SETUP_CODE`;
  later `SMTP_URL` and `EMAIL_FROM` for the approval emails. A test copy gets its own values under Preview, plus
  `MIGRATE_PREVIEW=1`.
- `npm run build` applies `db/migrations/*.sql` before building, so every deployment updates its own database
  (under an advisory lock, so two builds cannot collide). A production build without `DATABASE_URL` fails on purpose;
  a preview build leaves tables alone unless `MIGRATE_PREVIEW=1` is set for the Preview environment.
- Connections outside localhost use TLS; prepared statements are off on port 6543. Each function keeps at most two
  connections (ten on the transaction pooler, where pipelining onto a busy connection can lose a reply).
- Server actions accept bodies up to 9 MB; phone photos above 1.5 MB are shrunk in the browser before upload.
- Ten wrong passwords in a row lock a login for fifteen minutes. Temporary passwords are shown once on screen and
  never written to the address bar or the log.

## Build status

Done: logins and roles, chart of accounts (one line per GL code with its total over all cost centers, a cost-center filter and the split per project), cost centers with automatic project GL codes, customers and vendors,
Expense / Collection / Transfer entries with approval, return and reversal, full history per entry,
trial balance, income statement, balance sheet, general ledger, import of the old app's data,
payment requests (إذن صرف) approved by the head of their department (a project's by the head of Engineering), then Management, with email, vendor payments,
settings (departments as groups with a head and what members can do, people, final approvers, company rules), receipt photos and PDFs on payment requests
and expense entries (phone camera; stored on disk locally, in a private Supabase Storage bucket in production),
sales invoices (INV-00001…, typed Design / Fit-out / Furniture, each type on its own revenue code R111–R113, VAT 14%,
printable with the CIB account details clients pay into, void by reversal), Money received (RCT-00001…, cash or bank
transfer, for a project, against invoices or as an advance, WHT withheld by the client goes to WHT receivable, printed as
a cash receipt or a bank transfer receipt, void by reversal), Collections (by project: client, contract, invoiced,
collected, still to receive; totals per type for a period; every receipt and direct collection with how it came in), Banks & cash (the CIB current account, the CIB
credit card with its limit, owed and available, and petty cash boxes with their holders; every payment out of one
gets a reference number when it posts, CIB-34-00001 from the bank, CC-12-00001 from the card, PT-00001 from cash,
and vendor payments carry it; bank charges and interest recorded from the bank's own page; a reconciliation summary per
period grouped as the statement is read, credited: transfers to vendors, bank charges, credit card settlement, transfers
between accounts, salaries, partners' withdrawals; debited: collections, partners' deposits, interest, transfers; statement reconciliation by
ticking cleared lines; payment requests are paid by bank transfer only; Finance only), Partners (Adel, Haitham, Youssef
and Marwan at 25% each, a current account per partner Q111–Q114 under Equity: money put in, withdrawals with a payment
reference, Management shares out a period's profit (or loss) from retained earnings by share, once per period, redone by
reversal; Finance), Purchasing (a material list, each material on its GL code, a starter list of 20 until the real one
arrives; purchase requests PRQ-00001 by anyone for a project or a department, priced by Procurement with the vendor, then
the department head (a project's: the head of Engineering), then Management, becoming purchase order PO-00001, printed
with the logo; Receive and invoice by Finance against the PO with the vendor's invoice attached, VI-00001, posted to the
items' GL codes for the PO's cost center and to the vendor's account, with ordered / received / remaining per line; a
payment request can tick the vendor's unpaid invoices instead of having lines, and once approved those invoices are paid
from Pay a vendor; a vendor account page per vendor; an unpaid vendor invoice can be voided), BOQ per project (upload an
Excel .xlsx or CSV BOQ, English or Arabic headers, read without extra libraries; each line matched to one of the project's
GL codes by its code column or by name, the rest by hand; BOQ vs actual vs on order per GL code with % used; a new
upload replaces the BOQ; Finance or Engineering), Payroll (employees, monthly runs with
overtime and deductions, Egyptian social insurance 11% / 18.75% between 2,700 and 16,700, salary tax on annualised
pay with the 20,000 exemption and progressive brackets, a per-employee "no social insurance or salary tax" switch for staff
paid the full salary, posting per project or department, salary payment; Finance only),
Tasks (board To do → In progress → Review → Done, assignee, due date, priority, comments, links from documents),
Tenders (BOQ per trade with paste from Excel, up to 12 bidders per trade with currency, wastage and discount,
comparison and award per trade, markup per trade and client price with VAT, Excel CSV and printable offer,
a won tender becomes a cost center with its contract value and cost budget; Tenders role),
Reports: cost centers (revenue, cost and budget used per project, grouped by type, service or unit), budget vs actual
per GL code (with committed payment requests), aging of payables and receivables by days past due, VAT, WHT and
deductions for the returns; every report exports to Excel (CSV) and prints to PDF.

Next: the owner creates the Supabase and Vercel accounts and deploys (see Deployment); then the cut-over import of the live books.
