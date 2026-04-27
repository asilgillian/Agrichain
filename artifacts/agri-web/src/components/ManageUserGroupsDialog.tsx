import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useListGroups } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

type Group = {
  id: string;
  name: string;
  regionId: string;
  village?: string | null;
  status: string;
};

type Region = { id: string; name: string; parentId: string | null; level: number | null };

interface Props {
  user: { id: string; firstName: string; lastName: string; email: string; role: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Multi-select dialog letting an admin pick which farmer groups a user is
 * assigned to. Only users with the `groups.assigned_only` permission are
 * actually scoped on the server side, but the UI is available for any user
 * (so an admin can pre-assign before granting the permission).
 */
export function ManageUserGroupsDialog({ user, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const { data: allGroups, isLoading: groupsLoading } = useListGroups({});
  const { data: regions } = useQuery<Region[]>({
    queryKey: ["/api/admin/regions"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/admin/regions`);
      if (!r.ok) throw new Error(`Failed to load regions (${r.status})`);
      return r.json();
    },
  });

  // Fetch the user's current assignments when the dialog opens.
  const { data: assigned, isLoading: assignedLoading } = useQuery<{ id: string }[]>({
    queryKey: ["/api/users", user?.id, "groups"],
    enabled: !!user?.id && open,
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/users/${user!.id}/groups`);
      if (!r.ok) throw new Error(`Failed to load assignments (${r.status})`);
      return r.json();
    },
  });

  // Sync `selected` from server when (re)opened or assignments arrive.
  useEffect(() => {
    if (open && assigned) {
      setSelected(new Set(assigned.map(a => a.id)));
    }
    if (!open) {
      setQuery("");
    }
  }, [open, assigned]);

  // Build region path string ("Wakiso District / Kasanje Sub-county / Buwaya Parish / Buwaya Village").
  const pathFor = useMemo(() => {
    const byId = new Map<string, Region>();
    (regions ?? []).forEach(r => byId.set(r.id, r));
    return (regionId: string): string => {
      const parts: string[] = [];
      let cur: Region | undefined = byId.get(regionId);
      while (cur) {
        parts.unshift(cur.name);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      return parts.join(" / ");
    };
  }, [regions]);

  const filtered = useMemo(() => {
    const list = ((allGroups ?? []) as unknown as Group[]).filter(g => g.status !== "archived");
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(g => {
      const path = pathFor(g.regionId).toLowerCase();
      return g.name.toLowerCase().includes(q) || path.includes(q);
    });
  }, [allGroups, query, pathFor]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/api/users/${user!.id}/groups`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupIds: Array.from(selected) }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? `Save failed (${r.status})`);
      }
      return r.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/users", user?.id, "groups"] });
      qc.invalidateQueries({ queryKey: ["/api/users-group-counts"] });
      toast({ title: "Assignments saved", description: `${data.count} group(s) assigned to ${user?.firstName}` });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage groups for {user.firstName} {user.lastName}</DialogTitle>
          <DialogDescription>
            {user.role} · {user.email}<br />
            Pick the farmer groups this user can access on the mobile app. Users without the
            <code className="text-xs px-1 mx-1 rounded bg-muted">groups.assigned_only</code>
            permission can see everything regardless.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by group name or admin path…"
              className="pl-8"
              data-testid="search-groups"
            />
          </div>

          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span data-testid="selected-count"><Check className="h-3 w-3 inline -mt-0.5 mr-1" />{selected.size} selected</span>
            <span>·</span>
            <span>{filtered.length} group(s) shown</span>
          </div>

          <ScrollArea className="h-80 rounded-md border">
            <div className="p-2 space-y-1">
              {(groupsLoading || assignedLoading) ? (
                [1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full" />)
              ) : filtered.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {query ? "No groups match your search" : "No groups available"}
                </div>
              ) : (
                filtered.map(g => {
                  const path = pathFor(g.regionId);
                  const checked = selected.has(g.id);
                  return (
                    <label
                      key={g.id}
                      className={`flex items-start gap-3 p-2 rounded-md cursor-pointer hover:bg-muted/40 ${checked ? "bg-muted/30" : ""}`}
                      data-testid={`group-row-${g.id}`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggle(g.id)}
                        data-testid={`group-checkbox-${g.id}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{g.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{path || "—"}</div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} data-testid="save-assignments">
            {saveMut.isPending ? "Saving…" : `Save (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
