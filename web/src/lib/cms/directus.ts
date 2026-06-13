import { eq } from "drizzle-orm";

import { tenants } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import { env } from "@/lib/env";
import { badRequest, forbidden, serviceUnavailable } from "@/lib/errors";

export type DirectusTenantTokens = Record<string, string>;

const ITEM_QUERY_ALLOWLIST = new Set([
	"fields",
	"filter",
	"sort",
	"limit",
	"offset",
	"page",
	"search",
	"meta",
]);

export function tenantCollectionPrefix(slug: string): string {
	return `t_${slug}__`;
}

export function prefixedCollection(slug: string, name: string): string {
	const clean = name.replace(/^t_[a-z0-9_-]+__/, "");
	return `${tenantCollectionPrefix(slug)}${clean}`;
}

export function stripCollectionPrefix(slug: string, collection: string): string {
	const prefix = tenantCollectionPrefix(slug);
	if (!collection.startsWith(prefix)) return collection;
	return collection.slice(prefix.length);
}

export function parseTenantTokens(raw: string | undefined): DirectusTenantTokens {
	if (!raw || raw.trim() === "" || raw.trim() === "{}") return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("expected object");
		}
		const out: DirectusTenantTokens = {};
		for (const [slug, token] of Object.entries(parsed)) {
			if (typeof token === "string" && token.length > 0) out[slug] = token;
		}
		return out;
	} catch {
		throw badRequest("DIRECTUS_TENANT_TOKENS must be valid JSON object");
	}
}

export function requireDirectusUrl(): string {
	if (!env.DIRECTUS_URL) {
		throw serviceUnavailable("Directus is not configured (DIRECTUS_URL missing)");
	}
	return env.DIRECTUS_URL.replace(/\/$/, "");
}

export function requireAdminToken(): string {
	if (!env.DIRECTUS_ADMIN_TOKEN) {
		throw serviceUnavailable(
			"Directus admin token is not configured (DIRECTUS_ADMIN_TOKEN missing)",
		);
	}
	return env.DIRECTUS_ADMIN_TOKEN;
}

export async function resolveTenantSlug(tenantId: string): Promise<string> {
	const [row] = await withoutTenant(async (tx) =>
		tx
			.select({ slug: tenants.slug })
			.from(tenants)
			.where(eq(tenants.id, tenantId))
			.limit(1),
	);
	if (!row) throw badRequest("Unknown tenant");
	return row.slug;
}

export function assertTenantCollection(slug: string, collection: string): string {
	const prefixed = collection.includes("__")
		? collection
		: prefixedCollection(slug, collection);
	const prefix = tenantCollectionPrefix(slug);
	if (!prefixed.startsWith(prefix)) {
		throw forbidden("Collection is not allowed for this tenant");
	}
	return prefixed;
}

export function tenantDirectusToken(slug: string): string {
	const tokens = parseTenantTokens(env.DIRECTUS_TENANT_TOKENS);
	const token = tokens[slug];
	if (!token) {
		throw serviceUnavailable(
			`Directus token not configured for tenant '${slug}' (DIRECTUS_TENANT_TOKENS)`,
		);
	}
	return token;
}

export function allowlistedItemQuery(searchParams: URLSearchParams): string {
	const qs = new URLSearchParams();
	for (const [key, value] of searchParams.entries()) {
		if (ITEM_QUERY_ALLOWLIST.has(key)) qs.append(key, value);
	}
	const s = qs.toString();
	return s ? `?${s}` : "";
}

type DirectusFetchInit = Omit<RequestInit, "headers"> & {
	headers?: Record<string, string>;
	token?: string;
};

export async function directusFetch<T>(
	path: string,
	init: DirectusFetchInit = {},
): Promise<T> {
	const base = requireDirectusUrl();
	const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
	const headers: Record<string, string> = {
		accept: "application/json",
		...(init.headers ?? {}),
	};
	if (init.token) headers.authorization = `Bearer ${init.token}`;
	if (init.body && !headers["content-type"]) {
		headers["content-type"] = "application/json";
	}

	const res = await fetch(url, { ...init, headers });
	const text = await res.text();
	let json: unknown = null;
	if (text) {
		try {
			json = JSON.parse(text);
		} catch {
			json = { raw: text };
		}
	}

	if (!res.ok) {
		const msg =
			typeof json === "object" &&
			json &&
			"errors" in json &&
			Array.isArray((json as { errors?: unknown[] }).errors)
				? String((json as { errors: { message?: string }[] }).errors[0]?.message)
				: res.statusText;
		throw new Error(`Directus ${res.status}: ${msg}`);
	}

	return json as T;
}
