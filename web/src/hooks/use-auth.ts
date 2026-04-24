"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { api } from "@/lib/api";
import {
  useAuthStore,
  type AuthUser,
  type AuthTenant,
} from "@/stores/auth-store";

type MeResponse = {
  user: AuthUser;
  tenant: AuthTenant;
};

export function useMe() {
  const setSession = useAuthStore((s) => s.setSession);
  const clear = useAuthStore((s) => s.clear);

  const query = useQuery<MeResponse>({
    queryKey: ["me"],
    queryFn: async () => api<MeResponse>("/api/me"),
    retry: false,
  });

  useEffect(() => {
    if (query.data) {
      setSession(query.data.user, query.data.tenant);
    } else if (query.isError) {
      clear();
    }
  }, [query.data, query.isError, setSession, clear]);

  return query;
}

export function useLogin() {
  const qc = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      return api<{
        user: AuthUser & { tenantSlug: string };
        expiresIn: number;
      }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.push("/dashboard");
      router.refresh();
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  const clear = useAuthStore((s) => s.clear);

  return useMutation({
    mutationFn: async () =>
      api("/api/auth/logout", { method: "POST", body: "{}" }),
    onSettled: () => {
      clear();
      qc.clear();
      router.push("/login");
      router.refresh();
    },
  });
}
