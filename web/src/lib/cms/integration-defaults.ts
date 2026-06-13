export const DEFAULT_JSON_SCHEMA = {
	type: "object",
	properties: {
		sku: { type: "string", title: "SKU" },
		name: { type: "string", title: "Product name" },
		available_qty: { type: "integer", title: "Available quantity" },
		unit: { type: "string", title: "Unit", enum: ["pcs", "kg", "ltr", "box"] },
		price: { type: "number", title: "Price" },
	},
	required: ["sku", "name"],
} as const;

export const DEFAULT_UI_SCHEMA = {
	type: "VerticalLayout",
	elements: [
		{ type: "Control", scope: "#/properties/sku" },
		{ type: "Control", scope: "#/properties/name" },
		{ type: "Control", scope: "#/properties/available_qty" },
		{ type: "Control", scope: "#/properties/unit" },
		{ type: "Control", scope: "#/properties/price" },
	],
} as const;

export const DEFAULT_DIRECTUS_COLLECTION = "collection_responses";

export function stringifyJson(value: unknown, fallback = "{}"): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return fallback;
	}
}

export function parseJsonObject(
	raw: string,
	label: string,
): Record<string, unknown> | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error(`${label} must be a JSON object`);
		}
		return parsed as Record<string, unknown>;
	} catch (err) {
		throw new Error(
			err instanceof Error ? err.message : `${label} must be valid JSON`,
		);
	}
}
