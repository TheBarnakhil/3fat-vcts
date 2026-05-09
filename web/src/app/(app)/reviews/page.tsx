"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertOctagon, CheckCircle2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs";
import { api, isApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

type Review = {
	id: string;
	reason: string;
	payload: Record<string, unknown> | null;
	createdAt: string;
	resolvedAt: string | null;
	resolvedBy: string | null;
	collectionId: string;
	receiptNo: string | null;
	amount: number | null;
	customerId: string | null;
	customerName: string | null;
	customerCode: string | null;
	agentId: string | null;
	collectedAt: string | null;
	agent: {
		id: string;
		name: string | null;
		agentCode: string | null;
	} | null;
};

type ReviewsResponse = { reviews: Review[] };

const REASON_LABELS: Record<string, { label: string; tone: "warn" | "info" }> = {
	balance_drift: { label: "Balance drift", tone: "warn" },
	stale_replay: { label: "Stale replay", tone: "info" },
	unverified_visit: { label: "Unverified visit", tone: "warn" },
};

function formatINR(n: number | null): string {
	if (n == null) return "—";
	const parts = n.toFixed(2).split(".");
	return `₹${Number(parts[0]).toLocaleString("en-IN")}.${parts[1]}`;
}

function formatTime(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleString("en-IN", {
		day: "2-digit",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export default function ReviewsPage() {
	const me = useAuthStore((s) => s.user);
	const canResolve = me?.role === "manager" || me?.role === "super_admin";
	const [tab, setTab] = React.useState<"pending" | "resolved">("pending");

	const { data, isLoading } = useQuery<ReviewsResponse>({
		queryKey: ["reviews", tab],
		queryFn: () => api<ReviewsResponse>(`/api/reviews?status=${tab}`),
	});

	return (
		<div className="space-y-6">
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<AlertOctagon className="size-7 text-primary" />
						Supervisor reviews
					</span>
				}
				description="Collections flagged by the offline sync engine or the visit-validation cron. Resolve each one to clear its banner from the agent's dashboard."
			/>

			<Tabs value={tab} onValueChange={(v) => setTab(v as "pending" | "resolved")}>
				<TabsList>
					<TabsTrigger value="pending">Pending</TabsTrigger>
					<TabsTrigger value="resolved">Resolved</TabsTrigger>
				</TabsList>
				<TabsContent value={tab} className="mt-4">
					{isLoading ? (
						<div className="grid gap-3">
							{Array.from({ length: 3 }).map((_, i) => (
								<Card key={i} className="animate-pulse">
									<CardContent className="h-24" />
								</Card>
							))}
						</div>
					) : (data?.reviews.length ?? 0) === 0 ? (
						<EmptyState
							icon={AlertOctagon}
							title={
								tab === "pending" ? "Inbox zero" : "No resolved reviews yet"
							}
							description={
								tab === "pending"
									? "Nothing to review right now. Sync issues and unverified visits will land here automatically."
									: "When you resolve a review, it'll show up here for the audit trail."
							}
						/>
					) : (
						<ul className="grid gap-3">
							{(data?.reviews ?? []).map((r) => (
								<ReviewCard
									key={r.id}
									review={r}
									canResolve={canResolve}
								/>
							))}
						</ul>
					)}
				</TabsContent>
			</Tabs>
		</div>
	);
}

function ReviewCard({
	review,
	canResolve,
}: {
	review: Review;
	canResolve: boolean;
}) {
	const qc = useQueryClient();
	const tone = REASON_LABELS[review.reason]?.tone ?? "info";

	const mutation = useMutation({
		mutationFn: async (action: "resolve" | "reopen") =>
			api(`/api/reviews/${review.id}`, {
				method: "PATCH",
				body: JSON.stringify({ action }),
			}),
		onSuccess: () => {
			toast.success(
				review.resolvedAt ? "Review reopened" : "Review resolved",
			);
			qc.invalidateQueries({ queryKey: ["reviews"] });
		},
		onError: (err) => {
			toast.error(isApiError(err) ? err.message : "Failed to update review");
		},
	});

	const reasonLabel = REASON_LABELS[review.reason]?.label ?? review.reason;

	return (
		<Card>
			<CardContent className="space-y-3 p-4">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="space-y-1">
						<div className="flex flex-wrap items-center gap-2">
							<Badge
								variant={tone === "warn" ? "destructive" : "secondary"}
								className="font-mono"
							>
								{reasonLabel}
							</Badge>
							{review.receiptNo && (
								<span className="font-mono text-xs text-muted-foreground">
									{review.receiptNo}
								</span>
							)}
							<span className="text-xs text-muted-foreground">
								raised {formatTime(review.createdAt)}
							</span>
						</div>
						<div className="text-sm">
							<span className="font-medium">
								{review.customerName ?? "Unknown customer"}
							</span>
							{review.customerCode && (
								<span className="ml-1 text-muted-foreground">
									({review.customerCode})
								</span>
							)}
							<span className="text-muted-foreground"> · </span>
							<span>{formatINR(review.amount)}</span>
							{review.agent?.name && (
								<>
									<span className="text-muted-foreground"> · agent </span>
									<span>{review.agent.name}</span>
								</>
							)}
						</div>
					</div>
					<div className="flex items-center gap-2">
						{review.resolvedAt ? (
							<span className="text-xs text-muted-foreground">
								Resolved {formatTime(review.resolvedAt)}
							</span>
						) : null}
						{canResolve &&
							(review.resolvedAt ? (
								<Button
									size="sm"
									variant="ghost"
									onClick={() => mutation.mutate("reopen")}
									disabled={mutation.isPending}
								>
									<RotateCcw className="mr-1 size-4" />
									Reopen
								</Button>
							) : (
								<Button
									size="sm"
									onClick={() => mutation.mutate("resolve")}
									disabled={mutation.isPending}
								>
									<CheckCircle2 className="mr-1 size-4" />
									Resolve
								</Button>
							))}
					</div>
				</div>
				{review.payload && Object.keys(review.payload).length > 0 && (
					<pre className="overflow-x-auto rounded-md bg-muted/40 p-2 font-mono text-xs text-muted-foreground">
						{JSON.stringify(review.payload, null, 2)}
					</pre>
				)}
			</CardContent>
		</Card>
	);
}
