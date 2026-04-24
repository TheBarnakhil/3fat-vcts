"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

import { AppShell } from "@/components/shell/app-shell";
import { useMe } from "@/hooks/use-auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, isLoading, isError, error } = useMe();

  useEffect(() => {
    if (isError && (error as { status?: number })?.status === 401) {
      router.replace("/login");
    }
  }, [isError, error, router]);

  if (isLoading || !data) {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center text-muted-foreground">
        <LoaderCircle className="mr-2 size-5 animate-spin" />
        Loading workspace...
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
