"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import {
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  ReceiptText,
  ShieldCheck,
  Users,
  UsersRound,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ThemeToggle, TenantAccent } from "@/components/theme/theme-toggle";
import { useReducedMotionSafeGSAP, DURATION, EASE } from "@/lib/motion/gsap";
import { useAuthStore } from "@/stores/auth-store";
import { useLogout } from "@/hooks/use-auth";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  comingSoon?: boolean;
};

const NAV: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: UsersRound },
  { href: "/customers", label: "Customers", icon: Users },
  {
    href: "/collections",
    label: "Collections",
    icon: ReceiptText,
    comingSoon: true,
  },
  { href: "/map", label: "Live map", icon: MapPin, comingSoon: true },
  { href: "/audit", label: "Audit", icon: ShieldCheck, comingSoon: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, tenant } = useAuthStore();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <>
      <TenantAccent hsl={tenant?.accentHsl ?? null} />

      <div className="flex min-h-screen flex-col lg:flex-row">
        {/* Desktop sidebar */}
        <DesktopSidebar />

        {/* Mobile header */}
        <div className="flex items-center justify-between border-b px-4 h-14 lg:hidden">
          <div className="flex items-center gap-2">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open menu">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                <SheetHeader className="border-b px-4 py-3">
                  <SheetTitle className="text-left text-base font-semibold">
                    VCTS
                  </SheetTitle>
                </SheetHeader>
                <MobileNav onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
            <span className="font-semibold tracking-tight">VCTS</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>

        {/* Main column */}
        <div className="flex flex-1 flex-col min-w-0">
          {/* Desktop top bar */}
          <header className="sticky top-0 z-30 hidden h-14 items-center justify-between border-b bg-background/70 px-6 backdrop-blur lg:flex">
            <div className="flex items-center gap-3">
              {tenant && (
                <div className="flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ background: "hsl(var(--primary))" }}
                    aria-hidden
                  />
                  <span className="text-muted-foreground">Tenant:</span>
                  <span className="font-semibold">
                    {tenant.name ?? tenant.slug}
                  </span>
                </div>
              )}
              {user && (
                <span className="text-xs text-muted-foreground">
                  {user.role.replace("_", " ")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>

          <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
    </>
  );
}

function DesktopSidebar() {
  const pathname = usePathname();
  const ref = React.useRef<HTMLElement>(null);

  useReducedMotionSafeGSAP(
    ({ gsap, reduced }) => {
      if (reduced) return;
      gsap.fromTo(
        ".vcts-nav-item",
        { x: -8, opacity: 0 },
        {
          x: 0,
          opacity: 1,
          duration: DURATION.standard,
          ease: EASE.out,
          stagger: 0.035,
        },
      );
    },
    [],
    ref,
  );

  return (
    <aside
      ref={ref}
      className="hidden w-60 shrink-0 border-r bg-muted/20 lg:flex lg:flex-col"
    >
      <div className="flex h-14 items-center gap-2 border-b px-5">
        <div
          className="flex size-7 items-center justify-center rounded-md text-sm font-bold text-primary-foreground"
          style={{ background: "hsl(var(--primary))" }}
          aria-hidden
        >
          V
        </div>
        <span className="font-semibold tracking-tight">VCTS</span>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <li key={item.href} className="vcts-nav-item">
                <Link
                  href={item.comingSoon ? "#" : item.href}
                  aria-disabled={item.comingSoon || undefined}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    item.comingSoon && "cursor-not-allowed opacity-50",
                  )}
                >
                  <Icon className="size-4" />
                  <span className="flex-1">{item.label}</span>
                  {item.comingSoon && (
                    <span className="text-[10px] text-muted-foreground">
                      soon
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t p-3 text-xs text-muted-foreground">
        <div>VCTS v0.2</div>
        <kbd className="mt-1 inline-block rounded border px-1 font-mono text-[10px]">
          ⌘J
        </kbd>{" "}
        toggle theme
      </div>
    </aside>
  );
}

function MobileNav({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="p-3">
      <ul className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <li key={item.href}>
              <Link
                href={item.comingSoon ? "#" : item.href}
                onClick={onNavigate}
                aria-disabled={item.comingSoon || undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm",
                  active
                    ? "bg-primary/10 text-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  item.comingSoon && "pointer-events-none opacity-50",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const logout = useLogout();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 pl-2">
          <span
            className="flex size-6 items-center justify-center rounded-full text-[11px] font-semibold text-primary-foreground"
            style={{ background: "hsl(var(--primary))" }}
          >
            {user?.name?.[0]?.toUpperCase() ?? "?"}
          </span>
          <span className="hidden text-sm sm:inline">
            {user?.name ?? "Loading..."}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span>{user?.name}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {user?.email}
          </span>
          {tenant && (
            <span className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {tenant.slug}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => logout.mutate()}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
