# Security, privacy and compliance

## Controls in place

| Area | Control |
| --- | --- |
| Authentication | bcrypt (cost 12); hashed DB-backed sessions; immediate revocation on logout, password change/reset and deactivation; login lockout; no account enumeration on register, reset or login |
| Authorization | every service checks the session actor against `landlordId` / `tenantId` / conversation participants; foreign IDs → 404; admins can't read tenancy financial data; roles are immutable and can't be self-assigned |
| CSRF | SameSite=Lax cookies plus a strict Origin/Referer check on all mutating API requests; auth forms use POST so credentials never land in URLs |
| Input | Zod schemas on every endpoint; ObjectIds validated; strict Mongoose filters; regex input escaped |
| Output | React escaping; email templates escape all dynamic text; CSV export neutralizes formula injection (`= + - @ \t \r`) |
| Headers | nonce-based CSP for scripts (`proxy.ts`), `frame-ancestors 'none'`, HSTS, nosniff, Referrer-Policy, Permissions-Policy, COOP |
| Rate limiting | MongoDB-backed fixed windows on login (IP + email), registration, reset, invitations, uploads, payments, messages, exports and all mutations |
| Payments | server-side initialization; HMAC-SHA512 webhook verification (timing-safe); server-to-server verification of status, amount, currency and reference; idempotent event processing; no card data handled or stored |
| Files | content sniffing; type and size limits; active-PDF/SVG/HTML rejection; generated keys; private delivery via authenticated, expiring links; per-request authorization |
| Audit | append-only `auditlogs` and `timelineevents` (app-level guard); secrets redacted from all metadata and logs |
| Secrets | server-only env module (`server-only` import); `.env*` git-ignored; startup validation |
| Errors | generic messages to clients; stack traces only in server logs (redacted) |

### Database-level append-only (recommended)

```js
db.createRole({ role: "homebaseApp", privileges: [
  { resource: { db: "homebase", collection: "" }, actions: ["find","insert","update","remove","createIndex"] },
], roles: [] })
// then a second role for the audit collections with only find/insert, and run the app user with
// collection-scoped privileges that exclude update/remove on timelineevents and auditlogs.
```

Test any custom role in staging; the app never updates or deletes those collections.

## Data protection (Nigeria Data Protection Act 2023)

- **Minimization:** name, email, optional phone, tenancy and payment records. No NIN/BVN/ID documents are requested, and users are told not to upload them. No creditworthiness scores or public blacklists.
- **Transparency:** `/privacy` notice (draft; needs professional review) shown and accepted at registration and invitation acceptance (timestamp stored).
- **Access by need:** each party sees only their shared tenancy; landlord internal notes are hidden from tenants; admin searches are audited.
- **Data subject rights:** self-service JSON export (Settings → Privacy → Download my data); access/correction/deletion requests tracked in `/admin/data-requests` with a 30-day response target; deactivation revokes access.
- **Retention (proposed; confirm with counsel):**
  - financial records (charges, payments, receipts, timeline): 6 years after tenancy end
  - messages and maintenance: tenancy end + 2 years
  - auth tokens: purged 7 days after expiry
  - sessions: expire after `SESSION_TTL_DAYS`
  - completed jobs: 30 days
  - security logs: 12 months

  After the retention period, run an anonymization script (to be implemented before year 6) that replaces names and emails on closed tenancies with placeholders.
- **Processors:** MongoDB Atlas, Vercel, Cloudinary, Brevo, Paystack. Keep DPAs on file; record transfer safeguards.

## Incident response

1. **Detect:** alerts from the error webhook, failed webhooks/jobs in `/admin`, user reports.
2. **Contain:** rotate the affected secret (`APP_SECRET` rotation invalidates rate-limit keys only; rotate `PAYSTACK_SECRET_KEY` / Cloudinary / Brevo keys at the provider). To force everyone to sign in again, revoke all sessions: `db.sessions.updateMany({}, {$set:{revokedAt:new Date()}})`. Set `PAYMENT_PROVIDER=disabled` if payments are affected.
3. **Assess:** use `auditlogs` and Vercel and Atlas logs to establish what data and which users are affected.
4. **Notify:** if personal data is likely at risk, notify the **NDPC within 72 hours** and affected users without undue delay; inform Paystack if payment flows are involved.
5. **Recover:** see DEPLOYMENT.md §8.
6. **Review:** write a post-incident note with root cause and follow-up actions.

Contacts (fill in before launch): Data Protection Officer ____ · Engineering on-call ____ · Legal ____.

## Dependency hygiene

Run `npm audit` and update dependencies monthly; CI should run `npm run check` and `npm run test:e2e` on every change.
