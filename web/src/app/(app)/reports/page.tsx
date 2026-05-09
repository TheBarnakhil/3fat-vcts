"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Legend,
	Line,
	LineChart,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { BarChart3, Download } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

type DayBucket = { day: string; count: number; amount: number };
type AgentBucket = {
	agentId: string;
	agentName: string;
	agentCode: string | null;
	count: number;
	amount: number;
};
type ModeBucket = { mode: string; count: number; amount: number };

type Summary = {
	window: { from: string; to: string };
	totals: { count: number; amount: number; supervisorReview: number };
	byDay: DayBucket[];
	byAgent: AgentBucket[];
	byMode: ModeBucket[];
};

const PIE_COLORS = [
	"hsl(var(--primary))",
	"hsl(var(--secondary))",
	"hsl(var(--muted-foreground))",
	"hsl(var(--destructive))",
	"hsl(var(--accent))",
];

const MODE_LABELS: Record<string, string> = {
	cash: "Cash",
	cheque: "Cheque",
	bank_transfer: "Bank",
	upi: "UPI",
};

function formatINR(n: number): string {
	const parts = n.toFixed(2).split(".");
	return `₹${Number(parts[0]).toLocaleString("en-IN")}.${parts[1]}`;
}

function isoDaysAgo(days: number): string {
	const d = new Date();
	d.setUTCHours(0, 0, 0, 0);
	d.setUTCDate(d.getUTCDate() - days);
	return d.toISOString().slice(0, 10);
}

function todayUtcIso(): string {
	return new Date().toISOString().slice(0, 10);
}

