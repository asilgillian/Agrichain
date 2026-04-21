import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, FileText, Truck, Receipt } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

const statusColors: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  APPROVED: "bg-blue-100 text-blue-800",
  STOCK_ALLOCATED: "bg-indigo-100 text-indigo-800",
  PARTIALLY_FULFILLED: "bg-yellow-100 text-yellow-800",
  FULLY_FULFILLED: "bg-green-100 text-green-800",
  CLOSED: "bg-gray-200 text-gray-600",
  CANCELLED: "bg-red-100 text-red-700",
};

const emptyForm = {
  buyerId: "", contractType: "SPOT", commodityType: "", grade: "",
  targetQuantityKg: "", agreedPricePerKg: "", currency: "USD",
  deliveryWindowStart: "", deliveryWindowEnd: "", incoterms: "FOB", certificationRequired: "", notes: "",
};

export default function SalesPage() {
  const [status, setStatus] = useState("all");
  const [tab, setTab] = useState<"contracts" | "dispatches" | "invoices">("contracts");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (status !== "all") params.set("status", status);

  const { data: contracts, isLoading: contractsLoading } = useQuery({
    queryKey: ["/api/sales/contracts", status, page],
    queryFn: () => fetch(`${API_BASE}/api/sales/contracts?${params}`).then(r => r.json()),
    enabled: tab === "contracts",
  });

  const { data: dispatches, isLoading: dispatchesLoading } = useQuery({
    queryKey: ["/api/dispatches"],
    queryFn: () => fetch(`${API_BASE}/api/dispatches?limit=20&page=${page}`).then(r => r.json()),
    enabled: tab === "dispatches",
  });

  const { data: invoices, isLoading: invoicesLoading } = useQuery({
    queryKey: ["/api/invoices"],
    queryFn: () => fetch(`${API_BASE}/api/invoices?limit=20&page=${page}`).then(r => r.json()),
    enabled: tab === "invoices",
  });

  const { data: buyersData } = useQuery({
    queryKey: ["/api/buyers", "for-contract"],
    queryFn: () => fetch(`${API_BASE}/api/buyers?limit=200`).then(r => r.json()),
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => fetch(`${API_BASE}/api/sales/contracts`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales/contracts"] });
      toast({ title: "Contract created" });
      setOpen(false); setForm(emptyForm);
    },
    onError: (e: any) => toast({ title: "Failed to create contract", description: e.message, variant: "destructive" }),
  });

  const submit = () => {
    if (!form.buyerId) { toast({ title: "Buyer is required", variant: "destructive" }); return; }
    createMutation.mutate({
      buyerId: form.buyerId,
      contractType: form.contractType,
      commodityType: form.commodityType.trim() || undefined,
      grade: form.grade.trim() || undefined,
      targetQuantityKg: form.targetQuantityKg ? Number(form.targetQuantityKg) : undefined,
      agreedPricePerKg: form.agreedPricePerKg ? Number(form.agreedPricePerKg) : undefined,
      currency: form.currency,
      deliveryWindowStart: form.deliveryWindowStart || undefined,
      deliveryWindowEnd: form.deliveryWindowEnd || undefined,
      incoterms: form.incoterms || undefined,
      certificationRequired: form.certificationRequired.trim() || undefined,
      notes: form.notes.trim() || undefined,
    });
  };

  const tabs = [
    { key: "contracts", label: "Contracts", icon: FileText },
    { key: "dispatches", label: "Dispatches", icon: Truck },
    { key: "invoices", label: "Invoices", icon: Receipt },
  ] as const;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sales & Commodity Exit</h1>
          <p className="text-muted-foreground mt-1">Buyer contracts, dispatch management, and invoice tracking.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="new-contract-btn" className="gap-2"><Plus className="h-4 w-4" /> New Contract</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New Sales Contract</DialogTitle>
              <DialogDescription>Create a new buyer contract. Starts in DRAFT status.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Buyer *</Label>
                <Select value={form.buyerId} onValueChange={v => setForm({ ...form, buyerId: v })}>
                  <SelectTrigger data-testid="input-buyer"><SelectValue placeholder="Select buyer" /></SelectTrigger>
                  <SelectContent>
                    {(buyersData?.data ?? []).map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}{b.country ? ` (${b.country})` : ""}</SelectItem>
                    ))}
                    {(buyersData?.data ?? []).length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">No buyers — add one first</div>}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Contract Type</Label>
                  <Select value={form.contractType} onValueChange={v => setForm({ ...form, contractType: v })}>
                    <SelectTrigger data-testid="input-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SPOT">Spot</SelectItem>
                      <SelectItem value="FORWARD">Forward</SelectItem>
                      <SelectItem value="FRAMEWORK">Framework</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Commodity</Label><Input value={form.commodityType} onChange={e => setForm({ ...form, commodityType: e.target.value })} placeholder="Coffee, Cocoa..." data-testid="input-commodity" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Grade</Label><Input value={form.grade} onChange={e => setForm({ ...form, grade: e.target.value })} placeholder="AA, Premium..." data-testid="input-grade" /></div>
                <div><Label>Target Quantity (kg)</Label><Input type="number" value={form.targetQuantityKg} onChange={e => setForm({ ...form, targetQuantityKg: e.target.value })} placeholder="20000" data-testid="input-qty" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Price per kg</Label><Input type="number" step="0.01" value={form.agreedPricePerKg} onChange={e => setForm({ ...form, agreedPricePerKg: e.target.value })} placeholder="4.50" data-testid="input-price" /></div>
                <div>
                  <Label>Currency</Label>
                  <Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v })}>
                    <SelectTrigger data-testid="input-currency"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="UGX">UGX</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Delivery From</Label><Input type="date" value={form.deliveryWindowStart} onChange={e => setForm({ ...form, deliveryWindowStart: e.target.value })} data-testid="input-from" /></div>
                <div><Label>Delivery To</Label><Input type="date" value={form.deliveryWindowEnd} onChange={e => setForm({ ...form, deliveryWindowEnd: e.target.value })} data-testid="input-to" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Incoterms</Label>
                  <Select value={form.incoterms} onValueChange={v => setForm({ ...form, incoterms: v })}>
                    <SelectTrigger data-testid="input-incoterms"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FOB">FOB</SelectItem>
                      <SelectItem value="CIF">CIF</SelectItem>
                      <SelectItem value="EXW">EXW</SelectItem>
                      <SelectItem value="CFR">CFR</SelectItem>
                      <SelectItem value="DDP">DDP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Certification</Label><Input value={form.certificationRequired} onChange={e => setForm({ ...form, certificationRequired: e.target.value })} placeholder="EUDR, RA..." data-testid="input-cert" /></div>
              </div>
              <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} data-testid="input-notes" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={createMutation.isPending} data-testid="submit-contract">{createMutation.isPending ? "Creating..." : "Create Contract"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-1 border-b">
        {tabs.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setPage(1); }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            data-testid={`tab-${t.key}`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {tab === "contracts" && (
        <>
          <div className="flex gap-3">
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-48" data-testid="status-filter"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.keys(statusColors).map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contract No.</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Commodity</TableHead>
                  <TableHead>Target (kg)</TableHead>
                  <TableHead>Price/kg</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {contractsLoading ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                )) : contracts?.data?.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No contracts found</TableCell></TableRow>
                ) : contracts?.data?.map((c: any) => (
                  <TableRow key={c.id} data-testid={`contract-row-${c.id}`}>
                    <TableCell className="font-mono text-sm font-semibold">{c.contractNumber}</TableCell>
                    <TableCell>{c.buyerName ?? "—"}</TableCell>
                    <TableCell className="text-xs">{c.contractType}</TableCell>
                    <TableCell>{c.commodityType ?? "—"}</TableCell>
                    <TableCell className="font-mono">{c.targetQuantityKg ? Number(c.targetQuantityKg).toLocaleString() : "—"}</TableCell>
                    <TableCell className="font-mono">{c.agreedPricePerKg ? `${c.currency ?? "USD"} ${Number(c.agreedPricePerKg).toFixed(2)}` : "—"}</TableCell>
                    <TableCell><Badge className={`${statusColors[c.status] ?? ""} border-0 text-xs`}>{c.status.replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell><Link href={`/sales/${c.id}`}><Button size="sm" variant="ghost">View</Button></Link></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {tab === "dispatches" && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dispatch No.</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Truck Reg</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Weight (kg)</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dispatchesLoading ? Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
              )) : dispatches?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No dispatches found</TableCell></TableRow>
              ) : dispatches?.data?.map((d: any) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono font-semibold">{d.dispatchNumber}</TableCell>
                  <TableCell>{d.containerNumber ?? "—"}</TableCell>
                  <TableCell>{d.truckReg ?? "—"}</TableCell>
                  <TableCell>{d.driverName ?? "—"}</TableCell>
                  <TableCell className="font-mono">{d.dispatchWeightKg ? Number(d.dispatchWeightKg).toLocaleString() : "—"}</TableCell>
                  <TableCell><Badge variant="outline">{d.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {tab === "invoices" && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice No.</TableHead>
                <TableHead>Weight (kg)</TableHead>
                <TableHead>Price/kg</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoicesLoading ? Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
              )) : invoices?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No invoices found</TableCell></TableRow>
              ) : invoices?.data?.map((inv: any) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono font-semibold">{inv.invoiceNumber}</TableCell>
                  <TableCell className="font-mono">{inv.dispatchWeightKg ? Number(inv.dispatchWeightKg).toLocaleString() : "—"}</TableCell>
                  <TableCell className="font-mono">{inv.pricePerKg ? Number(inv.pricePerKg).toFixed(2) : "—"}</TableCell>
                  <TableCell className="font-mono font-semibold">{inv.totalAmount ? Number(inv.totalAmount).toLocaleString() : "—"}</TableCell>
                  <TableCell>{inv.currency}</TableCell>
                  <TableCell>{inv.dueDate ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline">{inv.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
