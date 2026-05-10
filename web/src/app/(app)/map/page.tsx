"use client";

import * as React from "react";
import { MapPin, Radio, RefreshCw, Wifi, WifiOff } from "lucide-react";

import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";
import { LiveMap, type LiveAgentFix } from "@/components/maps/live-map";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";

type StreamStatus = "connecting" | "connected" | "stale" | "error";

/**
 * Phase 10 / Track C2 - live operations map.
 *
 * Subscribes to `/api/stream/agent-locations` (SSE), renders a Google
 * Map with one pin per active agent, and offers a sidebar that lists
 * each agent with their last-seen timestamp + battery + accuracy.
 *
 * Connection lifecycle:
 *   - Browser opens an EventSource to the stream endpoint. The
 *     httpOnly `vcts_access` cookie ships automatically, so no extra
 *     plumbing is required.
 *   - Server flushes a fresh snapshot every ~5s for ~50s, then closes.
 *   - EventSource auto-reconnects (server emits `retry: 5000`).
 *   - We mark the channel "stale" if no event arrives within 30s,
 *     "error" on `onerror` (network drop), and "connected" otherwise.
 */
export default function LiveMapPage() {
	const me = useAuthStore((s) => s.user);
	const [fixes, setFixes] = React.useState<LiveAgentFix[]>([]);
	const [status, setStatus] = React.useState<StreamStatus>("connecting");
	const [lastEventAt, setLastEventAt] = React.useState<number | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [reconnectKey, setReconnectKey] = React.useState(0);
	// React 19's purity rules forbid `Date.now()` inside render. We keep
	// a ticking state instead so timestamps stay accurate without
	// breaking the strict purity contract.
	const [now, setNow] = React.useState<number>(() => Date.now());

	const isAgent = me?.role === "agent";

	React.useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 5_000);
		return () => clearInterval(id);
	}, []);

	React.useEffect(() => {
		if (isAgent) return;
		if (typeof window === "undefined") return;
		// EventSource has been widely supported since ~2010; we don't
		// guard on its availability anymore. If a user lands on a UA
		// that lacks it, the server's stream simply never connects and
		// the status pill stays "Connecting".

		const source = new EventSource("/api/stream/agent-locations");

		source.addEventListener("snapshot", (ev) => {
			try {
				const payload = JSON.parse(
					(ev as MessageEvent).data,
				) as { fixes: LiveAgentFix[]; ts: number };
				setFixes(payload.fixes ?? []);
				setLastEventAt(Date.now());
				setStatus("connected");
			} catch {
				// ignore malformed events
			}
		});
		source.addEventListener("heartbeat", () => {
			setLastEventAt(Date.now());
			setStatus("connected");
		});
		source.addEventListener("error", (ev) => {
			try {
				const payload = JSON.parse(
					(ev as MessageEvent).data,
				) as { message?: string };
				setError(payload.message ?? "Stream error");
			} catch {
				// no JSON body - browser will auto-retry
			}
		});
		source.onerror = () => {
			setStatus("error");
			// EventSource auto-reconnects. We surface the state so the
			// user can see "connection lost" and trust the UI again
			// once the next snapshot lands.
		};

		return () => source.close();
	}, [reconnectKey, isAgent]);

	// Stale detector - if we go > 30s without any event the connection
	// is alive but the upstream isn't producing. Most likely a Vercel
	// function tear-down between cycles; we'll auto-recover when the
	// EventSource reconnects.
	React.useEffect(() => {
		if (status !== "connected") return;
		const id = setInterval(() => {
			if (lastEventAt && Date.now() - lastEventAt > 30_000) {
				setStatus("stale");
			}
		}, 5_000);
		return () => clearInterval(id);
	}, [status, lastEventAt]);

	if (isAgent) {
		return (
			<div className="space-y-6">
				<PageHeader
					title={
						<span className="flex items-center gap-2">
							<MapPin className="size-7 text-primary" />
							Live map
						</span>
					}
					description="This view is for managers and auditors. Your own location and assigned customers appear under Movement and Customers."
				/>
				<EmptyState
					icon={MapPin}
					title="Manager-only"
					description="Sign in with a manager or super-admin account to see live agent locations."
				/>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<MapPin className="size-7 text-primary" />
						Live map
					</span>
				}
				description="One pin per agent on duty in the last 30 minutes. The stream refreshes every few seconds; older fixes fade through amber to grey so a stale agent stands out."
				actions={
					<div className="flex items-center gap-2">
						<StatusPill status={status} />
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setReconnectKey((k) => k + 1)}
							title="Reconnect the live stream"
						>
							<RefreshCw className="mr-2 size-3.5" />
							Reconnect
						</Button>
					</div>
				}
			/>

			<div className="grid gap-4 lg:grid-cols-[1fr_320px]">
				<LiveMap fixes={fixes} />
				<RosterSidebar
					fixes={fixes}
					status={status}
					lastEventAt={lastEventAt}
					error={error}
					now={now}
				/>
			</div>
		</div>
	);
}

