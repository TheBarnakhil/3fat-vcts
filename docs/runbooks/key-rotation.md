# Key & secret rotation runbook

This runbook covers rotating the cryptographic secrets that gate the VCTS
backend. Each section is **independent** - rotate only what you need to
unless you have reason to believe a secret was leaked, in which case rotate
everything.

## Inventory

| Secret | Used for | Rotation impact | How to generate |
| --- | --- | --- | --- |
| `JWT_PRIVATE_KEY_BASE64` + `JWT_PUBLIC_KEY_BASE64` | RS256 signing of access tokens | All issued access tokens are invalidated; refresh tokens still work because they are opaque. Users may need to log in again. | `pnpm keys:generate` (the first two lines). |
| `PASSWORD_PEPPER` | Mixed into bcrypt input | **Invalidates every user password.** Only rotate during a planned reset campaign. | `pnpm keys:generate` (3rd line). |
| `AUDIT_HMAC_SECRET` | HMAC-chains audit_trail rows | Existing audit chains can no longer be verified end-to-end. Document the rotation point in the audit trail itself before rotating. | `pnpm keys:generate` (4th line). |
| `APP_DB_PASSWORD` | Password for the `vcts_app` Postgres role | All in-flight DB connections fail until DATABASE_URL is also updated. | `pnpm keys:generate` (5th line) **plus** rerun `pnpm db:rls`. |
| `CRON_SECRET` | Bearer for `/api/cron/visits/recompute` | Vercel Cron stops calling the recompute endpoint until the new secret is propagated. | Any 32+ byte url-safe random string (`openssl rand -base64 32`). |
| `JWT_REFRESH_TOKEN` rows | Per-user refresh tokens | One row per logged-in user-device. `DELETE FROM refresh_tokens WHERE …` forces re-login. | n/a (server-side state, not env). |
| Cloudflare R2 access key / secret | Presigned PUT/GET URLs | Already-signed URLs continue working until they expire (max `RECEIPT_PRESIGN_TTL_SECONDS`). New presign requests fail until env is updated. | Cloudflare dashboard -> R2 -> Manage API Tokens. |

## Rotating JWT signing keys (the most common rotation)

Goal: replace the RS256 keypair without locking everyone out. Because
access tokens have an 8h lifetime by default the system self-heals once
the new public key is deployed.

1. Generate a new pair locally:
   ```bash
   pnpm keys:generate
   ```
   Copy the `JWT_PRIVATE_KEY_BASE64` and `JWT_PUBLIC_KEY_BASE64` lines.

2. **Optional dual-key window** (recommended for zero downtime). The
   verifier in `src/lib/auth/jwt.ts` currently accepts a single public
   key. To allow a 8-24h overlap:
   - Add a `JWT_PUBLIC_KEYS_BASE64` env that supports a comma-separated
     list. The verifier should attempt each key in order.
   - Push that change to prod **before** rotating.
   - Set `JWT_PUBLIC_KEYS_BASE64="<new-pub>,<old-pub>"` and the new
     `JWT_PRIVATE_KEY_BASE64=<new-priv>`.
   - After the access-token TTL has expired, drop `<old-pub>`.
   *(If you skip this step, every active user must log in again.)*

3. Update Vercel env (one project, three environments):
   ```bash
   npx vercel env rm JWT_PRIVATE_KEY_BASE64 production
   printf '%s' '<new private base64>' | npx vercel env add JWT_PRIVATE_KEY_BASE64 production
   npx vercel env rm JWT_PUBLIC_KEY_BASE64 production
   printf '%s' '<new public base64>' | npx vercel env add JWT_PUBLIC_KEY_BASE64 production
   ```
   Do the same for `preview` + `development` if those branches need to
   stay in sync. Always use `printf` (never `echo`) to avoid a trailing
   newline being baked into the value, which Next.js will then refuse to
   accept as a valid header.

4. Redeploy:
   ```bash
   npx vercel --prod
   ```

5. Verify:
   - `curl https://<host>/api/me -H "Authorization: Bearer <stale-token>"` should return `401`.
   - Login + `/api/me` with a fresh token should return `200`.

6. Update local `.env.local` for any developers who need to keep working.

## Rotating `CRON_SECRET`

1. Generate `openssl rand -base64 32` (or run `pnpm keys:generate`).
2. Update Vercel env in **production** only:
   ```bash
   npx vercel env rm CRON_SECRET production
   printf '%s' '<new secret>' | npx vercel env add CRON_SECRET production
   ```
3. Redeploy. Vercel Cron picks up the new `Authorization` header from the
   project's encrypted env automatically.
4. Verify with the isolation script: `pnpm verify:isolation` - the
   "GET /api/cron/visits/recompute (no secret)" case must still return
   401.

## Rotating `AUDIT_HMAC_SECRET`

⚠️ **High-impact.** Rotating this means existing audit rows can no longer
be verified together with new ones. Treat as a security incident response
or a planned cut-over, not routine maintenance.

1. Run `pnpm verify:phase1` (or the equivalent audit verifier) to confirm
   the chain is currently intact.
