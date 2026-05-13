import { useMemo, useState } from "react";
import { useListDeliveries, customFetch } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import { ChevronRight, CheckCircle, Circle, Plus, Package } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  captured: "outline",
  pending_weight_submit: "secondary", pending_weight_approve: "secondary",
  pending_qc_submit: "secondary", pending_qc_approve: "secondary",
  pending_pricing_propose: "outline", pending_pricing_approve: "outline",
  approved: "default",
  rejected_correction: "outline", partial_rejection: "outline",
  rejected_commodity: "destructive", rejected_escalate: "destructive", suspended: "destructive",
};
const statusLabels: Record<string, string> = {
  captured: "Captured",
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

// Captured delivery shape (subset). Generated `useListDeliveries` returns the
// full delivery row but lacks the new delivery-first fields in its TypeScript
// types (we haven't re-run codegen for the new shape on purpose). We read them
// off the row defensively.
type CapturedDelivery = {
  id: string;
  deliveryNumber?: string | null;
  farmerId?: string | null;
  cropType?: string | null;
  capturedWeightKg?: number | string | null;
};

type Farmer = { id: string; firstName: string; lastName: string; nationalId?: string | null };
type Commodity = { id: string; name: string; status?: string };

export default function ProcurementHub() {
  const { data: deliveries, isLoading, refetch } = useListDeliveries({});
  const { toast } = useToast();
  const qc = useQueryClient();

  // ----- Captured (unbatched) deliveries — for the batching dialog -------
  const { data: capturedRaw, refetch: refetchCaptured } = useQuery<unknown>({
    queryKey: ["/api/procurement/deliveries", "unbatched"],
    queryFn: () => customFetch<unknown>("/api/procurement/deliveries?unbatched=true"),
  });
  const captured: CapturedDelivery[] = Array.isArray(capturedRaw) ? (capturedRaw as CapturedDelivery[]) : [];

  // ============ NEW: Capture delivery dialog =============================
  const [captureOpen, setCaptureOpen] = useState(false);
  const [capForm, setCapForm] = useState<{ farmerId: string; cropType: string; weightKg: string }>({ farmerId: "", cropType: "", weightKg: "" });
  const [farmerSearch, setFarmerSearch] = useState("");
  const [pickedFarmer, setPickedFarmer] = useState<Farmer | null>(null);

  const { data: farmerHits } = useQuery<Farmer[]>({
    queryKey: ["/api/farmers", farmerSearch],
    enabled: farmerSearch.trim().length >= 2,
    queryFn: () => customFetch<Farmer[]>(`/api/farmers?search=${encodeURIComponent(farmerSearch.trim())}&limit=10`),
  });

  const { data: commodities } = useQuery<Commodity[]>({
    queryKey: ["/api/commodities", "active"],
    queryFn: () => customFetch<Commodity[]>("/api/commodities?status=active"),
  });

  const captureMut = useMutation({
    mutationFn: (body: { farmerId: string; cropType: string; weightKg: number }) =>
      customFetch<{ id: string; deliveryNumber: string }>("/api/procurement/deliveries", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["/api/procurement/deliveries"] });
      refetchCaptured();
      refetch();
      toast({ title: "Delivery captured", description: d.deliveryNumber });
      setCaptureOpen(false);
      setCapForm({ farmerId: "", cropType: "", weightKg: "" });
      setPickedFarmer(null);
      setFarmerSearch("");
    },
    onError: (e: any) => toast({ title: "Could not capture delivery", description: e.message, variant: "destructive" }),
  });

  function submitCapture() {
    const w = Number(capForm.weightKg);
    if (!pickedFarmer || !capForm.cropType || !Number.isFinite(w) || w <= 0) {
      toast({ title: "Farmer, crop, and weight (> 0) are required", variant: "destructive" });
      return;
    }
    captureMut.mutate({ farmerId: pickedFarmer.id, cropType: capForm.cropType, weightKg: w });
  }

  // ============ NEW: Group into batch dialog =============================
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchCrop, setBatchCrop] = useState<string>("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const cropChoices = useMemo(
    () => Array.from(new Set(captured.map(d => d.cropType).filter((c): c is string => !!c))).sort(),
    [captured],
  );
  const eligible = useMemo(() => captured.filter(d => d.cropType === batchCrop), [captured, batchCrop]);

  const togglePick = (id: string) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const batchMut = useMutation({
    mutationFn: (deliveryIds: string[]) =>
      customFetch<{ id: string; batchTag: string }>("/api/batches/from-deliveries", { method: "POST", body: JSON.stringify({ deliveryIds }) }),
    onSuccess: (b) => {
      refetchCaptured();
      refetch();
      qc.invalidateQueries({ queryKey: ["/api/batches"] });
      toast({ title: "Batch created", description: b.batchTag });
      setBatchOpen(false);
      setBatchCrop("");
      setPicked(new Set());
    },
    onError: (e: any) => toast({ title: "Could not create batch", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Procurement Hub</h1>
          <p className="text-muted-foreground mt-1">Per-farmer deliveries — capture first, group into batches, then run the weight, QC, and pricing workflow</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{isLoading ? "..." : (deliveries?.length ?? 0)} deliveries</Badge>
          <Badge variant="outline">{captured.length} captured</Badge>

          {/* Group into batch */}
          <Dialog open={batchOpen} onOpenChange={(v) => { setBatchOpen(v); if (!v) { setBatchCrop(""); setPicked(new Set()); } }}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2" disabled={captured.length === 0} data-testid="group-batch-btn">
                <Package className="h-4 w-4" /> Group into batch
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Group deliveries into a batch</DialogTitle>
                <DialogDescription>Pick a crop, then select the captured deliveries to include. Only same-crop deliveries can share a batch.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Crop</Label>
                  <Select value={batchCrop} onValueChange={(v) => { setBatchCrop(v); setPicked(new Set()); }}>
                    <SelectTrigger data-testid="batch-crop-select"><SelectValue placeholder="Select a crop" /></SelectTrigger>
                    <SelectContent>
                      {cropChoices.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {batchCrop && (
                  <div className="space-y-2 max-h-72 overflow-auto border rounded-md p-2">
                    {eligible.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-2 text-center">No captured deliveries for {batchCrop}.</p>
                    ) : eligible.map(d => (
                      <label key={d.id} className="flex items-center gap-3 p-2 rounded hover:bg-accent cursor-pointer" data-testid={`pick-delivery-${d.id}`}>
                        <Checkbox checked={picked.has(d.id)} onCheckedChange={() => togglePick(d.id)} />
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-sm truncate">{d.deliveryNumber ?? d.id.slice(0, 8)}</p>
                          <p className="text-xs text-muted-foreground">{Number(d.capturedWeightKg ?? 0).toLocaleString()} kg · farmer {(d.farmerId ?? "").slice(0, 8)}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
                {batchCrop && picked.size > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Selected: {picked.size} delivery{picked.size === 1 ? "" : "s"} · {eligible.filter(d => picked.has(d.id)).reduce((s, d) => s + Number(d.capturedWeightKg ?? 0), 0).toLocaleString()} kg
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setBatchOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => batchMut.mutate(Array.from(picked))}
                  disabled={!batchCrop || picked.size === 0 || batchMut.isPending}
                  data-testid="submit-batch"
                >
                  {batchMut.isPending ? "Creating…" : "Create batch"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Capture delivery */}
          <Dialog open={captureOpen} onOpenChange={(v) => { setCaptureOpen(v); if (!v) { setPickedFarmer(null); setFarmerSearch(""); setCapForm({ farmerId: "", cropType: "", weightKg: "" }); } }}>
            <DialogTrigger asChild>
              <Button className="gap-2" data-testid="new-delivery-btn"><Plus className="h-4 w-4" /> Capture delivery</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Capture delivery</DialogTitle>
                <DialogDescription>One farmer's drop-off. The delivery number is generated automatically and the row starts in "captured" status — group it into a batch to advance to weight/QC.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Farmer *</Label>
                  {pickedFarmer ? (
                    <div className="flex items-center gap-2 p-2 rounded bg-accent">
                      <span className="flex-1 text-sm">{pickedFarmer.firstName} {pickedFarmer.lastName}</span>
                      <Button size="sm" variant="ghost" onClick={() => setPickedFarmer(null)}>Change</Button>
                    </div>
                  ) : (
                    <>
                      <Input
                        value={farmerSearch}
                        onChange={e => setFarmerSearch(e.target.value)}
                        placeholder="Search by name or national ID"
                        data-testid="capture-farmer-search"
                      />
                      {(farmerHits ?? []).slice(0, 6).map(f => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setPickedFarmer(f)}
                          className="w-full text-left p-2 mt-1 border rounded hover:bg-accent text-sm"
                          data-testid={`capture-farmer-hit-${f.id}`}
                        >
                          <span className="font-medium">{f.firstName} {f.lastName}</span>
                          {f.nationalId ? <span className="text-xs text-muted-foreground ml-2">NID {f.nationalId}</span> : null}
                        </button>
                      ))}
                    </>
                  )}
                </div>
                <div>
                  <Label>Crop *</Label>
                  <Select value={capForm.cropType} onValueChange={v => setCapForm({ ...capForm, cropType: v })}>
                    <SelectTrigger data-testid="capture-crop"><SelectValue placeholder="Select a crop" /></SelectTrigger>
                    <SelectContent>
                      {(commodities ?? []).map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Weight (kg) *</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.001"
                    value={capForm.weightKg}
                    onChange={e => setCapForm({ ...capForm, weightKg: e.target.value })}
                    placeholder="e.g. 38.5"
                    data-testid="capture-weight"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCaptureOpen(false)}>Cancel</Button>
                <Button onClick={submitCapture} disabled={captureMut.isPending} data-testid="submit-capture">{captureMut.isPending ? "Saving…" : "Capture"}</Button>
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
                  <TableHead>Reference</TableHead>
                  <TableHead>Crop</TableHead>
                  <TableHead>Weight (kg)</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead className="text-center">Weight</TableHead>
                  <TableHead className="text-center">QC</TableHead>
                  <TableHead>Price/kg</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries && deliveries.length > 0 ? deliveries.map((d) => {
                  // Bridge: rows from the new delivery-first model carry
                  // deliveryNumber/cropType/capturedWeightKg; legacy columns
                  // (lotTag, netWeightKg) only fill in once weight is recorded.
                  const dx = d as unknown as (typeof d & CapturedDelivery);
                  const ref = (dx.deliveryNumber as string | undefined) ?? d.lotTag;
                  const crop = (dx.cropType as string | undefined) ?? "—";
                  const weight = d.netWeightKg ?? dx.capturedWeightKg ?? null;
                  return (
                    <TableRow key={d.id} className="cursor-pointer" data-testid={`delivery-row-${d.id}`}>
                      <TableCell className="font-mono text-sm font-medium">{ref}</TableCell>
                      <TableCell>{crop}</TableCell>
                      <TableCell>{weight != null ? Number(weight).toLocaleString() : <span className="text-muted-foreground text-sm">—</span>}</TableCell>
                      <TableCell>{d.grade ?? <span className="text-muted-foreground text-sm">—</span>}</TableCell>
                      <TableCell className="text-center"><Checkmark ok={d.weightApproved ?? false} /></TableCell>
                      <TableCell className="text-center"><Checkmark ok={d.qcApproved ?? false} /></TableCell>
                      <TableCell>{d.pricePerKg != null ? `UGX ${Number(d.pricePerKg).toLocaleString()}` : <span className="text-muted-foreground text-sm">—</span>}</TableCell>
                      <TableCell><Badge variant={statusColors[d.status ?? ""] ?? "secondary"}>{statusLabels[d.status ?? ""] ?? d.status}</Badge></TableCell>
                      <TableCell>
                        <Link href={`/procurement/${d.id}`}><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>
                      </TableCell>
                    </TableRow>
                  );
                }) : (
                  <TableRow><TableCell colSpan={9} className="py-12 text-center text-muted-foreground">No deliveries found</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
