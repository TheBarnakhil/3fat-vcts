"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, LoaderCircle, Save, X } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, isApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

type Branding = {
  legalName?: string;
  address?: string;
  gstin?: string;
  phone?: string;
  logoUrl?: string;
  accentHsl?: string;
};

type TenantResponse = {
  tenant: {
    id: string;
    slug: string;
    name: string;
    branding: Branding;
  };
};

type PresignResponse = {
  url: string;
  key: string;
  method: "PUT";
  headers: Record<string, string>;
};

export default function BrandingPage() {
  const user = useAuthStore((s) => s.user);
  const tenantStore = useAuthStore((s) => s.tenant);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["tenant", "me"],
    queryFn: () => api<TenantResponse>("/api/tenants/me"),
  });

  // Lazy draft pattern: until the user edits anything, render straight
  // from the server response. Once they touch a field the draft "owns"
  // the form. This avoids the React-Compiler `setState-in-effect` lint
  // warning *and* keeps the form in sync if the query refetches.
  const [editedDraft, setEditedDraft] = React.useState<Branding | null>(null);
  const draft: Branding = editedDraft ?? data?.tenant.branding ?? {};
  const setDraft = (next: Branding) => setEditedDraft(next);
  const [logoFile, setLogoFile] = React.useState<File | null>(null);
  const [logoPreview, setLogoPreview] = React.useState<string | null>(null);

  const onLogoSelected = (file: File | null) => {
    setLogoFile(file);
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    if (file) {
      setLogoPreview(URL.createObjectURL(file));
    } else {
      setLogoPreview(null);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      let logoUrl = draft.logoUrl ?? null;
      if (logoFile) {
        const presign = await api<PresignResponse>(
          "/api/tenants/me/branding/logo/presign",
          {
            method: "POST",
            body: JSON.stringify({ contentType: logoFile.type || "image/png" }),
          },
        );
        const putRes = await fetch(presign.url, {
          method: "PUT",
          body: logoFile,
          headers: presign.headers,
        });
        if (!putRes.ok) {
          throw new Error(
            `Logo upload failed (${putRes.status} ${putRes.statusText}). Check R2 settings.`,
          );
        }
        logoUrl = presign.key;
      }
      const next: Branding = { ...draft, logoUrl: logoUrl ?? undefined };
      const res = await api<TenantResponse>("/api/tenants/me", {
        method: "PATCH",
        body: JSON.stringify({ branding: next }),
      });
      return res;
    },
    onSuccess: (res) => {
      qc.setQueryData(["tenant", "me"], res);
      onLogoSelected(null);
      setEditedDraft(null); // resync to server response
      toast.success("Branding saved.");
    },
    onError: (err) => {
      const msg = isApiError(err) ? err.message : (err as Error).message;
      toast.error(msg);
    },
  });

  const isReadonly = user?.role !== "super_admin";

  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <LoaderCircle className="mr-2 size-5 animate-spin" />
        Loading branding...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branding"
        description="Tune the legal block, GSTIN and logo that appear on every receipt and verification page."
      />

      {isReadonly ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Only super admins can edit branding. Ask{" "}
            <span className="font-medium text-foreground">
              {tenantStore?.name ?? "your admin"}
            </span>{" "}
            to update these fields.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Receipt header</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Legal name"
              hint="Full registered name printed on every receipt."
            >
              <Input
                value={draft.legalName ?? ""}
                onChange={(e) => setDraft({ ...draft, legalName: e.target.value })}
                placeholder="Acme Distributors Pvt. Ltd."
                disabled={isReadonly}
              />
            </Field>
            <Field label="Address">
              <Input
                value={draft.address ?? ""}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                placeholder="Plot 1, MG Road, Bengaluru 560001"
                disabled={isReadonly}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="GSTIN">
                <Input
                  value={draft.gstin ?? ""}
                  onChange={(e) => setDraft({ ...draft, gstin: e.target.value })}
                  placeholder="29AABCU9603R1ZJ"
                  disabled={isReadonly}
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={draft.phone ?? ""}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                  placeholder="+91-9876543210"
                  disabled={isReadonly}
                />
              </Field>
            </div>
            <Field
              label="Accent (HSL)"
              hint="Three space-separated values, e.g. 221 83% 53%. Drives the receipt + verify-page accent."
            >
              <Input
                value={draft.accentHsl ?? ""}
                onChange={(e) => setDraft({ ...draft, accentHsl: e.target.value })}
                placeholder="221 83% 53%"
                disabled={isReadonly}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Logo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <LogoPreview
              draftLogoUrl={draft.logoUrl}
              draftPreview={logoPreview}
              fallback={data.tenant.name.slice(0, 1).toUpperCase()}
            />

            <Label className="block text-xs text-muted-foreground">
              Upload a transparent PNG (recommended) or JPEG. Max 1 MB.
            </Label>
            <div className="flex items-center gap-2">
              <label
                className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm hover:bg-muted/50"
              >
                <ImagePlus className="size-4" />
                <span>{logoFile ? logoFile.name : "Choose file"}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  disabled={isReadonly}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    if (file && file.size > 1024 * 1024) {
                      toast.error("Logo must be ≤ 1 MB");
                      return;
                    }
                    onLogoSelected(file);
                  }}
                />
              </label>
              {logoFile ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onLogoSelected(null)}
                  aria-label="Clear selection"
                >
                  <X className="size-4" />
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Stored at{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">
                t/{data.tenant.slug}/branding/logo.png
              </code>
              . Receipts re-fetch on every render so updates appear immediately.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => save.mutate()}
          disabled={isReadonly || save.isPending}
          className="gap-2"
        >
          {save.isPending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Save branding
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function LogoPreview({
  draftLogoUrl,
  draftPreview,
  fallback,
}: {
  draftLogoUrl?: string;
  draftPreview: string | null;
  fallback: string;
}) {
  // Existing R2 keys aren't reachable from the browser; only direct URLs
  // and the in-flight blob preview render here. The canonical receipt
  // always re-fetches the freshly uploaded bytes server-side.
  const src = draftPreview
    ? draftPreview
    : draftLogoUrl && /^https?:/i.test(draftLogoUrl)
      ? draftLogoUrl
      : null;
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt="Logo preview"
        className="h-32 w-full rounded-md border bg-white object-contain p-3"
      />
    );
  }
  return (
    <div className="flex h-32 w-full items-center justify-center rounded-md border bg-muted/30 text-3xl font-bold text-muted-foreground">
      {fallback}
    </div>
  );
}
