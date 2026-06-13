"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Plug2, Save } from "lucide-react";
import { toast } from "sonner";

import { SchemaAuthoringGuide } from "@/components/cms/schema-authoring-guide";
import { SchemaFormPreview } from "@/components/cms/schema-form-preview";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, isApiError } from "@/lib/api";
import {
	DEFAULT_DIRECTUS_COLLECTION,
	DEFAULT_JSON_SCHEMA,
	DEFAULT_UI_SCHEMA,
	parseJsonObject,
	stringifyJson,
} from "@/lib/cms/integration-defaults";
import { useAuthStore } from "@/stores/auth-store";

type IntegrationMode = "webview" | "offline";

type IntegrationConfig = {
	mode: IntegrationMode;
	webviewUrl: string | null;
	jsonSchema: Record<string, unknown> | null;
	uiSchema: Record<string, unknown> | null;
	directusCollection: string | null;
	updatedAt: string;
};

type IntegrationResponse = {
	integration: IntegrationConfig | null;
};

type Draft = {
	mode: IntegrationMode;
	webviewUrl: string;
	directusCollection: string;
	jsonSchemaText: string;
	uiSchemaText: string;
};

function integrationToDraft(integration: IntegrationConfig | null | undefined): Draft {
	if (!integration) {
		return {
			mode: "offline",
			webviewUrl: "",
			directusCollection: DEFAULT_DIRECTUS_COLLECTION,
			jsonSchemaText: stringifyJson(DEFAULT_JSON_SCHEMA),
			uiSchemaText: stringifyJson(DEFAULT_UI_SCHEMA),
		};
	}

	return {
		mode: integration.mode,
		webviewUrl: integration.webviewUrl ?? "",
		directusCollection: integration.directusCollection ?? DEFAULT_DIRECTUS_COLLECTION,
		jsonSchemaText: integration.jsonSchema
			? stringifyJson(integration.jsonSchema)
			: stringifyJson(DEFAULT_JSON_SCHEMA),
		uiSchemaText: integration.uiSchema
			? stringifyJson(integration.uiSchema)
			: stringifyJson(DEFAULT_UI_SCHEMA),
	};
}

