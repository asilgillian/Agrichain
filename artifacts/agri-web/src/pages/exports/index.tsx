import { useState } from "react";
import { useListExportContracts, useListShipments } from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