function StatusPill({ status }: { status: StreamStatus }) {
	const map: Record<StreamStatus, { label: string; tone: string; Icon: React.ComponentType<{ className?: string }> }> = {
		connecting: {
			label: "Connecting",
			tone: "bg-muted text-muted-foreground",
			Icon: Radio,
		},
		connected: {
			label: "Live",
			tone: "bg-primary/10 text-primary",
			Icon: Wifi,
		},
		stale: {
			label: "Reconnecting",
			tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
			Icon: Radio,
		},
		error: {
			label: "Offline",
			tone: "bg-destructive/10 text-destructive",
			Icon: WifiOff,
		},
	};
	const { label, tone, Icon } = map[status];
	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}
		>
			<Icon className="size-3.5" />
			{label}
		</span>
	);
}

function RosterSidebar({
	fixes,
	status,
	lastEventAt,
	error,
	now,
}: {
	fixes: LiveAgentFix[];
	status: StreamStatus;
	lastEventAt: number | null;
	error: string | null;
	now: number;
}) {
	return (
		<div className="space-y-3">
			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-sm font-medium text-muted-foreground">
						On duty now
					</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-2 text-sm">
					<RosterRow
						label="Active agents"
						value={String(fixes.length)}
						hint={`Last update: ${lastEventAt ? `${Math.round((now - lastEventAt) / 1000)}s ago` : "—"}`}
					/>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-sm font-medium text-muted-foreground">
						Roster
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2 p-3">
					{status === "error" && error ? (
						<p className="px-2 text-xs text-destructive">{error}</p>
					) : null}
					{fixes.length === 0 ? (
						<p className="px-2 text-xs text-muted-foreground">
							No agents have logged a location fix in the last 30 minutes.
						</p>
					) : (
						<ol className="space-y-2">
							{fixes.map((f) => {
								const stale = Math.max(
									0,
									Math.round((now - new Date(f.loggedAt).getTime()) / 1000),
								);
								return (
									<li
										key={f.agentId}
										className="rounded-lg border bg-muted/20 p-2 text-xs"
									>
										<div className="flex items-baseline justify-between gap-2">
											<span className="font-medium">{f.agentName}</span>
											<StaleBadge seconds={stale} />
										</div>
										<div className="mt-1 flex items-center justify-between text-muted-foreground">
											<span>
												{f.agentCode ? (
													<span className="font-mono">{f.agentCode}</span>
												) : null}
												{f.agentCode ? " · " : ""}
												{f.lat.toFixed(4)}, {f.lng.toFixed(4)}
											</span>
											{f.batteryPct != null ? (
												<span title={`Battery ${f.batteryPct}%`}>
													{f.batteryPct}%
												</span>
											) : null}
										</div>
										{f.accuracyM != null ? (
											<div className="mt-0.5 text-[10px] text-muted-foreground">
												Accuracy ±{Math.round(f.accuracyM)}m
											</div>
										) : null}
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

function RosterRow({
	label,
	value,
	hint,
}: {
	label: string;
	value: string;
	hint?: string;
}) {
	return (
		<div className="flex items-baseline justify-between">
			<span className="text-muted-foreground">{label}</span>
			<span className="text-right">
				<span className="font-medium tabular-nums">{value}</span>
				{hint ? (
					<span className="ml-2 text-[10px] text-muted-foreground">{hint}</span>
				) : null}
			</span>
		</div>
	);
}

function StaleBadge({ seconds }: { seconds: number }) {
	let tone = "bg-primary/10 text-primary";
	if (seconds > 600) tone = "bg-muted text-muted-foreground";
	else if (seconds > 120)
		tone = "bg-amber-500/10 text-amber-600 dark:text-amber-400";
	const label =
		seconds < 60
			? `${seconds}s ago`
			: seconds < 3600
				? `${Math.round(seconds / 60)}m ago`
				: `${Math.floor(seconds / 3600)}h ago`;
	return (
		<span
			className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}
		>
			{label}
		</span>
	);
}
