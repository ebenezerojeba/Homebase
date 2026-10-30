# Architecture

## Layout

```
src/
  app/                    Next.js routes
    api/                  JSON route handlers (thin: validate → call service → respond)
    landlord/ tenant/ admin/   role areas; each layout enforces the role server-side
    print/                printable statement and shared record
    (auth)/ invite/ ...   public pages
  components/             ui/ (design system), shared/ (both roles), landlord/, tenant/, admin/
  lib/                    framework-free helpers: money, dates, csv, files, validation, env, logger
  server/
    models/               Mongoose schemas (identity, property, ledger, activity)
    services/             all business logic and authorization (testable without Next)
    providers/            payments (Paystack, mock), storage (Cloudinary, local), email (Brevo, console)
    auth/                 sessions, crypto, rate limiting, actor
    http.ts               route wrapper: auth, role, CSRF origin check, rate limit, error mapping
    db.ts                 serverless-safe connection, transaction helper
  proxy.ts                per-request CSP nonce (Next 16 "proxy", formerly middleware)
  instrumentation.ts      env validation at startup, structured error reporting
tests/unit, tests/integration, tests/e2e
```

Every protected operation goes through a service that receives the `Actor` derived from the server-side session. IDs from the client are always re-checked against ownership (`landlordId`) or membership (`tenantId`). Records the actor can't see return **404**, so guessed IDs reveal nothing.

## Authentication

Custom database sessions (`sessions` collection): a 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie (`__Host-` prefixed and `Secure` in production); only its SHA-256 hash is stored. Logout, password change/reset and deactivation revoke sessions immediately. Passwords use bcrypt (cost 12). Email verification and password reset use single-use, expiring, hashed tokens. Registration and reset responses are identical whether or not an account exists. Login locks for 15 minutes after 8 failures, plus IP and per-email rate limits (MongoDB-backed, so they hold across serverless instances). CSRF: SameSite cookies + strict `Origin`/`Referer` check on every mutating API call.

Roles: `landlord`, `tenant`, `admin`. Roles are immutable on the user document; public registration can only create landlords or tenants; admins are created by script. A session becomes invalid if the user's role or status changes.

## Data model

| Collection | Purpose / key constraints |
| --- | --- |
| users, sessions, authtokens, invitations | identity; unique email; one pending invite per tenancy |
| properties, units | ownership by `landlordId`; unit name unique per property (case-insensitive) |
| tenancies | agreed terms; `rentSchedule[]` is append-only history; `generatedThroughIndex` high-water mark |
| rentcharges | one row per billing period and item; **unique `idempotencyKey`**; `adjustments[]` appended, never edited |
| payments | every payment attempt/claim/record with `source` (provider / tenant_claim / landlord_record), `status`, `statusHistory[]`; unique provider reference; **unique confirmed external reference per landlord** |
| paymentallocations | payment → charge links; unique (paymentId, rentChargeId); reversed, never deleted |
| receipts | one per confirmed payment (unique paymentId); sequential `HB-YYYY-NNNNNN`; voided on reversal |
| webhookevents | idempotency for provider deliveries (unique provider + eventKey) |
| timelineevents | **Shared Tenancy Record** — append-only, server timestamps, source + actor, optional `correctsEventId`, `visibility` |
| auditlogs | append-only security/financial audit trail, redacted metadata |
| maintenancerequests, maintenancecomments | comments are append-only; `visibility: internal` filtered in queries |
| expenses | landlord property expenses; voided with reason, never deleted |
| inspections | move-in/out items with dated photo assets; tenant acknowledgement/dispute |
| conversations, messages | per-tenancy conversation; messages paginated by `(conversationId, createdAt)` |
| notifications | in-app + email delivery state; **unique `dedupeKey`** |
| assets | file metadata only (binaries live in Cloudinary or local dev disk) |
| jobs | persistent scheduled tasks with dedupe keys, locks, retries |
| ratelimits, counters, dataRequests, mocktransactions (dev) | support |

Indexes are declared on the schemas next to the queries that use them. `npm run db:indexes` creates missing ones without dropping anything. In production `autoIndex` is off, so run it after deploys that add indexes.

### Migration strategy

