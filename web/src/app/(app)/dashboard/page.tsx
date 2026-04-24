"use client";

import * as React from "react";
import {
  CircleDollarSign,
  Map,
  ReceiptText,
  TrendingUp,
  UsersRound,
} from "lucide-react";

import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useReducedMotionSafeGSAP, DURATION, EASE } from "@/lib/motion/gsap";
import { useAuthStore } from "@/stores/auth-store";

type Kpi = {
  label: string;
  value: number;
  suffix?: string;
  prefix?: string;
  delta?: string;
  hint?: string;
  Icon: React.ComponentType<{ className?: string }>;
};

const KPIS: Kpi[] = [
  {
    label: "Collected today",
    value: 0,
    prefix: "₹",
    delta: "+0%",
    hint: "vs yesterday",
    Icon: CircleDollarSign,
  },
  {
    label: "Active agents",
    value: 0,
    suffix: "",
    hint: "this week",
    Icon: UsersRound,
  },
  {
    label: "Receipts generated",
    value: 0,
    hint: "last 7 days",
    Icon: ReceiptText,
  },
  {
    label: "Visits on-fence",
    value: 0,
    suffix: "%",
    hint: "accuracy today",
    Icon: Map,
  },
];

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const containerRef = React.useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef}>
      <PageHeader
        title={`Welcome back${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`}
        description="Live operations overview. Real data starts flowing in Phase 3."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((k) => (
          <KpiCard key={k.label} kpi={k} />
        ))}
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 kpi-panel">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">Collections trend</h3>
                <p className="text-xs text-muted-foreground">
                  Recharts-powered chart lands in Phase 9
                </p>
              </div>
              <TrendingUp className="size-4 text-muted-foreground" />
            </div>
            <div className="mt-8 flex h-48 items-end gap-2">
              {[18, 22, 16, 28, 24, 34, 30, 42, 38, 48, 44, 52].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t-md bg-primary/80 kpi-bar"
                  style={{ height: `${h * 2}px`, opacity: 0 }}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="kpi-panel">
          <CardContent className="p-6">
            <h3 className="text-sm font-medium">Top agents</h3>
            <p className="text-xs text-muted-foreground">
              Seeded once collections start
            </p>
            <ul className="mt-4 space-y-3">
              {["A001", "A002", "A003"].map((code) => (
                <li key={code} className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex size-7 items-center justify-center rounded-full text-[11px] font-semibold text-primary-foreground"
                      style={{ background: "hsl(var(--primary))" }}
                    >
                      {code.slice(-2)}
                    </span>
                    <span className="text-sm">{code}</span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    ₹—
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <KpiAnimation containerRef={containerRef} />
    </div>
  );
}

function KpiCard({ kpi }: { kpi: Kpi }) {
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
          <span
            ref={numberRef}
            data-kpi-value={value}
            className="font-mono text-3xl font-semibold tracking-tight tabular-nums"
          >
            0
          </span>
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

function KpiAnimation({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
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
    [],
    containerRef,
  );
  return null;
}
