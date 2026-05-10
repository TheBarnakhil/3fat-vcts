# VCTS Manual Test Plan

Use this checklist before the final "make the app live" phase and after any
schema-touching deploy. It assumes Vercel is deployed, `pnpm db:push` and
`pnpm db:rls` have run, and demo/platform seed data exists where required.

## 1. Preflight

From `web/`:

```bash
pnpm db:push
pnpm db:rls
pnpm db:seed:platform
pnpm verify:isolation
pnpm verify:platform
pnpm test:automated -- --build
```

Expected:

- `verify:isolation` passes all checks.
- `verify:platform` passes all checks.
- `test:automated -- --build` passes unit assertions, TypeScript, lint, and production build.

For final release rehearsal against production:

```bash
VCTS_BASE_URL=https://project-jcsyq.vercel.app pnpm test:release
```

## 2. Web Tenant Login and Dashboard

Credentials:

- Acme admin: `admin@acme.test / Passw0rd!`
- Acme manager: `manager@acme.test / Passw0rd!`
- Acme agent: `agent1@acme.test / Passw0rd!`
- Globex admin: `admin@globex.test / Passw0rd!`

Steps:

1. Open `/login`.
2. Sign in as Acme admin.
3. Confirm `/dashboard` loads and KPIs are populated.
4. Sign out.
5. Sign in as Globex admin.
6. Confirm no Acme customers/collections are visible.

Pass criteria:

- Login succeeds for valid users and fails for wrong password.
- Dashboard data is tenant-scoped.
- Cross-tenant data never appears.

## 3. Customer, Collection, and Ledger

Steps as Acme admin/manager:

1. Open `/customers`.
2. Create a new customer with a pinned map location.
3. Confirm the geofence radius defaults to the tenant setting from **Tenant settings**.
4. Edit the customer and assign it to an agent.
5. Open `/collections`; confirm collection records are visible.
6. Open a customer detail dialog and download ledger CSV + PDF.

Pass criteria:

- New customer saves and appears in the table.
- Assigned agent is shown correctly.
- Ledger CSV has rows and totals.
- Ledger PDF opens with visible header, rows, totals, and no blank pages.

## 4. Tenant Settings

Steps as Acme super admin:

1. Open **Tenant settings** (`/branding`).
2. Edit legal name, address, GSTIN/phone, accent HSL.
3. Upload a PNG/JPEG logo smaller than 1 MB.
4. Change default geofence radius and min GPS accuracy.
5. Change mobile sync interval.
6. Save.
7. Create a new customer and confirm the radius slider uses the new default.

Pass criteria:

- Settings save successfully.
- Receipt branding/verification pages reflect branding changes.
- New customer radius defaults to the saved geofence radius.
- Non-super-admin users see read-only messaging.

## 5. Reviews, Audit, Reports, and Movement

Steps as manager/admin:

1. Open `/reviews`; confirm pending/resolved filters work.
2. Open `/audit`; verify audit rows load.
3. Open `/audit` or audit verify route and confirm chain verification succeeds.
4. Open `/reports`; export CSV and confirm totals match dashboard/collections.
5. Open `/movement`; select an agent and day with location logs.
6. Confirm location fixes, collection markers, and visit counts render.

Pass criteria:

- Manager/admin routes load.
- Agent users are denied manager-only surfaces.
- Movement and report data is tenant-scoped and internally consistent.

## 6. Live Map

Steps as manager/admin/auditor:

1. Open `/map`.
2. Confirm status transitions to Live after the first SSE snapshot.
3. Toggle an Android agent to active duty and wait for location sync.
4. Confirm the agent pin and roster last-seen update.
5. Let the stream reconnect after the server closes the SSE cycle.

Pass criteria:

- Agents see 403 for `/api/stream/agent-locations`.
- Managers/admins/auditors see live or heartbeat status.
- Pins do not jump/auto-fit on every position-only update.

## 7. Platform Console

Prerequisite:

```bash
pnpm db:seed:platform
```

Steps:

1. Open `/platform/login`.
2. Sign in as `platform@3fat.test / Passw0rd!` or configured `PLATFORM_ADMIN_*`.
3. Confirm `/platform` lists all tenants.
4. Create a new tenant with a first super-admin.
5. Suspend and reactivate that tenant.
6. Confirm usage cards and per-tenant columns render:
   - This-month collection count/amount
   - Active agents in last 30 days
   - R2 storage usage or `n/a`

Pass criteria:

- Tenant token cannot access platform APIs.
- Platform token can list/provision/suspend/reactivate tenants.
- Suspended tenants cannot log in.

## 8. Self-Serve Signup

Production prerequisite:

- `RESEND_API_KEY`
- `SIGNUP_FROM_EMAIL`

Steps:

1. Open `/signup`.
2. Fill company slug/name and first admin details.
3. Submit.
4. In non-production, use the displayed development verification link.
5. In production, open the verification email link.
6. Confirm `/signup/verify` creates the tenant and first admin.
7. Sign in via `/login` with the new admin credentials.

Pass criteria:

- Duplicate tenant slug or admin email is rejected.
- Expired/consumed/invalid token is rejected.
- Successful verification creates tenant + admin exactly once.

## 9. Public Receipt Verification

Steps:

1. Open a collection receipt PDF or receipt details.
2. Scan/click the QR verify link.
3. Confirm `/r/{tenantSlug}/{receiptNo}` shows receipt details, branding, map/photo/signature when present.
4. Reverse a collection as manager/admin and reload the public receipt.

Pass criteria:

- Public receipt is tenant-scoped by slug/receipt number.
- Reversed receipts show reversed status.
- Attachments and static map render when available.

## 10. Android Field App

Use Android Studio or a Gradle-enabled machine.

Steps:

1. Install debug or internal-test build.
2. Launch app and grant required permissions when prompted.
3. Log in as `agent1@acme.test / Passw0rd!`.
4. Pull customer list and confirm only assigned customers show.
5. Enable active duty.
6. Confirm persistent notification is visible.
7. Move/emulate location near a customer geofence.
8. Record a collection with GPS, payment mode, remarks, photo, and signature.
9. Go offline, record another collection, then reconnect.
10. Confirm queue drains and web collections/dashboard update.
11. Open receipt preview and share sheet.
12. Confirm on-device PDF matches the web receipt layout.

Pass criteria:

- Agent cannot collect outside geofence or with poor GPS accuracy.
- Offline queue survives app restart and drains on reconnect.
- Location logs appear in web movement/live map.
- Photo/signature upload later attaches to receipt/public verification.

## 11. Final Release Readiness

Before public go-live:

1. Recompute TLS pins if the certificate chain changed.
2. Build signed Android release with `VCTS_RELEASE_*` env vars.
3. Add release keystore SHA-1 + package `com.threefat.vcts` to Google API restrictions.
4. Upload to Play Console internal testing.
5. Confirm Firebase Analytics/Crashlytics sessions appear.
6. Take a Neon backup using `docs/runbooks/neon-backup-restore.md`.
7. Run `pnpm test:release` and complete this manual checklist.