export default function CollectionIntegrationPage() {
	const user = useAuthStore((s) => s.user);
	const tenantStore = useAuthStore((s) => s.tenant);
	const qc = useQueryClient();

	const { data, isLoading } = useQuery({
		queryKey: ["cms", "integration"],
		queryFn: () => api<IntegrationResponse>("/api/cms/integration"),
	});

	const [editedDraft, setEditedDraft] = React.useState<Draft | null>(null);
	const draft = editedDraft ?? integrationToDraft(data?.integration);
	const setDraft = (next: Draft) => setEditedDraft(next);

	const previewSchema = React.useMemo(() => {
		try {
			return parseJsonObject(draft.jsonSchemaText, "JSON Schema");
		} catch {
			return null;
		}
	}, [draft.jsonSchemaText]);

	const jsonSchemaError = React.useMemo(() => {
		try {
			parseJsonObject(draft.jsonSchemaText, "JSON Schema");
			return null;
		} catch (err) {
			return err instanceof Error ? err.message : "Invalid JSON Schema";
		}
	}, [draft.jsonSchemaText]);

	const previewUiSchema = React.useMemo(() => {
		try {
			const trimmed = draft.uiSchemaText.trim();
			if (!trimmed) return null;
			return parseJsonObject(draft.uiSchemaText, "UI Schema");
		} catch {
			return null;
		}
	}, [draft.uiSchemaText]);

	const uiSchemaError = React.useMemo(() => {
		try {
			const trimmed = draft.uiSchemaText.trim();
			if (!trimmed) return null;
			parseJsonObject(draft.uiSchemaText, "UI Schema");
			return null;
		} catch (err) {
			return err instanceof Error ? err.message : "Invalid UI Schema";
		}
	}, [draft.uiSchemaText]);

	const save = useMutation({
		mutationFn: async () => {
			if (draft.mode === "webview") {
				if (!draft.webviewUrl.trim()) {
					throw new Error("Directus collection URL is required for WebView mode");
				}
				return api<IntegrationResponse>("/api/cms/integration", {
					method: "PUT",
					body: JSON.stringify({
						mode: "webview",
						webviewUrl: draft.webviewUrl.trim(),
						jsonSchema: null,
						uiSchema: null,
						directusCollection: null,
					}),
				});
			}

			const jsonSchema = parseJsonObject(draft.jsonSchemaText, "JSON Schema");
			const uiSchema = parseJsonObject(draft.uiSchemaText, "UI Schema");
			if (!jsonSchema) throw new Error("JSON Schema is required for offline mode");
			if (!draft.directusCollection.trim()) {
				throw new Error("Directus collection name is required");
			}

			return api<IntegrationResponse>("/api/cms/integration", {
				method: "PUT",
				body: JSON.stringify({
					mode: "offline",
					webviewUrl: null,
					jsonSchema,
					uiSchema,
					directusCollection: draft.directusCollection.trim(),
				}),
			});
		},
		onSuccess: (res) => {
			qc.setQueryData(["cms", "integration"], res);
			setEditedDraft(null);
			toast.success("Collection integration saved.");
		},
		onError: (err) => {
			const msg = isApiError(err) ? err.message : (err as Error).message;
			toast.error(msg);
		},
	});

	const isReadonly = user?.role !== "super_admin";

	if (isLoading) {
		return (
			<div className="flex h-64 items-center justify-center text-muted-foreground">
				<LoaderCircle className="mr-2 size-5 animate-spin" />
				Loading collection integration...
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<PageHeader
				title="Collection integration"
				description="Choose how agents capture extra data during a collection — embed a Directus WebView or render a native offline form from JSON Schema."
			/>

			{isReadonly ? (
				<Card>
					<CardContent className="py-6 text-sm text-muted-foreground">
						Only super admins can edit collection integration. Ask{" "}
						<span className="font-medium text-foreground">
							{tenantStore?.name ?? "your admin"}
						</span>{" "}
						to update these settings.
					</CardContent>
				</Card>
			) : null}

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-base">
						<Plug2 className="size-4" />
						Integration mode
					</CardTitle>
				</CardHeader>
				<CardContent>
					<Tabs
						value={draft.mode}
						onValueChange={(value) =>
							setDraft({ ...draft, mode: value as IntegrationMode })
						}
					>
						<TabsList>
							<TabsTrigger value="webview" disabled={isReadonly}>
								WebView
							</TabsTrigger>
							<TabsTrigger value="offline" disabled={isReadonly}>
								Offline (JSON Schema)
							</TabsTrigger>
						</TabsList>

						<TabsContent value="webview" className="mt-4 space-y-4">
							<Field
								label="Directus collection URL"
								hint="Full URL the agent opens in a WebView. Must be reachable from the device and usable without extra auth (shareable/public form URL)."
							>
								<Input
									value={draft.webviewUrl}
									onChange={(e) =>
										setDraft({ ...draft, webviewUrl: e.target.value })
									}
									placeholder="https://your-directus.example.com/admin/content/t_acme__stock"
									disabled={isReadonly}
								/>
							</Field>
						</TabsContent>

						<TabsContent value="offline" className="mt-4 space-y-6">
							<Field
								label="Directus collection name"
								hint={`Stored as t_${tenantStore?.slug ?? "tenant"}__<name> in Directus. Use letters, numbers, underscores.`}
							>
								<Input
									value={draft.directusCollection}
									onChange={(e) =>
										setDraft({ ...draft, directusCollection: e.target.value })
									}
									placeholder={DEFAULT_DIRECTUS_COLLECTION}
									disabled={isReadonly}
								/>
							</Field>

							<div className="grid gap-6 xl:grid-cols-2 xl:items-start">
								<div className="space-y-4">
									<Field
										label="JSON Schema"
										hint="Defines fields and validation. See the schema guide below for supported types and examples."
									>
										<Textarea
											value={draft.jsonSchemaText}
											onChange={(e) =>
												setDraft({ ...draft, jsonSchemaText: e.target.value })
											}
											className="min-h-[300px] font-mono text-xs leading-relaxed"
											disabled={isReadonly}
											aria-invalid={Boolean(jsonSchemaError)}
										/>
										{jsonSchemaError ? (
											<p className="text-xs text-destructive">{jsonSchemaError}</p>
										) : null}
									</Field>
									<Field
										label="UI Schema (optional)"
										hint="Controls layout and grouping. Leave empty to auto-generate a vertical form."
									>
										<Textarea
											value={draft.uiSchemaText}
											onChange={(e) =>
												setDraft({ ...draft, uiSchemaText: e.target.value })
											}
											className="min-h-[220px] font-mono text-xs leading-relaxed"
											disabled={isReadonly}
											aria-invalid={Boolean(uiSchemaError)}
										/>
										{uiSchemaError ? (
											<p className="text-xs text-destructive">{uiSchemaError}</p>
										) : null}
									</Field>
								</div>

								<div className="xl:sticky xl:top-6">
									<SchemaFormPreview
										schema={previewSchema}
										uischema={previewUiSchema}
										schemaError={jsonSchemaError}
										uiSchemaError={uiSchemaError}
									/>
								</div>
							</div>

							<SchemaAuthoringGuide />
						</TabsContent>
					</Tabs>
				</CardContent>
			</Card>

			{data?.integration?.updatedAt ? (
				<p className="text-xs text-muted-foreground">
					Last saved{" "}
					{new Date(data.integration.updatedAt).toLocaleString(undefined, {
						dateStyle: "medium",
						timeStyle: "short",
					})}
					.
				</p>
			) : null}

			<div className="flex justify-end">
				<Button
					onClick={() => save.mutate()}
					disabled={isReadonly || save.isPending}
					className="gap-2"
				>
					{save.isPending ? (
						<LoaderCircle className="size-4 animate-spin" />
					) : (
						<Save className="size-4" />
					)}
					Save integration
				</Button>
			</div>
		</div>
	);
}

function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-1.5">
			<Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</Label>
			{children}
			{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
		</div>
	);
}
