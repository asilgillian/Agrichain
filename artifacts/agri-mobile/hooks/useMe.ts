import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";

export type AuthedUser = {
  id: string;
  clerkUserId: string;
  email: string;
  role: string;
  permissions: string[];
};

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ??
  (process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/api-server`
    : "");

// Fetches the current user's role + permissions from the API. Mobile uses Bearer
// auth (vs. cookie auth on web), so we attach the Clerk session token explicitly.
// Permissions are resolved fresh on every request server-side, so an admin granting
// access takes effect on the next refetch.
export function useMe(): {
  me: AuthedUser | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const { isSignedIn, getToken } = useAuth();

  const { data, isLoading, isError, refetch } = useQuery<AuthedUser>({
    queryKey: ["/api/me", isSignedIn],
    enabled: !!isSignedIn,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const r = await fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`Failed to load /api/me (${r.status})`);
      return r.json();
    },
  });

  return { me: data, isLoading, isError, refetch: () => void refetch() };
}
