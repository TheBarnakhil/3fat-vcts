import { and, asc, eq, inArray } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import {
	collectionReversals,
	collections as collectionsTable,
	customers,
	tenants,
	users,
} from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";
import { requireAuth } from "@/lib/auth/context";
import { forbidden, notFound, toResponse } from "@/lib/errors";
import {
	renderLedgerPdfDetailed,
	type LedgerInput,
} from "@/lib/receipts/ledger-pdf";
import { readBranding } from "@/lib/tenants/branding";

export const runtime = "nodejs";

/**
 * GET /api/customers/{id}/ledger
 *
 * Phase 10 / Track C3 - per-customer ledger export.
 *
 * Query params:
 *   format = json (default) | csv | pdf
 *
 * Auth + scoping:
 *   - All roles authorise; admins/managers/auditors see any customer in
 *     the tenant; agents only see customers assigned to them (matches
 *     /api/customers/[id]).
 *   - Tenant scoping is enforced by RLS + explicit eq(tenantId) filters
 *     on every query (defense-in-depth).
 *
 * The endpoint pulls the customer's full collection history with
 * reversal status and the agent display name, computes simple totals,
 * and ships JSON, CSV, or a paginated A4 PDF in one round trip.
 */

type LedgerCollectionRow = {
	id: string;
	collectedAt: Date;
	receiptNo: string | null;
	paymentMode: "cash" | "cheque" | "bank_transfer" | "upi";
	amount: number;
	refNo: string | null;
	agentName: string;
	reversed: boolean;
};

