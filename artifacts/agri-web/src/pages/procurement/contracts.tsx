import { useState } from "react";
import {
  useListProcurementContracts,
  useCreateProcurementContract,
  useUpdateProcurementContract,
  useListGroups,
  customFetch,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil } from "lucide-react";

type Fulfillment = { contractId: string; targetKg: number | null; deliveredKg: number; remainingKg: number | null; deliveryCount: number };

// Tiny inline cell that shows "X / Y kg" + a progress bar when the contract has
// a target. We fetch per-row because there's no server-side bulk endpoint yet
// and contract counts here are small. Cached for 30s so toggling status doesn't
// re-thrash the API.
function FulfillmentCell({ contractId }: { contractId: string }) {
  const { data } = useQuery<Fulfillment>({
    queryKey: ["/api/procurement/contracts", contractId, "fulfillment"],
    queryFn: () => customFetch<Fulfillment>(`${API_BASE}/api/procurement/contracts/${contractId}/fulfillment`),
    staleTime: 30_000,
  });
  if (!data) return <span className="text-muted-foreground text-sm">—</span>;
  const delivered = Number(data.deliveredKg ?? 0);
  if (data.targetKg == null) {
    return <span className="text-sm">{delivered.toLocaleString()} kg <span className="text-muted-foreground">delivered</span></span>;
  }
  const pct = data.targetKg > 0 ? Math.min(100, Math.round((delivered / data.targetKg) * 100)) : 0;
  return (
    <div className="space-y-1 min-w-[140px]">
      <div className="flex justify-between text-xs">
        <span className="font-medium">{delivered.toLocaleString()} kg</span>
        <span className="text-muted-foreground">/ {Number(data.targetKg).toLocaleString()} kg</span>
      </div>
      <Progress value={pct} className="h-1.5" />
      <div className="text-[10px] text-muted-foreground">{pct}% · {data.deliveryCount} {data.deliveryCount === 1 ? "delivery" : "deliveries"}</div>
    </div>
  );
}

