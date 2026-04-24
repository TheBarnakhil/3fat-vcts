"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { useLogin } from "@/hooks/use-auth";
import { useReducedMotionSafeGSAP, DURATION, EASE } from "@/lib/motion/gsap";
import { cn } from "@/lib/utils";
import { isApiError } from "@/lib/api";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const search = useSearchParams();
  const nextParam = search?.get("next") ?? "/dashboard";

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  const login = useLogin();
  const cardRef = React.useRef<HTMLDivElement>(null);

  useReducedMotionSafeGSAP(
    ({ gsap, reduced }) => {
      // Ornament: gradient blobs + logo pulse. Gated off when reduced-motion.
      if (!reduced) {
        gsap.fromTo(
          ".vcts-blob",
          { scale: 0.9, opacity: 0 },
          {
            scale: 1,
            opacity: 0.7,
            duration: 1.2,
            ease: EASE.out,
            stagger: 0.15,
          },
        );
        gsap.to(".vcts-logo", {
          scale: 1.04,
          duration: 2,
          ease: EASE.inOut,
          repeat: -1,
          yoyo: true,
        });
      }

      // Functional transition: card entrance. Always runs (10ms under RM).
      const d = reduced ? 0.01 : DURATION.emphasized;
      gsap.fromTo(
        cardRef.current,
        { y: 18, opacity: 0 },
        { y: 0, opacity: 1, duration: d, ease: EASE.out, delay: reduced ? 0 : 0.1 },
      );
    },
    [],
    cardRef,
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login.mutateAsync({ email, password });
      toast.success("Welcome back");
      // router.push is inside the hook, but honour ?next= if present
      if (nextParam && nextParam !== "/dashboard") {
        window.location.href = nextParam;
      }
    } catch (err) {
      const msg = isApiError(err) ? err.message : "Sign-in failed";
      toast.error(msg);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* Ornamental gradient backdrop */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center justify-center",
        )}
      >
        <div
          className="vcts-blob absolute -top-32 -left-24 h-[32rem] w-[32rem] rounded-full blur-[120px]"
          style={{ background: "hsl(var(--primary) / 0.35)" }}
        />
        <div
          className="vcts-blob absolute -bottom-40 -right-24 h-[30rem] w-[30rem] rounded-full blur-[120px]"
          style={{ background: "hsl(var(--chart-3) / 0.25)" }}
        />
        <div
          className="vcts-blob absolute top-1/3 right-1/4 h-[18rem] w-[18rem] rounded-full blur-[100px]"
          style={{ background: "hsl(var(--chart-2) / 0.25)" }}
        />
        <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px] dark:bg-background/70" />
      </div>

      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      <div
        ref={cardRef}
        className="relative z-10 w-full max-w-[420px] space-y-6"
      >
        <div className="flex flex-col items-center text-center">
          <div
            className="vcts-logo mb-4 flex size-14 items-center justify-center rounded-2xl text-xl font-bold text-primary-foreground shadow-lg"
            style={{ background: "hsl(var(--primary))" }}
          >
            V
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Sign in to VCTS
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Verified Collection Tracking System
          </p>
        </div>

        <Card className="border-border/70 shadow-xl shadow-black/5 backdrop-blur-md dark:shadow-black/30">
          <CardContent className="p-6">
            <form className="space-y-4" onSubmit={onSubmit} autoComplete="on">
              <div className="space-y-2">
                <Label htmlFor="email">Work email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <a
                    href="#"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.preventDefault();
                      toast.info(
                        "Ask your administrator to reset your password for now.",
                      );
                    }}
                  >
                    Forgot?
                  </a>
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={login.isPending}
              >
                {login.isPending ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    <KeyRound className="size-4" /> Sign in
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          Enterprise-grade, multi-tenant. Powered by 3FAT.
        </p>
      </div>
    </div>
  );
}