Schema changes are additive (new optional fields with defaults). Any backfill is a separate idempotent script in `scripts/` that is safe to re-run, is tested against a copy of production data, and never drops collections. Destructive changes (removing fields) happen only after a release no longer reads them.

## Money and dates

- All amounts are **integer kobo** (`Number.isSafeInteger` validated on every schema field). Naira input is parsed with string/BigInt arithmetic; prorating uses BigInt; no floating-point arithmetic touches stored or summed amounts.
- Currency is NGN only; provider amounts/currency are checked before crediting.
- Tenancy dates are calendar dates stored as UTC midnight; "today" is computed in Africa/Lagos.
- Billing periods are anchored to the start day-of-month: the 31st becomes the month's last day without drifting (Jan 31 → Feb 28 → Mar 31); leap days are handled the same way. Rent is due at the start of each period; overdue is after `dueDate + gracePeriodDays`. A short final period is billed in full unless `prorateFinalPeriod` is set.
- Charges are generated up to 45 days before they fall due (on tenancy creation, renewal and daily by the scheduler).

## Financial invariants

1. A charge's `amountKobo = baseAmountKobo + Σ adjustments`; `baseAmountKobo` is immutable.
2. A charge's `allocatedKobo = Σ active allocations`, and `0 ≤ allocatedKobo ≤ amountKobo`.
3. For a confirmed rent payment, `Σ active allocations + unallocatedKobo = amountKobo`.
4. Only `confirmed` payments are income. Pending, rejected, failed, abandoned, reversed and refunded payments are not. Deposits (`purpose: deposit`) are tracked separately and never counted as rent.
5. A payment is confirmed at most once (atomic compare-and-set on `status`), has at most one receipt, and an external reference can be confirmed at most once per landlord (unique partial index).
6. Nothing financial is deleted: reversals mark payments `reversed/refunded`, allocations `reversed`, receipts `voided`, and add a timeline event linked to the original.

The landlord's **Reconciliation** tab re-derives invariants 1–3 from raw rows for each tenancy and flags any mismatch.

### Transactions and the fallback

Multi-document financial changes run in MongoDB transactions (Atlas and the test replica set support them). If a deployment has no transactions (`MONGODB_TRANSACTIONS=false` or a standalone server), the same code runs without a session. It stays safe because each operation is ordered: an atomic status transition claims the work, all follow-up writes are idempotent upserts guarded by unique indexes, and allocation/credit updates use optimistic checks on the value read. A crashed operation is completed by re-running it (webhook retry, reconcile job, or repeating the action). Receipt numbers may skip a value in that mode.

## Payment flows

**Online (Paystack)** — the tenant picks charges; the server validates them, binds tenant + tenancy + amount + NGN + a unique reference into a `payments` row (`initiated`) and calls `transaction/initialize`. Confirmation happens only in `verifyAndApplyProviderPayment`, which calls `transaction/verify/:reference` server-to-server and checks reference, status, amount and currency. Triggers: the signed webhook (`/api/webhooks/paystack`, HMAC-SHA512 over the raw body with the secret key), the callback page (a redirect proves nothing; it just triggers server verification), the hourly reconcile job, and a "Check status" button. Mismatched amount or currency is flagged and **not credited**. Duplicate and out-of-order deliveries are harmless: events are deduplicated, and a stale failure can't undo a confirmation. Refund events reverse allocations and void the receipt.

**Bank transfer / POS / cash reported by tenant** — stored as `pending_verification` with reference, date, optional bank and optional proof file. The landlord confirms or rejects it with a reason in the Payment review workspace, which shows prompts such as duplicate references, partial or excess amounts, missing proof, and nothing currently billed. A screenshot is treated as supporting information only.

**Recorded by landlord** — cash/transfer/POS the landlord already received; confirmed immediately, attributed to the landlord, receipt issued, tenant notified.

**Allocation** — the payer's chosen charges first, then the oldest due date, with rent before other charges. Leftover money becomes credit (`unallocatedKobo`) and is applied automatically when new charges are generated.

## Shared Tenancy Record

