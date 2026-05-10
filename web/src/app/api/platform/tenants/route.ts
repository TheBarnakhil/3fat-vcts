import { and, eq, gte, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { collections, customers, locationLogs, tenants, users } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import { appendAudit } from "@/lib/audit/chain";
import { requirePlatformAuth } from "@/lib/auth/platform-context";
import { hashPassword } from "@/lib/auth/password";
import { badRequest, conflict, toResponse } from "@/lib/errors";
import { prefixUsage, r2Enabled } from "@/lib/storage/r2";

export const runtime = "nodejs";

const CreateBody = z.object({
	slug: z
		.string()
		.trim()
		.toLowerCase()
		.regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, {
			message: "Slug must be 3-50 chars of lowercase letters, numbers, or hyphens",
		}),
	name: z.string().trim().min(2).max(120),
	adminEmail: z.string().email().max(254).toLowerCase(),
	adminName: z.string().trim().min(2).max(120),
	adminPassword: z.string().min(8).max(256),
	branding: z
		.object({
			legalName: z.string().trim().min(1).max(120).optional(),
			address: z.string().trim().min(1).max(240).optional(),
			gstin: z.string().trim().min(1).max(20).optional(),
			phone: z.string().trim().min(1).max(40).optional(),
			accentHsl: z
				.string()
				.trim()
				.regex(/^\d{1,3}\s+\d{1,3}%\s+\d{1,3}%$/)
				.optional(),
		})
		.optional(),
});

export async function GET() {
	try {
		await requirePlatformAuth();
		const now = new Date();
		const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
		const activeSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

		const rows = await withoutTenant(async (tx) => {
			const tenantRows = await tx
				.select({
					id: tenants.id,
					slug: tenants.slug,
					name: tenants.name,
					isActive: tenants.isActive,
					createdAt: tenants.createdAt,
					updatedAt: tenants.updatedAt,
				})
				.from(tenants)
				.orderBy(tenants.createdAt);

			const userCounts = await tx
				.select({
					tenantId: users.tenantId,
					count: sql<number>`count(*)::int`,
				})
				.from(users)
				.groupBy(users.tenantId);
			const customerCounts = await tx
				.select({
					tenantId: customers.tenantId,
					count: sql<number>`count(*)::int`,
				})
				.from(customers)
				.groupBy(customers.tenantId);
			const collectionCounts = await tx
				.select({
					tenantId: collections.tenantId,
					count: sql<number>`count(*)::int`,
				})
				.from(collections)
				.groupBy(collections.tenantId);
			const monthCollections = await tx
				.select({
					tenantId: collections.tenantId,
					count: sql<number>`count(*)::int`,
					amount: sql<number>`coalesce(sum(${collections.amount}), 0)::float8`,
				})
				.from(collections)
				.where(gte(collections.collectedAt, monthStart))
				.groupBy(collections.tenantId);
			const activeAgentRows = await tx
				.select({
					tenantId: users.tenantId,
					count: sql<number>`count(distinct ${users.id})::int`,
				})
				.from(users)
				.leftJoin(
					locationLogs,
					and(
						eq(locationLogs.agentId, users.id),
						eq(locationLogs.tenantId, users.tenantId),
						gte(locationLogs.loggedAt, activeSince),
					),
				)
				.leftJoin(
					collections,
					and(
						eq(collections.agentId, users.id),
						eq(collections.tenantId, users.tenantId),
						gte(collections.collectedAt, activeSince),
					),
				)
				.where(
					and(
						eq(users.role, "agent"),
						eq(users.isActive, true),
						sql`(${locationLogs.id} is not null or ${collections.id} is not null)`,
					),
				)
				.groupBy(users.tenantId);

			const usersByTenant = new Map(userCounts.map((r) => [r.tenantId, r.count]));
			const customersByTenant = new Map(
				customerCounts.map((r) => [r.tenantId, r.count]),
			);
			const collectionsByTenant = new Map(
				collectionCounts.map((r) => [r.tenantId, r.count]),
			);
			const monthlyByTenant = new Map(
				monthCollections.map((r) => [
					r.tenantId,
					{ count: r.count, amount: r.amount },
				]),
			);
			const activeAgentsByTenant = new Map(
				activeAgentRows.map((r) => [r.tenantId, r.count]),
			);

			return tenantRows.map((t) => ({
				...t,
				counts: {
					users: usersByTenant.get(t.id) ?? 0,
					customers: customersByTenant.get(t.id) ?? 0,
					collections: collectionsByTenant.get(t.id) ?? 0,
				},
				usage: {
					monthCollections: monthlyByTenant.get(t.id)?.count ?? 0,
					monthAmount: monthlyByTenant.get(t.id)?.amount ?? 0,
					activeAgents30d: activeAgentsByTenant.get(t.id) ?? 0,
					storage: null as null | { objects: number; bytes: number },
				},
			}));
		});

		const withStorage = r2Enabled()
			? await Promise.all(
					rows.map(async (row) => {
						const storage = await prefixUsage(`t/${row.slug}/`).catch(() => null);
						return { ...row, usage: { ...row.usage, storage } };
					}),
				)
			: rows;

		return NextResponse.json({ tenants: withStorage });
	} catch (err) {
		return toResponse(err);
	}
}

export async function POST(req: NextRequest) {
	try {
		const auth = await requirePlatformAuth();
		const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
		if (!parsed.success) throw badRequest("Invalid body", parsed.error.flatten());
		const body = parsed.data;
		const passwordHash = await hashPassword(body.adminPassword);

		const created = await withoutTenant(async (tx) => {
			const existing = await tx
				.select({ id: tenants.id })
				.from(tenants)
				.where(eq(tenants.slug, body.slug))
				.limit(1);
			if (existing[0]) throw conflict("Tenant slug already exists");

			const existingAdmin = await tx
				.select({ id: users.id })
				.from(users)
				.where(eq(users.email, body.adminEmail))
				.limit(1);
			if (existingAdmin[0]) throw conflict("Admin email already exists");

			const [tenant] = await tx
				.insert(tenants)
				.values({
					slug: body.slug,
					name: body.name,
					settings: {
						branding: {
							legalName: body.branding?.legalName ?? body.name,
							address: body.branding?.address,
							gstin: body.branding?.gstin,
							phone: body.branding?.phone,
							accentHsl: body.branding?.accentHsl ?? "221 83% 53%",
						},
						geofence: { defaultRadiusM: 100, minAccuracyM: 50 },
						sync: { intervalMin: 15 },
					},
				})
				.returning();

			const [admin] = await tx
				.insert(users)
				.values({
					tenantId: tenant.id,
					email: body.adminEmail,
					passwordHash,
					name: body.adminName,
					role: "super_admin",
				})
				.returning({ id: users.id, email: users.email, name: users.name });

			await appendAudit(tx, {
				tenantId: tenant.id,
				actorId: admin.id,
				action: "tenant.provisioned",
				entityType: "tenant",
				entityId: tenant.id,
				after: {
					slug: tenant.slug,
					name: tenant.name,
					platformActor: auth.email,
					adminEmail: admin.email,
				},
			});

			return { tenant, admin };
		});

		return NextResponse.json({ tenant: created.tenant, admin: created.admin }, { status: 201 });
	} catch (err) {
		return toResponse(err);
	}
}
