"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, LoaderCircle, Shield } from "lucide-react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function PlatformLoginPage() {
	return (
		<Suspense fallback={null}>
			<PlatformLoginInner />
		</Suspense>
	);
}

function PlatformLoginInner() {
	const router = useRouter();
	const search = useSearchParams();
	const next = search.get("next") ?? "/platform";
	const [email, setEmail] = React.useState("");
	const [password, setPassword] = React.useState("");
	const [busy, setBusy] = React.useState(false);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		try {
			const res = await fetch("/api/platform/auth/login", {
				method: "POST",
				credentials: "same-origin",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email, password }),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.error?.message ?? "Platform sign-in failed");
			}
			toast.success("Welcome to the platform console");
			router.replace(next);
			router.refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Platform sign-in failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden bg-background px-4 py-10">
			<div className="absolute right-4 top-4">
				<ThemeToggle />
			</div>
			<div className="w-full max-w-[420px] space-y-6">
				<div className="flex flex-col items-center text-center">
					<div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
						<Shield className="size-7" />
					</div>
					<h1 className="text-2xl font-semibold tracking-tight">
						Platform Console
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						3FAT operator access for tenant provisioning
					</p>
				</div>

				<Card className="border-border/70 shadow-xl shadow-black/5">
					<CardContent className="p-6">
						<form className="space-y-4" onSubmit={onSubmit}>
							<div className="space-y-2">
								<Label htmlFor="platform-email">Email</Label>
								<Input
									id="platform-email"
									type="email"
									autoComplete="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									required
									autoFocus
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="platform-password">Password</Label>
								<Input
									id="platform-password"
									type="password"
									autoComplete="current-password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									required
								/>
							</div>
							<Button type="submit" className="w-full" size="lg" disabled={busy}>
								{busy ? (
									<>
										<LoaderCircle className="size-4 animate-spin" />
										Signing in...
									</>
								) : (
									<>
										<KeyRound className="size-4" />
										Sign in
									</>
								)}
							</Button>
						</form>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
