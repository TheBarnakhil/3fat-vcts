"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, KeyRound, LoaderCircle, Play, Shield, Terminal } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	CMS_API_ENDPOINTS,
	CMS_API_GROUPS,
	resolveApiPath,
	tenantPrefixedCollection,
	type CmsApiEndpoint,
	type HttpMethod,
} from "@/lib/cms/api-docs";
import { api, isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

type DocsContext = {
	tenant: { id: string; slug: string; name: string };
	collectionPrefix: string;
	directusConfigured: boolean;
	directusTokenConfigured: boolean;
	bearerToken: string | null;
	exampleCollections: string[];
};

const METHOD_STYLES: Record<HttpMethod, string> = {
	GET: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
	POST: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
	PUT: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
	PATCH: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
	DELETE: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			className="h-7 gap-1 px-2 text-xs"
			onClick={async () => {
				await navigator.clipboard.writeText(text);
				toast.success("Copied to clipboard");
			}}
		>
			<Copy className="size-3" />
			{label}
		</Button>
	);
}

function CodeBlock({ code }: { code: string }) {
	return (
		<pre className="max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-foreground">
			{code}
		</pre>
	);
}

function buildCurl(
	method: HttpMethod,
	url: string,
	bearerToken: string | null | undefined,
	body?: string,
): string {
	const token = bearerToken ?? "<tenant-jwt>";
	return [
		`curl -X ${method} '${url}'`,
		`-H 'Content-Type: application/json'`,
		`-H 'Authorization: Bearer ${token}'`,
		body && (method === "POST" || method === "PUT" || method === "PATCH")
			? `-d '${body.replace(/\n/g, "").replace(/'/g, "'\\''")}'`
			: null,
	]
		.filter(Boolean)
		.join(" \\\n  ");
}

function TenantAuthPanel({ context }: { context: DocsContext }) {
	const token = context.bearerToken;

	return (
		<div className="space-y-3 rounded-lg border bg-muted/20 p-4">
			<div className="flex items-start gap-2">
				<Shield className="mt-0.5 size-4 shrink-0 text-primary" />
				<div className="space-y-1 text-sm">
					<p className="font-medium text-foreground">
						Tenant scope: {context.tenant.name}{" "}
						<span className="font-mono text-muted-foreground">({context.tenant.slug})</span>
					</p>
					<p className="text-xs text-muted-foreground">
						All CMS calls use your <strong>VCTS JWT for this tenant</strong>. The server
						exchanges it for the Directus service token{" "}
						<code className="font-mono">DIRECTUS_TENANT_TOKENS[{context.tenant.slug}]</code>
						— do not paste Directus admin credentials from the WebView, and never send
						Directus static tokens from the browser.
					</p>
				</div>
			</div>
			<div className="grid gap-2 text-xs sm:grid-cols-2">
				<div>
					<span className="font-medium text-foreground">Collection prefix</span>
					<p className="font-mono text-muted-foreground">{context.collectionPrefix}</p>
				</div>
				<div>
					<span className="font-medium text-foreground">Directus token</span>
					<p className="text-muted-foreground">
						{context.directusTokenConfigured ? "Configured for this tenant" : "Missing in env"}
					</p>
				</div>
			</div>
			{token ? (
				<div className="space-y-1.5">
					<div className="flex items-center justify-between gap-2">
						<Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
							<KeyRound className="size-3.5" />
							Your tenant JWT (Bearer)
						</Label>
						<CopyButton text={token} label="Copy JWT" />
					</div>
					<CodeBlock code={token} />
				</div>
			) : (
				<p className="text-xs text-destructive">Could not read session token. Log in again.</p>
			)}
		</div>
	);
}

