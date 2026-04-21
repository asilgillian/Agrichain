import { useState } from "react";
import { useListDeliveries, customFetch } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import { ChevronRight, CheckCircle, Circle, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending_weight_submit: "secondary", pending_weight_approve: "secondary",
  pending_qc_submit: "secondary", pending_qc_approve: "secondary",
  pending_pricing_propose: "outline", pending_pricing_approve: "outline",
  approved: "default",
  rejected_correction: "outline", partial_rejection: "outline",
  rejected_commodity: "destructive", rejected_escalate: "destructive", suspended: "destructive",
};
const statusLabels: Record<string, string> = {
  pending_weight_submit: "Awaiting weight",
  pending_weight_approve: "Awaiting weight approval",
  pending_qc_submit: "Awaiting QC",
  pending_qc_approve: "Awaiting QC approval",
  pending_pricing_propose: "Awaiting price",
  pending_pricing_approve: "Awaiting price approval",
  approved: "Approved",
  rejected_correction: "Correction needed",
  rejected_commodity: "Rejected — commodity",
  rejected_escalate: "Escalated",
  partial_rejection: "Partial rejection",
  suspended: "Suspended",
};

function Checkmark({ ok }: { ok: boolean }) {
  return ok ? <CheckCircle className="h-4 w-4 text-green-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />;
}

export default function ProcurementHub() {
  const { data: deliveries, isLoading } = useListDeliveries({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ batchTag: "", stationId: "" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: stationsRaw } = useQuery<unknown>({
    queryKey: ["/api/buying-stations"],
    queryFn: () => customFetch<unknown>("/api/buying-stations"),
  });
  const stations: Array<{ id: string; name: string }> = Array.isArray(stationsRaw) ? stationsRaw as any : [];

  const createMut = useMutation({
    mutationFn: (body: any) => customFetch<any>("/api/procurement/deliveries", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/procurement/deliveries"] });
      toast({ title: "Delivery logged" });
      setOpen(false);
      setForm({ batchTag: "", stationId: "" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Procurement Hub</h1>
          <p className="text-muted-foreground mt-1">Inbound deliveries — weight, QC, pricing, and approval workflow</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{isLoading ? "..." : (deliveries?.length ?? 0)} deliveries</Badge>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" data-testid="new-delivery-btn"><Plus className="h-4 w-4" /> New Delivery</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Log New Delivery</DialogTitle>
                <DialogDescription>Open a new delivery record at a buying station to begin the weight, QC, and pricing workflow.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div><Label>Batch Tag *</Label><Input value={form.batchTag} onChange={e => setForm({ ...form, batchTag: e.target.value })} placeholder="e.g. BATCH-2026-001" data-testid="input-batch-tag" /></div>
                <div>
                  <Label>Buying Station *</Label>
                  <Select value={form.stationId} onValueChange={v => setForm({ ...form, stationId: v })}>
                    <SelectTrigger data-testid="input-station"><SelectValue placeholder="Select station" /></SelectTrigger>
                    <SelectContent>
                      {stations.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => { const tag = form.batchTag.trim(); if (!tag || !form.stationId) { toast({ title: "Batch tag and station required", variant: "destructive" }); return; } createMut.mutate({ batchTag: tag, stationId: form.stationId }); }} disabled={createMut.isPending} data-testid="submit-delivery">{createMut.isPending ? "Saving..." : "Create"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lot Tag</TableHead>
                  <TableHead>Net Weight (kg)</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead className="text-center">Weight</TableHead>
                  <TableHead className="text-center">QC</TableHead>
                  <TableHead>Price/kg</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries && deliveries.length > 0 ? deliveries.map((d) => (
                  <TableRow key={d.id} className="cursor-pointer" data-testid={`delivery-row-${d.id}`}>
                    <TableCell className="font-mono text-sm font-medium">{d.lotTag}</TableCell>
                    <TableCell>{d.netWeightKg != null ? Number(d.netWeightKg).toLocaleString() : <span className="text-muted-foreground text-sm">—</span>}</TableCell>
                    <TableCell>{d.grade ?? <span className="text-muted-foreground text-sm">—</span>}</TableCell>
                    <TableCell className="text-center"><Checkmark ok={d.weightApproved ?? false} /></TableCell>
                    <TableCell className="text-center"><Checkmark ok={d.qcApproved ?? false} /></TableCell>
                    <TableCell>{d.pricePerKg != null ? `UGX ${Number(d.pricePerKg).toLocaleString()}` : <span className="text-muted-foreground text-sm">—</span>}</TableCell>
                    <TableCell><Badge variant={statusColors[d.status ?? ""] ?? "secondary"}>{statusLabels[d.status ?? ""] ?? d.status}</Badge></TableCell>
                    <TableCell>
                      <Link href={`/procurement/${d.id}`}><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={8} className="py-12 text-center text-muted-foreground">No deliveries found</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
