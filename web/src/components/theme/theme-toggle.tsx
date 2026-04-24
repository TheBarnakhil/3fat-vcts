"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Hydration-safe flag: `useSyncExternalStore` returns the server snapshot
 * during SSR and the client snapshot after mount without calling setState
 * inside an effect.
 */
function useHasMounted(): boolean {
  return React.useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}
function subscribeNoop() {
  return () => {};
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useHasMounted();

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle theme"
              className="relative"
            >
              <Sun className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
              <Moon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          Toggle theme
          <kbd className="text-muted-foreground ml-2 rounded border px-1 font-mono text-[10px]">
            ⌘J
          </kbd>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={mounted ? theme : undefined}
          onValueChange={(v) => setTheme(v)}
        >
          <DropdownMenuRadioItem value="light">
            <Sun className="mr-2 size-4" /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="mr-2 size-4" /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="mr-2 size-4" /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Read-only variant that shows which theme is currently resolved. */
export function ResolvedThemeIcon({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  const mounted = useHasMounted();
  if (!mounted) return null;
  return resolvedTheme === "dark" ? (
    <Moon className={className} />
  ) : (
    <Sun className={className} />
  );
}

/** Injects per-tenant accent color as `--primary` + `--ring` via inline CSS. */
export function TenantAccent({ hsl }: { hsl?: string | null }) {
  if (!hsl) return null;
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
          :root, .dark {
            --primary: ${hsl};
            --ring: ${hsl};
          }
        `,
      }}
    />
  );
}
