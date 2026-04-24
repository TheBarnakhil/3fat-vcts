"use client";

import { create } from "zustand";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: "super_admin" | "manager" | "agent";
  tenantId: string;
  agentCode: string | null;
  lastLoginAt: string | null;
};

export type AuthTenant = {
  id: string;
  slug: string;
  name?: string;
  accentHsl?: string | null;
};

interface AuthState {
  user: AuthUser | null;
  tenant: AuthTenant | null;
  status: "loading" | "authenticated" | "unauthenticated";
  setSession: (user: AuthUser, tenant: AuthTenant) => void;
  clear: () => void;
  setStatus: (status: AuthState["status"]) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  tenant: null,
  status: "loading",
  setSession: (user, tenant) =>
    set({ user, tenant, status: "authenticated" }),
  clear: () => set({ user: null, tenant: null, status: "unauthenticated" }),
  setStatus: (status) => set({ status }),
}));
