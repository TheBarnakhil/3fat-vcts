"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, LoaderCircle, XCircle } from "lucide-react";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type VerifyState =
	| { status: "loading" }
	| { status: "success"; tenantSlug: string; tenantName: string }
	| { status: "error"; message: string };

export default function SignupVerifyPage() {
	return (
		<Suspense fallback={null}>
			<SignupVerifyInner />
		</Suspense>
	);
}

function SignupVerifyInner() {
	const search = useSearchParams();
	const token = search.get("token");
	const [state, setState] = React.useState<VerifyState>({ status: "loading" });

	React.useEffect(() => {
		let cancelled = false;
		async function verify() {
			if (!token) {
				setState({ status: "error", message: "Missing verification token." });
				return;
			}
			try {
				const res = await fetch("/api/signup/verify", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ token }),
				});
				const body = await res.json().catch(() => null);
				if (!res.ok) {
					throw new Error(body?.error?.message ?? "Verification failed");
				}
				if (!cancelled) {
					setState({
						status: "success",
						tenantSlug: body.tenant.slug,
						tenantName: body.tenant.name,
					});
				}
			} catch (err) {
				if (!cancelled) {
					setState({
						status: "error",
						message:
							err instanceof Error
								? err.message
								: "Verification failed. Try signing up again.",
					});
				}
			}
		}
		void verify();
		return () => {
			cancelled = true;
		};
	}, [token]);

	return (
		<div className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
			<div className="absolute right-4 top-4">
				<ThemeToggle />
			</div>
			<Card className="w-full max-w-[460px] border-border/70 shadow-xl shadow-black/5">
				<CardContent className="space-y-5 p-6 text-center">
					{state.status === "loading" && (
						<>
							<LoaderCircle className="mx-auto size-12 animate-spin text-primary" />
							<div>
								<h1 className="text-2xl font-semibold tracking-tight">
									Verifying email...
								</h1>
								<p className="mt-2 text-sm text-muted-foreground">
									We are creating your workspace now.
								</p>
							</div>
						</>
					)}
					{state.status === "success" && (
						<>
							<CheckCircle2 className="mx-auto size-12 text-primary" />
							<div>
								<h1 className="text-2xl font-semibold tracking-tight">
									Workspace ready
								</h1>
								<p className="mt-2 text-sm text-muted-foreground">
									{state.tenantName} ({state.tenantSlug}) has been created. You can
									now sign in with the admin email and password you chose.
								</p>
							</div>
							<Button asChild className="w-full">
								<Link href="/login">Sign in</Link>
							</Button>
						</>
					)}
					{state.status === "error" && (
						<>
							<XCircle className="mx-auto size-12 text-destructive" />
							<div>
								<h1 className="text-2xl font-semibold tracking-tight">
									Verification failed
								</h1>
								<p className="mt-2 text-sm text-muted-foreground">
									{state.message}
								</p>
							</div>
							<Button asChild className="w-full">
								<Link href="/signup">Start over</Link>
							</Button>
						</>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
