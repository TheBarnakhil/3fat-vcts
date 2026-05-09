import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";

import {
	collectionReversals,
	collections as collectionsTable,
	customers,
	tenants,
	users,
} from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";
import { fetchStaticMapPng, staticMapUrl } from "@/lib/maps/static";
import { publicReceiptUrl } from "@/lib/receipts/public-url";
import {
	getObjectBytes,
	presignGetUrl,
	r2Enabled,
} from "@/lib/storage/r2";
import { readBranding } from "@/lib/tenants/branding";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PageProps = {
	params: Promise<{ path: string[] }>;
};

/**
 * Phase 8 public verification page. URL shape:
 *
 *   /r/{tenantSlug}/{agentCode}/{fyLabel}/{seq}
 *
 * The path segments are joined with "/" to reconstruct the receipt
 * number stored on `collections.receipt_no`. We do NOT require auth -
 * a customer who got a printed receipt should be able to verify it
 * from any browser; the page exposes only what's already on the
 * physical receipt.
 *
 * RLS: the row lookup goes through `withoutTenant` so we can pin
 * tenant_id explicitly from the URL. Cross-tenant collisions are
 * impossible because (tenant_id, receipt_no) is unique.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
	const { path } = await params;
	const receiptNo = path.map(decodeURIComponent).join("/");
	return {
		title: `Receipt ${receiptNo}`,
		description: "Verify a VCTS-issued collection receipt",
	};
}

async function loadReceipt(receiptNo: string) {
	const slug = receiptNo.split("/")[0];
	if (!slug) return null;

	const [tenant] = await withoutTenant(async (tx) =>
		tx
			.select({
				id: tenants.id,
				slug: tenants.slug,
				name: tenants.name,
				settings: tenants.settings,
			})
			.from(tenants)
			.where(and(eq(tenants.slug, slug), eq(tenants.isActive, true)))
			.limit(1),
	);
	if (!tenant) return null;

	const data = await withTenant(tenant.id, async (tx) => {
		const [row] = await tx
			.select({
				collection: collectionsTable,
				customerName: customers.name,
				customerCode: customers.code,
				customerAddress: customers.address,
			})
			.from(collectionsTable)
			.innerJoin(customers, eq(customers.id, collectionsTable.customerId))
			.where(eq(collectionsTable.receiptNo, receiptNo))
			.limit(1);
		if (!row) return null;
		const reversals = await tx
			.select({ id: collectionReversals.id })
			.from(collectionReversals)
			.where(eq(collectionReversals.originalCollectionId, row.collection.id));
		return { ...row, reversed: reversals.length > 0 };
	});
	if (!data) return null;

	const [agent] = await withoutTenant(async (tx) =>
		tx
			.select({ id: users.id, name: users.name, agentCode: users.agentCode })
			.from(users)
			.where(
				and(
					eq(users.id, data.collection.agentId),
					eq(users.tenantId, tenant.id),
				),
			)
			.limit(1),
	);

	return { tenant, data, agent: agent ?? null };
}

export default async function PublicReceiptPage({ params }: PageProps) {
	const { path } = await params;
	const receiptNo = path.map(decodeURIComponent).join("/");

	const result = await loadReceipt(receiptNo);
	if (!result) notFound();
	const { tenant, data, agent } = result;
	const { collection, reversed } = data;

	const branding = readBranding(tenant.settings);
	const accent = branding.accentHsl ?? "221 83% 53%";
	const verifyUrl = publicReceiptUrl({ receiptNo });

	let qrSvg: string | null = null;
	try {
		qrSvg = await QRCode.toString(verifyUrl || receiptNo, {
			type: "svg",
			margin: 1,
			width: 160,
			color: { dark: "#0F172A", light: "#FFFFFF" },
		});
	} catch {
		qrSvg = null;
	}

	let photoSrc: string | null = null;
	let signatureSrc: string | null = null;
	if (r2Enabled() && collection.photoUrl) {
		photoSrc = await presignGetUrl(collection.photoUrl).catch(() => null);
	}
	if (r2Enabled() && collection.signatureUrl) {
		signatureSrc = await presignGetUrl(collection.signatureUrl).catch(
			() => null,
		);
	}

	let logoDataUri: string | null = null;
	if (r2Enabled() && branding.logoUrl) {
		const looksLikeKey = branding.logoUrl.startsWith("t/");
		try {
			const bytes = looksLikeKey
				? await getObjectBytes(branding.logoUrl)
				: await fetch(branding.logoUrl)
						.then((r) => (r.ok ? r.arrayBuffer() : null))
						.then((b) => (b ? Buffer.from(b) : null))
						.catch(() => null);
			if (bytes) {
				const mime =
					branding.logoUrl.endsWith(".jpg") ||
					branding.logoUrl.endsWith(".jpeg")
						? "image/jpeg"
						: "image/png";
				logoDataUri = `data:${mime};base64,${bytes.toString("base64")}`;
			}
		} catch {
			logoDataUri = null;
		}
	}

	let mapDataUri: string | null = null;
	const mapBytes = await fetchStaticMapPng({
		lat: collection.collectionLat,
		lng: collection.collectionLng,
		zoom: 16,
	});
	if (mapBytes) {
		mapDataUri = `data:image/png;base64,${Buffer.from(mapBytes).toString("base64")}`;
	}
	const mapsLinkHref = staticMapUrl({
		lat: collection.collectionLat,
		lng: collection.collectionLng,
	});

	const collectedAt = new Date(collection.collectedAt).toLocaleString("en-IN", {
		dateStyle: "full",
		timeStyle: "short",
		timeZone: "Asia/Kolkata",
	});
	const amountText = new Intl.NumberFormat("en-IN", {
		style: "currency",
		currency: "INR",
		maximumFractionDigits: 2,
	}).format(collection.amount);

	const accentStyle = { ["--receipt-accent" as string]: accent } as React.CSSProperties;

	return (
		<main
			style={accentStyle}
			className="min-h-screen bg-linear-to-br from-slate-50 to-slate-100 px-4 py-10 dark:from-slate-950 dark:to-slate-900"
		>
			<div className="mx-auto max-w-2xl">
				<header className="mb-6 flex items-center justify-between">
					<div className="flex items-center gap-3">
						{logoDataUri ? (
							// eslint-disable-next-line @next/next/no-img-element
							<img
								src={logoDataUri}
								alt={`${branding.legalName ?? tenant.name} logo`}
								className="h-12 w-12 rounded-md object-contain bg-white p-1 shadow-sm"
							/>
						) : (
							<div
								className="flex h-12 w-12 items-center justify-center rounded-md text-lg font-bold text-white shadow-sm"
								style={{ backgroundColor: `hsl(var(--receipt-accent))` }}
							>
								{tenant.name.slice(0, 1).toUpperCase()}
							</div>
						)}
						<div>
							<h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">
								{branding.legalName ?? tenant.name}
							</h1>
							<p className="text-xs text-slate-500 dark:text-slate-400">
								{branding.address ?? "Verified Collection Tracking System"}
							</p>
						</div>
					</div>
					<span className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white" style={{ backgroundColor: `hsl(var(--receipt-accent))` }}>
						{reversed ? "Reversed" : "Verified"}
					</span>
				</header>

				<section className="rounded-2xl border bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
					<div className="border-b px-6 py-5 dark:border-slate-800">
						<p className="text-xs font-medium uppercase tracking-widest text-slate-500">
							Receipt
						</p>
						<p className="mt-1 font-mono text-sm text-slate-900 dark:text-slate-100">
							{collection.receiptNo}
						</p>
					</div>

					<div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-3">
						<div className="md:col-span-2 space-y-5">
							<div>
								<p className="text-xs font-medium uppercase tracking-widest text-slate-500">
									Amount received
								</p>
								<p
									className="mt-1 text-3xl font-semibold"
									style={{ color: `hsl(var(--receipt-accent))` }}
								>
									{amountText}
								</p>
								<p className="text-xs text-slate-500">
									via {collection.paymentMode.replace("_", " ")}
									{collection.refNo ? ` · Ref ${collection.refNo}` : ""}
								</p>
							</div>

							<div className="grid grid-cols-2 gap-4 text-sm">
								<div>
									<p className="text-xs font-medium uppercase tracking-widest text-slate-500">
										Received from
									</p>
									<p className="mt-1 text-slate-900 dark:text-slate-100">
										{data.customerName}
									</p>
									{data.customerCode ? (
										<p className="font-mono text-xs text-slate-500">
											{data.customerCode}
										</p>
									) : null}
								</div>
								<div>
									<p className="text-xs font-medium uppercase tracking-widest text-slate-500">
										Collected by
									</p>
									<p className="mt-1 text-slate-900 dark:text-slate-100">
										{agent?.name ?? "Field agent"}
									</p>
									{agent?.agentCode ? (
										<p className="font-mono text-xs text-slate-500">
											{agent.agentCode}
										</p>
									) : null}
								</div>
								<div>
									<p className="text-xs font-medium uppercase tracking-widest text-slate-500">
										Collected at
									</p>
									<p className="mt-1 text-slate-900 dark:text-slate-100">
										{collectedAt}
									</p>
								</div>
								<div>
									<p className="text-xs font-medium uppercase tracking-widest text-slate-500">
										GPS pin
									</p>
									<p className="mt-1 font-mono text-xs text-slate-900 dark:text-slate-100">
										{collection.collectionLat.toFixed(5)},{" "}
										{collection.collectionLng.toFixed(5)}
									</p>
									{collection.gpsAccuracyM ? (
										<p className="text-xs text-slate-500">
											+/- {Math.round(collection.gpsAccuracyM)} m
										</p>
									) : null}
								</div>
							</div>
						</div>

						<aside className="flex flex-col items-center gap-3">
							{qrSvg ? (
								<div
									className="rounded-lg bg-white p-2 shadow"
									dangerouslySetInnerHTML={{ __html: qrSvg }}
								/>
							) : null}
							<p className="text-center text-xs text-slate-500">
								Scan to re-verify
							</p>
						</aside>
					</div>

					<div className="grid grid-cols-1 gap-4 border-t px-6 py-6 dark:border-slate-800 md:grid-cols-3">
						<AttachmentTile label="Photo proof" src={photoSrc} alt="Customer photo proof" />
						<AttachmentTile
							label="Customer signature"
							src={signatureSrc}
							alt="Customer signature"
							light
						/>
						<AttachmentTile
							label="GPS pin"
							src={mapDataUri}
							alt="Static map of GPS pin"
							href={mapsLinkHref}
						/>
					</div>

					<footer className="rounded-b-2xl border-t bg-slate-50 px-6 py-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/40">
						This receipt was issued by {branding.legalName ?? tenant.name}
						{branding.gstin ? ` (GSTIN ${branding.gstin})` : ""}. All
						collection records are signed into a tamper-evident audit chain
						and corroborated against on-the-ground location data.
					</footer>
				</section>

				<p className="mt-6 text-center text-xs text-slate-500">
					Powered by VCTS · {new Date().getFullYear()}
				</p>
			</div>
		</main>
	);
}

function AttachmentTile({
	label,
	src,
	alt,
	light,
	href,
}: {
	label: string;
	src: string | null;
	alt: string;
	light?: boolean;
	href?: string | null;
}) {
	const inner = src ? (
		// eslint-disable-next-line @next/next/no-img-element
		<img
			src={src}
			alt={alt}
			className={`h-32 w-full rounded-md object-contain ${light ? "bg-white" : "bg-slate-900"}`}
		/>
	) : (
		<div className="flex h-32 w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
			Not captured
		</div>
	);
	return (
		<div>
			<p className="mb-2 text-xs font-medium uppercase tracking-widest text-slate-500">
				{label}
			</p>
			{href && src ? (
				<a href={href} target="_blank" rel="noreferrer">
					{inner}
				</a>
			) : (
				inner
			)}
		</div>
	);
}
