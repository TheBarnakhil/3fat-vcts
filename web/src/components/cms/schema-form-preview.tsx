"use client";

import * as React from "react";
import type { JsonSchema, UISchemaElement } from "@jsonforms/core";
import { JsonForms } from "@jsonforms/react";
import { vanillaCells, vanillaRenderers } from "@jsonforms/vanilla-renderers";
import { AlertCircle, Smartphone, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type SchemaFormPreviewProps = {
	schema: Record<string, unknown> | null;
	uischema: Record<string, unknown> | null;
	schemaError?: string | null;
	uiSchemaError?: string | null;
	className?: string;
};

export function SchemaFormPreview({
	schema,
	uischema,
	schemaError,
	uiSchemaError,
	className,
}: SchemaFormPreviewProps) {
	const [data, setData] = React.useState<Record<string, unknown>>({});

	const fieldCount =
		schema?.type === "object"
			? Object.keys((schema.properties as Record<string, unknown> | undefined) ?? {}).length
			: 0;

	const usingAutoUi = !uischema || Object.keys(uischema).length === 0;
	const parseError = schemaError ?? uiSchemaError;

	if (parseError) {
		return (
			<PreviewShell className={className} fieldCount={0} usingAutoUi={false} invalid>
				<div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
					<AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
					<div className="space-y-1">
						<p className="text-sm font-medium text-destructive">Fix JSON to preview</p>
						<p className="text-xs leading-relaxed text-muted-foreground">{parseError}</p>
					</div>
				</div>
			</PreviewShell>
		);
	}

	if (!schema || schema.type !== "object") {
		return (
			<PreviewShell className={className} fieldCount={0} usingAutoUi={false} invalid>
				<div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
					<Sparkles className="size-8 text-muted-foreground/40" />
					<p className="text-sm text-muted-foreground">
						Add a JSON Schema object with{" "}
						<code className="rounded bg-muted px-1 text-xs">type: &quot;object&quot;</code> and
						a <code className="rounded bg-muted px-1 text-xs">properties</code> map to see the
						agent form here.
					</p>
				</div>
			</PreviewShell>
		);
	}

	const ui: UISchemaElement =
		uischema && Object.keys(uischema).length > 0
			? (uischema as unknown as UISchemaElement)
			: {
					type: "VerticalLayout",
					elements: Object.keys(
						(schema.properties as Record<string, unknown> | undefined) ?? {},
					).map((key) => ({
						type: "Control",
						scope: `#/properties/${key}`,
					})),
				};

	return (
		<PreviewShell
			className={className}
			fieldCount={fieldCount}
			usingAutoUi={usingAutoUi}
			invalid={false}
		>
			<div className="jsonforms-preview space-y-4">
				<JsonForms
					schema={schema as JsonSchema}
					uischema={ui}
					data={data}
					renderers={vanillaRenderers}
					cells={vanillaCells}
					onChange={({ data: next }) => setData((next as Record<string, unknown>) ?? {})}
				/>
			</div>
		</PreviewShell>
	);
}

function PreviewShell({
	children,
	className,
	fieldCount,
	usingAutoUi,
	invalid,
}: {
	children: React.ReactNode;
	className?: string;
	fieldCount: number;
	usingAutoUi: boolean;
	invalid: boolean;
}) {
	return (
		<div
			className={cn(
				"overflow-hidden rounded-xl border bg-linear-to-b from-muted/30 to-background shadow-sm",
				invalid && "border-destructive/20",
				className,
			)}
		>
			<div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3">
				<div className="flex items-center gap-2">
					<div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<Smartphone className="size-4" />
					</div>
					<div>
						<p className="text-sm font-semibold leading-none">Agent form preview</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Approximate mobile layout agents will see
						</p>
					</div>
				</div>
				<div className="flex flex-wrap justify-end gap-1.5">
					{fieldCount > 0 ? (
						<Badge variant="secondary" className="text-[10px]">
							{fieldCount} field{fieldCount === 1 ? "" : "s"}
						</Badge>
					) : null}
					{usingAutoUi && fieldCount > 0 ? (
						<Badge variant="outline" className="text-[10px]">
							Auto UI layout
						</Badge>
					) : null}
				</div>
			</div>

			<div className="p-4">
				<div
					className={cn(
						"mx-auto max-w-md rounded-2xl border bg-card p-5 shadow-inner",
						"jsonforms-preview-surface",
						"[&_.control]:mb-4 [&_.control:last-child]:mb-0",
						"[&_label]:mb-1.5 [&_label]:block [&_label]:text-xs [&_label]:font-semibold [&_label]:uppercase [&_label]:tracking-wide [&_label]:text-muted-foreground",
						"[&_input]:h-10 [&_input]:w-full [&_input]:rounded-lg [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:text-sm [&_input]:shadow-xs",
						"[&_input:focus]:outline-none [&_input:focus]:ring-2 [&_input:focus]:ring-ring/40",
						"[&_select]:h-10 [&_select]:w-full [&_select]:rounded-lg [&_select]:border [&_select]:border-input [&_select]:bg-background [&_select]:px-3 [&_select]:text-sm",
						"[&_textarea]:min-h-20 [&_textarea]:w-full [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-background [&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:text-sm",
						"[&_input[type=checkbox]]:size-4 [&_input[type=checkbox]]:rounded [&_input[type=checkbox]]:accent-primary",
						"[&_.group-label]:mb-3 [&_.group-label]:text-sm [&_.group-label]:font-semibold [&_.group-label]:text-foreground",
						"[&_.horizontal-layout]:grid [&_.horizontal-layout]:gap-3 [&_.horizontal-layout]:sm:grid-cols-2",
						"[&_.validation]:mt-1 [&_.validation]:text-xs [&_.validation]:text-destructive",
					)}
				>
					{children}
				</div>
			</div>
		</div>
	);
}
