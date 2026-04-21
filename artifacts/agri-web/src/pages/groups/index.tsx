import { useState } from "react";
import { useListGroups } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { Users, MapPin, ChevronRight, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

export default function GroupsList() {
  const { data: groups, isLoading } = useListGroups({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", regionId: "", village: "" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: regions } = useQuery<any[]>({
    queryKey: ["/api/admin/regions"],
    queryFn: () => fetch(`${API_BASE}/api/admin/regions`).then(r => r.json()),
  });

  const createMut = useMutation({
    mutationFn: (body: any) => fetch(`${API_BASE}/api/groups`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({ title: "Group created" });
      setOpen(false);
      setForm({ name: "", regionId: "", village: "" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Farmer Groups</h1>
          <p className="text-muted-foreground mt-1">Cooperative groups and their compliance scores</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{isLoading ? "..." : (groups?.length ?? 0)} groups</Badge>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" data-testid="add-group-btn"><Plus className="h-4 w-4" /> New Group</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Farmer Group</DialogTitle>
                <DialogDescription>Cooperative groups link farmers to a region and village.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div><Label>Group Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kibaale Coffee Cooperative" data-testid="input-name" /></div>
                <div>
                  <Label>Region *</Label>
                  <Select value={form.regionId} onValueChange={v => setForm({ ...form, regionId: v })}>
                    <SelectTrigger data-testid="input-region"><SelectValue placeholder="Select region" /></SelectTrigger>
                    <SelectContent>
                      {regions?.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Village</Label><Input value={form.village} onChange={e => setForm({ ...form, village: e.target.value })} data-testid="input-village" /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => { const name = form.name.trim(); const village = form.village.trim(); if (!name || !form.regionId) { toast({ title: "Name and region required", variant: "destructive" }); return; } const body: any = { name, regionId: form.regionId }; if (village) body.village = village; createMut.mutate(body); }} disabled={createMut.isPending} data-testid="submit-group">{createMut.isPending ? "Saving..." : "Create"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      ) : groups && groups.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((group) => (
            <Link key={group.id} href={`/groups/${group.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer" data-testid={`group-card-${group.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg">{group.name}</CardTitle>
                    <ChevronRight className="h-4 w-4 text-muted-foreground mt-1" />
                  </div>
                  {group.village && (
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="h-3 w-3" /><span>{group.village}</span>
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 pt-2 border-t">
                    <div><p className="text-xs text-muted-foreground">Members</p><p className="font-semibold flex items-center gap-1"><Users className="h-3 w-3" />{group.memberCount ?? 0}</p></div>
                    <div><p className="text-xs text-muted-foreground">Active Plots</p><p className="font-semibold">{group.activePlots ?? 0}</p></div>
                    <div><p className="text-xs text-muted-foreground">Compliance</p><p className={`font-semibold ${(group.complianceScore ?? 0) >= 0.8 ? "text-green-600" : "text-amber-600"}`}>{(((group.complianceScore ?? 0)) * 100).toFixed(0)}%</p></div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="py-16 text-center text-muted-foreground">No groups found</div>
      )}
    </div>
  );
}
