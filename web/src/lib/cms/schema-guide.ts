export type SchemaGuideRow = {
	type: string;
	example: string;
	notes: string;
};

export const JSON_SCHEMA_TYPES: SchemaGuideRow[] = [
	{
		type: "string",
		example: '{ "type": "string", "title": "Customer note" }',
		notes: "Single-line text. Add format: \"textarea\" for multi-line (Directus + mobile).",
	},
	{
		type: "integer",
		example: '{ "type": "integer", "title": "Quantity", "minimum": 0 }',
		notes: "Whole numbers. Use minimum / maximum for range validation.",
	},
	{
		type: "number",
		example: '{ "type": "number", "title": "Price", "minimum": 0 }',
		notes: "Decimals (price, weight). Stored as decimal in Directus.",
	},
	{
		type: "boolean",
		example: '{ "type": "boolean", "title": "Delivered?" }',
		notes: "Checkbox / toggle.",
	},
	{
		type: "enum",
		example: '{ "type": "string", "enum": ["pcs", "kg", "box"], "title": "Unit" }',
		notes: "Dropdown. enum values must be strings.",
	},
	{
		type: "date",
		example: '{ "type": "string", "format": "date", "title": "Delivery date" }',
		notes: "ISO date (YYYY-MM-DD).",
	},
];

export const UI_SCHEMA_ELEMENTS: SchemaGuideRow[] = [
	{
		type: "VerticalLayout",
		example: '{ "type": "VerticalLayout", "elements": [ ... ] }',
		notes: "Stack fields top-to-bottom (default if UI Schema omitted).",
	},
	{
		type: "HorizontalLayout",
		example: '{ "type": "HorizontalLayout", "elements": [ ... ] }',
		notes: "Place controls side-by-side on wider screens.",
	},
	{
		type: "Control",
		example: '{ "type": "Control", "scope": "#/properties/sku", "label": "SKU" }',
		notes: "Binds one JSON Schema property. scope must match #/properties/<key>.",
	},
	{
		type: "Group",
		example: '{ "type": "Group", "label": "Stock", "elements": [ ... ] }',
		notes: "Visual section with heading.",
	},
];

export const JSON_SCHEMA_EXAMPLE = `{
  "type": "object",
  "properties": {
    "sku": { "type": "string", "title": "SKU" },
    "name": { "type": "string", "title": "Product name" },
    "available_qty": { "type": "integer", "title": "Qty on hand", "minimum": 0 },
    "unit": {
      "type": "string",
      "title": "Unit",
      "enum": ["pcs", "kg", "ltr", "box"]
    },
    "price": { "type": "number", "title": "Price (INR)", "minimum": 0 },
    "notes": { "type": "string", "title": "Notes", "format": "textarea" }
  },
  "required": ["sku", "name"]
}`;

export const UI_SCHEMA_EXAMPLE = `{
  "type": "VerticalLayout",
  "elements": [
    { "type": "Group", "label": "Product", "elements": [
      { "type": "Control", "scope": "#/properties/sku" },
      { "type": "Control", "scope": "#/properties/name" }
    ]},
    { "type": "HorizontalLayout", "elements": [
      { "type": "Control", "scope": "#/properties/available_qty" },
      { "type": "Control", "scope": "#/properties/unit" }
    ]},
    { "type": "Control", "scope": "#/properties/price" },
    { "type": "Control", "scope": "#/properties/notes" }
  ]
}`;

export const SCHEMA_TIPS = [
	"Root must be type \"object\" with a properties map.",
	"Use title on each property — agents see it as the field label.",
	"required is an array of property keys that must be filled before submit.",
	"Collection name becomes t_<your-tenant-slug>__<name> in Directus (e.g. collection_responses).",
	"Leave UI Schema empty to auto-generate a simple vertical form from properties order.",
	"Save provisions the Directus collection and fields; unsupported types fall back to text.",
];
