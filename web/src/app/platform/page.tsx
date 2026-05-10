"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Building2,
	LoaderCircle,
	LogOut,
	Plus,
	ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

type PlatformMe = {
	user: { id: string; email: string; name: string; role: "platform_admin" };
};

type PlatformTenant = {
	id: string;
	slug: string;
	name: string;
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
	counts: { users: number; customers: number; collections: number };
	usage: {
		monthCollections: number;
		monthAmount: number;
		activeAgents30d: number;
		storage: null | { objects: number; bytes: number };
	};
};

type TenantsResponse = { tenants: PlatformTenant[] };

async function platformApi<T>(input: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(input, {
		credentials: "same-origin",
		headers: { "content-type": "application/json", ...(init.headers ?? {}) },
		...init,
	});
	const text = await res.text();
	const body = text ? JSON.parse(text) : null;
	if (!res.ok) {
		throw new Error(body?.error?.message ?? res.statusText ?? "Request failed");
	}
	return body as T;
}

export default function PlatformPage() {
	const router = useRouter();
	const qc = useQueryClient();
	const [createOpen, setCreateOpen] = React.useState(false);

	const me = useQuery<PlatformMe>({
		queryKey: ["platform", "me"],
		queryFn: () => platformApi<PlatformMe>("/api/platform/me"),
		retry: false,
	});
	const tenants = useQuery<TenantsResponse>({
		queryKey: ["platform", "tenants"],
		queryFn: () => platformApi<TenantsResponse>("/api/platform/tenants"),
		enabled: !!me.data,
	});

	React.useEffect(() => {
		if (me.isError) router.replace("/platform/login");
	}, [me.isError, router]);

	const logout = useMutation({
		mutationFn: () =>
			platformApi("/api/platform/auth/logout", {
				method: "POST",
				body: "{}",
			}),
		onSettled: () => {
			qc.clear();
			router.replace("/platform/login");
		},
	});

	const toggle = useMutation({
		mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
			platformApi(`/api/platform/tenants/${id}`, {
				method: "PATCH",
				body: JSON.stringify({ isActive }),
			}),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: ["platform", "tenants"] });
			toast.success("Tenant status updated");
		},
		onError: (err) => {
			toast.error(err instanceof Error ? err.message : "Update failed");
		},
	});

	if (me.isLoading || (me.data && tenants.isLoading)) {
		return (
			<div className="flex min-h-screen items-center justify-center text-muted-foreground">
				<LoaderCircle className="mr-2 size-5 animate-spin" />
				Loading platform console...
			</div>
		);
	}

	if (!me.data) return null;

	return (
		<div className="min-h-screen bg-background">
			<header className="border-b bg-card/60">
				<div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
					<div className="flex items-center gap-3">
						<div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
							<ShieldCheck className="size-5" />
						</div>
						<div>
							<h1 className="text-lg font-semibold">VCTS Platform</h1>
							<p className="text-xs text-muted-foreground">
								Signed in as {me.data.user.name} ({me.data.user.email})
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<ThemeToggle />
						<Button
							variant="outline"
							size="sm"
							onClick={() => logout.mutate()}
							disabled={logout.isPending}
						>
							<LogOut className="size-4" />
							Sign out
						</Button>
					</div>
				</div>
			</header>

			<main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
				<div className="flex flex-wrap items-center justify-between gap-4">
					<div>
						<h2 className="text-2xl font-semibold tracking-tight">Tenants</h2>
						<p className="text-sm text-muted-foreground">
							Provision, suspend, and inspect tenant workspaces.
						</p>
					</div>
					<Dialog open={createOpen} onOpenChange={setCreateOpen}>
						<DialogTrigger asChild>
							<Button>
								<Plus className="size-4" />
								Create tenant
							</Button>
						</DialogTrigger>
						<CreateTenantDialog onDone={() => setCreateOpen(false)} />
					</Dialog>
				</div>

				<div className="grid gap-4 md:grid-cols-3">
					<StatCard
						label="Tenants"
						value={tenants.data?.tenants.length ?? 0}
						helper="Total workspaces"
					/>
					<StatCard
						label="Active"
						value={tenants.data?.tenants.filter((t) => t.isActive).length ?? 0}
						helper="Can sign in and sync"
					/>
					<StatCard
						label="Collections"
						value={
							tenants.data?.tenants.reduce(
								(sum, t) => sum + t.counts.collections,
								0,
							) ?? 0
						}
						helper="Across all tenants"
					/>
				</div>
				<div className="grid gap-4 md:grid-cols-3">
					<StatCard
						label="This month"
						value={
							tenants.data?.tenants.reduce(
								(sum, t) => sum + t.usage.monthCollections,
								0,
							) ?? 0
						}
						helper="Collections recorded"
					/>
					<StatCard
						label="Active agents"
						value={
							tenants.data?.tenants.reduce(
								(sum, t) => sum + t.usage.activeAgents30d,
								0,
							) ?? 0
						}
						helper="Seen in last 30 days"
					/>
					<StatCard
						label="R2 storage"
						valueText={formatBytes(
							tenants.data?.tenants.reduce(
								(sum, t) => sum + (t.usage.storage?.bytes ?? 0),
								0,
							) ?? 0,
						)}
						helper={
							tenants.data?.tenants.some((t) => t.usage.storage)
								? "Measured from tenant prefixes"
								: "R2 not configured or unavailable"
						}
					/>
				</div>

				<Card>
					<CardContent className="p-0">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Tenant</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Users</TableHead>
									<TableHead className="text-right">Customers</TableHead>
									<TableHead className="text-right">Collections</TableHead>
									<TableHead className="text-right">Month</TableHead>
									<TableHead className="text-right">Active agents</TableHead>
									<TableHead className="text-right">Storage</TableHead>
									<TableHead>Created</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{tenants.data?.tenants.map((tenant) => (
									<TableRow key={tenant.id}>
										<TableCell>
											<div className="flex items-center gap-2">
												<Building2 className="size-4 text-muted-foreground" />
												<div>
													<div className="font-medium">{tenant.name}</div>
													<div className="font-mono text-xs text-muted-foreground">
														{tenant.slug}
													</div>
												</div>
											</div>
										</TableCell>
										<TableCell>
											<Badge variant={tenant.isActive ? "default" : "secondary"}>
												{tenant.isActive ? "Active" : "Suspended"}
											</Badge>
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{tenant.counts.users}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{tenant.counts.customers}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{tenant.counts.collections}
										</TableCell>
										<TableCell className="text-right">
											<div className="tabular-nums">
												{tenant.usage.monthCollections}
											</div>
											<div className="text-xs text-muted-foreground tabular-nums">
												{formatINR(tenant.usage.monthAmount)}
											</div>
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{tenant.usage.activeAgents30d}
										</TableCell>
										<TableCell className="text-right">
											<div className="tabular-nums">
												{tenant.usage.storage
													? formatBytes(tenant.usage.storage.bytes)
													: "n/a"}
											</div>
											{tenant.usage.storage ? (
												<div className="text-xs text-muted-foreground tabular-nums">
													{tenant.usage.storage.objects} objects
												</div>
											) : null}
										</TableCell>
										<TableCell className="font-mono text-xs text-muted-foreground">
											{tenant.createdAt.slice(0, 10)}
										</TableCell>
										<TableCell className="text-right">
											<Button
												variant="outline"
												size="sm"
												disabled={toggle.isPending}
												onClick={() =>
													toggle.mutate({
														id: tenant.id,
														isActive: !tenant.isActive,
													})
												}
											>
												{tenant.isActive ? "Suspend" : "Reactivate"}
											</Button>
										</TableCell>
									</TableRow>
								))}
								{tenants.data?.tenants.length === 0 && (
									<TableRow>
										<TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
											No tenants yet.
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			</main>
		</div>
	);
}

function StatCard({
	label,
	value,
	valueText,
	helper,
}: {
	label: string;
	value?: number;
	valueText?: string;
	helper: string;
}) {
	return (
		<Card>
			<CardContent className="p-5">
				<div className="text-sm text-muted-foreground">{label}</div>
				<div className="mt-2 text-3xl font-semibold tabular-nums">
					{valueText ?? value ?? 0}
				</div>
				<div className="mt-1 text-xs text-muted-foreground">{helper}</div>
			</CardContent>
		</Card>
	);
}

function formatBytes(bytes: number): string {
	if (bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatINR(amount: number): string {
	return `Rs. ${amount.toLocaleString("en-IN", {
		maximumFractionDigits: 0,
	})}`;
}

function CreateTenantDialog({ onDone }: { onDone: () => void }) {
	const qc = useQueryClient();
	const [form, setForm] = React.useState({
		slug: "",
		name: "",
		adminEmail: "",
		adminName: "",
		adminPassword: "",
	});
	const create = useMutation({
		mutationFn: () =>
			platformApi("/api/platform/tenants", {
				method: "POST",
				body: JSON.stringify(form),
			}),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: ["platform", "tenants"] });
			toast.success("Tenant created");
			onDone();
		},
		onError: (err) => {
			toast.error(err instanceof Error ? err.message : "Tenant creation failed");
		},
	});

	return (
		<DialogContent className="sm:max-w-[560px]">
			<DialogHeader>
				<DialogTitle>Create tenant</DialogTitle>
				<DialogDescription>
					Creates a tenant workspace and its first tenant super-admin.
				</DialogDescription>
			</DialogHeader>
			<form
				className="grid gap-4"
				onSubmit={(e) => {
					e.preventDefault();
					create.mutate();
				}}
			>
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="space-y-2">
						<Label htmlFor="tenant-slug">Slug</Label>
						<Input
							id="tenant-slug"
							placeholder="newco"
							value={form.slug}
							onChange={(e) => setForm({ ...form, slug: e.target.value })}
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="tenant-name">Tenant name</Label>
						<Input
							id="tenant-name"
							placeholder="NewCo Distributors"
							value={form.name}
							onChange={(e) => setForm({ ...form, name: e.target.value })}
							required
						/>
					</div>
				</div>
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="space-y-2">
						<Label htmlFor="admin-name">Admin name</Label>
						<Input
							id="admin-name"
							value={form.adminName}
							onChange={(e) => setForm({ ...form, adminName: e.target.value })}
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="admin-email">Admin email</Label>
						<Input
							id="admin-email"
							type="email"
							value={form.adminEmail}
							onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
							required
						/>
					</div>
				</div>
				<div className="space-y-2">
					<Label htmlFor="admin-password">Temporary password</Label>
					<Input
						id="admin-password"
						type="password"
						value={form.adminPassword}
						onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
						required
						minLength={8}
					/>
				</div>
				<DialogFooter>
					<Button type="button" variant="ghost" onClick={onDone}>
						Cancel
					</Button>
					<Button type="submit" disabled={create.isPending}>
						{create.isPending && <LoaderCircle className="size-4 animate-spin" />}
						Create tenant
					</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	);
}
