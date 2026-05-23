import { useState } from "react";
import { useListGroups, customFetch } from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { Users, MapPin, ChevronRight, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { RegionPicker } from "@/components/RegionPicker";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

export default function GroupsList() {
  const { data: groups, isLoading } = useListGroups({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", regionId: "", village: "" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const createMut = useMutation({
    mutationFn: (body: any) => customFetch(`${API_BASE}/api/groups`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({ title: "Group created" });
      setOpen(false);
      setForm({ name: "", regionId: "", village: "" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // Anchor may be at District level or deeper — the server enforces the actual
  // floor. We only require name + a picked region here.
  const canSubmit = !!form.name.trim() && !!form.regionId;

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
                <DialogDescription>Anchor the group to any admin unit from District down to Village — pick as specific as you can.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div><Label>Group Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kibaale Coffee Cooperative" data-testid="input-name" /></div>
                <div>
                  <Label className="mb-1 block">Administrative unit *</Label>
                  <RegionPicker
                    value={form.regionId}
                    onChange={v => setForm({ ...form, regionId: v })}
                    country="UG"
                    required
                    testIdPrefix="input-region"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Pick at any level from District downward. Drilling deeper makes farmer transfers and reporting more precise.
                  </p>
                </div>
                <div><Label>Village name (free text, optional)</Label><Input value={form.village} onChange={e => setForm({ ...form, village: e.target.value })} placeholder="Only if different from the picked admin unit" data-testid="input-village" /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => { const name = form.name.trim(); const village = form.village.trim(); if (!canSubmit) { toast({ title: !form.name.trim() ? "Group name required" : "Region required", variant: "destructive" }); return; } const body: any = { name, regionId: form.regionId }; if (village) body.village = village; createMut.mutate(body); }} disabled={createMut.isPending || !canSubmit} data-testid="submit-group">{createMut.isPending ? "Saving..." : "Create"}</Button>
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
