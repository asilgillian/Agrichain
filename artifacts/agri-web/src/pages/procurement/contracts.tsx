import { useState } from "react";
import {
  useListProcurementContracts,
  useCreateProcurementContract,
  useUpdateProcurementContract,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

const statusVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ACTIVE: "default", DRAFT: "secondary", EXPIRED: "outline", SUSPENDED: "destructive",
};

export default function ProcurementContractsPage() {
  const { data: contracts, isLoading, refetch } = useListProcurementContracts({});
  const { data: groups } = useQuery<any[]>({
    queryKey: ["/api/groups"],
    queryFn: () => fetch(`${API_BASE}/api/groups`).then(r => r.json()),
  });
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
    notes: "",
    status: "ACTIVE",
  });

  async function handleCreate() {
    if (!form.groupId || !form.commodityType) {
      toast({ title: "Group and commodity required", variant: "destructive" });
      return;
    }
    try {
      await createMut.mutateAsync({
        data: {
          contractType: form.contractType as any,
          groupId: form.groupId,
          commodityType: form.commodityType,
          seasonStart: form.seasonStart || undefined,
          seasonEnd: form.seasonEnd || undefined,
          floorPricePerKg: form.floorPricePerKg ? Number(form.floorPricePerKg) : undefined,
          notes: form.notes || undefined,
          status: form.status as any,
        },
      });
      toast({ title: "Contract created" });
      setOpen(false);
      setForm({ contractType: "PRE_SEASON", groupId: "", commodityType: "", seasonStart: "", seasonEnd: "", floorPricePerKg: "", notes: "", status: "ACTIVE" });
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
                    {groups?.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Commodity</Label>
                <Input value={form.commodityType} onChange={e => setForm({ ...form, commodityType: e.target.value })} placeholder="e.g. coffee_arabica" data-testid="contract-commodity-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Season start</Label><Input type="date" value={form.seasonStart} onChange={e => setForm({ ...form, seasonStart: e.target.value })} data-testid="contract-start-input" /></div>
                <div><Label>Season end</Label><Input type="date" value={form.seasonEnd} onChange={e => setForm({ ...form, seasonEnd: e.target.value })} data-testid="contract-end-input" /></div>
              </div>
              <div>
                <Label>Floor price per kg (UGX)</Label>
                <Input value={form.floorPricePerKg} onChange={e => setForm({ ...form, floorPricePerKg: e.target.value })} placeholder="0.00" data-testid="contract-floor-input" />
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
                    <TableCell><Badge variant={statusVariants[c.status] ?? "secondary"}>{c.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {c.status === "DRAFT" && <Button size="sm" variant="outline" onClick={() => setStatus(c.id, "ACTIVE")} data-testid={`activate-${c.id}`}>Activate</Button>}
                      {c.status === "ACTIVE" && <Button size="sm" variant="outline" onClick={() => setStatus(c.id, "SUSPENDED")} data-testid={`suspend-${c.id}`}>Suspend</Button>}
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={8} className="py-12 text-center text-muted-foreground">No contracts yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
