export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type CmsApiEndpointGroup = "integration" | "items" | "collections" | "fields";

export type CmsApiQueryParam = {
	name: string;
	description: string;
	example?: string;
};

export type CmsApiPathParam = {
	name: string;
	description: string;
	placeholder: string;
};

export type CmsApiEndpoint = {
	id: string;
	group: CmsApiEndpointGroup;
	method: HttpMethod;
	pathTemplate: string;
	summary: string;
	description: string;
	auth: string;
	roles?: string;
	pathParams?: CmsApiPathParam[];
	queryParams?: CmsApiQueryParam[];
	requestBodyExample?: string;
	responseExample: string;
	/** When true, the in-app "Try it" panel is shown (uses your logged-in session). */
	tryIt?: boolean;
	/** Directus token used server-side for this route. */
	proxyToken: "tenant" | "admin";
};

export const CMS_API_BASE = "/api/cms";

export const CMS_API_GROUPS: { id: CmsApiEndpointGroup; title: string; description: string }[] =
	[
		{
			id: "integration",
			title: "Integration config",
			description: "VCTS collection integration settings (WebView URL or offline JSON Schema).",
		},
		{
			id: "items",
			title: "Items (content rows)",
			description:
				"CRUD on Directus items. Proxied with the tenant service token (DIRECTUS_TENANT_TOKENS).",
		},
		{
			id: "collections",
			title: "Collections (schema)",
			description:
				"List, create, update, or delete Directus collections. Tenant prefix enforced; schema ops use admin token server-side.",
		},
		{
			id: "fields",
			title: "Fields (schema columns)",
			description: "Manage fields on a tenant collection via Directus /fields API.",
		},
	];

const TENANT_JWT_AUTH =
	"Authorization: Bearer <tenant-jwt> (VCTS login for this tenant). The server maps your JWT to the tenant's Directus service token — never send Directus tokens from the client.";

const TENANT_ITEM_AUTH =
	"Authorization: Bearer <tenant-jwt> (VCTS login for this tenant). Proxied with DIRECTUS_TENANT_TOKENS[slug] server-side.";

const TENANT_SCHEMA_AUTH =
	"Authorization: Bearer <tenant-jwt>. Collection name must belong to this tenant (t_<slug>__*). Schema changes use DIRECTUS_ADMIN_TOKEN server-side.";

export const CMS_ITEM_PATH_PARAMS: CmsApiPathParam[] = [
	{
		name: "collection",
		description: "Short name (products) or full prefixed name (t_acme__products)",
		placeholder: "products",
	},
];

export const CMS_ITEM_ID_PATH_PARAMS: CmsApiPathParam[] = [
	...CMS_ITEM_PATH_PARAMS,
	{ name: "id", description: "Directus item primary key", placeholder: "1" },
];

export const CMS_COLLECTION_PATH_PARAMS: CmsApiPathParam[] = [...CMS_ITEM_PATH_PARAMS];

export const CMS_FIELD_PATH_PARAMS: CmsApiPathParam[] = [
	...CMS_ITEM_PATH_PARAMS,
	{ name: "field", description: "Field name in the collection", placeholder: "sku" },
];

export const CMS_ITEM_QUERY_PARAMS: CmsApiQueryParam[] = [
	{ name: "fields", description: "Comma-separated Directus fields to return", example: "id,sku,name" },
	{ name: "filter", description: "Directus filter JSON (URL-encoded)", example: '{"sku":{"_eq":"ACME-001"}}' },
	{ name: "sort", description: "Sort fields, prefix with - for descending", example: "-date_created" },
	{ name: "limit", description: "Max rows", example: "25" },
	{ name: "offset", description: "Skip rows", example: "0" },
	{ name: "page", description: "Page number (Directus pagination)", example: "1" },
	{ name: "search", description: "Directus search string", example: "widget" },
	{ name: "meta", description: "Include meta (e.g. filter_count)", example: "filter_count" },
];

