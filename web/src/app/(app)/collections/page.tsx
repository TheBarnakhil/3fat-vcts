"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
	Download,
	LoaderCircle,
	MapPin,
	ReceiptText,
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
import { Label } from "@/components/ui/label";
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
				cell: ({ row }) => (
					<div className="flex items-center gap-1 text-xs text-muted-foreground">
						<MapPin className="size-3" />
						{row.original.gpsAccuracyM != null
							? `±${row.original.gpsAccuracyM.toFixed(0)}m`
							: "—"}
					</div>
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

	const rows = data?.collections ?? [];

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
			/>

			<DataTable
				columns={columns}
				data={rows}
				loading={isLoading}
				getRowId={(r) => r.id}
				emptyState={
					<EmptyState
						icon={ReceiptText}
						title="No collections yet"
						description="Once your agents start logging in the field they'll appear here in real time."
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
