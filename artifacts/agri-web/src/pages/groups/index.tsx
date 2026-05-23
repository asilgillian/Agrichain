import { useMemo, useState } from "react";
import { useListGroups, useListRegions, customFetch } from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "wouter";
import { Users, MapPin, ChevronRight, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

export default function GroupsList() {
  const { data: groups, isLoading } = useListGroups({});
  const { data: regions } = useListRegions();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ name: string; districtIds: string[]; village: string }>({ name: "", districtIds: [], village: "" });
  const [filter, setFilter] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const districts = useMemo(
    () => (regions ?? []).filter((r: any) => r.level === 1 && (r.countryCode ?? "UG") === "UG")
      .sort((a: any, b: any) => a.name.localeCompare(b.name)),
    [regions],
  );
  const filteredDistricts = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? districts.filter((d: any) => d.name.toLowerCase().includes(q)) : districts;
  }, [districts, filter]);

  const createMut = useMutation({
    mutationFn: (body: any) => customFetch(`${API_BASE}/api/groups`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({ title: "Group created" });
      setOpen(false);
      setForm({ name: "", districtIds: [], village: "" });
      setFilter("");
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const canSubmit = !!form.name.trim() && form.districtIds.length > 0;

  const toggleDistrict = (id: string) => {
    setForm(f => ({
      ...f,
      districtIds: f.districtIds.includes(id)
        ? f.districtIds.filter(x => x !== id)
        : [...f.districtIds, id],
    }));
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Farmer Groups</h1>
          <p className="text-muted-foreground mt-1">Cooperative groups and their compliance scores</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{isLoading ? "..." : (groups?.length ?? 0)} groups</Badge>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setFilter(""); }}>
            <DialogTrigger asChild>
              <Button className="gap-2" data-testid="add-group-btn"><Plus className="h-4 w-4" /> New Group</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Farmer Group</DialogTitle>
                <DialogDescription>A group can cover one or more districts. Tick every district where its members live.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Group Name *</Label>
                  <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kibaale Coffee Cooperative" data-testid="input-name" />
                </div>
                <div>
                  <Label className="mb-1 block">Districts covered *</Label>
                  {form.districtIds.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2" data-testid="selected-districts">
                      {form.districtIds.map(id => {
                        const d = districts.find((x: any) => x.id === id);
                        return (
                          <Badge key={id} variant="secondary" className="gap-1">
                            {d?.name ?? id.slice(0, 6)}
                            <button type="button" onClick={() => toggleDistrict(id)} data-testid={`remove-district-${id}`} className="hover:text-destructive">
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                  <Input
                    placeholder="Search districts..."
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    data-testid="district-search"
                    className="mb-2"
                  />
                  <div className="max-h-48 overflow-y-auto border rounded-md p-2 space-y-1">
                    {filteredDistricts.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-2 text-center">No districts found</p>
                    ) : filteredDistricts.map((d: any) => (
                      <label key={d.id} className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded cursor-pointer" data-testid={`district-row-${d.id}`}>
                        <Checkbox
                          checked={form.districtIds.includes(d.id)}
                          onCheckedChange={() => toggleDistrict(d.id)}
                        />
                        <span className="text-sm">{d.name}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {form.districtIds.length} district{form.districtIds.length === 1 ? "" : "s"} selected
                  </p>
                </div>
                <div>
                  <Label>Village name (free text, optional)</Label>
                  <Input value={form.village} onChange={e => setForm({ ...form, village: e.target.value })} placeholder="Primary village if applicable" data-testid="input-village" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => {
                    const name = form.name.trim();
                    const village = form.village.trim();
                    if (!canSubmit) {
                      toast({ title: !form.name.trim() ? "Group name required" : "Pick at least one district", variant: "destructive" });
                      return;
                    }
                    const body: any = { name, districtIds: form.districtIds };
                    if (village) body.village = village;
                    createMut.mutate(body);
                  }}
                  disabled={createMut.isPending || !canSubmit}
                  data-testid="submit-group"
                >
                  {createMut.isPending ? "Saving..." : "Create"}
                </Button>
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
          {groups.map((group: any) => {
            const districtNames = (group.districts ?? []).map((d: any) => d.name).filter(Boolean);
            return (
              <Link key={group.id} href={`/groups/${group.id}`}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer" data-testid={`group-card-${group.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-lg">{group.name}</CardTitle>
                      <ChevronRight className="h-4 w-4 text-muted-foreground mt-1" />
                    </div>
                    {districtNames.length > 0 && (
                      <div className="flex items-start gap-1 text-sm text-muted-foreground">
                        <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                        <span className="line-clamp-2">{districtNames.join(", ")}</span>
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
            );
          })}
        </div>
      ) : (
        <div className="py-16 text-center text-muted-foreground">No groups found</div>
      )}
    </div>
  );
}