export const CMS_API_ENDPOINTS: CmsApiEndpoint[] = [
	// --- Integration ---
	{
		id: "integration-get",
		group: "integration",
		method: "GET",
		pathTemplate: `${CMS_API_BASE}/integration`,
		summary: "Read integration config",
		description:
			"Returns the tenant's Collection integration mode and schema. Used by the Android app before showing WebView or the offline form.",
		auth: TENANT_JWT_AUTH,
		proxyToken: "tenant",
		responseExample: JSON.stringify(
			{
				integration: {
					mode: "offline",
					webviewUrl: null,
					jsonSchema: { type: "object", properties: { sku: { type: "string" } } },
					uiSchema: { type: "VerticalLayout", elements: [] },
					directusCollection: "collection_responses",
					updatedAt: "2026-06-13T12:00:00.000Z",
				},
			},
			null,
			2,
		),
		tryIt: true,
	},
	{
		id: "integration-put",
		group: "integration",
		method: "PUT",
		pathTemplate: `${CMS_API_BASE}/integration`,
		summary: "Save integration config",
		description:
			"Creates or updates integration settings. Offline mode also provisions the Directus collection from JSON Schema.",
		auth: "Authorization: Bearer <tenant-jwt> (super_admin for this tenant)",
		roles: "super_admin only",
		proxyToken: "admin",
		requestBodyExample: JSON.stringify(
			{
				mode: "offline",
				webviewUrl: null,
				directusCollection: "collection_responses",
				jsonSchema: {
					type: "object",
					properties: {
						sku: { type: "string", title: "SKU" },
						name: { type: "string", title: "Name" },
					},
					required: ["sku"],
				},
				uiSchema: null,
			},
			null,
			2,
		),
		responseExample: JSON.stringify(
			{ integration: { mode: "offline", directusCollection: "collection_responses" } },
			null,
			2,
		),
	},
	// --- Items ---
	{
		id: "items-list",
		group: "items",
		method: "GET",
		pathTemplate: `${CMS_API_BASE}/items/{collection}`,
		summary: "List items",
		description: "Proxies to Directus GET /items/{collection}.",
		auth: TENANT_ITEM_AUTH,
		pathParams: CMS_ITEM_PATH_PARAMS,
		queryParams: CMS_ITEM_QUERY_PARAMS,
		proxyToken: "tenant",
		responseExample: JSON.stringify(
			{
				data: [{ id: 1, sku: "acme-PROD-100", name: "acme premium widget", in_stock: true }],
				meta: { filter_count: 1 },
			},
			null,
			2,
		),
		tryIt: true,
	},
	{
		id: "items-get",
		group: "items",
		method: "GET",
		pathTemplate: `${CMS_API_BASE}/items/{collection}/{id}`,
		summary: "Read one item",
		description: "Proxies to Directus GET /items/{collection}/{id}.",
		auth: TENANT_ITEM_AUTH,
		pathParams: CMS_ITEM_ID_PATH_PARAMS,
		queryParams: [
			{ name: "fields", description: "Comma-separated fields", example: "id,sku,name" },
		],
		proxyToken: "tenant",
		responseExample: JSON.stringify(
			{ data: { id: 1, sku: "acme-PROD-100", name: "acme premium widget" } },
			null,
			2,
		),
		tryIt: true,
	},
	{
		id: "items-create",
		group: "items",
		method: "POST",
		pathTemplate: `${CMS_API_BASE}/items/{collection}`,
		summary: "Create item",
		description:
			"Proxies to Directus POST /items/{collection}. Body fields must match the collection schema.",
		auth: TENANT_ITEM_AUTH,
		pathParams: CMS_ITEM_PATH_PARAMS,
		proxyToken: "tenant",
		requestBodyExample: JSON.stringify(
			{
				sku: "API-DEMO-001",
				name: "Created via CMS API",
				category: "fmcg",
				unit_price: 99.5,
				in_stock: true,
			},
			null,
			2,
		),
		responseExample: JSON.stringify(
			{ data: { id: 42, sku: "API-DEMO-001", name: "Created via CMS API" } },
			null,
			2,
		),
		tryIt: true,
	},
	{
		id: "items-update",
		group: "items",
		method: "PATCH",
		pathTemplate: `${CMS_API_BASE}/items/{collection}/{id}`,
		summary: "Update item",
		description: "Proxies to Directus PATCH /items/{collection}/{id}. Send only fields to change.",
		auth: TENANT_ITEM_AUTH,
		pathParams: CMS_ITEM_ID_PATH_PARAMS,
		proxyToken: "tenant",
		requestBodyExample: JSON.stringify({ name: "Updated name", in_stock: false }, null, 2),
		responseExample: JSON.stringify(
			{ data: { id: 42, sku: "API-DEMO-001", name: "Updated name", in_stock: false } },
			null,
			2,
		),
		tryIt: true,
	},
	{
		id: "items-delete",
		group: "items",
		method: "DELETE",
		pathTemplate: `${CMS_API_BASE}/items/{collection}/{id}`,
		summary: "Delete item",
		description: "Proxies to Directus DELETE /items/{collection}/{id}. Returns 204 on success.",
		auth: TENANT_ITEM_AUTH,
		pathParams: CMS_ITEM_ID_PATH_PARAMS,
		proxyToken: "tenant",
		responseExample: "(204 No Content)",
		tryIt: true,
	},
	// --- Collections ---
	{
		id: "collections-list",
		group: "collections",
		method: "GET",
		pathTemplate: `${CMS_API_BASE}/collections`,
		summary: "List tenant collections",
		description:
			"Returns Directus collections whose name starts with t_<slug>__. Uses admin token server-side with tenant filter.",
		auth: TENANT_SCHEMA_AUTH,
		proxyToken: "admin",
		responseExample: JSON.stringify(
			{
				data: [
					{ collection: "t_acme__products", meta: { icon: "inventory_2" } },
					{ collection: "t_acme__customer_notes", meta: { icon: "note" } },
				],
			},
			null,
			2,
		),
		tryIt: true,
	},
	{
		id: "collections-get",
		group: "collections",
		method: "GET",
		pathTemplate: `${CMS_API_BASE}/collections/{collection}`,
		summary: "Read collection metadata",
		description: "Proxies to Directus GET /collections/{collection}.",
		auth: TENANT_SCHEMA_AUTH,
		pathParams: CMS_COLLECTION_PATH_PARAMS,
		proxyToken: "admin",
		responseExample: JSON.stringify(
			{
				data: {
					collection: "t_acme__products",
					meta: { icon: "inventory_2", note: "Product catalog" },
					schema: {},
				},
			},
			null,
			2,
		),
		tryIt: true,
	},
	{
		id: "collections-create",
		group: "collections",
		method: "POST",
		pathTemplate: `${CMS_API_BASE}/collections`,
		summary: "Create collection",
		description:
			"Proxies to Directus POST /collections. Pass a short collection name; the server prefixes t_<slug>__.",
		auth: TENANT_SCHEMA_AUTH,
		roles: "super_admin only",
		proxyToken: "admin",
		requestBodyExample: JSON.stringify(
			{
				collection: "promotions",
				meta: { icon: "local_offer", note: "Seasonal promos" },
				schema: {},
				fields: [
					{
						field: "id",
						type: "integer",
						schema: { is_primary_key: true, has_auto_increment: true },
						meta: { hidden: true, interface: "input", readonly: true },
					},
					{ field: "title", type: "string", meta: { interface: "input", required: true } },
				],
			},
			null,
			2,
		),
		responseExample: JSON.stringify(
			{ data: { collection: "t_acme__promotions" } },
			null,
			2,
		),
	},
	{
		id: "collections-update",
		group: "collections",
		method: "PATCH",
		pathTemplate: `${CMS_API_BASE}/collections/{collection}`,
		summary: "Update collection metadata",
		description: "Proxies to Directus PATCH /collections/{collection} (meta, schema flags, etc.).",
		auth: TENANT_SCHEMA_AUTH,
		roles: "super_admin only",
		pathParams: CMS_COLLECTION_PATH_PARAMS,
		proxyToken: "admin",
		requestBodyExample: JSON.stringify(
			{ meta: { note: "Updated via CMS API", icon: "inventory" } },
			null,
			2,
		),
		responseExample: JSON.stringify(
			{ data: { collection: "t_acme__products", meta: { note: "Updated via CMS API" } } },
			null,
			2,
		),
	},
	{
		id: "collections-delete",
		group: "collections",
		method: "DELETE",
		pathTemplate: `${CMS_API_BASE}/collections/{collection}`,
		summary: "Delete collection",
		description:
			"Proxies to Directus DELETE /collections/{collection}. Drops the table and all items. Returns 204.",
		auth: TENANT_SCHEMA_AUTH,
		roles: "super_admin only",
		pathParams: CMS_COLLECTION_PATH_PARAMS,
		proxyToken: "admin",
		responseExample: "(204 No Content)",
	},
	// --- Fields ---
	{
		id: "fields-list",
		group: "fields",
		method: "GET",
		pathTemplate: `${CMS_API_BASE}/collections/{collection}/fields`,
		summary: "List fields",
		description: "Proxies to Directus GET /fields/{collection}.",
		auth: TENANT_SCHEMA_AUTH,
		pathParams: CMS_COLLECTION_PATH_PARAMS,
		proxyToken: "admin",
		responseExample: JSON.stringify(
			{
				data: [
					{ field: "id", type: "integer", meta: { hidden: true } },
					{ field: "sku", type: "string", meta: { interface: "input" } },
				],
			},
			null,
			2,
		),
		tryIt: true,
	},
	{
		id: "fields-get",
		group: "fields",
		method: "GET",
		pathTemplate: `${CMS_API_BASE}/collections/{collection}/fields/{field}`,
		summary: "Read one field",
		description: "Proxies to Directus GET /fields/{collection}/{field}.",
		auth: TENANT_SCHEMA_AUTH,
		pathParams: CMS_FIELD_PATH_PARAMS,
		proxyToken: "admin",
		responseExample: JSON.stringify(
			{ data: { field: "sku", type: "string", meta: { interface: "input", required: true } } },
			null,
			2,
		),
	},
	{
		id: "fields-create",
		group: "fields",
		method: "POST",
		pathTemplate: `${CMS_API_BASE}/collections/{collection}/fields`,
		summary: "Create field",
		description: "Proxies to Directus POST /fields/{collection}.",
		auth: TENANT_SCHEMA_AUTH,
		roles: "super_admin only",
		pathParams: CMS_COLLECTION_PATH_PARAMS,
		proxyToken: "admin",
		requestBodyExample: JSON.stringify(
			{
				field: "discount_pct",
				type: "decimal",
				schema: { numeric_precision: 5, numeric_scale: 2 },
				meta: { interface: "input" },
			},
			null,
			2,
		),
		responseExample: JSON.stringify(
			{ data: { field: "discount_pct", type: "decimal" } },
			null,
			2,
		),
	},
	{
		id: "fields-update",
		group: "fields",
		method: "PATCH",
		pathTemplate: `${CMS_API_BASE}/collections/{collection}/fields/{field}`,
		summary: "Update field",
		description: "Proxies to Directus PATCH /fields/{collection}/{field}.",
		auth: TENANT_SCHEMA_AUTH,
		roles: "super_admin only",
		pathParams: CMS_FIELD_PATH_PARAMS,
		proxyToken: "admin",
		requestBodyExample: JSON.stringify(
			{ meta: { required: true, note: "Must be unique per SKU" } },
			null,
			2,
		),
		responseExample: JSON.stringify(
			{ data: { field: "sku", meta: { required: true } } },
			null,
			2,
		),
	},
	{
		id: "fields-delete",
		group: "fields",
		method: "DELETE",
		pathTemplate: `${CMS_API_BASE}/collections/{collection}/fields/{field}`,
		summary: "Delete field",
		description: "Proxies to Directus DELETE /fields/{collection}/{field}. Returns 204.",
		auth: TENANT_SCHEMA_AUTH,
		roles: "super_admin only",
		pathParams: CMS_FIELD_PATH_PARAMS,
		proxyToken: "admin",
		responseExample: "(204 No Content)",
	},
];

export function resolveApiPath(
	pathTemplate: string,
	params: Record<string, string>,
): string {
	let path = pathTemplate;
	for (const [key, value] of Object.entries(params)) {
		path = path.replace(`{${key}}`, encodeURIComponent(value));
	}
	return path;
}

/** @deprecated use resolveApiPath */
export function resolveCollectionPath(pathTemplate: string, collection: string): string {
	return resolveApiPath(pathTemplate, { collection });
}

export function tenantPrefixedCollection(slug: string, collection: string): string {
	const clean = collection.replace(/^t_[a-z0-9_-]+__/, "");
	return `t_${slug}__${clean}`;
}

export function defaultPathParamValues(
	pathParams: CmsApiPathParam[] | undefined,
	collection: string,
): Record<string, string> {
	const out: Record<string, string> = { collection: collection.trim() || "products" };
	if (!pathParams) return out;
	for (const p of pathParams) {
		if (!(p.name in out)) out[p.name] = p.placeholder;
	}
	return out;
}
