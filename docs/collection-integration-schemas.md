# Collection integration — JSON Schema & UI Schema guide

This document explains how tenant admins populate the **JSON Schema** and **UI Schema** fields on the **Collection integration** screen (`/collection-integration`) when using **Offline (JSON Schema)** mode.

The agent mobile app renders forms using the [JSON Forms](https://jsonforms.io/) standard:

- **JSON Schema** — field keys, types, labels (`title`), validation (`required`, `minimum`, `enum`, …)
- **UI Schema** — layout (vertical stack, horizontal rows, groups) and which properties appear

On **Save**, VCTS provisions a matching Directus collection (`t_<tenant-slug>__<collection-name>`) and stores the schemas for offline sync.

---

## Quick start

1. Open **Collection integration** → **Offline (JSON Schema)** tab.
2. Set **Directus collection name** (e.g. `collection_responses` → stored as `t_acme__collection_responses`).
3. Paste or edit **JSON Schema** (required).
4. Optionally edit **UI Schema**; leave empty for an auto-generated vertical form.
5. Check **Agent form preview** on the right.
6. Click **Save integration**.

---

## JSON Schema rules

| Rule | Detail |
|------|--------|
| Root type | Must be `"object"`. |
| Properties | Map of field key → field definition. Keys use `snake_case` or `camelCase` (no spaces). |
| Labels | Set `"title"` on each property — shown to agents. |
| Required | Top-level `"required": ["field_a", "field_b"]` array. |
| Unsupported types | Fall back to plain text in Directus and on mobile. |

### Supported field types

| JSON Schema | Example | Directus / mobile |
|-------------|---------|-------------------|
| `string` | `{ "type": "string", "title": "SKU" }` | Text input |
| `string` + `format: "textarea"` | `{ "type": "string", "format": "textarea", "title": "Notes" }` | Multi-line text |
| `integer` | `{ "type": "integer", "minimum": 0, "title": "Qty" }` | Integer |
| `number` | `{ "type": "number", "minimum": 0, "title": "Price" }` | Decimal |
| `boolean` | `{ "type": "boolean", "title": "Confirmed?" }` | Checkbox |
| `string` + `enum` | `{ "type": "string", "enum": ["pcs","kg"], "title": "Unit" }` | Dropdown |
| `string` + `format: "date"` | `{ "type": "string", "format": "date", "title": "Date" }` | Date picker |

### Full JSON Schema example

```json
{
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
}
```

---

## UI Schema rules

Optional. If omitted, VCTS builds a **VerticalLayout** with one **Control** per property (object key order).

| Element | Purpose |
|---------|---------|
| `VerticalLayout` | Stack children top-to-bottom |
| `HorizontalLayout` | Side-by-side controls (e.g. qty + unit) |
| `Group` | Section with `label` and nested `elements` |
| `Control` | Single field; `scope` must be `#/properties/<key>` |

### Full UI Schema example (matches JSON above)

```json
{
  "type": "VerticalLayout",
  "elements": [
    {
      "type": "Group",
      "label": "Product",
      "elements": [
        { "type": "Control", "scope": "#/properties/sku" },
        { "type": "Control", "scope": "#/properties/name" }
      ]
    },
    {
      "type": "HorizontalLayout",
      "elements": [
        { "type": "Control", "scope": "#/properties/available_qty" },
        { "type": "Control", "scope": "#/properties/unit" }
      ]
    },
    { "type": "Control", "scope": "#/properties/price" },
    { "type": "Control", "scope": "#/properties/notes" }
  ]
}
```

### Common mistakes

| Problem | Fix |
|---------|-----|
| Preview empty | Root JSON Schema must have `"type": "object"` and `properties`. |
| Field missing in preview | Add a `Control` with matching `scope`, or rely on auto layout. |
| Invalid JSON | Use double quotes; trailing commas are not allowed in JSON. |
| Save fails validation | Offline mode requires both JSON Schema and collection name. |

---

## After save

- Config is stored in `collection_integrations` for your tenant.
- Directus collection is created/updated with fields mapped from JSON Schema.
- Agents fetch config via `GET /api/cms/integration` and submit responses to `POST /api/cms/items/<collection>` (synced when online).

---

## Further reading

- [JSON Forms documentation](https://jsonforms.io/docs)
- [JSON Schema specification](https://json-schema.org/)
- In-app: **Collection integration** page → **Schema authoring guide** (collapsible panel with copy-paste examples)
