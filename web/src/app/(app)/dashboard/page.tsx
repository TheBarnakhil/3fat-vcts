"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertOctagon,
  CircleDollarSign,
  Map,
  ReceiptText,
  TrendingUp,
  UsersRound,
} from "lucide-react";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useReducedMotionSafeGSAP, DURATION, EASE } from "@/lib/motion/gsap";
import { useAuthStore } from "@/stores/auth-store";

type DashboardSummary = {
  window: { today: string; last7From: string; last7To: string };
  kpis: {
    collectedToday: number;
    collectionsToday: number;
    collectedTodayDeltaPct: number;
    activeAgents7d: number;
    receipts7d: number;
    amount7d: number;
    visitsToday: number;
    collectionsWithVisitToday: number;
    visitCoveragePct: number;
    flaggedToday: number;
  };
  trend: Array<{ day: string; count: number; amount: number }>;
  topAgents: Array<{
    agentId: string;
    agentName: string;
    agentCode: string | null;
    count: number;
    amount: number;
  }>;
  recentCollections: Array<{
    id: string;
    receiptNo: string;
    amount: number;
    collectedAt: string;
    paymentMode: "cash" | "cheque" | "bank_transfer" | "upi";
    supervisorReview: boolean;
    customerName: string;
    customerCode: string | null;
  }>;
};

type Kpi = {
  label: string;
  value: number;
  suffix?: string;
  prefix?: string;
  delta?: string;
  hint?: string;
  Icon: React.ComponentType<{ className?: string }>;
};

function formatINR(n: number): string {
  const parts = n.toFixed(2).split(".");
  return `₹${Number(parts[0]).toLocaleString("en-IN")}.${parts[1]}`;
}

