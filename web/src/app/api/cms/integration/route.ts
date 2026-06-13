import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { collectionIntegrations } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { provisionOfflineIntegration } from "@/lib/cms/provision";
import { requireAuth, requireRole } from "@/lib/auth/context";
import { badRequest, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET() {
	try {
		const auth = await requireAuth();
		const [row] = await withTenant(auth.tid, async (tx) =>
			tx
				.select({
					mode: collectionIntegrations.mode,
					webviewUrl: collectionIntegrations.webviewUrl,
					jsonSchema: collectionIntegrations.jsonSchema,
					uiSchema: collectionIntegrations.uiSchema,
					directusCollection: collectionIntegrations.directusCollection,
					updatedAt: collectionIntegrations.updatedAt,
				})
				.from(collectionIntegrations)
				.where(eq(collectionIntegrations.tenantId, auth.tid))
				.limit(1),
		);
		return NextResponse.json({ integration: row ?? null });
	} catch (err) {
		return toResponse(err);
	}
}

const PutBody = z
	.object({
		mode: z.enum(["webview", "offline"]),
		webviewUrl: z.string().url().optional().nullable(),
		jsonSchema: z.record(z.string(), z.unknown()).optional().nullable(),
		uiSchema: z.record(z.string(), z.unknown()).optional().nullable(),
		directusCollection: z.string().min(1).max(120).optional().nullable(),
	})
	.superRefine((val, ctx) => {
		if (val.mode === "webview" && !val.webviewUrl) {
			ctx.addIssue({
				code: "custom",
				message: "webviewUrl is required when mode is webview",
				path: ["webviewUrl"],
			});
		}
		if (val.mode === "offline") {
			if (!val.jsonSchema) {
				ctx.addIssue({
					code: "custom",
					message: "jsonSchema is required when mode is offline",
					path: ["jsonSchema"],
				});
			}
			if (!val.directusCollection) {
				ctx.addIssue({
					code: "custom",
					message: "directusCollection is required when mode is offline",
					path: ["directusCollection"],
				});
			}
		}
	});

export async function PUT(req: NextRequest) {
	try {
		const auth = await requireAuth();
		requireRole(auth, "super_admin");

		const body = PutBody.parse(await req.json());
		const now = new Date();
		let uiSchema = body.uiSchema ?? null;

		if (body.mode === "offline") {
			if (!body.jsonSchema || !body.directusCollection) {
				throw badRequest("jsonSchema and directusCollection are required for offline mode");
			}
			const provisioned = await provisionOfflineIntegration(
				auth.tid,
				body.directusCollection,
				body.jsonSchema,
				body.uiSchema ?? null,
			);
			uiSchema = provisioned.uiSchema;
		}

		const [saved] = await withTenant(auth.tid, async (tx) =>
			tx
				.insert(collectionIntegrations)
				.values({
					tenantId: auth.tid,
					mode: body.mode,
					webviewUrl: body.webviewUrl ?? null,
					jsonSchema: body.jsonSchema ?? null,
					uiSchema,
					directusCollection: body.directusCollection ?? null,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: collectionIntegrations.tenantId,
					set: {
						mode: body.mode,
						webviewUrl: body.webviewUrl ?? null,
						jsonSchema: body.jsonSchema ?? null,
						uiSchema,
						directusCollection: body.directusCollection ?? null,
						updatedAt: now,
					},
				})
				.returning({
					mode: collectionIntegrations.mode,
					webviewUrl: collectionIntegrations.webviewUrl,
					jsonSchema: collectionIntegrations.jsonSchema,
					uiSchema: collectionIntegrations.uiSchema,
					directusCollection: collectionIntegrations.directusCollection,
					updatedAt: collectionIntegrations.updatedAt,
				}),
		);

		return NextResponse.json({ integration: saved });
	} catch (err) {
		return toResponse(err);
	}
}
