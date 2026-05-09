"use client";

import * as React from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
	CheckCircle2,
	Download,
	LoaderCircle,
	ShieldAlert,
	ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

type AuditRow = {
	id: string;
	seq: number;
	actorId: string | null;
	action: string;
	entityType: string;
	entityId: string | null;
	beforeJson: unknown;
	afterJson: unknown;
	ip: string | null;
	createdAt: string;
	actor: {
		id: string;
		name: string | null;
		email: string | null;
		agentCode: string | null;
	} | null;
};

type AuditPage = { rows: AuditRow[]; nextCursor: number | null };

type ChainResult =
	| { ok: true; rows: number }
	| { ok: false; rows: number; brokenAtSeq: number; reason: string };

function formatTime(iso: string): string {
	return new Date(iso).toLocaleString("en-IN", {
		day: "2-digit",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

const actionTone: Record<string, string> = {
	"collection.create": "bg-primary/10 text-primary",
	"collection.attached": "bg-blue-500/10 text-blue-700 dark:text-blue-300",
	"collection.reverse": "bg-destructive/10 text-destructive",
	"agent.create": "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
	"customer.create": "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
	"customer.update": "bg-amber-500/10 text-amber-700 dark:text-amber-300",
	"review.resolve": "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
	"review.reopen": "bg-amber-500/10 text-amber-700 dark:text-amber-300",
	"branding.update": "bg-purple-500/10 text-purple-700 dark:text-purple-300",
};

export default function AuditPage() {
	const me = useAuthStore((s) => s.user);
	const canVerify = me?.role === "super_admin" || me?.role === "auditor";
	const [actionFilter, setActionFilter] = React.useState("");

	const { data: chain, isFetching: chainLoading, refetch: refetchChain } =
		useQuery<ChainResult>({
			queryKey: ["audit", "verify"],
			queryFn: () => api<ChainResult>("/api/audit/verify"),
			enabled: canVerify,
		});

	const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
		useInfiniteQuery<
			AuditPage,
			Error,
			{ pages: AuditPage[]; pageParams: (number | null)[] },
			[string, string],
			number | null
		>({
			queryKey: ["audit", actionFilter],
			queryFn: ({ pageParam }) => {
				const q = new URLSearchParams({ limit: "100" });
				if (actionFilter.trim()) q.set("action", actionFilter.trim());
				if (pageParam != null) q.set("cursor", String(pageParam));
				return api<AuditPage>(`/api/audit?${q.toString()}`);
			},
			initialPageParam: null,
			getNextPageParam: (last) => last.nextCursor ?? undefined,
		});

	const rows: AuditRow[] = React.useMemo(
		() => (data?.pages ?? []).flatMap((p: AuditPage) => p.rows),
		[data],
	);

	const onExport = () => {
		if (rows.length === 0) {
			toast.info("Nothing to export.");
			return;
		}
		const headers = [
			"seq",
			"createdAt",
			"action",
			"entityType",
			"entityId",
			"actorName",
			"actorEmail",
			"ip",
		];
		const csvRows = rows.map((r) =>
			[
				r.seq,
				r.createdAt,
				r.action,
				r.entityType,
				r.entityId ?? "",
				r.actor?.name ?? "",
				r.actor?.email ?? "",
				r.ip ?? "",
			]
				.map((v) => `"${String(v).replace(/"/g, '""')}"`)
				.join(","),
		);
		const csv = [headers.join(","), ...csvRows].join("\n");
		const blob = new Blob([csv], { type: "text/csv" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	};

	return (
		<div className="space-y-6">
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<ShieldCheck className="size-7 text-primary" />
						Audit trail
					</span>
				}
				description="Every privileged action lands here as a row in an HMAC-chained log. A broken chain means somebody tampered with history."
			/>

			<div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
				<div className="space-y-1">
					<Label htmlFor="action-filter">Action filter (exact match)</Label>
					<Input
						id="action-filter"
						placeholder="e.g. collection.reverse"
						value={actionFilter}
						onChange={(e) => setActionFilter(e.target.value)}
					/>
				</div>
				<div className="flex items-end">
					<Button variant="outline" onClick={onExport}>
						<Download className="mr-2 size-4" />
						Export CSV
					</Button>
				</div>
				{canVerify && (
					<div className="flex items-end">
						<Button
							variant="secondary"
							onClick={() => {
								refetchChain();
								toast.info("Recomputing chain integrity…");
							}}
							disabled={chainLoading}
						>
							{chainLoading ? (
								<LoaderCircle className="mr-2 size-4 animate-spin" />
							) : (
								<ShieldCheck className="mr-2 size-4" />
							)}
							Verify chain
						</Button>
					</div>
				)}
			</div>

			{canVerify && chain && (
				<Card
					className={
						chain.ok
							? "border-emerald-500/40 bg-emerald-500/5"
							: "border-destructive/40 bg-destructive/5"
					}
				>
					<CardHeader className="pb-2">
						<CardTitle className="flex items-center gap-2 text-base">
							{chain.ok ? (
								<CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
							) : (
								<ShieldAlert className="size-5 text-destructive" />
							)}
							{chain.ok ? "Chain intact" : "Chain broken"}
						</CardTitle>
					</CardHeader>
					<CardContent className="text-sm">
						<div>
							<span className="text-muted-foreground">Rows checked: </span>
							<span className="font-mono">{chain.rows}</span>
						</div>
						{!chain.ok && (
							<div className="mt-1 space-y-0.5">
								<div>
									<span className="text-muted-foreground">Broken at: </span>
									<span className="font-mono">seq {chain.brokenAtSeq}</span>
								</div>
								<div>
									<span className="text-muted-foreground">Reason: </span>
									<span className="font-mono">{chain.reason}</span>
								</div>
							</div>
						)}
					</CardContent>
				</Card>
			)}

			<Card>
				<CardContent className="p-0">
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
								<tr>
									<th className="px-3 py-2 text-left">Seq</th>
									<th className="px-3 py-2 text-left">When</th>
									<th className="px-3 py-2 text-left">Action</th>
									<th className="px-3 py-2 text-left">Entity</th>
									<th className="px-3 py-2 text-left">Actor</th>
									<th className="px-3 py-2 text-left">IP</th>
								</tr>
							</thead>
							<tbody>
								{isLoading
									? Array.from({ length: 6 }).map((_, i) => (
											<tr key={i}>
												<td className="px-3 py-2" colSpan={6}>
													<div className="h-4 animate-pulse rounded bg-muted" />
												</td>
											</tr>
										))
									: rows.map((row) => (
											<AuditRowItem key={row.id} row={row} />
										))}
								{!isLoading && rows.length === 0 && (
									<tr>
										<td
											className="px-3 py-12 text-center text-muted-foreground"
											colSpan={6}
										>
											No audit events match this filter.
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
					{hasNextPage && (
						<div className="border-t p-3 text-center">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => fetchNextPage()}
								disabled={isFetchingNextPage}
							>
								{isFetchingNextPage && (
									<LoaderCircle className="mr-2 size-4 animate-spin" />
								)}
								Load more
							</Button>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function AuditRowItem({ row }: { row: AuditRow }) {
	const [open, setOpen] = React.useState(false);
	const tone = actionTone[row.action] ?? "bg-muted text-foreground";
	const hasDiff =
		(row.beforeJson != null && row.beforeJson !== undefined) ||
		(row.afterJson != null && row.afterJson !== undefined);

	return (
		<>
			<tr
				className={`border-b transition-colors hover:bg-muted/30 ${
					hasDiff ? "cursor-pointer" : ""
				}`}
				onClick={() => hasDiff && setOpen((o) => !o)}
			>
				<td className="px-3 py-2 font-mono text-xs text-muted-foreground">
					{row.seq}
				</td>
				<td className="px-3 py-2 text-xs text-muted-foreground">
					{formatTime(row.createdAt)}
				</td>
				<td className="px-3 py-2">
					<Badge className={`font-mono text-[10px] ${tone}`} variant="outline">
						{row.action}
					</Badge>
				</td>
				<td className="px-3 py-2">
					<span className="font-mono text-xs text-muted-foreground">
						{row.entityType}
					</span>
					{row.entityId && (
						<>
							<span className="text-muted-foreground"> · </span>
							<span className="font-mono text-[11px]">
								{row.entityId.slice(0, 8)}…
							</span>
						</>
					)}
				</td>
				<td className="px-3 py-2 text-xs">
					{row.actor ? (
						<>
							<span>{row.actor.name ?? row.actor.email}</span>
							{row.actor.agentCode && (
								<span className="ml-1 text-muted-foreground">
									({row.actor.agentCode})
								</span>
							)}
						</>
					) : (
						<span className="text-muted-foreground">system</span>
					)}
				</td>
				<td className="px-3 py-2 font-mono text-xs text-muted-foreground">
					{row.ip ?? "—"}
				</td>
			</tr>
			{open && (
				<tr className="border-b bg-muted/20">
					<td colSpan={6} className="px-3 py-3">
						<div className="grid gap-3 lg:grid-cols-2">
							<JsonBlock label="Before" value={row.beforeJson} />
							<JsonBlock label="After" value={row.afterJson} />
						</div>
					</td>
				</tr>
			)}
		</>
	);
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
	return (
		<div>
			<div className="mb-1 text-xs font-medium text-muted-foreground">
				{label}
			</div>
			<pre className="max-h-64 overflow-auto rounded-md bg-background p-2 font-mono text-[11px]">
				{value == null ? "null" : JSON.stringify(value, null, 2)}
			</pre>
		</div>
	);
}
