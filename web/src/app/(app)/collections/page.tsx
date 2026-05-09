"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
	AlertTriangle,
	Download,
	FileDown,
	LoaderCircle,
	MapPin,
	ReceiptText,
	ShieldCheck,
	Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shell/page-header";
import { DataTable } from "@/components/shell/data-table";
import { EmptyState } from "@/components/shell/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, isApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

type Collection = {
	id: string;
	receiptNo: string;
	amount: number;
	paymentMode: "cash" | "cheque" | "bank_transfer" | "upi";
	refNo: string | null;
	customerId: string;
	customerName: string;
	customerCode: string | null;
	agentId: string;
	agentName: string | null;
	agentCode: string | null;
	collectionLat: number;
	collectionLng: number;
	gpsAccuracyM: number | null;
	collectedAt: string;
	supervisorReview: boolean;
};

type CollectionsResponse = { collections: Collection[] };

const PAYMENT_LABELS: Record<Collection["paymentMode"], string> = {
	cash: "Cash",
	cheque: "Cheque",
	bank_transfer: "Bank",
	upi: "UPI",
};

function formatINR(n: number): string {
	const parts = n.toFixed(2).split(".");
	return `₹${Number(parts[0]).toLocaleString("en-IN")}.${parts[1]}`;
}

function formatTimestamp(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleString("en-IN", {
		day: "2-digit",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export default function CollectionsPage() {
	const user = useAuthStore((s) => s.user);
	const canReverse = user?.role === "manager" || user?.role === "super_admin";
	const [reverseTarget, setReverseTarget] = React.useState<Collection | null>(
		null,
	);

	const [search, setSearch] = React.useState("");
	const [modeFilter, setModeFilter] = React.useState<string>("all");
	const [reviewFilter, setReviewFilter] = React.useState<string>("all");

	const { data, isLoading } = useQuery<CollectionsResponse>({
		queryKey: ["collections"],
		queryFn: () => api<CollectionsResponse>("/api/collections?limit=200"),
	});

	const columns = React.useMemo<ColumnDef<Collection>[]>(
		() => [
			{
				header: "Receipt",
				accessorKey: "receiptNo",
				cell: ({ row }) => (
					<span className="font-mono text-xs">{row.original.receiptNo}</span>
				),
			},
			{
				header: "Customer",
				accessorKey: "customerName",
				cell: ({ row }) => (
					<div className="flex flex-col">
						<span className="font-medium">{row.original.customerName}</span>
						{row.original.customerCode && (
							<span className="text-[11px] text-muted-foreground">
								{row.original.customerCode}
							</span>
						)}
					</div>
				),
			},
			{
				header: "Amount",
				accessorKey: "amount",
				cell: ({ row }) => (
					<span className="font-mono tabular-nums">
						{formatINR(row.original.amount)}
					</span>
				),
			},
			{
				header: "Mode",
				accessorKey: "paymentMode",
				cell: ({ row }) => (
					<Badge variant="secondary">
						{PAYMENT_LABELS[row.original.paymentMode]}
					</Badge>
				),
			},
			{
				header: "Agent",
				accessorKey: "agentName",
				cell: ({ row }) => (
					<div className="flex flex-col">
						<span>{row.original.agentName ?? "—"}</span>
						{row.original.agentCode && (
							<span className="text-[11px] text-muted-foreground">
								{row.original.agentCode}
							</span>
						)}
					</div>
				),
			},
			{
				header: "When",
				accessorKey: "collectedAt",
				cell: ({ row }) => (
					<span className="text-sm text-muted-foreground">
						{formatTimestamp(row.original.collectedAt)}
					</span>
				),
			},
			{
				header: "GPS",
				accessorKey: "gpsAccuracyM",
				cell: ({ row }) => {
					const acc = row.original.gpsAccuracyM;
					const verified = acc != null && acc <= 50;
					return (
						<div className="flex items-center gap-1 text-xs">
							{verified ? (
								<ShieldCheck className="size-3 text-emerald-500" />
							) : (
								<MapPin className="size-3 text-muted-foreground" />
							)}
							<span
								className={
									verified
										? "text-emerald-600 dark:text-emerald-400"
										: "text-muted-foreground"
								}
							>
								{acc != null ? `±${acc.toFixed(0)}m` : "—"}
							</span>
						</div>
					);
				},
			},
			{
				header: "Status",
				accessorKey: "supervisorReview",
				cell: ({ row }) =>
					row.original.supervisorReview ? (
						<Badge
							variant="outline"
							className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
						>
							<AlertTriangle className="mr-1 size-3" />
							Review
						</Badge>
					) : (
						<span className="text-xs text-muted-foreground">—</span>
					),
			},
			{
				id: "actions",
				header: () => <span className="sr-only">Actions</span>,
				cell: ({ row }) => (
					<div className="flex items-center justify-end gap-1">
						<Button
							size="sm"
							variant="ghost"
							onClick={(e) => {
								e.stopPropagation();
								window.open(
									`/api/collections/${row.original.id}/receipt`,
									"_blank",
									"noopener,noreferrer",
								);
							}}
						>
							<Download className="size-4" />
							<span className="sr-only">Download receipt</span>
						</Button>
						{canReverse && (
							<Button
								size="sm"
								variant="ghost"
								onClick={(e) => {
									e.stopPropagation();
									setReverseTarget(row.original);
								}}
							>
								<Undo2 className="size-4" />
								<span className="sr-only">Reverse</span>
							</Button>
						)}
					</div>
				),
			},
		],
		[canReverse],
	);

	const allRows = React.useMemo(() => data?.collections ?? [], [data]);

	const filteredRows = React.useMemo(() => {
		const q = search.trim().toLowerCase();
		return allRows.filter((c) => {
			if (modeFilter !== "all" && c.paymentMode !== modeFilter) return false;
			if (reviewFilter === "review" && !c.supervisorReview) return false;
			if (reviewFilter === "clean" && c.supervisorReview) return false;
			if (q.length === 0) return true;
			return (
				c.receiptNo.toLowerCase().includes(q) ||
				c.customerName.toLowerCase().includes(q) ||
				(c.customerCode ?? "").toLowerCase().includes(q) ||
				(c.agentName ?? "").toLowerCase().includes(q) ||
				(c.agentCode ?? "").toLowerCase().includes(q)
			);
		});
	}, [allRows, search, modeFilter, reviewFilter]);

	const exportCsv = () => {
		if (filteredRows.length === 0) {
			toast.info("Nothing to export.");
			return;
		}
		const headers = [
			"receiptNo",
			"collectedAt",
			"customerName",
			"customerCode",
			"amount",
			"paymentMode",
			"refNo",
			"agentName",
			"agentCode",
			"lat",
			"lng",
			"gpsAccuracyM",
			"supervisorReview",
		];
		const rows = filteredRows.map((c) =>
			[
				c.receiptNo,
				c.collectedAt,
				c.customerName,
				c.customerCode ?? "",
				c.amount.toFixed(2),
				c.paymentMode,
				c.refNo ?? "",
				c.agentName ?? "",
				c.agentCode ?? "",
				c.collectionLat,
				c.collectionLng,
				c.gpsAccuracyM ?? "",
				c.supervisorReview ? "yes" : "no",
			]
				.map((v) => `"${String(v).replace(/"/g, '""')}"`)
				.join(","),
		);
		const csv = [headers.join(","), ...rows].join("\n");
		const blob = new Blob([csv], { type: "text/csv" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `collections-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	};

	return (
		<div className="space-y-6">
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<ReceiptText className="size-7 text-primary" />
						Collections
					</span>
				}
				description="Read-only ledger of every verified collection. Reverse a row to issue a corrected receipt."
				actions={
					<Button variant="outline" onClick={exportCsv} disabled={filteredRows.length === 0}>
						<FileDown className="mr-2 size-4" />
						Export CSV
					</Button>
				}
			/>

			<div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
				<div className="space-y-1">
					<Label htmlFor="search">Search</Label>
					<Input
						id="search"
						placeholder="Receipt #, customer, agent, code…"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>
				<div className="space-y-1">
					<Label htmlFor="mode">Payment mode</Label>
					<Select value={modeFilter} onValueChange={setModeFilter}>
						<SelectTrigger id="mode">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All modes</SelectItem>
							<SelectItem value="cash">Cash</SelectItem>
							<SelectItem value="cheque">Cheque</SelectItem>
							<SelectItem value="bank_transfer">Bank transfer</SelectItem>
							<SelectItem value="upi">UPI</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-1">
					<Label htmlFor="review">Status</Label>
					<Select value={reviewFilter} onValueChange={setReviewFilter}>
						<SelectTrigger id="review">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All</SelectItem>
							<SelectItem value="review">Flagged for review</SelectItem>
							<SelectItem value="clean">Clean only</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			<div className="text-xs text-muted-foreground">
				Showing <span className="font-mono">{filteredRows.length}</span> of{" "}
				<span className="font-mono">{allRows.length}</span> collections
			</div>

			<DataTable
				columns={columns}
				data={filteredRows}
				loading={isLoading}
				getRowId={(r) => r.id}
				emptyState={
					<EmptyState
						icon={ReceiptText}
						title="No collections match"
						description="Try widening the date range or clearing the filters."
					/>
				}
			/>

			<Dialog
				open={!!reverseTarget}
				onOpenChange={(o) => {
					if (!o) setReverseTarget(null);
				}}
			>
				{reverseTarget && (
					<ReverseDialog
						target={reverseTarget}
						onClose={() => setReverseTarget(null)}
					/>
				)}
			</Dialog>
		</div>
	);
}

function ReverseDialog({
	target,
	onClose,
}: {
	target: Collection;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const [reason, setReason] = React.useState("");

	const mutation = useMutation({
		mutationFn: async () =>
			api(`/api/collections/${target.id}/reversal`, {
				method: "POST",
				body: JSON.stringify({ reason: reason.trim() }),
			}),
		onSuccess: () => {
			toast.success(`Receipt ${target.receiptNo} reversed`);
			qc.invalidateQueries({ queryKey: ["collections"] });
			onClose();
		},
		onError: (err) => {
			toast.error(isApiError(err) ? err.message : "Failed to reverse");
		},
	});

	const canSubmit = reason.trim().length >= 3 && !mutation.isPending;

	return (
		<DialogContent className="sm:max-w-[480px]">
			<DialogHeader>
				<DialogTitle>Reverse receipt {target.receiptNo}</DialogTitle>
				<DialogDescription>
					This is the only way to undo a verified collection. The original row
					stays intact and a counter-entry is appended to the audit chain.
				</DialogDescription>
			</DialogHeader>
			<form
				className="space-y-4"
				onSubmit={(e) => {
					e.preventDefault();
					if (!canSubmit) return;
					mutation.mutate();
				}}
			>
				<div className="rounded-lg border bg-muted/30 p-3 text-sm">
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground">Customer</span>
						<span className="font-medium">{target.customerName}</span>
					</div>
					<div className="mt-1 flex items-center justify-between">
						<span className="text-muted-foreground">Amount</span>
						<span className="font-mono">{formatINR(target.amount)}</span>
					</div>
					<div className="mt-1 flex items-center justify-between">
						<span className="text-muted-foreground">Mode</span>
						<span>{PAYMENT_LABELS[target.paymentMode]}</span>
					</div>
				</div>
				<div className="space-y-2">
					<Label htmlFor="reason">Reason</Label>
					<Textarea
						id="reason"
						value={reason}
						onChange={(e) => setReason(e.target.value)}
						placeholder="e.g. Cheque bounced; customer to re-issue."
						rows={3}
						required
						minLength={3}
					/>
					<p className="text-xs text-muted-foreground">
						Minimum 3 characters. Visible to auditors and the agent.
					</p>
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="ghost"
						onClick={onClose}
						disabled={mutation.isPending}
					>
						Cancel
					</Button>
					<Button
						type="submit"
						variant="destructive"
						disabled={!canSubmit}
					>
						{mutation.isPending && (
							<LoaderCircle className="size-4 animate-spin" />
						)}
						Reverse
					</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	);
}
