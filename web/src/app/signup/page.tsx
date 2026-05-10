"use client";

import * as React from "react";
import { CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SignupResponse = {
	ok: true;
	email: string;
	expiresAt: string;
	emailDeliveryConfigured: boolean;
	verificationUrl?: string;
};

export default function SignupPage() {
	const [form, setForm] = React.useState({
		tenantSlug: "",
		tenantName: "",
		adminName: "",
		adminEmail: "",
		adminPassword: "",
	});
	const [busy, setBusy] = React.useState(false);
	const [result, setResult] = React.useState<SignupResponse | null>(null);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		try {
			const res = await fetch("/api/signup/request", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(form),
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.error?.message ?? "Signup failed");
			setResult(body as SignupResponse);
			toast.success("Verification link created");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Signup failed");
		} finally {
			setBusy(false);
		}
	}

	if (result) {
		return (
			<SignupShell>
				<Card className="border-border/70 shadow-xl shadow-black/5">
					<CardContent className="space-y-5 p-6 text-center">
						<CheckCircle2 className="mx-auto size-12 text-primary" />
						<div>
							<h1 className="text-2xl font-semibold tracking-tight">
								Check your email
							</h1>
							<p className="mt-2 text-sm text-muted-foreground">
								We sent a verification link to {result.email}. Once verified,
								your workspace and first admin account will be created.
							</p>
						</div>
						{result.verificationUrl && (
							<div className="rounded-lg border bg-muted/40 p-3 text-left">
								<p className="text-xs font-medium text-muted-foreground">
									Development verification link
								</p>
								<a
									href={result.verificationUrl}
									className="break-all text-sm text-primary underline"
								>
									{result.verificationUrl}
								</a>
							</div>
						)}
						<Button asChild className="w-full">
							<Link href="/login">Back to sign in</Link>
						</Button>
					</CardContent>
				</Card>
			</SignupShell>
		);
	}

	return (
		<SignupShell>
			<div className="mb-6 flex flex-col items-center text-center">
				<div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
					<ShieldCheck className="size-7" />
				</div>
				<h1 className="text-2xl font-semibold tracking-tight">
					Create your VCTS workspace
				</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Verify your email, then we create your tenant and first admin.
				</p>
			</div>
			<Card className="border-border/70 shadow-xl shadow-black/5">
				<CardContent className="p-6">
					<form className="space-y-4" onSubmit={onSubmit}>
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="tenant-slug">Workspace slug</Label>
								<Input
									id="tenant-slug"
									placeholder="newco"
									value={form.tenantSlug}
									onChange={(e) =>
										setForm({ ...form, tenantSlug: e.target.value })
									}
									required
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="tenant-name">Company name</Label>
								<Input
									id="tenant-name"
									placeholder="NewCo Distributors"
									value={form.tenantName}
									onChange={(e) =>
										setForm({ ...form, tenantName: e.target.value })
									}
									required
								/>
							</div>
						</div>
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="admin-name">Your name</Label>
								<Input
									id="admin-name"
									value={form.adminName}
									onChange={(e) =>
										setForm({ ...form, adminName: e.target.value })
									}
									required
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="admin-email">Work email</Label>
								<Input
									id="admin-email"
									type="email"
									value={form.adminEmail}
									onChange={(e) =>
										setForm({ ...form, adminEmail: e.target.value })
									}
									required
								/>
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor="admin-password">Password</Label>
							<Input
								id="admin-password"
								type="password"
								minLength={8}
								value={form.adminPassword}
								onChange={(e) =>
									setForm({ ...form, adminPassword: e.target.value })
								}
								required
							/>
						</div>
						<Button type="submit" className="w-full" size="lg" disabled={busy}>
							{busy && <LoaderCircle className="size-4 animate-spin" />}
							Send verification link
						</Button>
						<p className="text-center text-xs text-muted-foreground">
							Already have a workspace?{" "}
							<Link href="/login" className="text-primary underline">
								Sign in
							</Link>
						</p>
					</form>
				</CardContent>
			</Card>
		</SignupShell>
	);
}

function SignupShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="relative flex min-h-screen flex-1 items-center justify-center bg-background px-4 py-10">
			<div className="absolute right-4 top-4">
				<ThemeToggle />
			</div>
			<div className="w-full max-w-[620px]">{children}</div>
		</div>
	);
}
