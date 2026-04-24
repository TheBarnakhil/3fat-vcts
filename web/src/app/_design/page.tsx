import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme/theme-toggle";

const COLORS = [
  "background",
  "foreground",
  "card",
  "popover",
  "muted",
  "muted-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
];

const RADII = [
  { key: "sm", var: "--radius-sm" },
  { key: "md", var: "--radius-md" },
  { key: "lg", var: "--radius-lg" },
  { key: "xl", var: "--radius-xl" },
];

const MOTION = [
  { key: "micro (120ms)", var: "--motion-duration-micro" },
  { key: "standard (240ms)", var: "--motion-duration-standard" },
  { key: "emphasized (400ms)", var: "--motion-duration-emphasized" },
];

export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="mx-auto max-w-6xl p-8 space-y-12">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            VCTS design tokens
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dev-only reference. Toggle theme to see dark/light token values
            side-by-side.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <Section title="Color tokens" hint="HSL-component CSS variables">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {COLORS.map((c) => (
            <div
              key={c}
              className="flex items-center gap-3 rounded-lg border p-3"
            >
              <div
                className="size-10 rounded-md ring-1 ring-inset ring-border"
                style={{ background: `hsl(var(--${c}))` }}
                aria-hidden
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{c}</div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  --{c}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Radii">
        <div className="flex flex-wrap gap-4">
          {RADII.map((r) => (
            <div key={r.key} className="flex flex-col items-center gap-2">
              <div
                className="size-20 border bg-primary/15"
                style={{ borderRadius: `var(${r.var})` }}
              />
              <div className="font-mono text-xs text-muted-foreground">
                {r.var}
              </div>
              <div className="text-xs">{r.key}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Motion">
        <ul className="space-y-2">
          {MOTION.map((m) => (
            <li key={m.key} className="flex items-center gap-3 text-sm">
              <span className="font-mono text-muted-foreground">{m.var}</span>
              <span>{m.key}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Typography">
        <div className="space-y-2">
          <div className="text-4xl font-semibold tracking-tight">
            Aa Geist Sans 600
          </div>
          <div className="text-base">Body text - Geist Sans 400</div>
          <div className="font-mono text-sm">Mono - Geist Mono 400</div>
          <div className="font-mono text-lg tabular-nums">
            ₹ 1,24,350.00 (receipt no. acme/A001/FY26/00042)
          </div>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent">
            Active
          </Badge>
        </div>
      </Section>

      <Section title="Form inputs">
        <div className="grid gap-3 sm:max-w-sm">
          <div className="space-y-1.5">
            <Label htmlFor="d-email">Email</Label>
            <Input id="d-email" placeholder="you@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-pass">Password</Label>
            <Input id="d-pass" type="password" />
          </div>
          <Separator className="my-2" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      </Section>

      <Section title="Card">
        <Card className="max-w-sm">
          <CardContent className="p-5">
            <h3 className="text-base font-semibold">VCTS card</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Rounded {` `}
              <code className="font-mono">--radius</code>, tinted border in
              dark mode, 1px hairline in light.
            </p>
            <div className="mt-4">
              <Button>Primary action</Button>
            </div>
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between border-b pb-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {hint && (
          <span className="text-xs text-muted-foreground">{hint}</span>
        )}
      </div>
      {children}
    </section>
  );
}
