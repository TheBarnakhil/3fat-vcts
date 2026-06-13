"use client";

import * as React from "react";
import { BookOpen, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	JSON_SCHEMA_EXAMPLE,
	JSON_SCHEMA_TYPES,
	SCHEMA_TIPS,
	UI_SCHEMA_ELEMENTS,
	UI_SCHEMA_EXAMPLE,
} from "@/lib/cms/schema-guide";
import { cn } from "@/lib/utils";

function CopyBlock({ label, code }: { label: string; code: string }) {
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs font-medium text-muted-foreground">{label}</span>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 gap-1 px-2 text-xs"
					onClick={async () => {
						await navigator.clipboard.writeText(code);
						toast.success("Copied to clipboard");
					}}
				>
					<Copy className="size-3" />
					Copy
				</Button>
			</div>
			<pre className="max-h-64 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-foreground">
				{code}
			</pre>
		</div>
	);
}

function GuideTable({ rows }: { rows: typeof JSON_SCHEMA_TYPES }) {
	return (
		<div className="overflow-x-auto rounded-lg border">
			<table className="w-full text-left text-sm">
				<thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
					<tr>
						<th className="px-3 py-2 font-medium">Type</th>
						<th className="px-3 py-2 font-medium">Example</th>
						<th className="px-3 py-2 font-medium">Notes</th>
					</tr>
				</thead>
				<tbody className="divide-y">
					{rows.map((row) => (
						<tr key={row.type} className="align-top">
							<td className="px-3 py-2 font-mono text-xs">{row.type}</td>
							<td className="px-3 py-2">
								<code className="block whitespace-pre-wrap rounded bg-muted/60 px-2 py-1 font-mono text-[10px] leading-snug">
									{row.example}
								</code>
							</td>
							<td className="px-3 py-2 text-xs text-muted-foreground">{row.notes}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function SchemaAuthoringGuide({ className }: { className?: string }) {
	const [open, setOpen] = React.useState(true);

	return (
		<Card className={cn("border-dashed", className)}>
			<CardHeader className="pb-3">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<CardTitle className="flex items-center gap-2 text-base">
							<BookOpen className="size-4 text-primary" />
							Schema authoring guide
						</CardTitle>
						<p className="mt-1 text-sm text-muted-foreground">
							JSON Schema defines fields and validation; UI Schema defines layout. Both
							follow the{" "}
							<a
								href="https://jsonforms.io/docs"
								target="_blank"
								rel="noopener noreferrer"
								className="font-medium text-primary underline-offset-4 hover:underline"
							>
								JSON Forms
							</a>{" "}
							standard used by the agent app.
						</p>
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="gap-1"
						onClick={() => setOpen((v) => !v)}
					>
						{open ? "Hide guide" : "Show guide"}
					</Button>
				</div>
			</CardHeader>

			{open ? (
				<CardContent className="space-y-8 pt-0">
					<section className="space-y-3">
						<h3 className="text-sm font-semibold">Quick tips</h3>
						<ul className="grid gap-2 sm:grid-cols-2">
							{SCHEMA_TIPS.map((tip) => (
								<li
									key={tip}
									className="rounded-lg border bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
								>
									{tip}
								</li>
							))}
						</ul>
					</section>

					<section className="space-y-3">
						<h3 className="text-sm font-semibold">JSON Schema — supported field types</h3>
						<GuideTable rows={JSON_SCHEMA_TYPES} />
					</section>

					<section className="space-y-3">
						<h3 className="text-sm font-semibold">UI Schema — layout elements</h3>
						<GuideTable rows={UI_SCHEMA_ELEMENTS} />
						<p className="text-xs text-muted-foreground">
							Every <code className="rounded bg-muted px-1">Control</code> needs a{" "}
							<code className="rounded bg-muted px-1">scope</code> pointing at{" "}
							<code className="rounded bg-muted px-1">#/properties/&lt;key&gt;</code>{" "}
							from your JSON Schema.
						</p>
					</section>

					<section className="grid gap-6 lg:grid-cols-2">
						<CopyBlock label="Full JSON Schema example" code={JSON_SCHEMA_EXAMPLE} />
						<CopyBlock label="Matching UI Schema example" code={UI_SCHEMA_EXAMPLE} />
					</section>

					<p className="flex items-center gap-1 text-xs text-muted-foreground">
						<ExternalLink className="size-3" />
						Extended reference (supported types, Directus mapping, troubleshooting):{" "}
						<code className="rounded bg-muted px-1">docs/collection-integration-schemas.md</code>{" "}
						in the repository.
					</p>
				</CardContent>
			) : null}
		</Card>
	);
}