2. Append a synthetic `audit.rotation` row in each tenant's chain that
   documents the rotation timestamp and the operator who triggered it.
3. Update env, redeploy, then accept that `verifyChain()` will only ever
   return `ok: true` for rows written **after** the rotation point. Older
   rows are still archivable but verification has to be done with the
   prior secret retrieved from your secrets backup.
4. Tell auditors the rotation date in writing.

## Rotating `APP_DB_PASSWORD`

The `vcts_app` Postgres role is the principal that runtime queries use
(it has no `BYPASSRLS`, so RLS keeps tenants isolated). Rotation must be
atomic with the application's `DATABASE_URL` because the password lives
in both places.

1. Generate a new password (last line of `pnpm keys:generate`).
2. Update `APP_DB_PASSWORD` and the embedded password in
   `DATABASE_URL` / `DATABASE_URL_UNPOOLED` in Vercel:
   ```bash
   npx vercel env rm APP_DB_PASSWORD production
   printf '%s' '<new>' | npx vercel env add APP_DB_PASSWORD production
   # ...same for DATABASE_URL[_UNPOOLED] with the new password embedded
   ```
3. From a local terminal authenticated against Neon as the **owner**
   role (not `vcts_app`):
   ```bash
   pnpm db:rls
   ```
   This script rewrites the role's password to match `APP_DB_PASSWORD`.
4. Redeploy. Existing in-flight requests will see "password
   authentication failed" once until the new env is rolled out; this is
   self-healing within ~30s on Vercel.

## Forcibly logging every user out

Sometimes you want to force re-login without rotating signing keys
(e.g. a stolen device, an employee leaving). The simplest path is to
delete the relevant `refresh_tokens` rows:

```sql
-- One user
DELETE FROM refresh_tokens WHERE user_id = '<uuid>';

-- One tenant (after a tenant-wide breach)
DELETE FROM refresh_tokens WHERE tenant_id = '<uuid>';

-- Everybody (last resort)
DELETE FROM refresh_tokens;
```

Access tokens already issued continue to work until they expire; rotate
`JWT_PRIVATE_KEY_BASE64` to revoke them too.

## R2 access keys

Cloudflare R2 supports rotating access keys without downtime:

1. Generate a second key in the dashboard (R2 → Manage API Tokens).
2. Update `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` in Vercel and
   redeploy.
3. After the next deploy is healthy, **delete the old key** in
   Cloudflare. Already-presigned URLs signed with the old key remain
   valid until they expire (default 15 min via
   `RECEIPT_PRESIGN_TTL_SECONDS`).

## Verification checklist after any rotation

- [ ] `pnpm verify:isolation` against the rotated environment - 55/55 pass
- [ ] `pnpm verify:phase1` (audit chain integrity) - both tenants `ok`
- [ ] Manual login test in the web admin and the Android app
- [ ] Spot-check a presigned receipt URL still resolves
- [ ] Vercel function logs free of `unauthorized` floods for ~5 minutes

## Bootstrap checklist (new prod database)

The May 2026 cross-tenant outage came from running `pnpm db:push` once
during initial provisioning and *not* `pnpm db:rls`. Without RLS, every
tenant-scoped table sits at `relrowsecurity=false policies=0` and every
cross-tenant query silently returns all rows. Postgres remembers
`FORCE ROW LEVEL SECURITY` (it's sticky across DISABLE) but FORCE alone
does nothing without ENABLE.

Whenever you spin up a fresh prod / staging Neon branch:

1. `pnpm db:push` - applies the schema.
2. `pnpm db:rls` - **mandatory**, never skip. The script's
   `=== RLS state BEFORE ===` block tells you instantly if a table is
   missing RLS or a policy. After the run, every tenant-scoped table
   must show `rls=true forced=true policies=1` and `vcts_app role`
   must show `bypassrls=false`.
3. `pnpm db:seed` - if you want fixture data (only for dev / staging).
4. `pnpm verify:isolation` against the new environment - must pass
   55/55.

Do **not** rely on Drizzle migrations or `db:push` to manage RLS;
Drizzle has no concept of policies. RLS is owned exclusively by
`apply-rls.ts`, which is idempotent and safe to re-run on every deploy.

## Schema-touching deploy ordering

Track B (May 2026) hit a self-inflicted outage from deploying code that
referenced `refresh_tokens.device_fingerprint` *before* the column
existed in prod. Login routes then 500'd until the column was added.

Rule: any track that adds or alters a column ships in **two commits**:

1. **Migration commit** - schema change only (`pnpm db:push` against
   prod immediately after merge, before the second commit's deploy
   reaches the lambda). Verify the column exists with the diagnostic
   path of choice (`pnpm db:rls` is fine, it'll print the new column
   in its dump; `psql` works too).
2. **Code commit** - new logic that uses the column.

For platforms where the user's local network blocks the Neon WebSocket
or DNS, fall back to: ask Neon support to apply the migration via the
Neon console SQL editor, switch to a phone hotspot, or write a one-shot
migration endpoint protected by `CRON_SECRET` (delete the endpoint as
its own commit immediately after the migration runs - never leave it in
the deployed app).
