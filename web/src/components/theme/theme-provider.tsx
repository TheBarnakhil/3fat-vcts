"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange={false}
      storageKey="vcts-theme"
      {...props}
    >
      <ThemeShortcutBridge />
      {children}
    </NextThemesProvider>
  );
}

/**
 * Global keyboard shortcut (Ctrl/Cmd+J) to cycle light → dark → system.
 * Ignores when the event originates from an editable element so it never
 * interferes with forms.
 */
function ThemeShortcutBridge() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "j") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      e.preventDefault();
      const current = theme === "system" ? resolvedTheme : theme;
      setTheme(current === "dark" ? "light" : "dark");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [theme, resolvedTheme, setTheme]);

  return null;
}
