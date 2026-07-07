import { useState } from "react";
import { useListExportContracts, useListShipments, customFetch } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";
import { ChevronRight, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

function fmtKg(v?: number | null) {
  if (v == null) return "-";
  return `${Number(v).toLocaleString()} kg`;
}

const emptyForm = { contractNumber: "", buyer: "", destination: "", cropType: "coffee", quantityKg: "", pricePerKg: "", certificationRequired: "", deliveryDate: "" };

const emptyShipmentForm = { contractId: "", commodityTypeId: "", totalWeightKg: "", containerNumber: "", vesselName: "", portOfLoading: "", portOfDestination: "", shipmentDate: "" };

export default function ExportsPage() {
  const { data: contracts, isLoading: isLoadingContracts } = useListExportContracts();
  const { data: shipments, isLoading: isLoadingShipments } = useListShipments();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const { toast } = useToast();
  const qc = useQueryClient();

  const createMut = useMutation({
    mutationFn: (body: any) => fetch(`${API_BASE}/api/exports/contracts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/exports/contracts"] });
      toast({ title: "Export contract created" });
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const submit = () => {
    const cn = form.contractNumber.trim(); const buyer = form.buyer.trim(); const dest = form.destination.trim();
    const qty = Number(form.quantityKg); const price = Number(form.pricePerKg);
    if (!cn || !buyer || !dest || !form.cropType || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      toast({ title: "All required fields must be filled with positive numbers", variant: "destructive" });
      return;
    }
    const body: any = { contractNumber: cn, buyer, destination: dest, cropType: form.cropType, quantityKg: qty, pricePerKg: price };
    if (form.certificationRequired) body.certificationRequired = form.certificationRequired;
    if (form.deliveryDate) body.deliveryDate = form.deliveryDate;
    createMut.mutate(body);
  };

  const [shipmentOpen, setShipmentOpen] = useState(false);
  const [shipmentForm, setShipmentForm] = useState(emptyShipmentForm);

  // Graded commodity stock balances — the sellable inventory booked by grading runs. Shipping
  // against a graded commodity type draws the shipped weight down from this stock.
  const { data: massBalance } = useQuery<any>({
    queryKey: ["/api/warehouse/mass-balance"],
    queryFn: () => customFetch(`${API_BASE}/api/warehouse/mass-balance`),
    enabled: shipmentOpen,
  });
  const gradedStock: any[] = massBalance?.commodityStock ?? [];
  const selectedStock = shipmentForm.commodityTypeId ? gradedStock.find((s: any) => s.commodityTypeId === shipmentForm.commodityTypeId) : null;

  const createShipmentMut = useMutation({
    mutationFn: (body: any) => customFetch(`${API_BASE}/api/exports/shipments`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/exports/shipments"] });
      qc.invalidateQueries({ queryKey: ["/api/warehouse/mass-balance"] });
      toast({ title: "Shipment created", description: shipmentForm.commodityTypeId ? "Graded stock has been drawn down." : undefined });
      setShipmentOpen(false);
      setShipmentForm(emptyShipmentForm);
    },
    onError: (e: any) => {
      const msg = e?.data?.error ?? e.message;
      toast({ title: "Failed to create shipment", description: msg, variant: "destructive" });
    },
  });

  const submitShipment = () => {
    if (!shipmentForm.contractId) { toast({ title: "Select an export contract", variant: "destructive" }); return; }
    const weight = Number(shipmentForm.totalWeightKg);
    if (shipmentForm.commodityTypeId) {
      if (!Number.isFinite(weight) || weight <= 0) { toast({ title: "Weight must be a positive number when shipping graded stock", variant: "destructive" }); return; }
      if (selectedStock && weight > selectedStock.netStockKg) {
        toast({ title: "Not enough graded stock", description: `Only ${selectedStock.netStockKg.toLocaleString()} kg of ${selectedStock.commodityTypeName} in stock`, variant: "destructive" });
        return;
      }
    }
    const body: any = { contractId: shipmentForm.contractId };
    if (shipmentForm.commodityTypeId) body.commodityTypeId = shipmentForm.commodityTypeId;
    if (shipmentForm.totalWeightKg) body.totalWeightKg = weight;
    if (shipmentForm.containerNumber.trim()) body.containerNumber = shipmentForm.containerNumber.trim();
    if (shipmentForm.vesselName.trim()) body.vesselName = shipmentForm.vesselName.trim();
    if (shipmentForm.portOfLoading.trim()) body.portOfLoading = shipmentForm.portOfLoading.trim();
    if (shipmentForm.portOfDestination.trim()) body.portOfDestination = shipmentForm.portOfDestination.trim();
    if (shipmentForm.shipmentDate) body.shipmentDate = shipmentForm.shipmentDate;
    createShipmentMut.mutate(body);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Export Management</h1>
          <p className="text-muted-foreground mt-1">Export contracts, shipments, and documentation</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" data-testid="new-export-btn"><Plus className="h-4 w-4" /> New Contract</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Export Contract</DialogTitle>
              <DialogDescription>Create a contract with an international buyer.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Contract # *</Label><Input value={form.contractNumber} onChange={e => setForm({ ...form, contractNumber: e.target.value })} placeholder="EXP-2026-001" data-testid="input-contract-number" /></div>
                <div>
                  <Label>Crop *</Label>
                  <Select value={form.cropType} onValueChange={v => setForm({ ...form, cropType: v })}>
                    <SelectTrigger data-testid="input-crop"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="coffee">Coffee</SelectItem>
                      <SelectItem value="cocoa">Cocoa</SelectItem>
                      <SelectItem value="maize">Maize</SelectItem>
                      <SelectItem value="vanilla">Vanilla</SelectItem>
                      <SelectItem value="tea">Tea</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Buyer *</Label><Input value={form.buyer} onChange={e => setForm({ ...form, buyer: e.target.value })} placeholder="e.g. European Coffee Importers Ltd" data-testid="input-buyer" /></div>
              <div><Label>Destination *</Label><Input value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} placeholder="e.g. Hamburg, Germany" data-testid="input-destination" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Quantity (kg) *</Label><Input type="number" value={form.quantityKg} onChange={e => setForm({ ...form, quantityKg: e.target.value })} placeholder="20000" data-testid="input-quantity" /></div>
                <div><Label>Price per kg (USD) *</Label><Input type="number" step="0.01" value={form.pricePerKg} onChange={e => setForm({ ...form, pricePerKg: e.target.value })} placeholder="3.50" data-testid="input-price" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Certification</Label>
                  <Select value={form.certificationRequired || "none"} onValueChange={v => setForm({ ...form, certificationRequired: v === "none" ? "" : v })}>
                    <SelectTrigger data-testid="input-cert"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="EUDR">EUDR</SelectItem>
                      <SelectItem value="Rainforest Alliance">Rainforest Alliance</SelectItem>
                      <SelectItem value="Fairtrade">Fairtrade</SelectItem>
                      <SelectItem value="Organic">Organic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Delivery Date</Label><Input type="date" value={form.deliveryDate} onChange={e => setForm({ ...form, deliveryDate: e.target.value })} data-testid="input-delivery-date" /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={createMut.isPending} data-testid="submit-export">{createMut.isPending ? "Saving..." : "Create"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="contracts">
        <TabsList>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
          <TabsTrigger value="shipments">Shipments</TabsTrigger>
        </TabsList>

        <TabsContent value="contracts" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Export Contracts</CardTitle>
                <Badge variant="secondary">{isLoadingContracts ? "..." : (contracts?.length ?? 0)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contract #</TableHead>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Crop</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Certification</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingContracts ? (
                    <TableRow><TableCell colSpan={7}><Skeleton className="h-12 w-full" /></TableCell></TableRow>
                  ) : contracts && contracts.length > 0 ? contracts.map(c => (
                    <TableRow key={c.id} data-testid={`contract-row-${c.id}`}>
                      <TableCell className="font-mono text-sm font-medium">{c.contractNumber}</TableCell>
                      <TableCell className="font-medium">{c.buyer}</TableCell>
                      <TableCell className="text-muted-foreground">{c.destination}</TableCell>
                      <TableCell className="capitalize">{c.cropType}</TableCell>
                      <TableCell>{fmtKg(c.quantityKg)}</TableCell>
                      <TableCell>{c.certificationRequired ? <Badge variant="outline">{c.certificationRequired}</Badge> : "—"}</TableCell>
                      <TableCell><Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status}</Badge></TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No contracts</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="shipments" className="mt-4">
          <div className="flex justify-end mb-4">
            <Dialog open={shipmentOpen} onOpenChange={setShipmentOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2" data-testid="new-shipment-btn"><Plus className="h-4 w-4" /> New Shipment</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>New Shipment</DialogTitle>
                  <DialogDescription>Optionally ship graded commodity stock directly — the shipped weight is drawn down from warehouse graded stock.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Export Contract *</Label>
                    <Select value={shipmentForm.contractId} onValueChange={v => setShipmentForm({ ...shipmentForm, contractId: v })}>
                      <SelectTrigger data-testid="input-shipment-contract"><SelectValue placeholder="Select contract" /></SelectTrigger>
                      <SelectContent>
                        {(contracts ?? []).map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.contractNumber} — {c.buyer}</SelectItem>
                        ))}
                        {(contracts ?? []).length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">No contracts — create one first</div>}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Graded Commodity (optional)</Label>
                    <Select value={shipmentForm.commodityTypeId || "none"} onValueChange={v => setShipmentForm({ ...shipmentForm, commodityTypeId: v === "none" ? "" : v })}>
                      <SelectTrigger data-testid="input-shipment-commodity"><SelectValue placeholder="No graded stock drawdown" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No graded stock drawdown</SelectItem>
                        {gradedStock.filter((s: any) => s.netStockKg > 0).map((s: any) => (
                          <SelectItem key={s.commodityTypeId} value={s.commodityTypeId}>
                            {s.commodityTypeName} — {s.netStockKg.toLocaleString()} kg in stock
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedStock && (
                      <p className="text-xs text-muted-foreground mt-1" data-testid="shipment-available-stock">
                        Available: {selectedStock.netStockKg.toLocaleString()} kg
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Weight (kg){shipmentForm.commodityTypeId ? " *" : ""}</Label><Input type="number" min="0" value={shipmentForm.totalWeightKg} onChange={e => setShipmentForm({ ...shipmentForm, totalWeightKg: e.target.value })} placeholder="19200" data-testid="input-shipment-weight" /></div>
                    <div><Label>Shipment Date</Label><Input type="date" value={shipmentForm.shipmentDate} onChange={e => setShipmentForm({ ...shipmentForm, shipmentDate: e.target.value })} data-testid="input-shipment-date" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Container No.</Label><Input value={shipmentForm.containerNumber} onChange={e => setShipmentForm({ ...shipmentForm, containerNumber: e.target.value })} data-testid="input-shipment-container" /></div>
                    <div><Label>Vessel</Label><Input value={shipmentForm.vesselName} onChange={e => setShipmentForm({ ...shipmentForm, vesselName: e.target.value })} data-testid="input-shipment-vessel" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Port of Loading</Label><Input value={shipmentForm.portOfLoading} onChange={e => setShipmentForm({ ...shipmentForm, portOfLoading: e.target.value })} placeholder="Mombasa" data-testid="input-shipment-pol" /></div>
                    <div><Label>Port of Destination</Label><Input value={shipmentForm.portOfDestination} onChange={e => setShipmentForm({ ...shipmentForm, portOfDestination: e.target.value })} placeholder="Hamburg" data-testid="input-shipment-pod" /></div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShipmentOpen(false)}>Cancel</Button>
                  <Button onClick={submitShipment} disabled={createShipmentMut.isPending} data-testid="submit-shipment">
                    {createShipmentMut.isPending ? "Saving..." : "Create Shipment"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Shipments</CardTitle>
                <Badge variant="secondary">{isLoadingShipments ? "..." : (shipments?.length ?? 0)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Container</TableHead>
                    <TableHead>Vessel</TableHead>
                    <TableHead>Loading Port</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Weight</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingShipments ? (
                    <TableRow><TableCell colSpan={7}><Skeleton className="h-12 w-full" /></TableCell></TableRow>
                  ) : shipments && shipments.length > 0 ? shipments.map(s => (
                    <TableRow key={s.id} data-testid={`shipment-row-${s.id}`}>
                      <TableCell className="font-mono text-sm font-medium">{s.containerNumber ?? "—"}</TableCell>
                      <TableCell>{s.vesselName ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{s.portOfLoading ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{s.portOfDestination ?? "—"}</TableCell>
                      <TableCell>{fmtKg(s.totalWeightKg)}</TableCell>
                      <TableCell><Badge variant="secondary">{s.status}</Badge></TableCell>
                      <TableCell>
                        <Link href={`/exports/${s.id}`}><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No shipments</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
