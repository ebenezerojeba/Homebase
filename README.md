# Homebase

A mobile-first rental management platform for Nigerian landlords and their tenants, built around a **Shared Tenancy Record**: a timestamped, attributed history of agreed terms, charges, payments, receipts, corrections, repairs, documents and inspections that both parties can see.

> The name is configurable (`APP_NAME`, `NEXT_PUBLIC_APP_NAME`).

## What it does

**Landlords:** properties and units · tenancies with agreed terms (monthly / quarterly / half-yearly / annual, grace period, deposit, extra charges) · tenant invitations · rent ledger with partial payments, credits, adjustments and reversals · payment review workspace · cash/transfer recording · receipts · maintenance workflow with internal notes and expenses · messaging · private documents with versioned agreements · move-in/move-out inspections · financial reports and CSV exports · notifications.

**Tenants:** review terms before joining · see what's due and when · pay online (Paystack) or report a transfer · receipts and statements · repair requests with photos and confirmation · messages · documents · the shared record · privacy self-service.

**Admins:** operational health (dead jobs, failed webhooks/emails), user deactivation, NDPA data requests, audit log. Admins cannot read tenancy financial records.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · MongoDB + Mongoose 9 · Zod 4 · Paystack · Cloudinary · Nodemailer (SMTP) · Termii SMS · WhatsApp Cloud API · Server-Sent Events · Vitest · Playwright.

Production: https://homebase-iota-khaki.vercel.app

## Quick start (local)

Requirements: Node 20.9+ (tested on Node 26), npm.

```bash
npm install
cp .env.example .env.local          # then edit APP_SECRET; defaults use mock payments, console email, local files
npx tsx scripts/dev-db.ts           # terminal 1: in-memory MongoDB replica set (no install needed). Prints MONGODB_URI
# put the printed MONGODB_URI into .env.local, or use your own Atlas dev cluster
npm run dev                         # terminal 2: http://localhost:3000
```

- Emails (verification, invitations, resets) are printed to the server console when `EMAIL_PROVIDER=console`.
- Online payments use a sandbox checkout page when `PAYMENT_PROVIDER=mock`. No money moves.
- `npm run seed:dev` creates two fake demo users (refuses to run against production).
- `ADMIN_PASSWORD=... npm run admin:create -- admin@example.com "Admin Name"` creates a platform admin (admins can't self-register).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint (Next + TypeScript rules) |
| `npm test` | Unit + integration tests (Vitest, in-memory MongoDB replica set) |
| `npm run test:e2e` | Builds, then runs Playwright journeys against the production build |
| `npm run db:indexes` | Create any missing indexes (non-destructive) |
| `npm run check` | typecheck + lint + tests |

The first test run downloads a MongoDB binary (~100 MB) into `node_modules/.cache`. `npm run test:e2e` needs `npx playwright install chromium` once.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — structure, data model, financial invariants, payment flows, jobs
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Vercel/Atlas/Paystack/Cloudinary/Brevo setup, cron, health, backups, recovery, rollback, checklist
- [docs/SECURITY.md](docs/SECURITY.md) — threat model, controls, privacy (NDPA 2023), retention, incident response

## Important limitations

See "Known limitations" in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#known-limitations). In short: no automatic bank-transfer matching (no bank data source is connected), SMS/WhatsApp need paid provider accounts, legal templates are not provided, and the privacy notice and terms are drafts that need legal review.
