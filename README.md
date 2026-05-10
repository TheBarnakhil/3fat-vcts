# VCTS - Verified Collection Tracking System

GPS-enforced field-agent collections platform. Multi-tenant.

Structure:

- `web/` - Next.js 16 admin portal + API (TypeScript, Drizzle ORM, Neon Postgres, Upstash Redis). This is what Vercel deploys.
- `android/` - Kotlin + Jetpack Compose field app. See `android/README.md` for setup.
- `VCTS_PRD_v1.0.docx` - product requirements document.

Phases: see the active plan in Cursor (`vcts_multi-phase_build_*.plan.md`).

## Vercel deployment

This repo is connected to Vercel at the repo root. Set the project's
**Root Directory** to `web` so Vercel runs `pnpm install` and `pnpm build`
inside `web/`. Add the secrets from `web/.env.example` to the Vercel project
environment variables (Preview + Production).

### Post-deploy verification before the final live phase

After schema-touching phases deploy to Vercel, run these from `web/` against the
production database before considering the phase verified:

```bash
pnpm db:push
pnpm db:rls
pnpm verify:isolation
```

For Phase 11 platform/self-serve onboarding work, also run:

```bash
pnpm db:seed:platform
pnpm verify:platform
pnpm test:automated -- --build
```

Then verify the user-facing surfaces manually:

- `/platform/login` with the seeded platform admin.
- `/platform` tenant list/create/suspend/reactivate.
- `/signup` and `/signup/verify` after `RESEND_API_KEY` + `SIGNUP_FROM_EMAIL`
  are configured for real email delivery.

Keep these steps complete before the final "make the app live" phase, where the
signed Android build, Play internal testing, API-key SHA-1 restriction, and final
Neon backup are handled.

Full manual regression guidance lives in `docs/testing/manual-test-plan.md`.

Useful automated test commands from `web/`:

```bash
pnpm test:unit          # pure helper assertions only
pnpm test:automated     # unit assertions + TypeScript + ESLint
pnpm test:automated -- --build
pnpm test:release       # unit + TypeScript + ESLint + build + deployed HTTP verifiers
```

## Local dev (web)

```bash
cd web
pnpm install
pnpm keys:generate          # paste the 5 lines into web/.env.local
pnpm db:push                # create tables in Neon
pnpm db:rls                 # provision vcts_app role + RLS policies
pnpm db:seed                # seed acme + globex demo tenants
pnpm dev                    # http://localhost:3000
pnpm verify:phase1          # end-to-end multi-tenant isolation test
```

Demo credentials (after `pnpm db:seed`):

| Tenant | Role        | Email                | Password   |
| ------ | ----------- | -------------------- | ---------- |
| acme   | super_admin | admin@acme.test      | Passw0rd!  |
| acme   | manager     | manager@acme.test    | Passw0rd!  |
| acme   | agent       | agent1@acme.test     | Passw0rd!  |
| acme   | agent       | agent2@acme.test     | Passw0rd!  |
| globex | super_admin | admin@globex.test    | Passw0rd!  |
| globex | agent       | agent1@globex.test   | Passw0rd!  |
