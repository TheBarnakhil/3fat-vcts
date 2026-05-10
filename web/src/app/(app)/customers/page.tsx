"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Download,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  MapPin,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shell/page-header";
import { DataTable } from "@/components/shell/data-table";
import { EmptyState } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CustomerMapPicker } from "@/components/maps/customer-map-picker";
import { api, isApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { flipShared } from "@/lib/motion/gsap";

type Customer = {
  id: string;
  code: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  lat: number;
  lng: number;
  geofenceRadiusM: number;
  outstandingBalance: number;
  assignedAgentId: string | null;
};

type CustomersResponse = { customers: Customer[] };
type Agent = {
  id: string;
  name: string;
  email: string;
  role: "agent" | "manager" | "super_admin" | "auditor";
  agentCode: string | null;
  isActive: boolean;
};
type AgentsResponse = { agents: Agent[] };

const DEFAULT_CENTER = { lat: 12.9716, lng: 77.5946 }; // Bengaluru-ish; overwritten after first save

export default function CustomersPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === "super_admin" || user?.role === "manager";
  const canDelete = user?.role === "super_admin";

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Customer | null>(null);

  const { data, isLoading } = useQuery<CustomersResponse>({
    queryKey: ["customers"],
    queryFn: () => api<CustomersResponse>("/api/customers"),
  });

  const { data: agentsData } = useQuery<AgentsResponse>({
    queryKey: ["agents"],
    queryFn: () => api<AgentsResponse>("/api/agents"),
    enabled: canManage,
  });
  const assignableAgents = React.useMemo(
    () => (agentsData?.agents ?? []).filter((a) => a.role === "agent" && a.isActive),
    [agentsData],
  );
  const agentsById = React.useMemo(
    () => new Map((agentsData?.agents ?? []).map((a) => [a.id, a])),
    [agentsData],
  );

  const deleteMut = useMutation({
    mutationFn: async (id: string) =>
      api(`/api/customers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Customer deleted");
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err) => {
      toast.error(isApiError(err) ? err.message : "Delete failed");
    },
  });

  const columns = React.useMemo<ColumnDef<Customer, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Customer",
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.code ?? "—"}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "address",
        header: "Address",
        cell: ({ row }) => (
          <span className="line-clamp-1 max-w-sm text-sm text-muted-foreground">
            {row.original.address ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "phone",
        header: "Phone",
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {row.original.phone ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "geofenceRadiusM",
        header: "Fence",
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
            <MapPin className="size-3.5" />
            {row.original.geofenceRadiusM} m
          </span>
        ),
      },
      {
        accessorKey: "outstandingBalance",
        header: "Outstanding",
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            ₹{row.original.outstandingBalance.toLocaleString()}
          </span>
        ),
      },
      {
        accessorKey: "assignedAgentId",
        header: "Assigned agent",
        cell: ({ row }) => {
          const agentId = row.original.assignedAgentId;
          const agent = agentId ? agentsById.get(agentId) : null;
          const label =
            agent?.name ??
            (agentId && agentId === user?.id
              ? "Assigned to you"
              : agentId
                ? "Assigned"
                : "Unassigned");
          return (
            <span className="text-sm text-muted-foreground">
              {label}
              {agent?.agentCode ? (
                <span className="ml-1 font-mono text-xs">({agent.agentCode})</span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            {canDelete && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete ${row.original.name}?`)) {
                    deleteMut.mutate(row.original.id);
                  }
                }}
                className="text-destructive hover:text-destructive"
                aria-label="Delete customer"
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [agentsById, canDelete, deleteMut, user?.id],
  );

  const rowId = (row: HTMLElement | null) => row?.getAttribute("data-row-key");

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Customer list with pinned locations and collection geofence."
        actions={
          canManage && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="size-4" />
                  New customer
                </Button>
              </DialogTrigger>
              <CustomerDialog
                mode="create"
                assignableAgents={assignableAgents}
                defaultLocation={
                  data?.customers[0]
                    ? {
                        lat: data.customers[0].lat,
                        lng: data.customers[0].lng,
                      }
                    : DEFAULT_CENTER
                }
                onClose={() => setCreateOpen(false)}
              />
            </Dialog>
          )
        }
      />

      {!isLoading && (data?.customers ?? []).length === 0 ? (
        <EmptyState
          icon={Users}
          title="No customers yet"
          description="Add your first customer with a pinned location to start collecting."
          action={
            canManage && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                Add customer
              </Button>
            )
          }
        />
      ) : (
        <div data-customers-table>
          <DataTable
            columns={columns}
            data={data?.customers ?? []}
            loading={isLoading}
            getRowId={(r) => r.id}
            onRowClick={(r) => {
              // Capture rows for FLIP before mounting the dialog
              const table = document.querySelector("[data-customers-table]");
              if (table) {
                const state = flipShared.capture(
                  table.querySelectorAll(".vcts-row"),
                );
                setEditing(r);
                requestAnimationFrame(() => flipShared.play(state));
              } else {
                setEditing(r);
              }
              void rowId;
            }}
          />
        </div>
      )}

      {/* Detail / edit dialog. Agents + auditors land in read-only view. */}
      <Dialog
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        {editing && (
          <CustomerDialog
            mode={canManage ? "edit" : "view"}
            initial={editing}
            assignableAgents={assignableAgents}
            defaultLocation={{ lat: editing.lat, lng: editing.lng }}
            onClose={() => setEditing(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

function CustomerDialog({
  mode,
  initial,
  assignableAgents,
  defaultLocation,
  onClose,
}: {
  mode: "create" | "edit" | "view";
  initial?: Customer;
  assignableAgents: Agent[];
  defaultLocation: { lat: number; lng: number };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const readOnly = mode === "view";
  const [form, setForm] = React.useState({
    code: initial?.code ?? "",
    name: initial?.name ?? "",
    address: initial?.address ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    lat: initial?.lat ?? defaultLocation.lat,
    lng: initial?.lng ?? defaultLocation.lng,
    geofenceRadiusM: initial?.geofenceRadiusM ?? 100,
    outstandingBalance: initial?.outstandingBalance ?? 0,
    assignedAgentId: initial?.assignedAgentId ?? "",
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        code: form.code || null,
        name: form.name,
        address: form.address || null,
        phone: form.phone || null,
        email: form.email || null,
        lat: Number(form.lat),
        lng: Number(form.lng),
        geofenceRadiusM: Number(form.geofenceRadiusM),
        outstandingBalance: Number(form.outstandingBalance),
        assignedAgentId: form.assignedAgentId || null,
      };
      return mode === "create"
        ? api("/api/customers", {
            method: "POST",
            body: JSON.stringify(payload),
          })
        : api(`/api/customers/${initial!.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          });
    },
    onSuccess: () => {
      toast.success(mode === "create" ? "Customer created" : "Customer updated");
      qc.invalidateQueries({ queryKey: ["customers"] });
      onClose();
    },
    onError: (err) => {
      toast.error(isApiError(err) ? err.message : "Save failed");
    },
  });

  return (
    <DialogContent className="sm:max-w-[720px]">
      <DialogHeader>
        <DialogTitle>
          {mode === "create"
            ? "Create customer"
            : mode === "edit"
              ? `Edit ${initial?.name}`
              : initial?.name}
        </DialogTitle>
        <DialogDescription>
          {readOnly
            ? "Customer details and the geofence agents must be inside to log a collection. Read-only for your role."
            : "Pin the exact location where collections must happen. The geofence radius controls how strict the GPS gate is in the field."}
        </DialogDescription>
      </DialogHeader>

      <form
        className="grid gap-5 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (readOnly) return;
          mutation.mutate();
        }}
      >
        <fieldset disabled={readOnly} className="contents">
          <div className="space-y-4 md:col-span-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label htmlFor="c-name">Name</Label>
                <Input
                  id="c-name"
                  required
                  readOnly={readOnly}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-code">Code</Label>
                <Input
                  id="c-code"
                  readOnly={readOnly}
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-phone">Phone</Label>
                <Input
                  id="c-phone"
                  readOnly={readOnly}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="c-address">Address</Label>
                <Input
                  id="c-address"
                  readOnly={readOnly}
                  value={form.address}
                  onChange={(e) =>
                    setForm({ ...form, address: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="c-email">Email (optional)</Label>
                <Input
                  id="c-email"
                  type="email"
                  readOnly={readOnly}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="c-outstanding">Outstanding balance (₹)</Label>
                <Input
                  id="c-outstanding"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  readOnly={readOnly}
                  value={form.outstandingBalance}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      outstandingBalance: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="c-assigned-agent">Assigned agent</Label>
                {readOnly ? (
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    {initial?.assignedAgentId ? "Assigned to you" : "Unassigned"}
                  </div>
                ) : (
                  <select
                    id="c-assigned-agent"
                    value={form.assignedAgentId}
                    onChange={(e) =>
                      setForm({ ...form, assignedAgentId: e.target.value })
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="">Unassigned</option>
                    {assignableAgents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                        {agent.agentCode ? ` (${agent.agentCode})` : ""}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-xs text-muted-foreground">
                  Only the assigned field agent will see this store in the
                  Android app or be allowed to record a collection.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="c-radius">Geofence radius</Label>
                <span className="font-mono text-sm tabular-nums">
                  {form.geofenceRadiusM} m
                </span>
              </div>
              <input
                id="c-radius"
                type="range"
                min={50}
                max={500}
                step={10}
                disabled={readOnly}
                value={form.geofenceRadiusM}
                onChange={(e) =>
                  setForm({
                    ...form,
                    geofenceRadiusM: Number(e.target.value),
                  })
                }
                className="w-full accent-primary disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="text-xs text-muted-foreground">
                {readOnly
                  ? "Agents must be inside this radius to log a collection."
                  : "Agent must be inside this radius to log a collection."}
              </p>
            </div>

            <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs font-mono">
              <span className="text-muted-foreground">lat</span>
              <span className="tabular-nums">{form.lat.toFixed(6)}</span>
              <span className="ml-3 text-muted-foreground">lng</span>
              <span className="tabular-nums">{form.lng.toFixed(6)}</span>
            </div>
          </div>

          <div className="space-y-2 md:col-span-1">
            <Label>{readOnly ? "Pinned location" : "Pin location"}</Label>
            <CustomerMapPicker
              value={{ lat: form.lat, lng: form.lng }}
              radiusM={form.geofenceRadiusM}
              address={form.address}
              readOnly={readOnly}
              onAddressChange={(a) => setForm((f) => ({ ...f, address: a }))}
              onChange={(p) =>
                setForm((f) => ({ ...f, lat: p.lat, lng: p.lng }))
              }
            />
          </div>
        </fieldset>

        <DialogFooter className="md:col-span-2 sm:flex-row sm:items-center sm:justify-between">
          {mode !== "create" && initial ? (
            <LedgerExportActions customerId={initial.id} customerName={initial.name} />
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {readOnly ? (
              <Button type="button" onClick={onClose}>
                Close
              </Button>
            ) : (
              <>
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
                  {mode === "create" ? "Create customer" : "Save changes"}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/**
 * Phase 10 / Track C3 - inline ledger exports.
 *
 * Both buttons hit `GET /api/customers/{id}/ledger?format=...` over
 * `same-origin` fetch (the JWT cookie is httpOnly, so a plain anchor
 * link would still work, but a fetch + blob round-trip lets us
 * surface API errors as a toast instead of dumping JSON in a new tab).
 */
function LedgerExportActions({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const [busy, setBusy] = React.useState<null | "csv" | "pdf">(null);

  async function download(format: "csv" | "pdf") {
    setBusy(format);
    try {
      const res = await fetch(
        `/api/customers/${customerId}/ledger?format=${format}`,
        { credentials: "same-origin" },
      );
      if (!res.ok) {
        const text = await res.text();
        let msg = "Export failed";
        try {
          const parsed = JSON.parse(text);
          msg = parsed?.error?.message ?? parsed?.error ?? msg;
        } catch {
          msg = text || msg;
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const safeName =
        customerName.replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 40) || "customer";
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}-ledger.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Ledger ${format.toUpperCase()} downloaded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="hidden sm:inline-flex items-center gap-1.5">
        <Download className="size-3.5" />
        Ledger
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!!busy}
        onClick={() => download("csv")}
      >
        {busy === "csv" ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <FileSpreadsheet className="size-3.5" />
        )}
        CSV
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!!busy}
        onClick={() => download("pdf")}
      >
        {busy === "pdf" ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <FileText className="size-3.5" />
        )}
        PDF
      </Button>
    </div>
  );
}