function TargetEditor({ contract, onSaved }: { contract: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(contract.targetVolumeKg != null ? String(contract.targetVolumeKg) : "");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  async function save() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { targetVolumeKg: val ? Number(val) : null };
      await customFetch(`${API_BASE}/api/procurement/contracts/${contract.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      toast({ title: "Target updated" });
      setOpen(false);
      onSaved();
    } catch (e: any) {
      toast({ title: e?.message ?? "Failed", variant: "destructive" });
    } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2" data-testid={`edit-target-${contract.id}`}><Pencil className="h-3 w-3" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Fulfillment target</DialogTitle><DialogDescription>Set a tonnage target so the dashboard can track progress. Leave blank for an open-ended contract.</DialogDescription></DialogHeader>
        <div><Label>Target volume (kg)</Label><Input value={val} onChange={e => setVal(e.target.value)} placeholder="e.g. 5000" data-testid={`target-input-${contract.id}`} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy} data-testid={`save-target-${contract.id}`}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

const statusVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ACTIVE: "default", DRAFT: "secondary", EXPIRED: "outline", SUSPENDED: "destructive",
};

export default function ProcurementContractsPage() {
  const { data: contracts, isLoading, refetch } = useListProcurementContracts({});
  const { data: groupsData } = useListGroups({});
  const groups = Array.isArray(groupsData) ? groupsData : [];
  const { data: commoditiesData } = useQuery<any[]>({
    queryKey: ["/api/commodities"],
    queryFn: () => customFetch<any[]>(`${API_BASE}/api/commodities`),
  });
  const commodities = Array.isArray(commoditiesData) ? commoditiesData : [];
  const createMut = useCreateProcurementContract();
  const updateMut = useUpdateProcurementContract();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    contractType: "PRE_SEASON",
    groupId: "",
    commodityType: "",
    seasonStart: "",
    seasonEnd: "",
    floorPricePerKg: "",
    targetVolumeKg: "",
    notes: "",
    status: "ACTIVE",
  });

  async function handleCreate() {
    if (!form.groupId || !form.commodityType) {
      toast({ title: "Group and commodity required", variant: "destructive" });
      return;
    }
    try {
      // targetVolumeKg isn't in the codegen yet; cast through `any` so it survives the call.
      await createMut.mutateAsync({
        data: {
          contractType: form.contractType as any,
          groupId: form.groupId,
          commodityType: form.commodityType,
          seasonStart: form.seasonStart || undefined,
          seasonEnd: form.seasonEnd || undefined,
          floorPricePerKg: form.floorPricePerKg ? Number(form.floorPricePerKg) : undefined,
          targetVolumeKg: form.targetVolumeKg ? Number(form.targetVolumeKg) : undefined,
          notes: form.notes || undefined,
          status: form.status as any,
        } as any,
      });
      toast({ title: "Contract created" });
      setOpen(false);
      setForm({ contractType: "PRE_SEASON", groupId: "", commodityType: "", seasonStart: "", seasonEnd: "", floorPricePerKg: "", targetVolumeKg: "", notes: "", status: "ACTIVE" });
      refetch();
    } catch (e: any) {
      toast({ title: e?.response?.data?.error ?? e?.message ?? "Failed", variant: "destructive" });
    }
  }

  async function setStatus(id: string, status: string) {
    try {
      await updateMut.mutateAsync({ contractId: id, data: { status: status as any } });
      refetch();
    } catch (e: any) {
      toast({ title: e?.response?.data?.error ?? "Failed", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Procurement Contracts</h1>
          <p className="text-muted-foreground mt-1">Pre-season agreements with farmer groups. Active contracts enforce a floor price at pricing.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" data-testid="new-contract-btn"><Plus className="h-4 w-4" /> New Contract</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New procurement contract</DialogTitle>
              <DialogDescription>Pre-season contracts carry a floor price that proposals must respect.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Type</Label>
                <Select value={form.contractType} onValueChange={v => setForm({ ...form, contractType: v })}>
                  <SelectTrigger data-testid="contract-type-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PRE_SEASON">Pre-season</SelectItem>
                    <SelectItem value="PER_DELIVERY">Per delivery</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Farmer group</Label>
                <Select value={form.groupId} onValueChange={v => setForm({ ...form, groupId: v })}>
                  <SelectTrigger data-testid="contract-group-select"><SelectValue placeholder="Select group" /></SelectTrigger>
                  <SelectContent>
                    {groups.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Commodity</Label>
                <Select value={form.commodityType} onValueChange={v => setForm({ ...form, commodityType: v })}>
                  <SelectTrigger data-testid="contract-commodity-select"><SelectValue placeholder={commodities.length ? "Select commodity" : "No commodities — add one in Commodity Master"} /></SelectTrigger>
                  <SelectContent>
                    {commodities.map((c: any) => (
                      <SelectItem key={c.id} value={c.code}>{c.name} ({c.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Season start</Label><Input type="date" value={form.seasonStart} onChange={e => setForm({ ...form, seasonStart: e.target.value })} data-testid="contract-start-input" /></div>
                <div><Label>Season end</Label><Input type="date" value={form.seasonEnd} onChange={e => setForm({ ...form, seasonEnd: e.target.value })} data-testid="contract-end-input" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Floor price per kg (UGX)</Label>
                  <Input value={form.floorPricePerKg} onChange={e => setForm({ ...form, floorPricePerKg: e.target.value })} placeholder="0.00" data-testid="contract-floor-input" />
                </div>
                <div>
                  <Label>Target volume (kg)</Label>
                  <Input value={form.targetVolumeKg} onChange={e => setForm({ ...form, targetVolumeKg: e.target.value })} placeholder="Optional" data-testid="contract-target-input" />
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional" />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger data-testid="contract-status-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                    <SelectItem value="ACTIVE">Active (enforces floor)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createMut.isPending} data-testid="create-contract-submit">{createMut.isPending ? "Saving..." : "Create"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contract #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Commodity</TableHead>
                  <TableHead>Season</TableHead>
                  <TableHead>Floor / kg</TableHead>
                  <TableHead>Fulfillment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts && contracts.length > 0 ? contracts.map(c => (
                  <TableRow key={c.id} data-testid={`contract-row-${c.id}`}>
                    <TableCell className="font-mono text-sm">{c.contractNumber}</TableCell>
                    <TableCell>{c.contractType}</TableCell>
                    <TableCell>{c.groupName ?? <span className="text-muted-foreground text-sm">—</span>}</TableCell>
                    <TableCell>{c.commodityType}</TableCell>
                    <TableCell className="text-sm">{c.seasonStart ?? "—"} → {c.seasonEnd ?? "—"}</TableCell>
                    <TableCell>{c.floorPricePerKg != null ? `UGX ${Number(c.floorPricePerKg).toLocaleString()}` : <span className="text-muted-foreground text-sm">—</span>}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <FulfillmentCell contractId={c.id} />
                        <TargetEditor contract={c} onSaved={refetch} />
                      </div>
                    </TableCell>
                    <TableCell><Badge variant={statusVariants[c.status] ?? "secondary"}>{c.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {c.status === "DRAFT" && <Button size="sm" variant="outline" onClick={() => setStatus(c.id, "ACTIVE")} data-testid={`activate-${c.id}`}>Activate</Button>}
                      {c.status === "ACTIVE" && <Button size="sm" variant="outline" onClick={() => setStatus(c.id, "SUSPENDED")} data-testid={`suspend-${c.id}`}>Suspend</Button>}
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={9} className="py-12 text-center text-muted-foreground">No contracts yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
