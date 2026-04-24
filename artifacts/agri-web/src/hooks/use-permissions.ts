import { useQuery } from "@tanstack/react-query";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export type AuthedUser = {
  id: string;
  clerkUserId: string;
  email: string;
  role: string;
  permissions: string[];
};

// Fetches the current user's role + permission set from the API. The API resolves permissions
// fresh on every request, so a permission change made by an admin takes effect on the next
// page load (per spec).
export function useMe(): {
  me: AuthedUser | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery<AuthedUser>({
    queryKey: ["/api/me"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/me`);
      if (!r.ok) throw new Error(`Failed to load /api/me (${r.status})`);
      return r.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  return { me: data, isLoading, isError };
}

// Returns helpers for permission checks. Wildcard "*" grants every permission. When the user
// data is still loading, `has` returns false so UI defaults to hidden — fail-closed.
export function usePermissions() {
  const { me, isLoading } = useMe();
  const set = new Set(me?.permissions ?? []);
  const has = (key: string): boolean => {
    if (!me) return false;
    if (set.has("*")) return true;
    return set.has(key);
  };
  // hasAny: true if the user has at least one of the supplied permissions.
  const hasAny = (keys: string[]): boolean => {
    if (!me) return false;
    if (set.has("*")) return true;
    return keys.some((k) => set.has(k));
  };
  return { me, isLoading, has, hasAny, all: me?.permissions ?? [] };
}
