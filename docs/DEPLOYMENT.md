# Deployment (Vercel + MongoDB Atlas)

Integrations are disabled or sandboxed until configured. Nothing below has been verified against live accounts. Test each step in a staging project first.

## 1. MongoDB Atlas

1. Create a cluster (M10+ recommended for production: continuous backups and point-in-time restore). Region close to Vercel's (for example `eu-west` / `af-south-1`).
2. Create a database user for the app with `readWrite` on the `homebase` database. Optionally create a custom role that allows only `insert`/`find` on `timelineevents` and `auditlogs` (see SECURITY.md).
3. Network access: allow Vercel's egress (or `0.0.0.0/0` with a strong password, plus Atlas IP access logs).
4. `MONGODB_URI=mongodb+srv://...`, `MONGODB_DB=homebase`.
5. After the first deploy (and any deploy that changes indexes): `npm run db:indexes` with production env vars (from a trusted machine).

### Region (important for speed)
Put the Vercel functions in the same region as the Atlas cluster: every page makes several database calls, and a cross-continent hop adds ~100 ms to each. This project's cluster is AWS `eu-west-3` (Paris), so `vercel.json` sets `"regions": ["cdg1"]`. If you move the cluster, change the region to match (e.g. Frankfurt `eu-central-1` → `fra1`, Ireland `eu-west-1` → `dub1`).

## 2. Environment variables (Vercel → Settings → Environment Variables)

Use separate values for Preview and Production. Required in production:

| Variable | Notes |
| --- | --- |
| `APP_URL` | `https://your-domain` (must be https) |
| `APP_SECRET` | 32+ random chars |
| `MONGODB_URI`, `MONGODB_DB` | |
| `CRON_SECRET` | 16+ random chars; Vercel Cron sends it as a Bearer token |
| `PAYMENT_PROVIDER` | `paystack` (or `disabled` to launch with transfers only) |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY` | test keys in Preview, live keys only in Production |
| `STORAGE_DRIVER=cloudinary`, `CLOUDINARY_URL` | `cloudinary://API_KEY:API_SECRET@CLOUD_NAME` (dashboard "API environment variable"); local storage is refused in production |
| `EMAIL_PROVIDER=smtp`, `SMTP_URL`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | Nodemailer over any SMTP server (Gmail app password, Brevo SMTP, Zoho…). `brevo` (HTTP API) also supported |
| `SMS_PROVIDER`, `TERMII_*` | optional; see §5b |
| `WHATSAPP_PROVIDER`, `WHATSAPP_*` | optional; see §5b |
| `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_SUPPORT_EMAIL` | public |
| `ERROR_WEBHOOK_URL` | optional error relay |

The app validates configuration at startup (`instrumentation.ts`) and refuses insecure combinations (mock payments, local storage, http URL, missing cron secret).

## 3. Paystack

1. Create the Paystack business and complete compliance (KYC) for live mode. Account eligibility is Paystack's decision.
2. **Test mode first:** Settings → API Keys & Webhooks → copy the *test* secret/public keys to Preview env.
3. Webhook URL: `https://<preview-or-prod-domain>/api/webhooks/paystack` (set separately for test and live).
4. Callback URL: set by the app per transaction (`/tenant/payments/callback`); nothing to configure.
5. Optionally restrict webhooks to Paystack's published IPs at your firewall/WAF; signature verification is always enforced.
6. Test with Paystack's test cards: success, decline, and abandoned checkout. Confirm that each results in exactly one confirmed payment and one receipt, that a failed card leaves the balance unchanged, and that re-sending the webhook from the dashboard changes nothing.
7. Only then switch Production to live keys.

**Local sandbox:** `PAYMENT_PROVIDER=mock` gives a fake checkout page with success / failure / wrong amount / cancel, delivered through the same signed-webhook and verification path. It is refused in production.

## 4. Cloudinary

1. Create a product environment; copy cloud name, API key and secret.
2. Settings → Security: enable **"Strict transformations"** and **restrict "authenticated" and "private" delivery** (do not enable unsigned uploads; this app uploads server-side only).
3. Private files use delivery type `authenticated` and are served through short-lived `private_download_url` links that the app issues after checking access. Property photos use the public `upload` type.
4. Optional: set a folder (`CLOUDINARY_FOLDER`), and lifecycle/backup policies.

If your Cloudinary plan or configuration can't guarantee private delivery, implement the `StorageProvider` interface (`src/server/providers/storage.ts`) for an S3-compatible private bucket with presigned GET URLs, and switch `STORAGE_DRIVER`.

## 5. Email (Nodemailer / SMTP)

Set `EMAIL_PROVIDER=smtp` and `SMTP_URL`:

- **Gmail** (free, ~500/day): enable 2-Step Verification → Google Account → Security → App passwords → create one. Then `SMTP_URL=smtps://you%40gmail.com:APPPASSWORD@smtp.gmail.com:465` (write `@` in the username as `%40`) and `EMAIL_FROM_ADDRESS=you@gmail.com`.
- **Brevo SMTP** (free, 300/day): `SMTP_URL=smtp://LOGIN:SMTP_KEY@smtp-relay.brevo.com:587`; verify the sender in Brevo.
- For a custom domain, set up SPF, DKIM and DMARC at your DNS provider to keep mail out of spam.

Test: request a password reset for your own account and check it arrives.

**Keeping email out of spam.** A personal Gmail account sending links to a `*.vercel.app` address is the most common reason app emails land in spam (and Gmail disables links inside spam). For production:
1. Put the app on your own domain (Vercel → Project → Domains, e.g. `app.yourdomain.com`; add the CNAME it shows at your DNS provider) and update `APP_URL`.
2. Send from an address on that domain through a transactional provider that signs mail for it (Brevo, Resend, Zoho ZeptoMail, Amazon SES…): add the SPF, DKIM and DMARC records the provider gives you, then set `SMTP_URL` (or `EMAIL_PROVIDER=brevo`) and `EMAIL_FROM_ADDRESS=no-reply@yourdomain.com`.
3. Landlords can always use **Get link to share** on a tenancy to send the invitation by WhatsApp/SMS instead of relying on email.