`timelineevents` is written by services in the same transaction as the change it describes. Each event has a server timestamp, type, source (`tenant_submitted`, `landlord_recorded`, `landlord_confirmed`, `provider_confirmed`, `system`), actor, entity, safe metadata and before/after values. Corrections add a new event pointing to the original via `correctsEventId`. Mongoose middleware blocks updates and deletes; at the database level, grant the app user insert/find only on this collection (see SECURITY.md). Tenants never receive `landlord_only` entries. The record is exportable as CSV and as a printable page.

## Scheduler, notifications and reminders

Channels: in-app (always), email, SMS and WhatsApp (verified, opted-in phones only; time-sensitive types only; quiet hours). Each channel has its own delivery state on the notification (`email.*`, `sms.*`, `whatsapp.*`) and the same lease/retry worker.

Vercel Cron calls `GET /api/cron/run` (Bearer `CRON_SECRET`). It enqueues the day's jobs with dedupe keys (`type:YYYY-MM-DD`) and runs any due jobs: generate charges → close expired tenancies → rent reminders → renewal reminders, plus an hourly online-payment reconcile. Jobs are leased with a lock that expires, retried with exponential backoff, and marked `dead` after max attempts (visible to admins).

Reminders are notifications with deterministic dedupe keys (`reminder:<chargeId>:before:7`, `:due`, `:overdue:14`). Only the nearest applicable reminder fires, so a missed run doesn't cause a burst. Conditions are re-checked at send time, so paid charges and ended tenancies get nothing. Wording is factual and never threatening.

Email delivery: each notification row is leased atomically before sending (no double-sends), retried with backoff up to 5 times, then marked `failed`. Delivery is attempted right after each mutating request (Next `after()`) and again by cron. Users can opt out per type; account emails can't be disabled.

## Files

Validated by content (magic bytes), not by name or browser MIME type. Allowed types are JPEG, PNG, WebP and PDF; PDFs with JavaScript or launch actions, SVG, HTML and executables are rejected. Each category has a size limit. Storage keys are generated (`kind/landlordId/objectId.ext`). Property photos are public Cloudinary assets. Everything else uses Cloudinary's `authenticated` delivery type and is served only via `/api/assets/:id`, which checks access on every request and redirects to a 5-minute signed URL (or streams with `nosniff` and a sandbox CSP in local dev). Agreements, payment evidence, inspection photos and expense receipts can't be deleted by users (retention); agreements are versioned.

## Messaging (real-time)

Messages are persisted (cursor pagination, read receipts, retry-safe sends via `clientId`, attachment ownership checks). Open chats subscribe to `GET /api/conversations/:id/stream` (Server-Sent Events). The server watches MongoDB **change streams** for new messages and read-receipt updates in that conversation and pushes a small "changed" event; the browser then re-fetches through the normal authorised API, so no message content travels over the stream. Participants are checked on connect. Streams close after ~280 s (Vercel function limit) and `EventSource` reconnects automatically; heartbeats every 20 s keep proxies from closing idle connections. If change streams are unavailable the server polls every 3 s instead, and the client keeps a 30 s safety poll (5 s while disconnected). A "Live" badge shows the connection state.

## Known limitations

- **No automatic bank-transfer verification.** No bank data source is connected; transfers are confirmed by the landlord. Matching suggestions are prompts, not verification.
- **SMS/WhatsApp** are implemented (Termii, Meta Cloud API) but off until configured; texts cost money per message with every provider.
- **Vercel Hobby cron runs once a day**, so reminders and email retries run daily; on Pro, set the schedule hourly. Fresh emails are still sent immediately after each action.
- **Paystack** refunds must be started in the Paystack dashboard; the app reflects them via webhook. Fees aren't modelled.
- **Admin access** is intentionally narrow (no tenancy financial data); dispute handling is out of scope.
- **One email address = one role.** A landlord who is also a tenant needs a second email.
- **Tenant moves between units** = end the tenancy, then create a new one (both histories are kept).
- **Invitation acceptance** creates the tenant user before the linking transaction. If linking then fails, the user can sign in and accept again.
- **Legal:** the privacy notice and terms are drafts; no tenancy agreement templates are provided.
- Error monitoring is a structured log plus an optional webhook (`ERROR_WEBHOOK_URL`); a full APM such as Sentry isn't wired in.
