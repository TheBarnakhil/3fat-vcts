import {
	assertTenantCollection,
	directusFetch,
	requireAdminToken,
	resolveTenantSlug,
	stripCollectionPrefix,
} from "@/lib/cms/directus";

type JsonSchemaProperty = {
	type?: string | string[];
	enum?: unknown[];
	format?: string;
};

type JsonSchema = {
	type?: string;
	properties?: Record<string, JsonSchemaProperty>;
	required?: string[];
};

type DirectusList<T> = { data: T[] };
type DirectusOne<T> = { data: T };

const ACTIONS = ["read", "create", "update", "delete"] as const;

function directusFieldType(prop: JsonSchemaProperty): {
	type: string;
	schema?: Record<string, unknown>;
	meta?: Record<string, unknown>;
} {
	const rawType = Array.isArray(prop.type)
		? prop.type.find((t) => t !== "null") ?? "string"
		: prop.type ?? "string";

	if (prop.enum?.length) {
		return {
			type: "string",
			meta: {
				interface: "select-dropdown",
				options: { choices: prop.enum.map((v) => ({ text: String(v), value: v })) },
			},
		};
	}

	switch (rawType) {
		case "integer":
			return { type: "integer", meta: { interface: "input" } };
		case "number":
			return {
				type: "decimal",
				schema: { numeric_precision: 12, numeric_scale: 4 },
				meta: { interface: "input" },
			};
		case "boolean":
			return { type: "boolean", meta: { interface: "boolean" } };
		case "string":
			if (prop.format === "date") {
				return { type: "date", meta: { interface: "datetime" } };
			}
			if (prop.format === "date-time") {
				return { type: "timestamp", meta: { interface: "datetime" } };
			}
			return {
				type: "string",
				meta: { interface: prop.format === "textarea" ? "input-multiline" : "input" },
			};
		default:
			return { type: "string", meta: { interface: "input" } };
	}
}

function buildDefaultUiSchema(jsonSchema: JsonSchema): Record<string, unknown> {
	const props = Object.keys(jsonSchema.properties ?? {});
	return {
		type: "VerticalLayout",
		elements: props.map((key) => ({
			type: "Control",
			scope: `#/properties/${key}`,
		})),
	};
}

async function findPolicyId(slug: string): Promise<string | null> {
	const admin = requireAdminToken();
	const filter = encodeURIComponent(JSON.stringify({ name: { _eq: `VCTS Tenant ${slug}` } }));
	const res = await directusFetch<DirectusList<{ id: string }>>(
		`/policies?filter=${filter}&limit=1`,
		{ token: admin },
	);
	return res.data[0]?.id ?? null;
}

export async function ensureTenantCollectionPermissions(
	slug: string,
	collection: string,
): Promise<void> {
	const policyId = await findPolicyId(slug);
	if (!policyId) return;

	const admin = requireAdminToken();
	const filter = encodeURIComponent(
		JSON.stringify({ policy: { _eq: policyId }, collection: { _eq: collection } }),
	);
	const existing = await directusFetch<DirectusList<{ action: string }>>(
		`/permissions?filter=${filter}`,
		{ token: admin },
	);
	const have = new Set(existing.data.map((p) => p.action));
	for (const action of ACTIONS) {
		if (have.has(action)) continue;
		await directusFetch("/permissions", {
			method: "POST",
			token: admin,
			body: JSON.stringify({
				policy: policyId,
				collection,
				action,
				fields: ["*"],
			}),
		});
	}
}

async function ensureCollection(slug: string, collection: string, jsonSchema: JsonSchema) {
	const admin = requireAdminToken();
	const properties = jsonSchema.properties ?? {};
	const required = new Set(jsonSchema.required ?? []);

	try {
		const meta = await directusFetch<DirectusOne<{ schema?: unknown }>>(
			`/collections/${collection}`,
			{ token: admin },
		);
		if (!meta.data.schema) {
			await directusFetch(`/collections/${collection}`, { method: "DELETE", token: admin });
			throw new Error("recreate");
		}
	} catch {
		const fields = [
			{
				field: "id",
				type: "integer",
				schema: { is_primary_key: true, has_auto_increment: true },
				meta: { hidden: true, interface: "input", readonly: true },
			},
			...Object.entries(properties).map(([field, prop]) => {
				const mapped = directusFieldType(prop);
				return {
					field,
					type: mapped.type,
					schema: mapped.schema ?? {},
					meta: {
						...(mapped.meta ?? {}),
						required: required.has(field),
					},
				};
			}),
		];

		await directusFetch("/collections", {
			method: "POST",
			token: admin,
			body: JSON.stringify({
				collection,
				meta: {
					icon: "dynamic_form",
					note: `VCTS offline integration for ${slug}`,
				},
				schema: {},
				fields,
			}),
		});
		return;
	}

	for (const [field, prop] of Object.entries(properties)) {
		try {
			await directusFetch(`/fields/${collection}/${field}`, { token: admin });
		} catch {
			const mapped = directusFieldType(prop);
			await directusFetch(`/fields/${collection}`, {
				method: "POST",
				token: admin,
				body: JSON.stringify({
					field,
					type: mapped.type,
					schema: mapped.schema ?? {},
					meta: {
						...(mapped.meta ?? {}),
						required: required.has(field),
					},
				}),
			});
		}
	}
}

export async function provisionOfflineIntegration(
	tenantId: string,
	directusCollection: string,
	jsonSchemaInput: Record<string, unknown>,
	uiSchemaInput?: Record<string, unknown> | null,
): Promise<{ collection: string; uiSchema: Record<string, unknown> }> {
	const slug = await resolveTenantSlug(tenantId);
	const collection = assertTenantCollection(slug, directusCollection);
	const jsonSchema = jsonSchemaInput as JsonSchema;
	if (jsonSchema.type !== "object" || !jsonSchema.properties) {
		throw new Error("jsonSchema must be a JSON Schema object with properties");
	}

	const uiSchema =
		uiSchemaInput && Object.keys(uiSchemaInput).length > 0
			? uiSchemaInput
			: buildDefaultUiSchema(jsonSchema);

	await ensureCollection(slug, collection, jsonSchema);
	await ensureTenantCollectionPermissions(slug, collection);

	return {
		collection: stripCollectionPrefix(slug, collection),
		uiSchema,
	};
}
