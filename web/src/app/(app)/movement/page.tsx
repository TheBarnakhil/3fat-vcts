"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Route as RouteIcon, MapPin, Users, Clock } from "lucide-react";

import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MovementMap, type CustomerPin, type Fix } from "@/components/maps/movement-map";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

type Agent = {
	id: string;
	name: string;
	email: string;
	role: "agent" | "manager" | "auditor" | "super_admin";
	agentCode: string | null;
};

type AgentsResponse = { agents: Agent[] };

type CustomerRow = {
	id: string;
	name: string;
	lat: number;
	lng: number;
	geofenceRadiusM: number;
	assignedAgentId: string | null;
};

type CustomersResponse = { customers: CustomerRow[] };

type Visit = {
	id: string;
	customerId: string;
	startedAt: string;
	endedAt: string;
	dwellSeconds: number;
	source: string;
	collectionId: string | null;
};

type MovementResponse = {
	agent: { id: string; name: string; email: string; agentCode: string | null };
	window: { day: string; tz: string; startUtc: string; endUtc: string };
	fixes: Fix[];
	visits: Visit[];
	truncated: boolean;
};

function todayLocalIso(): string {
	const now = new Date();
	const yyyy = now.getFullYear();
	const mm = String(now.getMonth() + 1).padStart(2, "0");
	const dd = String(now.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

function formatRelative(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
	const h = Math.floor(seconds / 3600);
	const m = Math.round((seconds % 3600) / 60);
	return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatTime(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleTimeString("en-IN", {
		hour: "2-digit",
		minute: "2-digit",
	});
}

export default function MovementPage() {
	const me = useAuthStore((s) => s.user);
	const myTz =
		typeof Intl !== "undefined"
			? Intl.DateTimeFormat().resolvedOptions().timeZone
			: "UTC";

	const [day, setDay] = React.useState<string>(todayLocalIso());
	const [agentId, setAgentId] = React.useState<string | null>(null);

	const { data: agentsData, isLoading: agentsLoading } = useQuery<AgentsResponse>({
		queryKey: ["agents"],
		queryFn: () => api<AgentsResponse>("/api/agents"),
	});

	const agents = React.useMemo(
		() => (agentsData?.agents ?? []).filter((a) => a.role === "agent"),
		[agentsData],
	);

	// Pick first agent during render rather than via setState-in-effect.
	const effectiveAgentId =
		agentId ?? (agents.length > 0 ? agents[0].id : null);

	const { data, isLoading, isError, error } = useQuery<MovementResponse>({
		queryKey: ["movement", effectiveAgentId, day, myTz],
		queryFn: () =>
			api<MovementResponse>(
				`/api/agents/${effectiveAgentId}/movement?day=${day}&tz=${encodeURIComponent(myTz)}`,
			),
		enabled: !!effectiveAgentId,
	});

	const { data: customersData } = useQuery<CustomersResponse>({
		queryKey: ["customers"],
		queryFn: () => api<CustomersResponse>("/api/customers"),
	});

	const customerLookup = React.useMemo(() => {
		const m = new Map<string, CustomerRow>();
		for (const c of customersData?.customers ?? []) m.set(c.id, c);
		return m;
	}, [customersData]);

	const visibleCustomers = React.useMemo<CustomerPin[]>(() => {
		if (!effectiveAgentId) return [];
		return (customersData?.customers ?? [])
			.filter((c) => c.assignedAgentId === effectiveAgentId)
			.map((c) => ({
				id: c.id,
				name: c.name,
				lat: c.lat,
				lng: c.lng,
				radiusM: c.geofenceRadiusM,
			}));
	}, [customersData, effectiveAgentId]);

	if (me && me.role === "agent") {
		return (
			<div className="space-y-6">
				<PageHeader
					title={
						<span className="flex items-center gap-2">
							<RouteIcon className="size-7 text-primary" />
							Movement replay
						</span>
					}
					description="This page is for managers and auditors. Your own collections appear under Collections."
				/>
				<EmptyState
					icon={RouteIcon}
					title="Manager-only"
					description="Sign in with a manager or super-admin account to replay an agent's day."
				/>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<RouteIcon className="size-7 text-primary" />
						Movement replay
					</span>
				}
				description="Walk through an agent's day on the map. Pins mark assigned customer locations; the polyline traces every recorded GPS fix."
			/>

			<Card>
				<CardContent className="grid gap-3 p-4 sm:grid-cols-3">
					<div className="space-y-1">
						<Label htmlFor="agent">Agent</Label>
						<Select
							value={effectiveAgentId ?? undefined}
							onValueChange={(v) => setAgentId(v)}
							disabled={agentsLoading || agents.length === 0}
						>
							<SelectTrigger id="agent">
								<SelectValue placeholder="Select agent" />
							</SelectTrigger>
							<SelectContent>
								{agents.map((a) => (
									<SelectItem key={a.id} value={a.id}>
										{a.name}
										{a.agentCode ? ` · ${a.agentCode}` : ""}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-1">
						<Label htmlFor="day">Date</Label>
						<Input
							id="day"
							type="date"
							value={day}
							max={todayLocalIso()}
							onChange={(e) => setDay(e.target.value)}
						/>
					</div>
					<div className="space-y-1 text-xs text-muted-foreground sm:self-end">
						Timezone <span className="font-mono">{myTz}</span>
					</div>
				</CardContent>
			</Card>

			{isLoading ? (
				<Skeleton className="h-[520px] w-full rounded-xl" />
			) : isError ? (
				<EmptyState
					icon={RouteIcon}
					title="Couldn't load movement"
					description={
						(error as { message?: string })?.message ??
						"Pick a different agent or day and try again."
					}
				/>
			) : data ? (
				<div className="grid gap-4 lg:grid-cols-[1fr_320px]">
					<MovementMap fixes={data.fixes} customers={visibleCustomers} />
					<DaySummary
						data={data}
						customerLookup={customerLookup}
					/>
				</div>
			) : null}
		</div>
	);
}

function DaySummary({
	data,
	customerLookup,
}: {
	data: MovementResponse;
	customerLookup: Map<string, CustomerRow>;
}) {
	const totalDwell = data.visits.reduce((acc, v) => acc + v.dwellSeconds, 0);
	const verifiedVisits = data.visits.filter((v) => !!v.collectionId).length;

	return (
		<div className="space-y-3">
			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-sm font-medium text-muted-foreground">
						Day at a glance
					</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-3 text-sm">
					<KpiRow
						icon={MapPin}
						label="Fixes"
						value={`${data.fixes.length}${data.truncated ? "+" : ""}`}
					/>
					<KpiRow icon={Users} label="Visits" value={`${data.visits.length}`} />
					<KpiRow
						icon={Clock}
						label="On-site time"
						value={formatRelative(totalDwell)}
					/>
					<KpiRow
						icon={Users}
						label="With collection"
						value={`${verifiedVisits} / ${data.visits.length}`}
					/>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-sm font-medium text-muted-foreground">
						Visit timeline
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2 p-3">
					{data.visits.length === 0 ? (
						<p className="px-2 text-xs text-muted-foreground">
							No sustained visits derived. Either the agent didn&apos;t enter a
							fence or fixes are missing.
						</p>
					) : (
						<ol className="space-y-2">
							{data.visits.map((v) => {
								const c = customerLookup.get(v.customerId);
								return (
									<li
										key={v.id}
										className="rounded-lg border bg-muted/20 p-2 text-xs"
									>
										<div className="flex items-baseline justify-between gap-2">
											<span className="font-medium">
												{c?.name ?? "Unknown customer"}
											</span>
											<span className="text-muted-foreground">
												{formatTime(v.startedAt)}–{formatTime(v.endedAt)}
											</span>
										</div>
										<div className="mt-1 flex items-center justify-between text-muted-foreground">
											<span>{formatRelative(v.dwellSeconds)} on-site</span>
											{v.collectionId ? (
												<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
													Collected
												</span>
											) : (
												<span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">
													Visit only
												</span>
											)}
										</div>
									</li>
								);
							})}
						</ol>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function KpiRow({
	icon: Icon,
	label,
	value,
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: string;
}) {
	return (
		<div className="flex items-center justify-between">
			<span className="flex items-center gap-2 text-muted-foreground">
				<Icon className="size-4" />
				{label}
			</span>
			<span className="font-medium tabular-nums">{value}</span>
		</div>
	);
}