function escapeCsv(field: string): string {
	if (field === null || field === undefined) return "";
	const needsQuotes = /[",\n\r]/.test(field);
	const escaped = field.replace(/"/g, '""');
	return needsQuotes ? `"${escaped}"` : escaped;
}

function buildCsv(
	customer: { name: string; code: string | null },
	rows: LedgerCollectionRow[],
): string {
	const headers = [
		"Date (UTC)",
		"Receipt No",
		"Payment Mode",
		"Amount",
		"Reference",
		"Agent",
		"Status",
	];
	const lines: string[] = [];
	lines.push(`# Customer: ${customer.name}${customer.code ? " (" + customer.code + ")" : ""}`);
	lines.push(`# Generated: ${new Date().toISOString()}`);
	lines.push(headers.map(escapeCsv).join(","));
	for (const r of rows) {
		lines.push(
			[
				r.collectedAt.toISOString(),
				r.receiptNo ?? "",
				r.paymentMode,
				r.amount.toFixed(2),
				r.refNo ?? "",
				r.agentName,
				r.reversed ? "REVERSED" : "OK",
			]
				.map((v) => escapeCsv(String(v)))
				.join(","),
		);
	}
	return lines.join("\r\n");
}

export async function GET(
	req: NextRequest,
	ctx: { params: Promise<{ id: string }> },
) {
	try {
		const auth = await requireAuth();
		const { id } = await ctx.params;
		const url = new URL(req.url);
		const format = (url.searchParams.get("format") ?? "json").toLowerCase();
		if (!["json", "csv", "pdf"].includes(format)) {
			return NextResponse.json(
				{ error: "format must be json, csv, or pdf" },
				{ status: 400 },
			);
		}
		// `?debug=1` — diagnostic JSON describing what the PDF path would
		// have produced (byte length, page count, collection row count).
		// Used to triage "blank PDF" reports without round-tripping bytes
		// through the browser.
		const wantDebug = url.searchParams.get("debug") === "1";

		// Pull customer + collections + reversals inside a single tenant-scoped
		// transaction so RLS + the explicit eq(tenantId) filters are applied
		// uniformly. Agents are additionally restricted to their assigned
		// customer set so they can never enumerate the whole book.
		const ledgerData = await withTenant(auth.tid, async (tx) => {
			const [customer] = await tx
				.select()
				.from(customers)
				.where(
					and(
						eq(customers.id, id),
						eq(customers.tenantId, auth.tid),
						auth.role === "agent"
							? eq(customers.assignedAgentId, auth.sub)
							: undefined,
					),
				)
				.limit(1);
			if (!customer) return null;

			const collectionRows = await tx
				.select({
					id: collectionsTable.id,
					collectedAt: collectionsTable.collectedAt,
					receiptNo: collectionsTable.receiptNo,
					paymentMode: collectionsTable.paymentMode,
					amount: collectionsTable.amount,
					refNo: collectionsTable.refNo,
					agentId: collectionsTable.agentId,
				})
				.from(collectionsTable)
				.where(
					and(
						eq(collectionsTable.customerId, id),
						eq(collectionsTable.tenantId, auth.tid),
						auth.role === "agent"
							? eq(collectionsTable.agentId, auth.sub)
							: undefined,
					),
				)
				.orderBy(asc(collectionsTable.collectedAt));

			let reversedIds = new Set<string>();
			if (collectionRows.length > 0) {
				const ids = collectionRows.map((r) => r.id);
				const reversals = await tx
					.select({ originalCollectionId: collectionReversals.originalCollectionId })
					.from(collectionReversals)
					.where(
						and(
							inArray(collectionReversals.originalCollectionId, ids),
							eq(collectionReversals.tenantId, auth.tid),
						),
					);
				reversedIds = new Set(reversals.map((r) => r.originalCollectionId));
			}

			return { customer, collectionRows, reversedIds };
		});

		if (!ledgerData) throw notFound("Customer not found");

		// If an agent somehow reached a non-assigned customer (shouldn't
		// happen with the where-clause above, but belt-and-braces).
		if (
			auth.role === "agent" &&
			ledgerData.customer.assignedAgentId &&
			ledgerData.customer.assignedAgentId !== auth.sub
		) {
			throw forbidden("Customer is not assigned to you");
		}

		// Resolve agent display names + tenant metadata via withoutTenant
		// (same pattern as receipt route) - users live behind RLS too but
		// the "no current_tenant" path is fine here because we filter by
		// id explicitly.
		const distinctAgentIds = Array.from(
			new Set(ledgerData.collectionRows.map((r) => r.agentId)),
		);
		const agentNamesById = new Map<string, string>();
		let tenantRow:
			| { id: string; name: string; slug: string; settings: unknown }
			| null = null;
		await withoutTenant(async (tx) => {
			if (distinctAgentIds.length > 0) {
				const rows = await tx
					.select({ id: users.id, name: users.name })
					.from(users)
					.where(
						and(
							inArray(users.id, distinctAgentIds),
							eq(users.tenantId, auth.tid),
						),
					);
				for (const r of rows) agentNamesById.set(r.id, r.name);
			}
			const t = await tx
				.select({
					id: tenants.id,
					name: tenants.name,
					slug: tenants.slug,
					settings: tenants.settings,
				})
				.from(tenants)
				.where(eq(tenants.id, auth.tid))
				.limit(1);
			tenantRow = t[0] ?? null;
		});
		if (!tenantRow) throw notFound("Tenant not found");

		const branding = readBranding((tenantRow as { settings: unknown }).settings);

		const rows: LedgerCollectionRow[] = ledgerData.collectionRows.map((r) => ({
			id: r.id,
			collectedAt: r.collectedAt,
			receiptNo: r.receiptNo,
			paymentMode: r.paymentMode,
			amount: r.amount,
			refNo: r.refNo,
			agentName: agentNamesById.get(r.agentId) ?? "Unknown agent",
			reversed: ledgerData.reversedIds.has(r.id),
		}));

		const totals = rows.reduce(
			(acc, r) => {
				acc.count += 1;
				acc.gross += r.amount;
				if (r.reversed) {
					acc.reversedCount += 1;
					acc.reversedAmount += r.amount;
				}
				return acc;
			},
			{
				count: 0,
				gross: 0,
				reversedCount: 0,
				reversedAmount: 0,
				net: 0,
			},
		);
		totals.net = totals.gross - totals.reversedAmount;

		// --- json -----------------------------------------------------------
		if (format === "json") {
			return NextResponse.json({
				customer: {
					id: ledgerData.customer.id,
					code: ledgerData.customer.code,
					name: ledgerData.customer.name,
					address: ledgerData.customer.address,
					phone: ledgerData.customer.phone,
					outstandingBalance: ledgerData.customer.outstandingBalance,
				},
				collections: rows.map((r) => ({
					id: r.id,
					collectedAt: r.collectedAt.toISOString(),
					receiptNo: r.receiptNo,
					paymentMode: r.paymentMode,
					amount: r.amount,
					refNo: r.refNo,
					agentName: r.agentName,
					reversed: r.reversed,
				})),
				totals,
			});
		}

		// Stable filename slug based on the customer name.
		const safeName = ledgerData.customer.name
			.replace(/[^a-zA-Z0-9-_]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 40) || "customer";

		// --- csv ------------------------------------------------------------
		if (format === "csv") {
			const csv = buildCsv(
				{ name: ledgerData.customer.name, code: ledgerData.customer.code },
				rows,
			);
			return new NextResponse(csv, {
				status: 200,
				headers: {
					"Content-Type": "text/csv; charset=utf-8",
					"Content-Disposition": `attachment; filename="${safeName}-ledger.csv"`,
					"Cache-Control": "private, max-age=0, must-revalidate",
				},
			});
		}

		// --- pdf ------------------------------------------------------------
		const ledgerInput: LedgerInput = {
			tenant: {
				legalName: branding.legalName ?? (tenantRow as { name: string }).name,
				address: branding.address,
				gstin: branding.gstin,
				phone: branding.phone,
			},
			customer: {
				name: ledgerData.customer.name,
				code: ledgerData.customer.code,
				address: ledgerData.customer.address,
				phone: ledgerData.customer.phone,
				outstandingBalance: ledgerData.customer.outstandingBalance,
			},
			collections: rows,
			totals,
			generatedAt: new Date(),
		};
		const { bytes: pdfBytes, pageCount } = await renderLedgerPdfDetailed(
			ledgerInput,
		);

		// Diagnostic mode - returns the size/page count *plus* a base64
		// preview of the first 32 bytes so we can sanity-check the PDF
		// magic bytes (`%PDF-`) made it across the wire intact. Never
		// returns the PDF body itself.
		if (wantDebug) {
			const head = Array.from(pdfBytes.slice(0, 32))
				.map((b) => b.toString(16).padStart(2, "0"))
				.join(" ");
			const headAscii = Array.from(pdfBytes.slice(0, 8))
				.map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "."))
				.join("");
			return NextResponse.json({
				ok: true,
				bytes: pdfBytes.length,
				pageCount,
				rows: rows.length,
				headHex: head,
				headAscii,
			});
		}

		// Stream the bytes directly. We deliberately do NOT set an explicit
		// Content-Length - some Vercel edge configurations have been seen
		// to truncate binary bodies when the header is set to a value that
		// disagrees with the on-the-wire (post-compression) size.
		return new Response(new Uint8Array(pdfBytes), {
			status: 200,
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `attachment; filename="${safeName}-ledger.pdf"`,
				"Cache-Control": "private, max-age=0, must-revalidate",
				"X-Ledger-Page-Count": String(pageCount),
				"X-Ledger-Rows": String(rows.length),
			},
		});
	} catch (err) {
		return toResponse(err);
	}
}