function TryItPanel({
	endpoint,
	pathParams,
	bearerToken,
	tenantSlug,
}: {
	endpoint: CmsApiEndpoint;
	pathParams: Record<string, string>;
	bearerToken: string | null | undefined;
	tenantSlug?: string;
}) {
	const needsCollection = endpoint.pathTemplate.includes("{collection}");
	const [query, setQuery] = React.useState("limit=5");
	const [body, setBody] = React.useState(endpoint.requestBodyExample ?? "{}");
	const [loading, setLoading] = React.useState(false);
	const [result, setResult] = React.useState<string | null>(null);

	const shortCollection = pathParams.collection?.trim() || "products";
	const path = resolveApiPath(endpoint.pathTemplate, pathParams);
	const url =
		endpoint.method === "GET" && query.trim()
			? `${path}?${query.trim().replace(/^\?/, "")}`
			: path;

	const hasBody =
		endpoint.method === "POST" ||
		endpoint.method === "PUT" ||
		endpoint.method === "PATCH";

	async function send() {
		if (!bearerToken) {
			toast.error("No tenant JWT available. Log in again.");
			return;
		}
		setLoading(true);
		setResult(null);
		try {
			const init: RequestInit = {
				method: endpoint.method,
				headers: { Authorization: `Bearer ${bearerToken}` },
			};
			if (hasBody) init.body = body;
			const data = await api<unknown>(url, init);
			if (endpoint.method === "DELETE" && (data === null || data === undefined)) {
				setResult("(204 No Content)");
			} else {
				setResult(JSON.stringify(data, null, 2));
			}
		} catch (err) {
			const msg = isApiError(err)
				? `${err.status} ${err.code ?? ""}: ${err.message}`
				: (err as Error).message;
			setResult(msg);
		} finally {
			setLoading(false);
		}
	}

	const resolvedDirectus =
		tenantSlug && needsCollection
			? tenantPrefixedCollection(tenantSlug, shortCollection)
			: null;

	return (
		<div className="space-y-3 rounded-lg border border-dashed bg-muted/20 p-4">
			<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				<Play className="size-3.5" />
				Try it (tenant JWT → Directus proxy)
			</div>
			{needsCollection ? (
				<p className="text-xs text-muted-foreground">
					Short name{" "}
					<code className="rounded bg-muted px-1 py-0.5 font-mono">{shortCollection}</code>
					{resolvedDirectus ? (
						<>
							{" "}
							→ Directus{" "}
							<code className="rounded bg-muted px-1 py-0.5 font-mono">{resolvedDirectus}</code>
						</>
					) : null}
				</p>
			) : null}
			{endpoint.method === "GET" && endpoint.queryParams ? (
				<div className="space-y-1.5">
					<Label className="text-xs text-muted-foreground">Query string</Label>
					<Input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						className="font-mono text-xs"
						placeholder="limit=5&fields=id,sku,name"
					/>
				</div>
			) : null}
			{hasBody ? (
				<div className="space-y-1.5">
					<Label className="text-xs text-muted-foreground">Request body (JSON)</Label>
					<Textarea
						value={body}
						onChange={(e) => setBody(e.target.value)}
						className="min-h-[140px] font-mono text-xs leading-relaxed"
					/>
				</div>
			) : null}
			<Button
				type="button"
				size="sm"
				onClick={send}
				disabled={loading || !bearerToken}
				className="gap-1.5"
			>
				{loading ? (
					<LoaderCircle className="size-3.5 animate-spin" />
				) : (
					<Play className="size-3.5" />
				)}
				Send request
			</Button>
			{result ? (
				<div className="space-y-1">
					<span className="text-xs font-medium text-muted-foreground">Response</span>
					<CodeBlock code={result} />
				</div>
			) : null}
		</div>
	);
}