export default function ReportsPage() {
	const [from, setFrom] = React.useState(isoDaysAgo(13));
	const [to, setTo] = React.useState(todayUtcIso());

	const { data, isLoading, error } = useQuery<Summary>({
		queryKey: ["reports", from, to],
		queryFn: () =>
			api<Summary>(
				`/api/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
			),
	});

	const exportCsv = () => {
		if (!data) return;
		const rows = data.byDay.map((d) =>
			[d.day, d.count, d.amount.toFixed(2)].join(","),
		);
		const csv = ["day,count,amount", ...rows].join("\n");
		const blob = new Blob([csv], { type: "text/csv" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `collections-${from}_to_${to}.csv`;
		a.click();
		URL.revokeObjectURL(url);
		toast.success("Daily collections exported.");
	};

	return (
		<div className="space-y-6">
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<BarChart3 className="size-7 text-primary" />
						Reports
					</span>
				}
				description="Quick-glance dashboards over your collections. All ranges are inclusive in UTC."
			/>

			<Card>
				<CardContent className="grid gap-3 p-4 sm:grid-cols-3 sm:items-end">
					<div className="space-y-1">
						<Label htmlFor="from">From</Label>
						<Input
							id="from"
							type="date"
							value={from}
							max={to}
							onChange={(e) => setFrom(e.target.value)}
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="to">To</Label>
						<Input
							id="to"
							type="date"
							value={to}
							max={todayUtcIso()}
							min={from}
							onChange={(e) => setTo(e.target.value)}
						/>
					</div>
					<div className="flex justify-end">
						<Button variant="outline" onClick={exportCsv} disabled={!data}>
							<Download className="mr-2 size-4" />
							Export daily CSV
						</Button>
					</div>
				</CardContent>
			</Card>

			{error ? (
				<Card className="border-destructive/40 bg-destructive/5">
					<CardContent className="p-6 text-sm">
						Couldn&apos;t load reports. Try a smaller date range.
					</CardContent>
				</Card>
			) : null}

			<div className="grid gap-4 md:grid-cols-3">
				<KpiCard
					title="Collections"
					value={data ? data.totals.count.toLocaleString("en-IN") : "—"}
					loading={isLoading}
				/>
				<KpiCard
					title="Total recovered"
					value={data ? formatINR(data.totals.amount) : "—"}
					loading={isLoading}
				/>
				<KpiCard
					title="Flagged for review"
					value={data ? `${data.totals.supervisorReview}` : "—"}
					loading={isLoading}
					tone={data && data.totals.supervisorReview > 0 ? "warn" : "ok"}
				/>
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Daily collections</CardTitle>
					</CardHeader>
					<CardContent className="h-72">
						{isLoading ? (
							<Skeleton className="h-full w-full" />
						) : (
							<ResponsiveContainer width="100%" height="100%">
								<LineChart data={data?.byDay ?? []}>
									<CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
									<XAxis
										dataKey="day"
										fontSize={11}
										stroke="hsl(var(--muted-foreground))"
									/>
									<YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
									<Tooltip
										contentStyle={{
											background: "hsl(var(--background))",
											border: "1px solid hsl(var(--border))",
											fontSize: 12,
										}}
										formatter={((value: unknown, name: unknown) => {
											const v = typeof value === "number" ? value : Number(value ?? 0);
											return name === "amount"
												? [formatINR(v), "Amount"]
												: [String(v), "Count"];
										}) as never}
									/>
									<Legend wrapperStyle={{ fontSize: 12 }} />
									<Line
										type="monotone"
										dataKey="amount"
										stroke="hsl(var(--primary))"
										strokeWidth={2}
										dot={false}
									/>
									<Line
										type="monotone"
										dataKey="count"
										stroke="hsl(var(--muted-foreground))"
										strokeWidth={1.5}
										dot={false}
										yAxisId={0}
									/>
								</LineChart>
							</ResponsiveContainer>
						)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>By payment mode</CardTitle>
					</CardHeader>
					<CardContent className="h-72">
						{isLoading ? (
							<Skeleton className="h-full w-full" />
						) : (
							<ResponsiveContainer width="100%" height="100%">
								<PieChart>
									<Pie
										data={data?.byMode ?? []}
										dataKey="amount"
										nameKey="mode"
										cx="50%"
										cy="50%"
										outerRadius={90}
										labelLine={false}
										label={((d: { mode?: string }) =>
											MODE_LABELS[d.mode ?? ""] ?? d.mode ?? "") as never}
									>
										{(data?.byMode ?? []).map((_, i) => (
											<Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
										))}
									</Pie>
									<Tooltip
										contentStyle={{
											background: "hsl(var(--background))",
											border: "1px solid hsl(var(--border))",
											fontSize: 12,
										}}
										formatter={((value: unknown, name: unknown) => {
											const v =
												typeof value === "number" ? value : Number(value ?? 0);
											const key = String(name ?? "");
											return [formatINR(v), MODE_LABELS[key] ?? key];
										}) as never}
									/>
								</PieChart>
							</ResponsiveContainer>
						)}
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Top performers (by amount)</CardTitle>
				</CardHeader>
				<CardContent className="h-80">
					{isLoading ? (
						<Skeleton className="h-full w-full" />
					) : (data?.byAgent.length ?? 0) === 0 ? (
						<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
							No collections in this window.
						</div>
					) : (
						<ResponsiveContainer width="100%" height="100%">
							<BarChart
								data={(data?.byAgent ?? []).slice(0, 10)}
								layout="vertical"
								margin={{ left: 24 }}
							>
								<CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
								<XAxis
									type="number"
									fontSize={11}
									stroke="hsl(var(--muted-foreground))"
								/>
								<YAxis
									type="category"
									dataKey="agentName"
									width={140}
									fontSize={11}
									stroke="hsl(var(--muted-foreground))"
								/>
								<Tooltip
									contentStyle={{
										background: "hsl(var(--background))",
										border: "1px solid hsl(var(--border))",
										fontSize: 12,
									}}
									formatter={((value: unknown, name: unknown) => {
										const v = typeof value === "number" ? value : Number(value ?? 0);
										return name === "amount"
											? [formatINR(v), "Amount"]
											: [String(v), "Count"];
									}) as never}
								/>
								<Bar dataKey="amount" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
							</BarChart>
						</ResponsiveContainer>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function KpiCard({
	title,
	value,
	loading,
	tone,
}: {
	title: string;
	value: string;
	loading: boolean;
	tone?: "ok" | "warn";
}) {
	return (
		<Card
			className={
				tone === "warn"
					? "border-amber-500/40 bg-amber-500/5"
					: undefined
			}
		>
			<CardHeader className="pb-2">
				<CardTitle className="text-sm font-medium text-muted-foreground">
					{title}
				</CardTitle>
			</CardHeader>
			<CardContent>
				{loading ? (
					<Skeleton className="h-8 w-32" />
				) : (
					<div className="text-2xl font-semibold tabular-nums">{value}</div>
				)}
			</CardContent>
		</Card>
	);
}
