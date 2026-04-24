"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, LoaderCircle, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shell/page-header";
import { DataTable } from "@/components/shell/data-table";
import { EmptyState } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, isApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

type Agent = {
  id: string;
  name: string;
  email: string;
  role: "agent" | "manager" | "super_admin" | "auditor";
  agentCode: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

type AgentsResponse = { agents: Agent[] };

export default function AgentsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const canManage = user?.role === "super_admin" || user?.role === "manager";

  const { data, isLoading } = useQuery<AgentsResponse>({
    queryKey: ["agents"],
    queryFn: () => api<AgentsResponse>("/api/agents"),
  });

  const toggleActive = useMutation({
    mutationFn: async (vars: { id: string; isActive: boolean }) => {
      return api(`/api/agents/${vars.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: vars.isActive }),
      });
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.isActive ? "Agent reactivated" : "Agent deactivated");
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: (err) => {
      toast.error(isApiError(err) ? err.message : "Failed to update agent");
    },
  });

  const columns = React.useMemo<ColumnDef<Agent, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-primary-foreground"
              style={{ background: "hsl(var(--primary))" }}
            >
              {row.original.name[0]?.toUpperCase() ?? "?"}
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium">{row.original.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {row.original.email}
              </div>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "agentCode",
        header: "Code",
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {row.original.agentCode ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => (
          <Badge variant="outline" className="capitalize">
            {row.original.role.replace("_", " ")}
          </Badge>
        ),
      },
      {
        accessorKey: "isActive",
        header: "Status",
        cell: ({ row }) =>
          row.original.isActive ? (
            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent">
              Active
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-muted-foreground">
              Inactive
            </Badge>
          ),
      },
      {
        accessorKey: "lastLoginAt",
        header: "Last login",
        cell: ({ row }) =>
          row.original.lastLoginAt ? (
            <span className="text-sm text-muted-foreground">
              {new Date(row.original.lastLoginAt).toLocaleString()}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const r = row.original;
          if (!canManage) return null;
          if (r.role === "super_admin") return null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" onClick={(e) => e.stopPropagation()}>
                  Manage
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {r.isActive ? (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleActive.mutate({ id: r.id, isActive: false });
                    }}
                    className="text-destructive focus:text-destructive"
                  >
                    Deactivate
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleActive.mutate({ id: r.id, isActive: true });
                    }}
                  >
                    Reactivate
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [canManage, toggleActive],
  );

  return (
    <div>
      <PageHeader
        title="Agents"
        description="Field agents + managers who can collect on behalf of this tenant."
        actions={
          canManage && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="size-4" />
                  New agent
                </Button>
              </DialogTrigger>
              <CreateAgentDialog onClose={() => setDialogOpen(false)} />
            </Dialog>
          )
        }
      />

      {!isLoading && (data?.agents ?? []).length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No agents yet"
          description="Invite your first field agent to start logging collections."
          action={
            canManage && (
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="size-4" />
                Add agent
              </Button>
            )
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={data?.agents ?? []}
          loading={isLoading}
          getRowId={(r) => r.id}
        />
      )}
    </div>
  );
}

function CreateAgentDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isManager = user?.role === "manager";

  const [form, setForm] = React.useState({
    name: "",
    email: "",
    password: "",
    agentCode: "",
    role: "agent" as "agent" | "manager",
  });

  const mutation = useMutation({
    mutationFn: async () =>
      api("/api/agents", {
        method: "POST",
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      toast.success("Agent created");
      qc.invalidateQueries({ queryKey: ["agents"] });
      onClose();
    },
    onError: (err) => {
      toast.error(isApiError(err) ? err.message : "Could not create agent");
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <DialogContent className="sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle>Create agent</DialogTitle>
        <DialogDescription>
          A new user will be invited with email-routed login.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agentCode">Agent code</Label>
            <Input
              id="agentCode"
              required
              placeholder="A003"
              value={form.agentCode}
              onChange={(e) => setForm({ ...form, agentCode: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Temporary password</Label>
            <Input
              id="password"
              type="text"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select
              value={form.role}
              disabled={isManager}
              onValueChange={(v) =>
                setForm({ ...form, role: v as "agent" | "manager" })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agent">Agent</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && (
              <LoaderCircle className="size-4 animate-spin" />
            )}
            Create agent
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