The app already sends plain transactional mail: text + HTML versions, the landlord as Reply-To on invitations, a visible copyable link, and one-click `List-Unsubscribe` headers on notification emails.

## 5b. SMS and WhatsApp (optional, off by default)

Users verify their phone with a one-time code and opt in per channel (Settings → Text alerts). Only time-sensitive events are texted (rent upcoming/due/overdue, payment outcomes, new payment claims for landlords, repair updates, renewals), never between `QUIET_HOURS_START`–`QUIET_HOURS_END` (default 21:00–07:00 WAT).

**WhatsApp — Meta WhatsApp Cloud API** (no platform fee; Meta charges per template message in production; a free test number can message up to 5 verified recipients):
1. developers.facebook.com → create an app (type Business) → add **WhatsApp**.
2. API Setup: copy the **Phone number ID**; create a **permanent access token** via a System User in Business Settings with `whatsapp_business_messaging` permission.
3. WhatsApp Manager → Message templates, create and get approved:
   - `homebase_update` — category **Utility**, language English, body: `{{1}}: {{2}}` (sample: `Rent due today` / `₦150,000 for rent is due today.`)
   - `homebase_code` — category **Authentication**, with a **copy code** button.
4. Set `WHATSAPP_PROVIDER=meta`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (and `WHATSAPP_API_VERSION` to the version shown in your app dashboard if different from `v22.0`).

**SMS — Termii** (pay-as-you-go in NGN, no monthly fee):
1. Create an account at termii.com, fund the wallet, and register a **Sender ID** (e.g. `Homebase`; approval takes a few days).
2. Set `SMS_PROVIDER=termii`, `TERMII_API_KEY`, `TERMII_SENDER_ID`, and `TERMII_BASE_URL` from your dashboard. Keep `TERMII_CHANNEL=dnd` so numbers on Do-Not-Disturb still receive transactional alerts.

Provider rejections (bad number, unapproved template, empty wallet) are marked failed immediately; temporary errors retry with backoff. Status is visible per notification in the database (`sms.*`, `whatsapp.*`).

## 5c. Brevo HTTP API (alternative to SMTP)

1. Create an account, verify the sending domain (SPF, DKIM, DMARC) and sender address.
2. Create an API key (SMTP & Transactional) → `BREVO_API_KEY`.
3. Send a password reset to yourself in Preview to verify it works.

## 6. Scheduler

`vercel.json` schedules `GET /api/cron/run` daily at 06:00 UTC (07:00 WAT). On Vercel Pro, change it to hourly (`0 * * * *`) for faster email retries and online-payment reconciliation. The endpoint is idempotent, so running it more often is safe. Manual run: `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/run`.

Not using Vercel? Any scheduler (GitHub Actions, cron, a cloud scheduler) can call the same URL.

## 7. Health and monitoring

- `GET /api/health` returns 200 with `{status:"ok"}` when configuration is valid and the database answers; otherwise 503. Point an uptime monitor at it.
- Logs are structured JSON with secrets redacted (Vercel → Logs, or a log drain). Server errors are reported through `onRequestError` and, if set, forwarded to `ERROR_WEBHOOK_URL`.
- Admin console (`/admin`): dead jobs, failed webhooks and failed emails.

## 8. Backups and recovery

- **Atlas continuous backup with point-in-time restore** (M10+). Keep snapshots for at least 30 days; keep monthly snapshots for 12 months.
- Cloudinary: enable backups for the private folder, or replicate to cold storage.
- **Restore drill (quarterly, and before launch):** restore a snapshot into a *new* cluster; point a staging deployment at it; run `npm run db:indexes`; sign in as a test landlord; open Reconciliation for a few tenancies and confirm "All charges, allocations and receipts reconcile"; compare payment totals with the Paystack dashboard for the same period. Record the date and the restore time achieved.
- **Recovery from a bad deploy that corrupted data:** put the app in maintenance (set `PAYMENT_PROVIDER=disabled`, redeploy); restore to a point in time before the incident into a new cluster; replay provider events after that time using Paystack's dashboard "resend webhook" (idempotent) and the reconcile job; then switch `MONGODB_URI`.

## 9. Rollback

Vercel → Deployments → promote the previous deployment (instant). Because schema changes are additive, older code runs against newer data. If a release added an index, leaving it is harmless. Never roll back by restoring the database unless data is actually corrupted (see above).

## 10. Production readiness checklist

- [ ] All production env vars set; `/api/health` returns ok
- [ ] `npm run db:indexes` run against production
- [ ] Atlas backups on; one restore drill completed and documented
- [ ] DB user follows least privilege; append-only role for audit collections (optional, recommended)
- [ ] Paystack test-mode end-to-end done (success, failure, abandoned, webhook resend, refund); live keys only in Production
- [ ] Paystack webhook URL set for live mode
- [ ] Cloudinary private delivery verified: a private file URL copied from the app expires and can't be guessed
- [ ] Brevo domain authenticated; reset and invitation emails arrive and aren't marked as spam
- [ ] Cron configured and a manual run returns 200
- [ ] Admin account created with a strong unique password; no shared accounts
- [ ] Privacy notice and terms reviewed by a Nigerian legal/data-protection professional; support email monitored
- [ ] Incident-response contacts filled in (SECURITY.md)
- [ ] `npm audit` reviewed; dependencies up to date
- [ ] Pilot with a small number of landlords before broader launch
