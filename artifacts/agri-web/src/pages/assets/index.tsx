import { useState } from "react";
import { useListAssets, useListUsers } from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import { ChevronRight, Plus, UserCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

function fmtUGX(v?: number | null) {
  if (v == null) return "-";
  return new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(Number(v));
}

const emptyForm = { type: "device", make: "", model: "", serialNumber: "", purchaseDate: new Date().toISOString().slice(0, 10), purchaseValue: "" };

export default function AssetsPage() {
  const { data: assets, isLoading } = useListAssets({});
  const { data: users } = useListUsers({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [assignId, setAssignId] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState({ userId: "", conditionAtHandover: "good" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const createMut = useMutation({
    mutationFn: (body: any) => fetch(`${API_BASE}/api/assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/assets"] });
      toast({ title: "Asset added" });
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const assignMut = useMutation({
    mutationFn: ({ id, body }: any) => fetch(`${API_BASE}/api/assets/${id}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/assets"] });
      toast({ title: "Asset assigned" });
      setAssignId(null);
      setAssignForm({ userId: "", conditionAtHandover: "good" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const submit = () => {
    const val = Number(form.purchaseValue);
    if (!form.type || !form.purchaseDate || !Number.isFinite(val) || val <= 0) {
      toast({ title: "Type, date and a positive value are required", variant: "destructive" });
      return;
    }
    const body: any = { type: form.type, purchaseDate: form.purchaseDate, purchaseValue: val };
    if (form.make.trim()) body.make = form.make.trim();
    if (form.model.trim()) body.model = form.model.trim();
    if (form.serialNumber.trim()) body.serialNumber = form.serialNumber.trim();
    createMut.mutate(body);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Asset Registry</h1>
          <p className="text-muted-foreground mt-1">Equipment, devices, and field assets</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{isLoading ? "..." : (assets?.length ?? 0)} assets</Badge>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" data-testid="add-asset-btn"><Plus className="h-4 w-4" /> Add Asset</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Register New Asset</DialogTitle>
                <DialogDescription>Add equipment, vehicles or devices to the registry.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Type *</Label>
                  <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                    <SelectTrigger data-testid="input-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="device">Device</SelectItem>
                      <SelectItem value="vehicle">Vehicle</SelectItem>
                      <SelectItem value="scale">Scale</SelectItem>
                      <SelectItem value="equipment">Equipment</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Make</Label><Input value={form.make} onChange={e => setForm({ ...form, make: e.target.value })} placeholder="e.g. Samsung" data-testid="input-make" /></div>
                  <div><Label>Model</Label><Input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="e.g. Galaxy A14" data-testid="input-model" /></div>
                </div>
                <div><Label>Serial Number</Label><Input value={form.serialNumber} onChange={e => setForm({ ...form, serialNumber: e.target.value })} data-testid="input-serial" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Purchase Date *</Label><Input type="date" value={form.purchaseDate} onChange={e => setForm({ ...form, purchaseDate: e.target.value })} data-testid="input-date" /></div>
                  <div><Label>Purchase Value (UGX) *</Label><Input type="number" value={form.purchaseValue} onChange={e => setForm({ ...form, purchaseValue: e.target.value })} placeholder="500000" data-testid="input-value" /></div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={submit} disabled={createMut.isPending} data-testid="submit-asset">{createMut.isPending ? "Saving..." : "Add"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Make / Model</TableHead>
                <TableHead>Serial #</TableHead>
                <TableHead>Purchase Value</TableHead>
                <TableHead>Book Value</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3].map(i => <TableRow key={i}><TableCell colSpan={9}><Skeleton className="h-10 w-full" /></TableCell></TableRow>)
              ) : assets && assets.length > 0 ? assets.map(a => (
                <TableRow key={a.id} data-testid={`asset-row-${a.id}`}>
                  <TableCell className="font-mono text-sm font-medium">{a.assetCode}</TableCell>
                  <TableCell className="capitalize">{a.type}</TableCell>
                  <TableCell className="text-muted-foreground">{a.make} {a.model}</TableCell>
                  <TableCell className="font-mono text-sm">{a.serialNumber ?? "—"}</TableCell>
                  <TableCell>{fmtUGX(a.purchaseValue)}</TableCell>
                  <TableCell>{fmtUGX(a.currentBookValue)}</TableCell>
                  <TableCell className="text-muted-foreground">{(a as any).assignedToName ?? <span className="italic">Unassigned</span>}</TableCell>
                  <TableCell><Badge variant={a.status === "available" ? "secondary" : "default"}>{a.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      {a.status === "available" && <Button size="sm" variant="ghost" onClick={() => setAssignId(a.id)} data-testid={`assign-${a.id}`}><UserCheck className="h-4 w-4" /></Button>}
                      <Link href={`/assets/${a.id}`}><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={9} className="py-12 text-center text-muted-foreground">No assets found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!assignId} onOpenChange={(o) => !o && setAssignId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Asset</DialogTitle>
            <DialogDescription>Hand over this asset to a user and record its condition.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>User *</Label>
              <Select value={assignForm.userId} onValueChange={v => setAssignForm({ ...assignForm, userId: v })}>
                <SelectTrigger data-testid="input-assignee"><SelectValue placeholder="Select user" /></SelectTrigger>
                <SelectContent>
                  {users?.map(u => <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Condition at Handover *</Label>
              <Select value={assignForm.conditionAtHandover} onValueChange={v => setAssignForm({ ...assignForm, conditionAtHandover: v })}>
                <SelectTrigger data-testid="input-condition"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="excellent">Excellent</SelectItem>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="fair">Fair</SelectItem>
                  <SelectItem value="poor">Poor</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignId(null)}>Cancel</Button>
            <Button onClick={() => { if (!assignForm.userId) { toast({ title: "Pick a user", variant: "destructive" }); return; } assignMut.mutate({ id: assignId, body: assignForm }); }} disabled={assignMut.isPending} data-testid="submit-assign">{assignMut.isPending ? "Saving..." : "Assign"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
