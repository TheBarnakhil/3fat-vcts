# Neon Backup and Restore Runbook

Operational backup/restore checklist for the VCTS production database.

## Scope

VCTS stores all tenant business data in one Neon Postgres database with tenant isolation enforced by RLS and the `vcts_app` runtime role. Backups must preserve:

- Schema objects and indexes.
- RLS policies.
- Helper functions such as `next_receipt_seq`.
- Tenant/customer/collection/location/audit data.
- The `vcts_app` role password must be re-provisioned after restore by `pnpm db:rls`.

## Routine Backup

From a trusted machine with `DATABASE_URL` set to the owner/admin connection string:

```bash
mkdir -p backups
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="backups/vcts-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Store the dump in encrypted storage. Do not commit dumps to git.

Recommended cadence:

- Daily before business hours.
- Immediately before any schema migration (`pnpm db:push`).
- Immediately before any manual data repair.

## Point-in-Time Recovery

Prefer Neon branching/PITR for production incidents when available:

1. Neon Console -> Project -> Branches.
2. Create a branch from the timestamp immediately before the incident.
3. Run smoke queries against the branch to confirm data state.
4. Either promote the restored branch per Neon procedure or export/import the required rows into production after review.

Always run isolation verification after a restore/promotion:

```bash
cd web
pnpm db:rls
pnpm verify:isolation
```

Current verifier baseline after Phase 10 Track C3: `65 passed, 0 failed`.

## Full Restore Into a Fresh Database

Use this for disaster recovery or staging rehearsal.

1. Create a new Neon database/branch and capture the owner `DATABASE_URL`.
2. Restore the dump:

```bash
pg_restore \
  --dbname "$DATABASE_URL" \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  "backups/vcts-YYYYMMDDTHHMMSSZ.dump"
```

3. Re-apply RLS/runtime-role provisioning:

```bash
cd web
pnpm db:rls
```

4. Confirm the script prints `rls=true forced=true policies=1` for every tenant-scoped table:

```text
customers
collections
collection_reversals
receipt_counters
location_logs
customer_visits
audit_trail
sync_queue
supervisor_reviews
```

5. Point a preview deployment or local `.env.local` at the restored database.
6. Run:

```bash
pnpm verify:isolation
pnpm verify:phase1
```

7. Log in as Acme and Globex admins and spot-check:

- Dashboard totals.
- Customer list.
- Collections list.
- Receipt PDF.
- Audit verification.
- Live map endpoint permissions.

## Audit Chain Check

After restore, verify the audit chain:

```bash
curl -sS \
  -H "Cookie: vcts_access=<admin_cookie>" \
  "https://<host>/api/audit/verify"
```

Expected: verification succeeds and reports no broken chain links. If the restore target has a different `AUDIT_HMAC_SECRET`, old audit rows will not verify. In that case, rotate back to the matching secret or treat the restore as invalid.

## RLS Failure Mode Reminder

`FORCE ROW LEVEL SECURITY` can be present while `relrowsecurity=false`. That state is unsafe: policies are not active and tenant data can leak. The `pnpm db:rls` output is the source of truth; do not ship or promote a database until every tenant table shows:

```text
rls=true forced=true policies=1
```