function formatShortDate(isoDay: string): string {
  return new Date(`${isoDay}T00:00:00.000Z`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function paymentModeLabel(mode: DashboardSummary["recentCollections"][number]["paymentMode"]) {
  switch (mode) {
    case "cash":
      return "Cash";
    case "cheque":
      return "Cheque";
    case "bank_transfer":
      return "Bank";
    case "upi":
      return "UPI";
  }
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { data, isLoading, error } = useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary"],
    queryFn: () => api<DashboardSummary>("/api/dashboard/summary"),
  });

  const kpis: Kpi[] = React.useMemo(
    () => [
      {
        label: "Collected today",
        value: Math.round(data?.kpis.collectedToday ?? 0),
        prefix: "₹",
        delta: data ? `${data.kpis.collectedTodayDeltaPct >= 0 ? "+" : ""}${data.kpis.collectedTodayDeltaPct}%` : undefined,
        hint: `${data?.kpis.collectionsToday ?? 0} collections today`,
        Icon: CircleDollarSign,
      },
      {
        label: "Active agents",
        value: data?.kpis.activeAgents7d ?? 0,
        hint: "with fixes or collections in 7d",
        Icon: UsersRound,
      },
      {
        label: "Receipts generated",
        value: data?.kpis.receipts7d ?? 0,
        hint: `last 7 days · ${data ? formatINR(data.kpis.amount7d) : "₹0.00"}`,
        Icon: ReceiptText,
      },
      {
        label: "Visit coverage",
        value: data?.kpis.visitCoveragePct ?? 0,
        suffix: "%",
        hint: `${data?.kpis.collectionsWithVisitToday ?? 0}/${data?.kpis.collectionsToday ?? 0} collections linked`,
        Icon: Map,
      },
    ],
    [data],
  );

  const maxTrendAmount = Math.max(1, ...(data?.trend ?? []).map((d) => d.amount));
  const valuesKey = kpis.map((k) => `${k.label}:${k.value}`).join("|");

  return (
    <div ref={containerRef}>
      <PageHeader
        title={`Welcome back${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`}
        description="Live operations overview from the collection ledger, tracker visits, and supervisor flags."
      />

      {error ? (
        <Card className="mb-4 border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm">
            Dashboard data could not be loaded. Refresh or try again after the current sync completes.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <KpiCard key={k.label} kpi={k} loading={isLoading} />
        ))}
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 kpi-panel">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">Collections trend · 7 days</h3>
                <p className="text-xs text-muted-foreground">
                  Daily recovered amount, inclusive in UTC
                </p>
              </div>
              <TrendingUp className="size-4 text-muted-foreground" />
            </div>
            {isLoading ? (
              <Skeleton className="mt-8 h-48 w-full" />
            ) : (
              <div className="mt-8 flex h-48 items-end gap-2">
                {(data?.trend ?? []).map((d) => {
                  const heightPct = d.amount === 0 ? 4 : Math.max(8, (d.amount / maxTrendAmount) * 100);
                  return (
                    <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                      <div
                        className="w-full rounded-t-md bg-primary/80 kpi-bar"
                        style={{ height: `${heightPct}%`, opacity: 0 }}
                        title={`${formatShortDate(d.day)} · ${formatINR(d.amount)} · ${d.count} collections`}
                      />
                      <span className="truncate text-[10px] text-muted-foreground">
                        {formatShortDate(d.day)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="kpi-panel">
          <CardContent className="p-6">
            <h3 className="text-sm font-medium">Top agents · 7 days</h3>
            <p className="text-xs text-muted-foreground">
              Ranked by recovered amount
            </p>
            {isLoading ? (
              <div className="mt-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (data?.topAgents.length ?? 0) === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No collections in the last 7 days.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {(data?.topAgents ?? []).map((agent) => (
                  <li key={agent.agentId} className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-primary-foreground"
                        style={{ background: "hsl(var(--primary))" }}
                      >
                        {(agent.agentCode ?? agent.agentName).slice(-2)}
                      </span>
                      <span className="min-w-0 truncate text-sm">
                        {agent.agentName}
                        {agent.agentCode ? ` · ${agent.agentCode}` : ""}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatINR(agent.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="kpi-panel lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Recent collections</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (data?.recentCollections.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No collections recorded yet.</p>
            ) : (
              <ul className="divide-y">
                {(data?.recentCollections ?? []).map((collection) => (
                  <li key={collection.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {collection.customerName}
                          {collection.customerCode ? ` · ${collection.customerCode}` : ""}
                        </p>
                        {collection.supervisorReview ? (
                          <Badge variant="destructive" className="shrink-0">
                            Review
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {collection.receiptNo} · {paymentModeLabel(collection.paymentMode)} · {formatTime(collection.collectedAt)}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-sm font-medium">
                      {formatINR(collection.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="kpi-panel">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <AlertOctagon className="size-4 text-muted-foreground" />
              Today&apos;s quality
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <QualityRow
              label="Visits recorded"
              value={data?.kpis.visitsToday ?? 0}
              loading={isLoading}
            />
            <QualityRow
              label="Collections linked to visits"
              value={data?.kpis.collectionsWithVisitToday ?? 0}
              loading={isLoading}
            />
            <QualityRow
              label="Flagged collections"
              value={data?.kpis.flaggedToday ?? 0}
              loading={isLoading}
              warn={(data?.kpis.flaggedToday ?? 0) > 0}
            />
          </CardContent>
        </Card>
      </div>

      <KpiAnimation containerRef={containerRef} valuesKey={valuesKey} />
    </div>
  );
}

function KpiCard({ kpi, loading }: { kpi: Kpi; loading: boolean }) {
  const { Icon, label, value, prefix, suffix, delta, hint } = kpi;
  const numberRef = React.useRef<HTMLSpanElement>(null);

  return (
    <Card className="kpi-card">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span className="rounded-md bg-primary/10 p-1.5 text-primary">
            <Icon className="size-4" />
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-1.5">
          {prefix && (
            <span className="text-xl font-semibold text-muted-foreground">
              {prefix}
            </span>
          )}
          {loading ? (
            <Skeleton className="h-9 w-24" />
          ) : (
            <span
              ref={numberRef}
              data-kpi-value={value}
              className="font-mono text-3xl font-semibold tracking-tight tabular-nums"
            >
              0
            </span>
          )}
          {suffix && (
            <span className="text-xl font-semibold text-muted-foreground">
              {suffix}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs">
          {delta && (
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 font-medium",
                delta.startsWith("+")
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              {delta}
            </span>
          )}
          {hint && <span className="text-muted-foreground">{hint}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function QualityRow({
  label,
  value,
  loading,
  warn,
}: {
  label: string;
  value: number;
  loading: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      {loading ? (
        <Skeleton className="h-5 w-10" />
      ) : (
        <span
          className={cn(
            "font-mono font-medium",
            warn && "text-destructive",
          )}
        >
          {value.toLocaleString("en-IN")}
        </span>
      )}
    </div>
  );
}

function KpiAnimation({
  containerRef,
  valuesKey,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  valuesKey: string;
}) {
  useReducedMotionSafeGSAP(
    ({ gsap, reduced }) => {
      const cards = containerRef.current?.querySelectorAll(".kpi-card");
      const panels = containerRef.current?.querySelectorAll(".kpi-panel");
      const bars = containerRef.current?.querySelectorAll(".kpi-bar");
      const numbers =
        containerRef.current?.querySelectorAll<HTMLElement>("[data-kpi-value]");

      if (!cards) return;

      if (!reduced) {
        gsap.fromTo(
          cards,
          { y: 14, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            stagger: 0.08,
            duration: DURATION.emphasized,
            ease: EASE.out,
          },
        );
        if (panels) {
          gsap.fromTo(
            panels,
            { y: 14, opacity: 0 },
            {
              y: 0,
              opacity: 1,
              stagger: 0.1,
              duration: DURATION.emphasized,
              ease: EASE.out,
              delay: 0.2,
            },
          );
        }
        if (bars) {
          gsap.to(bars, {
            opacity: 1,
            stagger: 0.04,
            duration: DURATION.standard,
            ease: EASE.out,
            delay: 0.3,
          });
        }
      }

      // Count-up: plain text mutation so it works regardless of reduced-motion
      numbers?.forEach((el) => {
        const end = Number(el.dataset.kpiValue ?? "0");
        if (reduced) {
          el.textContent = String(end);
          return;
        }
        const obj = { n: 0 };
        gsap.to(obj, {
          n: end,
          duration: 1.0,
          ease: EASE.out,
          onUpdate: () => {
            el.textContent = Math.round(obj.n).toLocaleString();
          },
        });
      });
    },
    [valuesKey],
    containerRef,
  );
  return null;
}