function EndpointCard({
	endpoint,
	pathParams,
	context,
	defaultOpen,
}: {
	endpoint: CmsApiEndpoint;
	pathParams: Record<string, string>;
	context: DocsContext;
	defaultOpen?: boolean;
}) {
	const [open, setOpen] = React.useState(defaultOpen ?? false);
	const resolvedPath = resolveApiPath(endpoint.pathTemplate, pathParams);
	const origin = typeof window !== "undefined" ? window.location.origin : "";
	const curl = buildCurl(
		endpoint.method,
		`${origin}${resolvedPath}`,
		context.bearerToken,
		endpoint.requestBodyExample,
	);

	return (
		<div className="rounded-lg border">
			<button
				type="button"
				className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/30"
				onClick={() => setOpen((v) => !v)}
			>
				<Badge className={cn("mt-0.5 shrink-0 font-mono text-[10px]", METHOD_STYLES[endpoint.method])}>
					{endpoint.method}
				</Badge>
				<div className="min-w-0 flex-1">
					<p className="font-mono text-sm break-all">{resolvedPath}</p>
					<p className="mt-0.5 text-sm text-muted-foreground">{endpoint.summary}</p>
				</div>
			</button>
			{open ? (
				<div className="space-y-4 border-t px-4 py-4">
					<p className="text-sm text-muted-foreground">{endpoint.description}</p>
					<div className="grid gap-2 text-xs sm:grid-cols-2">
						<div className="sm:col-span-2">
							<span className="font-medium text-foreground">Auth</span>
							<p className="text-muted-foreground">{endpoint.auth}</p>
						</div>
						{endpoint.roles ? (
							<div>
								<span className="font-medium text-foreground">Role</span>
								<p className="text-muted-foreground">{endpoint.roles}</p>
							</div>
						) : null}
						<div>
							<span className="font-medium text-foreground">Directus proxy</span>
							<p className="text-muted-foreground">
								{endpoint.proxyToken === "tenant"
									? "Tenant service token (DIRECTUS_TENANT_TOKENS)"
									: "Admin token (DIRECTUS_ADMIN_TOKEN), tenant prefix enforced"}
							</p>
						</div>
						<div>
							<span className="font-medium text-foreground">Directus target</span>
							<p className="font-mono text-muted-foreground">
								{endpoint.pathTemplate.includes("{collection}")
									? tenantPrefixedCollection(
											context.tenant.slug,
											pathParams.collection || "products",
										)
									: "—"}
							</p>
						</div>
					</div>

					{endpoint.pathParams ? (
						<div className="space-y-2">
							<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
								Path parameters
							</p>
							<div className="overflow-x-auto rounded-lg border">
								<table className="w-full text-left text-sm">
									<thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
										<tr>
											<th className="px-3 py-2 font-medium">Name</th>
											<th className="px-3 py-2 font-medium">Description</th>
											<th className="px-3 py-2 font-medium">Example</th>
										</tr>
									</thead>
									<tbody className="divide-y">
										{endpoint.pathParams.map((row) => (
											<tr key={row.name} className="align-top">
												<td className="px-3 py-2 font-mono text-xs">{row.name}</td>
												<td className="px-3 py-2 text-xs text-muted-foreground">
													{row.description}
												</td>
												<td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
													{pathParams[row.name] ?? row.placeholder}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					) : null}

					{endpoint.queryParams ? (
						<div className="space-y-2">
							<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
								Query parameters
							</p>
							<div className="overflow-x-auto rounded-lg border">
								<table className="w-full text-left text-sm">
									<thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
										<tr>
											<th className="px-3 py-2 font-medium">Name</th>
											<th className="px-3 py-2 font-medium">Description</th>
											<th className="px-3 py-2 font-medium">Example</th>
										</tr>
									</thead>
									<tbody className="divide-y">
										{endpoint.queryParams.map((row) => (
											<tr key={row.name} className="align-top">
												<td className="px-3 py-2 font-mono text-xs">{row.name}</td>
												<td className="px-3 py-2 text-xs text-muted-foreground">
													{row.description}
												</td>
												<td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
													{row.example ?? "—"}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					) : null}

					{endpoint.requestBodyExample ? (
						<div className="space-y-2">
							<div className="flex items-center justify-between gap-2">
								<span className="text-xs font-medium text-muted-foreground">Request body</span>
								<CopyButton text={endpoint.requestBodyExample} />
							</div>
							<CodeBlock code={endpoint.requestBodyExample} />
						</div>
					) : null}

					<div className="space-y-2">
						<div className="flex items-center justify-between gap-2">
							<span className="text-xs font-medium text-muted-foreground">Example response</span>
							<CopyButton text={endpoint.responseExample} />
						</div>
						<CodeBlock code={endpoint.responseExample} />
					</div>

					<div className="space-y-2">
						<div className="flex items-center justify-between gap-2">
							<span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
								<Terminal className="size-3.5" />
								cURL (tenant JWT)
							</span>
							<CopyButton text={curl} label="Copy cURL" />
						</div>
						<CodeBlock code={curl} />
					</div>

					{endpoint.tryIt ? (
						<TryItPanel
							endpoint={endpoint}
							pathParams={pathParams}
							bearerToken={context.bearerToken}
							tenantSlug={context.tenant.slug}
						/>
					) : null}
				</div>
			) : null}
		</div>
	);
}

export function CmsApiDocs({
	defaultCollection = "products",
	className,
}: {
	defaultCollection?: string;
	className?: string;
}) {
	const [collection, setCollection] = React.useState(defaultCollection);
	const [itemId, setItemId] = React.useState("1");
	const [fieldName, setFieldName] = React.useState("sku");

	const pathParams = React.useMemo(
		() => ({
			collection: collection.trim() || "products",
			id: itemId.trim() || "1",
			field: fieldName.trim() || "sku",
		}),
		[collection, itemId, fieldName],
	);

	const { data: context, isLoading, isError } = useQuery({
		queryKey: ["cms", "docs", "context"],
		queryFn: () => api<DocsContext>("/api/cms/docs/context"),
	});

	React.useEffect(() => {
		if (defaultCollection) setCollection(defaultCollection);
	}, [defaultCollection]);

	if (isLoading) {
		return (
			<Card className={cn("border-dashed", className)}>
				<CardContent className="flex h-32 items-center justify-center text-sm text-muted-foreground">
					<LoaderCircle className="mr-2 size-4 animate-spin" />
					Loading tenant API context...
				</CardContent>
			</Card>
		);
	}

	if (isError || !context) {
		return (
			<Card className={cn("border-dashed", className)}>
				<CardContent className="py-6 text-sm text-destructive">
					Could not load tenant API context. Refresh the page or log in again.
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className={cn("border-dashed", className)}>
			<CardHeader className="pb-3">
				<CardTitle className="flex items-center gap-2 text-base">
					<Terminal className="size-4" />
					CMS API reference
				</CardTitle>
				<p className="text-sm text-muted-foreground">
					Tenant-scoped proxy to Directus. Populate{" "}
					<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
						{context.collectionPrefix}*
					</code>{" "}
					collections using your <strong>{context.tenant.name}</strong> JWT — the same tenant
					scope as the WebView integration, without using Directus admin login.
				</p>
			</CardHeader>
			<CardContent className="space-y-4">
				<TenantAuthPanel context={context} />

				<div className="grid gap-4 sm:grid-cols-3">
					<div className="space-y-1.5">
						<Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Collection
						</Label>
						<Input
							value={collection}
							onChange={(e) => setCollection(e.target.value)}
							placeholder="products"
							className="font-mono text-sm"
						/>
						<p className="text-xs text-muted-foreground">
							→{" "}
							<code className="font-mono">
								{tenantPrefixedCollection(context.tenant.slug, collection || "products")}
							</code>
						</p>
					</div>
					<div className="space-y-1.5">
						<Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Item id
						</Label>
						<Input
							value={itemId}
							onChange={(e) => setItemId(e.target.value)}
							placeholder="1"
							className="font-mono text-sm"
						/>
					</div>
					<div className="space-y-1.5">
						<Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Field name
						</Label>
						<Input
							value={fieldName}
							onChange={(e) => setFieldName(e.target.value)}
							placeholder="sku"
							className="font-mono text-sm"
						/>
					</div>
				</div>
				<p className="text-xs text-muted-foreground">
					Seeded collections:{" "}
					{context.exampleCollections.map((c) => (
						<code key={c} className="mx-0.5 font-mono">
							{c}
						</code>
					))}
				</p>

				{CMS_API_GROUPS.map((group) => {
					const endpoints = CMS_API_ENDPOINTS.filter((e) => e.group === group.id);
					if (endpoints.length === 0) return null;
					return (
						<div key={group.id} className="space-y-3">
							<div>
								<h3 className="text-sm font-semibold text-foreground">{group.title}</h3>
								<p className="text-xs text-muted-foreground">{group.description}</p>
							</div>
							{endpoints.map((endpoint) => (
								<EndpointCard
									key={endpoint.id}
									endpoint={endpoint}
									pathParams={pathParams}
									context={context}
									defaultOpen={
										group.id === "items" && endpoint.id === "items-create"
									}
								/>
							))}
						</div>
					);
				})}

				<div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
					<Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
					<p>
						<strong className="font-medium text-foreground">Tip:</strong> use{" "}
						<span className="font-mono">POST /api/cms/items/&#123;collection&#125;</span> with
						your tenant JWT to seed rows for WebView testing. Reload the Directus admin URL
						after a successful create.
					</p>
				</div>
			</CardContent>
		</Card>
	);
}
